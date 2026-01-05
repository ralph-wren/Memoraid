import React, { useState, useEffect } from 'react';
import { Download, FileText, Settings as SettingsIcon, Loader2, Copy, Eye, Code, Send, History, Trash2, ArrowLeft, X, RefreshCw } from 'lucide-react';
import { getHistory, deleteHistoryItem, HistoryItem, clearHistory } from '../utils/storage';
import { ExtractionResult } from '../utils/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

const MermaidChart = ({ code }: { code: string }) => {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    const renderChart = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        setSvg(svg);
      } catch (error) {
        console.error('Mermaid render error:', error);
        setSvg(`<pre class="text-red-500 text-xs">${code}</pre>`);
      }
    };
    renderChart();
  }, [code]);

  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
};

interface HomeProps {
  onOpenSettings: () => void;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type ViewState = 'home' | 'result' | 'history';

const Home: React.FC<HomeProps> = ({ onOpenSettings }) => {
  const [view, setView] = useState<ViewState>('home');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [result, setResult] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>(''); // Track current document title
  const [isPreview, setIsPreview] = useState(true);
  
  // History State
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  
  // Refinement Chat State
  const [refinementInput, setRefinementInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [isRefining, setIsRefining] = useState(false);

  const [progress, setProgress] = useState(0);
  const [logMessage, setLogMessage] = useState('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check for ongoing background task when popup opens
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (task) => {
      if (task) {
        updateFromTask(task);
      } else {
        // Fallback: Check storage directly in case message passing fails or SW was dormant
        chrome.storage.local.get(['currentTask'], (result) => {
          if (result.currentTask) {
            updateFromTask(result.currentTask);
          }
        });
      }
    });

    // Listen for updates
    const listener = (message: any) => {
      if (message.type === 'STATUS_UPDATE') {
        updateFromTask(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleCancel = async () => {
    try {
      // Immediately update UI state
      setLoading(false);
      setProgress(0);
      setStatus('Ready');
      setErrorMessage(null);
      setIsRefining(false);
      setLogMessage('');
      
      await chrome.runtime.sendMessage({ type: 'CANCEL_SUMMARIZATION' });
    } catch (error) {
      console.error('Cancel error:', error);
    }
  };

  const updateFromTask = (task: any) => {
    if (!task) {
      // If task is null but we were loading, it might have been cancelled
      if (loading) {
        setLoading(false);
        setProgress(0);
        setStatus('Ready');
      }
      return;
    }
    
    if (task.error) {
      setLoading(false);
      setStatus(`Error`);
      setErrorMessage(task.error);
      setLogMessage(task.message || task.error);
      setProgress(0);
      setIsRefining(false); // Stop refinement loading
      return;
    }

    // Determine if it's a main summarization task or refinement
    const isRefinementTask = task.status.startsWith('Refin') || task.status === 'Refined!';
    
    if (isRefinementTask) {
      setIsRefining(task.status !== 'Refined!');
      // Restore conversation history if available
      if (task.conversationHistory) {
        setConversationHistory(task.conversationHistory);
      }
    } else {
      setLoading(task.status !== 'Done!');
    }

    setStatus(task.status);
    setErrorMessage(null);
    setProgress(task.progress);
    setLogMessage(task.message || task.status);
    
    if (task.result) {
      setResult(task.result);
      if (task.title) {
        setCurrentTitle(task.title);
      }
      // Only switch view if we are not already in result view (to avoid jumping if user is refining)
      if (view !== 'result') {
        setView('result');
      }
    }
    
    // Always sync conversation history if present in task, to ensure we have the full context
    if (task.conversationHistory) {
      setConversationHistory(task.conversationHistory);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const items = await getHistory();
    setHistoryItems(items);
  };

  const handleSummarize = async () => {
    setLoading(true);
    setProgress(5);
    setStatus('Extracting chat content...');
    setLogMessage('Extracting chat content from page...');
    setResult(null);
    setErrorMessage(null);
    setConversationHistory([]); 

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' });
      
      if (!response) {
        throw new Error('No response from content script. Refresh the page?');
      }
      
      if (response.type === 'ERROR') {
        throw new Error(response.payload);
      }

      setLogMessage('Content extracted! Sending to background task...');

      const extraction: ExtractionResult = response.payload;
      console.log('Extracted:', extraction);
      
      if (extraction.title) {
        setCurrentTitle(extraction.title);
      }

      // Delegate to Background Script
      chrome.runtime.sendMessage({ 
        type: 'START_SUMMARIZATION', 
        payload: extraction 
      });

    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message);
      setStatus('Error');
      setLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!refinementInput.trim() || isRefining) return;
    
    setIsRefining(true);
    setStatus('Refining...');
    setErrorMessage(null);
    setProgress(5); // Initial progress
    
    try {
      const newHistory: ChatMessage[] = [
        ...conversationHistory,
        { role: 'user', content: refinementInput }
      ];

      // Optimistically update history locally
      setConversationHistory(newHistory);
      setRefinementInput('');

      // Delegate to Background Script
      await chrome.runtime.sendMessage({ 
        type: 'START_REFINEMENT', 
        payload: { messages: newHistory, title: currentTitle }
      });

    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message);
      setStatus('Refine Error');
      setIsRefining(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setStatus('Copied to clipboard!');
      setTimeout(() => setStatus('Done!'), 2000);
    });
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'summary.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleDeleteItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteHistoryItem(id);
    loadHistory();
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear all history?')) {
      await clearHistory();
      loadHistory();
    }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <img src="/logo.svg" className="w-8 h-8" alt="Logo" />
          Memoraid
        </h1>
        <div className="flex gap-2">
          <button onClick={loadHistory} className="p-2 hover:bg-gray-100 rounded-full" title="Refresh History">
            <RefreshCw className="w-5 h-5 text-gray-600" />
          </button>
          <button onClick={onOpenSettings} className="p-2 hover:bg-gray-100 rounded-full" title="Settings">
            <SettingsIcon className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center space-y-4 w-full">
        {view === 'home' && (
          <div className="w-full flex-1 flex flex-col min-h-0">
            <div className="text-center space-y-4 w-full flex flex-col items-center mb-8 shrink-0">
              
              {errorMessage && (
                <div className="w-full px-4 mb-2">
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-start gap-2 text-left">
                    <X className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="break-words">{errorMessage}</span>
                  </div>
                </div>
              )}

              <p className="text-gray-600 text-sm px-4">
                Open a ChatGPT or Gemini chat page and click the button below.
              </p>
              
              {!loading ? (
                <button
                  onClick={handleSummarize}
                  className="bg-black text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-gray-800 transition mx-auto"
                >
                  <FileText className="w-5 h-5" />
                  Summarize & Export
                </button>
              ) : (
                <div className="w-64 mx-auto space-y-3">
                   <div className="bg-gray-100 rounded-lg p-3 border flex flex-col gap-2">
                     <div className="flex justify-between items-center text-xs text-gray-500 font-medium">
                       <span className="flex items-center gap-2">
                         <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                         Processing...
                       </span>
                       <span>{progress}%</span>
                     </div>
                     
                     <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-1.5 rounded-full transition-all duration-300 ease-in-out" 
                          style={{ width: `${progress}%` }}
                        ></div>
                     </div>
                     
                     {/* Detailed Log Message */}
                     <p className="text-[10px] text-gray-400 text-center truncate px-1 h-4">
                       {logMessage}
                     </p>

                     <button 
                       onClick={handleCancel}
                       className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 py-1 rounded transition flex items-center justify-center gap-1 w-full mt-1"
                     >
                       <X className="w-3 h-3" /> Cancel
                     </button>
                   </div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0 w-full border-t pt-4">
               <div className="flex justify-between items-center mb-3 px-1 shrink-0">
                 <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                   <History className="w-4 h-4" />
                   Recent Documents
                 </h2>
                 {historyItems.length > 0 && (
                   <button onClick={handleClearHistory} className="text-[10px] text-gray-400 hover:text-red-500 uppercase tracking-wider font-bold">
                     Clear All
                   </button>
                 )}
               </div>
               
               <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                 {historyItems.length === 0 ? (
                   <div className="h-32 flex flex-col items-center justify-center text-gray-400">
                     <History className="w-8 h-8 mb-2 opacity-20" />
                     <p className="text-xs italic">No history yet.</p>
                   </div>
                 ) : (
                   historyItems.map(item => (
                     <div 
                       key={item.id}
                      onClick={() => {
                        setResult(item.content);
                        setCurrentTitle(item.title);
                        setView('result');
                      }}
                       className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer group flex justify-between items-start transition bg-white"
                     >
                       <div className="flex-1 min-w-0">
                         <h3 className="font-medium text-sm truncate" title={item.title}>{item.title}</h3>
                         <p className="text-[10px] text-gray-400 mt-0.5">
                           {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         </p>
                       </div>
                       <button 
                         onClick={(e) => handleDeleteItem(e, item.id)}
                         className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                     </div>
                   ))
                 )}
               </div>
            </div>
          </div>
        )}

        {view === 'history' && (
           <div className="w-full h-full flex flex-col">
             {/* This view is deprecated but kept for safety if state gets stuck */}
             <div className="flex justify-between items-center mb-4">
               <button onClick={() => setView('home')} className="flex items-center gap-1 text-sm text-gray-600 hover:text-black">
                 <ArrowLeft className="w-4 h-4" /> Back
               </button>
             </div>
           </div>
        )}

        {view === 'result' && result && (
          <div className="w-full space-y-4 h-full flex flex-col">
            <div className="flex justify-between items-center px-1">
              <span className="text-xs font-semibold text-gray-500">Result</span>
              <div className="flex gap-2">
                 <button
                  onClick={() => setIsPreview(!isPreview)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  {isPreview ? <Code className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {isPreview ? 'Show Code' : 'Preview'}
                </button>
                <button
                 onClick={() => {
                   setView('home');
                   loadHistory(); // Reload history when returning to home
                 }}
                 className="text-xs text-gray-500 hover:text-black"
              >
                Close
              </button>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border flex-1 overflow-y-auto min-h-0">
              {isPreview ? (
                <div className="prose prose-sm prose-slate max-w-none">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkFrontmatter]}
                    rehypePlugins={[rehypeSlug, rehypeRaw]}
                    components={{
                      code({node, inline, className, children, ...props}: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isMermaid = match && match[1] === 'mermaid';
                        
                        if (!inline && isMermaid) {
                          return <MermaidChart code={String(children).replace(/\n$/, '')} />;
                        }
                        
                        return !inline && match ? (
                          <pre className={className} {...props}>
                            <code>{children}</code>
                          </pre>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                      // Hide frontmatter content in preview
                      p: ({children}: any) => {
                         if (typeof children === 'string' && children.startsWith('---') && children.endsWith('---')) {
                           return null;
                         }
                         return <p>{children}</p>;
                      }
                    }}
                  >
                    {result.replace(/^---[\s\S]+?---/, '')} 
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs font-mono text-gray-700">
                  {result}
                </pre>
              )}
            </div>
            
            <div className="flex gap-2 shrink-0">
               <button
                onClick={handleCopy}
                className="flex-1 bg-blue-600 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-blue-700 transition"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
               <button
                onClick={handleDownload}
                className="flex-1 bg-green-600 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-green-700 transition"
              >
                <Download className="w-4 h-4" />
                MD
              </button>
              <button
                onClick={() => {
                  setView('home');
                  loadHistory();
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50 transition"
              >
                Back
              </button>
            </div>
            
            <div className="pt-2 border-t mt-2 shrink-0 flex flex-col gap-2">
              {/* Refinement Chat History */}
              {conversationHistory.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-2 p-2 bg-gray-50 rounded border text-xs mb-1">
                  {conversationHistory.filter(msg => msg.role !== 'system' && !(msg.role === 'user' && msg.content.includes('Please summarize'))).map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-2 rounded-lg ${
                        msg.role === 'user' 
                          ? 'bg-blue-100 text-blue-900 rounded-br-none' 
                          : 'bg-white border text-gray-800 rounded-bl-none shadow-sm'
                      }`}>
                         {msg.role === 'assistant' ? 'AI: ' : 'You: '}
                         {msg.content.length > 60 && msg.role === 'assistant' ? msg.content.substring(0, 60) + '...' : msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isRefining && (
                 <div className="mb-1 px-1">
                     <div className="flex justify-between items-center text-[10px] text-gray-500 font-medium mb-1">
                       <span className="flex items-center gap-1 truncate max-w-[200px]">
                         <Loader2 className="w-3 h-3 animate-spin text-purple-600" />
                         {logMessage || 'Refining...'}
                       </span>
                       <span>{progress}%</span>
                     </div>
                     <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                        <div 
                          className="bg-purple-600 h-1 rounded-full transition-all duration-300 ease-in-out" 
                          style={{ width: `${progress}%` }}
                        ></div>
                     </div>
                 </div>
              )}
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={refinementInput}
                  onChange={(e) => setRefinementInput(e.target.value)}
                  placeholder="Ask AI to refine (e.g. 'Make it shorter')..."
                  disabled={isRefining}
                  className="flex-1 p-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                {isRefining ? (
                  <button
                    onClick={handleCancel}
                    className="bg-red-500 text-white p-2 rounded hover:bg-red-600 transition flex items-center justify-center min-w-[36px]"
                    title="Cancel Refinement"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleRefine}
                    disabled={!refinementInput.trim()}
                    className="bg-purple-600 text-white p-2 rounded hover:bg-purple-700 disabled:opacity-50 transition min-w-[36px] flex items-center justify-center"
                    title="Send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto pt-4 border-t text-center text-xs text-gray-400 shrink-0">
        Status: {status}
      </div>
    </div>
  );
};

export default Home;
