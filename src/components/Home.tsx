import React, { useState, useEffect } from 'react';
import { Download, FileText, Settings as SettingsIcon, Loader2, Copy, Eye, Code, Send, History, Trash2, ArrowLeft, X, RefreshCw, Square, Github, Folder, UploadCloud, Check, Newspaper, BookOpen } from 'lucide-react';
import { getHistory, deleteHistoryItem, HistoryItem, clearHistory, getSettings } from '../utils/storage';
import { getDirectories, pushToGitHub } from '../utils/github';
import { ExtractionResult } from '../utils/types';
import { getTranslation, Translation } from '../utils/i18n';
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
        // Simple heuristic to check if code looks somewhat complete before rendering
        // Mermaid often throws hard errors on partial syntax
        if (!code || code.trim().length < 10) {
           throw new Error('Code too short');
        }

        // Validate syntax before rendering to avoid the "Bomb" error icon
        await mermaid.parse(code);

        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        setSvg(svg);
      } catch (error) {
        // While streaming or if syntax is invalid, show the code block gracefully.
        console.warn('Mermaid rendering failed:', error);
        setSvg(`<div class="p-2 bg-gray-50 border rounded text-xs font-mono text-gray-500 overflow-x-auto whitespace-pre-wrap">${code}</div>`);
      }
    };
    if (code) {
        renderChart();
    }
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
  const [t, setT] = useState<Translation>(getTranslation('zh-CN')); // 翻译
  
  const [userClosedResult, setUserClosedResult] = useState(false);
  const userClosedResultRef = React.useRef(userClosedResult);
  const viewRef = React.useRef(view);

  useEffect(() => {
    userClosedResultRef.current = userClosedResult;
  }, [userClosedResult]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 加载语言设置
  useEffect(() => {
    const loadLanguage = async () => {
      const settings = await getSettings();
      setT(getTranslation(settings.language || 'zh-CN'));
    };
    loadLanguage();
  }, []);
  
  // History State
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  
  // Refinement Chat State
  const [refinementInput, setRefinementInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [isRefining, setIsRefining] = useState(false);

  const [progress, setProgress] = useState(0);
  const [logMessage, setLogMessage] = useState('');

  const [errorMessage, setErrorMessage] = useState<React.ReactNode | null>(null);

  // GitHub Save State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveConfig, setSaveConfig] = useState({
    fileName: '',
    directory: '/',
    message: ''
  });
  const [repoDirs, setRepoDirs] = useState<string[]>([]);
  const [isLoadingDirs, setIsLoadingDirs] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResultUrl, setPushResultUrl] = useState<string | null>(null);

  useEffect(() => {
    // Check for ongoing background task when popup opens
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (task) => {
      if (task) {
        updateFromTask(task, false);
      } else {
        // Fallback: Check storage directly in case message passing fails or SW was dormant
        chrome.storage.local.get(['currentTask'], (result) => {
          if (result.currentTask) {
            updateFromTask(result.currentTask, false);
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

  // 从已有结果发布到头条
  const handlePublishToToutiao = async () => {
    const settings = await getSettings();
    if (!settings.toutiao?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }
    
    setStatus(t.publishingToToutiao);
    try {
      // Send to background
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_TO_TOUTIAO',
        payload: {
          title: currentTitle || 'Untitled',
          content: result
        }
      });
      
      if (response && response.success) {
        setStatus(t.publishSuccess);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e: any) {
      console.error(e);
      setStatus(t.publishFailed);
      alert(`${t.publishFailed}: ${e.message}`);
    }
  };

  // 从已有结果发布到知乎
  const handlePublishToZhihu = async () => {
    const settings = await getSettings();
    if (!settings.zhihu?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }
    
    setStatus(t.publishingToZhihu);
    try {
      // Send to background
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_TO_ZHIHU',
        payload: {
          title: currentTitle || 'Untitled',
          content: result
        }
      });
      
      if (response && response.success) {
        setStatus(t.publishSuccess);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e: any) {
      console.error(e);
      setStatus(t.publishFailed);
      alert(`${t.publishFailed}: ${e.message}`);
    }
  };

  // 一键生成文章并发布到头条
  const handleGenerateAndPublishToToutiao = async () => {
    const settings = await getSettings();
    if (!settings.toutiao?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }

    setLoading(true);
    setProgress(5);
    setStatus(t.extractingContent);
    setLogMessage(t.extractingContent);
    setResult(null);
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

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

      setLogMessage(t.contentExtracted);

      const extraction: ExtractionResult = response.payload;
      
      if (extraction.title) {
        setCurrentTitle(extraction.title);
      }

      // 发送生成并发布到头条的请求
      chrome.runtime.sendMessage({ 
        type: 'GENERATE_AND_PUBLISH_TOUTIAO', 
        payload: extraction 
      });

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;
      
      if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
        setErrorMessage(
          <div className="flex flex-col gap-2">
            <span>{t.connectionFailed}</span>
            <button 
              onClick={async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id) {
                  chrome.tabs.reload(tab.id);
                  window.close();
                }
              }}
              className="text-xs bg-red-100 hover:bg-red-200 text-red-800 py-1 px-2 rounded font-medium transition w-fit"
            >
              {t.refreshPage}
            </button>
          </div> as any
        );
      } else {
        setErrorMessage(errorMsg);
      }
      
      setStatus('Error');
      setLoading(false);
    }
  };

  // 一键生成文章并发布到知乎
  const handleGenerateAndPublishToZhihu = async () => {
    const settings = await getSettings();
    if (!settings.zhihu?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }

    setLoading(true);
    setProgress(5);
    setStatus(t.extractingContent);
    setLogMessage(t.extractingContent);
    setResult(null);
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

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

      setLogMessage(t.contentExtracted);

      const extraction: ExtractionResult = response.payload;
      
      if (extraction.title) {
        setCurrentTitle(extraction.title);
      }

      // 发送生成并发布到知乎的请求
      chrome.runtime.sendMessage({ 
        type: 'GENERATE_AND_PUBLISH_ZHIHU', 
        payload: extraction 
      });

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;
      
      if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
        setErrorMessage(
          <div className="flex flex-col gap-2">
            <span>{t.connectionFailed}</span>
            <button 
              onClick={async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id) {
                  chrome.tabs.reload(tab.id);
                  window.close();
                }
              }}
              className="text-xs bg-red-100 hover:bg-red-200 text-red-800 py-1 px-2 rounded font-medium transition w-fit"
            >
              {t.refreshPage}
            </button>
          </div> as any
        );
      } else {
        setErrorMessage(errorMsg);
      }
      
      setStatus('Error');
      setLoading(false);
    }
  };

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

  const updateFromTask = (task: any, allowAutoSwitch = true) => {
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
      // 保持 loading 状态，直到任务完成（Done!）或发布完成后跳转
      // Publishing... 状态也应该保持 loading
      const isDone = task.status === 'Done!' || task.status === 'Refined!';
      setLoading(!isDone);
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
        // AND if the user hasn't explicitly closed the result view for this session
        // Use refs to check current state to avoid stale closure in event listener
        if (viewRef.current !== 'result' && allowAutoSwitch && !userClosedResultRef.current) {
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
    setStatus(t.extractingContent);
    setLogMessage(t.extractingContent);
    setResult(null);
    setErrorMessage(null);
    setConversationHistory([]); 
    setUserClosedResult(false); // Reset this flag for new task 

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

      setLogMessage(t.contentExtracted);

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
      let errorMsg = error.message;
      
      // Handle "Could not establish connection" error specifically
      if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
          setErrorMessage(
            <div className="flex flex-col gap-2">
               <span>{t.connectionFailed}</span>
               <button 
                 onClick={async () => {
                   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                   if (tab?.id) {
                     chrome.tabs.reload(tab.id);
                     window.close(); // Close popup to force user to reopen after refresh
                   }
                 }}
                 className="text-xs bg-red-100 hover:bg-red-200 text-red-800 py-1 px-2 rounded font-medium transition w-fit"
               >
                 {t.refreshPage}
               </button>
            </div> as any
          );
      } else {
          setErrorMessage(errorMsg);
      }
      
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

  const handleOpenSaveModal = async () => {
    const settings = await getSettings();
    if (!settings.github?.token || !settings.github?.repo) {
      if (confirm(t.githubNotConfigured)) {
        onOpenSettings();
      }
      return;
    }

    // Pre-fill
    let safeTitle = (currentTitle || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').trim();
    if (!safeTitle.endsWith('.md')) safeTitle += '.md';
    
    // Load last used directory
    let defaultDir = '/';
    try {
      const storage = await chrome.storage.local.get(['lastGithubDir']);
      if (storage.lastGithubDir) {
        defaultDir = storage.lastGithubDir;
      }
    } catch (e) {
      console.error('Failed to load last dir', e);
    }

    setSaveConfig({
      fileName: safeTitle,
      directory: defaultDir, 
      message: `Add ${safeTitle}`
    });
    setPushResultUrl(null);
    setIsSaveModalOpen(true);
    
    // Fetch directories
    setIsLoadingDirs(true);
    try {
      const dirs = await getDirectories(settings.github);
      setRepoDirs(dirs);
    } catch (e) {
      console.error(e);
      setRepoDirs(['/']); // Fallback
    } finally {
      setIsLoadingDirs(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      const settings = await getSettings();
      if (!settings.github) throw new Error('No settings');
      
      const dir = saveConfig.directory === '/' ? '' : saveConfig.directory;
      // Ensure no double slashes
      const fullPath = dir ? `${dir}/${saveConfig.fileName}` : saveConfig.fileName;
      
      const pushResponse = await pushToGitHub(
        settings.github,
        fullPath,
        result || '',
        saveConfig.message
      );
      
      // Save last used directory
      chrome.storage.local.set({ lastGithubDir: saveConfig.directory });

      setPushResultUrl(pushResponse.url);
      setStatus(t.pushedToGithub);
    } catch (e: any) {
      alert(`${t.publishFailed}: ${e.message}`);
    } finally {
      setIsPushing(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setStatus(t.copiedToClipboard);
      setTimeout(() => setStatus('Done!'), 2000);
    });
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Sanitize title for filename
    let safeTitle = (currentTitle || 'summary').replace(/[\\/:*?"<>|]/g, '-').trim();
    if (!safeTitle) safeTitle = 'summary';
    if (!safeTitle.toLowerCase().endsWith('.md')) safeTitle += '.md';
    
    a.download = safeTitle;
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
    if (confirm(t.confirmClearHistory)) {
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
        <div className="flex gap-1">
          <a 
            href="https://github.com/ralph-wren/memoraid" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 rounded-full transition"
            title="View on GitHub"
          >
            <Github className="w-5 h-5 text-gray-600" />
          </a>
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
                {t.homeDescription}
              </p>
              
              {!loading ? (
                <div className="flex flex-col gap-3 w-full items-center">
                  {/* 三个主要功能按钮放在一起 */}
                  <div className="flex gap-2 w-72">
                    <button
                      onClick={handleSummarize}
                      className="flex-1 bg-gray-700 text-white px-3 py-3 rounded-lg flex items-center gap-1.5 hover:bg-gray-800 transition justify-center"
                      title={t.generateTechDoc}
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-sm font-medium">{t.generateTechDoc}</span>
                    </button>
                    <button
                      onClick={handleGenerateAndPublishToToutiao}
                      className="flex-1 bg-red-600 text-white px-3 py-3 rounded-lg flex items-center gap-1.5 hover:bg-red-700 transition justify-center"
                      title={t.publishToToutiao}
                    >
                      <Newspaper className="w-4 h-4" />
                      <span className="text-sm font-medium">{t.publishToToutiao}</span>
                    </button>
                    <button
                      onClick={handleGenerateAndPublishToZhihu}
                      className="flex-1 bg-blue-500 text-white px-3 py-3 rounded-lg flex items-center gap-1.5 hover:bg-blue-600 transition justify-center"
                      title={t.publishToZhihu}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span className="text-sm font-medium">{t.publishToZhihu}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-64 mx-auto space-y-3">
                   <div className="bg-gray-100 rounded-lg p-3 border flex flex-col gap-2">
                     <div className="flex justify-between items-center text-xs text-gray-500 font-medium">
                       <span className="flex items-center gap-2">
                         <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                         {t.processing}
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

                     {result && (
                       <button 
                         onClick={() => {
                           setView('result');
                           setUserClosedResult(false);
                         }}
                         className="text-xs bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 py-1.5 rounded transition flex items-center justify-center gap-1.5 w-full mt-1 font-medium"
                       >
                         <Eye className="w-3 h-3" /> {t.viewLiveResult}
                       </button>
                     )}

                     <button 
                       onClick={handleCancel}
                       className="text-xs border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 py-1.5 rounded transition flex items-center justify-center gap-1.5 w-full mt-1 font-medium"
                     >
                       <Square className="w-3 h-3 fill-current" /> {t.stopGenerating}
                     </button>
                   </div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0 w-full border-t pt-4">
               <div className="flex justify-between items-center mb-3 px-1 shrink-0">
                 <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                   <History className="w-4 h-4" />
                   {t.recentDocuments}
                 </h2>
                 {historyItems.length > 0 && (
                   <button onClick={handleClearHistory} className="text-[10px] text-gray-400 hover:text-red-500 uppercase tracking-wider font-bold">
                     {t.clearAll}
                   </button>
                 )}
               </div>
               
               <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                 {historyItems.length === 0 ? (
                   <div className="h-32 flex flex-col items-center justify-center text-gray-400">
                     <History className="w-8 h-8 mb-2 opacity-20" />
                     <p className="text-xs italic">{t.noHistoryYet}</p>
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
            <div className="flex justify-between items-center px-1 mb-2">
              <span className="text-xs font-semibold text-gray-500">{t.result}</span>
              <div className="flex gap-2">
                 <button
                  onClick={() => setIsPreview(!isPreview)}
                  className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded transition shadow-sm font-medium"
                >
                  {isPreview ? <Code className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {isPreview ? t.showCode : t.preview}
                </button>
                <button
                 onClick={() => {
                   setView('home');
                   setUserClosedResult(true); // Mark as explicitly closed
                   loadHistory(); // Reload history when returning to home
                 }}
                 className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 text-gray-700 px-3 py-1.5 rounded transition shadow-sm font-medium"
              >
                <X className="w-3.5 h-3.5" />
                {t.close}
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
                title={t.copy}
              >
                <Copy className="w-4 h-4" />
                <span className="text-xs">{t.copy}</span>
              </button>
               <button
                onClick={handleDownload}
                className="flex-1 bg-green-600 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-green-700 transition"
                title={t.downloadMarkdown}
              >
                <Download className="w-4 h-4" />
                <span className="text-xs">{t.downloadMarkdown}</span>
              </button>
              <button
                onClick={handleOpenSaveModal}
                className="flex-1 bg-gray-800 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-gray-900 transition"
                title={t.save}
              >
                <UploadCloud className="w-4 h-4" />
                <span className="text-xs">{t.save}</span>
              </button>
            </div>

            <div className="flex gap-2 shrink-0 mt-2">
               <button
                onClick={handlePublishToToutiao}
                className="flex-1 bg-red-600 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-red-700 transition"
                title={t.toutiao}
              >
                <Newspaper className="w-4 h-4" />
                <span className="text-xs">{t.toutiao}</span>
              </button>
               <button
                onClick={handlePublishToZhihu}
                className="flex-1 bg-blue-500 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-blue-600 transition"
                title={t.zhihu}
              >
                <BookOpen className="w-4 h-4" />
                <span className="text-xs">{t.zhihu}</span>
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
                  placeholder={t.refinePromptPlaceholder}
                  disabled={isRefining}
                  className="flex-1 p-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                {isRefining ? (
                  <button
                    onClick={handleCancel}
                    className="bg-red-500 text-white p-2 rounded hover:bg-red-600 transition flex items-center justify-center min-w-[36px]"
                    title="Stop Generating"
                  >
                    <Square className="w-3 h-3 fill-current" />
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
        {t.status}: {status}
      </div>

      {/* Save Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-3 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <Github className="w-4 h-4" /> {t.saveToGithub}
              </h3>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-gray-500 hover:text-black">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto">
              {pushResultUrl ? (
                <div className="text-center py-4 space-y-3">
                  <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-green-600 font-medium">{t.successfullyPushed}</p>
                  <a 
                    href={pushResultUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm break-all block"
                  >
                    {t.viewOnGithub}
                  </a>
                  <button 
                    onClick={() => setIsSaveModalOpen(false)}
                    className="w-full bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200"
                  >
                    {t.close}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{t.fileName}</label>
                    <input 
                      type="text" 
                      value={saveConfig.fileName}
                      onChange={e => setSaveConfig({...saveConfig, fileName: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{t.directory}</label>
                    {isLoadingDirs ? (
                      <div className="p-2 text-xs text-gray-500 flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> {t.loadingDirectories}
                      </div>
                    ) : (
                      <div className="relative">
                        <select
                          value={saveConfig.directory}
                          onChange={e => setSaveConfig({...saveConfig, directory: e.target.value})}
                          className="w-full p-2 border rounded text-sm appearance-none"
                        >
                          <option value="/">/ (Root)</option>
                          {repoDirs.map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                        <Folder className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{t.commitMessage}</label>
                    <input 
                      type="text" 
                      value={saveConfig.message}
                      onChange={e => setSaveConfig({...saveConfig, message: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      placeholder={t.commitMessage}
                    />
                  </div>
                  
                  <button
                    onClick={handlePush}
                    disabled={isPushing || !saveConfig.fileName}
                    className="w-full bg-black text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-gray-800 disabled:opacity-50 transition"
                  >
                    {isPushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {isPushing ? t.pushing : t.pushToGithub}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
