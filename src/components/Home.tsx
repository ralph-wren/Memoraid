import React, { useState, useEffect } from 'react';
import { Download, FileText, Settings as SettingsIcon, Loader2, Copy, Eye, Code, Send, History, Trash2, ArrowLeft, X, Square, Github, Folder, UploadCloud, Check, Newspaper, BookOpen, MessageCircle, BookHeart, Bug, BarChart3, MessageSquare } from 'lucide-react';
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
  const [currentSourceUrl, setCurrentSourceUrl] = useState<string>(''); // Track source URL
  const [currentSourceImages, setCurrentSourceImages] = useState<string[]>([]); // Track source images
  const [isPreview, setIsPreview] = useState(true);
  const [t, setT] = useState<Translation>(getTranslation('zh-CN')); // 翻译
  // 额度信息状态 - 使用 undefined 表示未加载，null 表示加载失败，对象表示加载成功
  const [quota, setQuota] = useState<{
    total_remaining: number;
    free_remaining: number;
    paid_remaining: number;
  } | null | undefined>(undefined);

  const [userClosedResult, setUserClosedResult] = useState(false);
  const userClosedResultRef = React.useRef(userClosedResult);
  const viewRef = React.useRef(view);

  // 反馈弹窗状态
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'experience' | 'suggestion' | 'bug'>('experience');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSubmitStatus, setFeedbackSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState('');

  useEffect(() => {
    userClosedResultRef.current = userClosedResult;
  }, [userClosedResult]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 用户登录状态
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  // 加载用户额度信息 - 使用缓存机制
  const loadQuota = React.useCallback(async (forceRefresh = false) => {
    try {
      // 检查 chrome.storage 是否可用
      if (!chrome?.storage?.local) {
        console.error('chrome.storage.local is not available');
        setQuota(null);
        return;
      }

      // 如果不是强制刷新，先尝试从缓存读取
      if (!forceRefresh) {
        try {
          const cached = await chrome.storage.local.get(['quotaCache', 'quotaCacheTime']);
          const now = Date.now();
          const cacheExpiry = 5 * 60 * 1000; // 5分钟缓存有效期
          
          // 如果缓存存在且未过期，直接使用缓存
          if (cached.quotaCache && cached.quotaCacheTime && (now - cached.quotaCacheTime < cacheExpiry)) {
            setQuota(cached.quotaCache);
            // 清除可能存在的错误信息
            setErrorMessage(null);
            return;
          }
        } catch (cacheError) {
          console.warn('Failed to read cache:', cacheError);
          // 缓存读取失败，继续从服务器获取
        }
      }
      
      // 缓存不存在、已过期或强制刷新，从服务器获取
      const settings = await getSettings();
      const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
      const token = settings.sync?.token;
      const anonymousId = settings.anonymousId;
      
      // 构建请求头
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // 优先使用 token，如果没有则使用匿名 ID
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (anonymousId) {
        headers['X-Anonymous-ID'] = anonymousId;
      }
      
      const response = await fetch(`${backendUrl}/api/user/quota`, {
        method: 'GET',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        setQuota(data);
        // 成功加载额度，清除错误信息
        setErrorMessage(null);
        // 保存到缓存
        try {
          const now = Date.now();
          await chrome.storage.local.set({
            quotaCache: data,
            quotaCacheTime: now
          });
        } catch (cacheError) {
          console.warn('Failed to save cache:', cacheError);
          // 缓存保存失败不影响功能
        }
      } else {
        // 加载失败，设置为 null
        console.error('Failed to load quota: HTTP', response.status);
        setQuota(null);
      }
    } catch (error) {
      console.error('Failed to load quota:', error);
      // 加载失败，设置为 null
      setQuota(null);
    }
  }, []);

  // 加载语言设置和额度信息
  useEffect(() => {
    const loadLanguage = async () => {
      const settings = await getSettings();
      setT(getTranslation(settings.language || 'zh-CN'));
      // 检查用户是否已登录（有token表示已登录）
      setIsLoggedIn(!!settings.sync?.token);
    };
    loadLanguage();
    
    // 首次加载额度信息（强制刷新，不使用缓存）
    loadQuota(true);
  }, [loadQuota]);

  // History State
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  // Refinement Chat State
  const [refinementInput, setRefinementInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [isRefining, setIsRefining] = useState(false);

  const [progress, setProgress] = useState(0);
  const [logMessage, setLogMessage] = useState('');
  // Token 消耗统计（每次 AI 调用后更新）
  const [tokenUsage, setTokenUsage] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number } | null>(null);

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

    // 监听标签页更新事件，当页面导航时清除错误状态
    const tabUpdateListener = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === 'loading') {
        // 页面正在导航，清除可能的 bfcache 相关错误
        setErrorMessage(null);
      }
    };
    chrome.tabs.onUpdated.addListener(tabUpdateListener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
    };
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
          content: result,
          sourceUrl: currentSourceUrl,
          sourceImages: currentSourceImages
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
          content: result,
          sourceUrl: currentSourceUrl,
          sourceImages: currentSourceImages
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

  // 从已有结果发布到微信公众号
  const handlePublishToWeixin = async () => {
    const settings = await getSettings();
    if (!settings.weixin?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }

    setStatus(t.publishingToWeixin || '正在发布到公众号...');
    try {
      // Send to background
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_TO_WEIXIN',
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

  // 从已有结果发布到小红书
  const handlePublishToXiaohongshu = async () => {
    const settings = await getSettings();
    if (!settings.xiaohongshu?.cookie) {
      if (confirm(t.cookieMissing)) {
        onOpenSettings();
      }
      return;
    }

    setStatus(t.publishingToXiaohongshu || '正在发布到小红书...');
    try {
      // Send to background
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_TO_XIAOHONGSHU',
        payload: {
          title: currentTitle || 'Untitled',
          content: result,
          sourceUrl: currentSourceUrl,
          sourceImages: currentSourceImages
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

  // 一键生成文章并发布到小红书
  const handleGenerateAndPublishToXiaohongshu = async () => {
    const settings = await getSettings();
    if (!settings.xiaohongshu?.cookie) {
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
    setTokenUsage(null); // 清除上次的 token 消耗统计
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // 将抓取和生成逻辑移至 background，避免关闭 popup 中断任务
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GENERATE_AND_PUBLISH',
        payload: {
          platform: 'xiaohongshu',
          tabId: tab.id
        }
      });

      if (!response?.success) {
        throw new Error(response?.error || '无法启动后台任务');
      }

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;

      if (
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('message channel closed') ||
        errorMsg.includes('asynchronous response')
      ) {
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
    setTokenUsage(null); // 清除上次的 token 消耗统计
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // 将抓取和生成逻辑移至 background，避免关闭 popup 中断任务
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GENERATE_AND_PUBLISH',
        payload: {
          platform: 'toutiao',
          tabId: tab.id
        }
      });

      if (!response?.success) {
        throw new Error(response?.error || '无法启动后台任务');
      }

      // 不需要在这里处理 extraction 结果，background 会通过 storage 更新状态
      // 这里的 loading 状态会由 updateFromTask 维持

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;

      if (
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('message channel closed') ||
        errorMsg.includes('asynchronous response')
      ) {
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
    setTokenUsage(null); // 清除上次的 token 消耗统计
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // 将抓取和生成逻辑移至 background，避免关闭 popup 中断任务
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GENERATE_AND_PUBLISH',
        payload: {
          platform: 'zhihu',
          tabId: tab.id
        }
      });

      if (!response?.success) {
        throw new Error(response?.error || '无法启动后台任务');
      }

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;

      if (
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('message channel closed') ||
        errorMsg.includes('asynchronous response')
      ) {
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

  // 一键生成文章并发布到微信公众号
  const handleGenerateAndPublishToWeixin = async () => {
    const settings = await getSettings();
    if (!settings.weixin?.cookie) {
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
    setTokenUsage(null); // 清除上次的 token 消耗统计
    setErrorMessage(null);
    setConversationHistory([]);
    setUserClosedResult(false);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // 将抓取和生成逻辑移至 background，避免关闭 popup 中断任务
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GENERATE_AND_PUBLISH',
        payload: {
          platform: 'weixin',
          tabId: tab.id
        }
      });

      if (!response?.success) {
        throw new Error(response?.error || '无法启动后台任务');
      }

    } catch (error: any) {
      console.error(error);
      let errorMsg = error.message;

      if (
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('message channel closed') ||
        errorMsg.includes('asynchronous response')
      ) {
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
      // 过滤掉 bfcache 相关的错误和一些常见的无害错误
      const errorStr = String(task.error).toLowerCase();
      const isBfcacheError = errorStr.includes('back/forward cache') ||
        errorStr.includes('bfcache') ||
        errorStr.includes('message channel is closed') ||
        errorStr.includes('extension port is moved');
      
      // 过滤掉 React 内部错误（通常是由于组件卸载导致的）
      const isReactInternalError = errorStr.includes('cannot read properties of undefined') ||
        errorStr.includes('cannot read property') ||
        errorStr.includes('is not a function');

      if (isBfcacheError || isReactInternalError) {
        // 静默忽略这些错误，只在控制台记录
        console.log('[Memoraid] Ignoring harmless error:', task.error);
        return;
      }

      setLoading(false);
      setStatus(`Error`);
      setErrorMessage(task.error);
      setLogMessage(task.message || task.error);
      setProgress(0);
      setIsRefining(false); // Stop refinement loading
      return;
    }

    const statusText =
      typeof task.status === 'string'
        ? task.status
        : task.status == null
          ? ''
          : String(task.status);

    // Determine if it's a main summarization task or refinement
    const isRefinementTask = statusText.startsWith('Refin') || statusText === 'Refined!';

    if (isRefinementTask) {
      setIsRefining(statusText !== 'Refined!');
      // Restore conversation history if available
      if (task.conversationHistory) {
        setConversationHistory(task.conversationHistory);
      }
    } else {
      // 保持 loading 状态，直到任务完成（Done!）或发布完成后跳转
      // Publishing... 状态也应该保持 loading
      const isDone = statusText === 'Done!' || statusText === 'Refined!';
      setLoading(!isDone);
      
      // 如果任务完成，清除额度缓存并重新加载额度信息
      if (isDone) {
        chrome.storage.local.remove(['quotaCache', 'quotaCacheTime']);
        // 重新加载额度信息（强制刷新）
        loadQuota(true);
      }
    }

    setStatus(statusText || 'Ready');
    setErrorMessage(null);
    setProgress(task.progress);
    setLogMessage(task.message || statusText);

    if (task.result) {
      setResult(task.result);
      if (task.title) {
        setCurrentTitle(task.title);
      }
      if (task.sourceUrl) {
        setCurrentSourceUrl(task.sourceUrl);
      }
      if (task.sourceImages) {
        setCurrentSourceImages(task.sourceImages);
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

    // 更新 token 消耗统计
    if (task.tokenUsage) {
      setTokenUsage(task.tokenUsage);
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
    setTokenUsage(null); // 清除上次的 token 消耗统计
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

  // 提交用户反馈
  const handleSubmitFeedback = async () => {
    if (!feedbackContent.trim()) {
      setFeedbackSubmitStatus('error');
      setFeedbackErrorMessage('请输入反馈内容');
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackSubmitStatus('idle');
    setFeedbackErrorMessage('');
    
    try {
      const settings = await getSettings();
      const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
      const token = settings.sync?.token;
      const anonymousId = settings.anonymousId;

      // 构建请求头
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // 优先使用 token，如果没有则使用匿名 ID
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (anonymousId) {
        headers['X-Anonymous-ID'] = anonymousId;
      }

      const response = await fetch(`${backendUrl}/api/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: feedbackType,
          content: feedbackContent.trim()
        })
      });

      if (response.ok) {
        setFeedbackSubmitStatus('success');
        // 2秒后自动关闭弹窗
        setTimeout(() => {
          setIsFeedbackModalOpen(false);
          setFeedbackContent('');
          setFeedbackType('experience');
          setFeedbackSubmitStatus('idle');
        }, 2000);
      } else {
        const error = await response.json();
        setFeedbackSubmitStatus('error');
        setFeedbackErrorMessage(error.error || '提交失败，请稍后重试');
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      setFeedbackSubmitStatus('error');
      setFeedbackErrorMessage('网络错误，请稍后重试');
    } finally {
      setIsSubmittingFeedback(false);
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
        <div className="flex flex-col">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <img src="/logo.svg" className="w-8 h-8" alt="Logo" />
            Memoraid
          </h1>
          <p className="text-[10px] text-gray-400 ml-10">{t.slogan}</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => window.open('http://memoraid.dpdns.org/user', '_blank')}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-600"
            title="文章数据统计"
          >
            <BarChart3 className="w-5 h-5 text-indigo-500" />
          </button>
          <button
            onClick={() => setIsFeedbackModalOpen(true)}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-600"
            title="用户反馈"
          >
            <MessageSquare className="w-5 h-5 text-blue-500" />
          </button>
          <a
            href="https://github.com/ralph-wren/Memoraid"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 rounded-full text-gray-600"
            title="GitHub"
          >
            <Github className="w-5 h-5" />
          </a>
          <a
            href="https://github.com/ralph-wren/Memoraid/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 rounded-full text-gray-600"
            title="Report Bug"
          >
            <Bug className="w-5 h-5" />
          </a>
          <button onClick={onOpenSettings} className="p-2 hover:bg-gray-100 rounded-full" title="Settings">
            <SettingsIcon className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* 版本更新通知 - 自动滚动跑马灯 */}
      <div className="mb-3 px-4">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg px-3 py-1.5 overflow-hidden">
          <div className="animate-marquee whitespace-nowrap text-xs inline-block">
            <span className="text-blue-600 font-medium">🎉 v1.3.0 新功能：</span>
            <span className="text-gray-600">支持定时任务创建文章 | 支持充值文章额度 | 新增用户反馈功能 | 完善文章数据统计功能 | 优化账号同步功能</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center space-y-4 w-full">
        {view === 'home' && (
          <div className="w-full flex-1 flex flex-col min-h-0">
            <div className="text-center space-y-4 w-full flex flex-col items-center mb-8 shrink-0">

              {/* 额度显示和充值按钮 - 始终显示框架，内容为空直到加载完成 */}
              <div className="w-full px-4 mb-2">
                <div className="border rounded-lg px-4 py-3 text-sm flex items-center justify-between bg-blue-50 border-blue-200">
                  <div className="flex flex-col items-start">
                    <span className="font-medium text-blue-700">
                      剩余额度: {
                        quota === undefined ? '加载中...' : 
                        quota === null ? '加载失败' :
                        quota.total_remaining !== undefined ? `${quota.total_remaining} 次` : '0 次'
                      }
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      {quota && quota.free_remaining !== undefined && quota.paid_remaining !== undefined 
                        ? `免费: ${quota.free_remaining} | 付费: ${quota.paid_remaining}`
                        : quota === undefined ? '正在获取额度信息...' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => window.open('https://memoraid.dpdns.org/user', '_blank')}
                    className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-xs font-medium hover:from-blue-600 hover:to-purple-700 transition shadow-sm"
                  >
                    充值
                  </button>
                </div>
              </div>

              {/* 未登录用户额度用完提示 */}
              {!isLoggedIn && quota && quota.free_remaining === 0 && quota.paid_remaining === 0 && (
                <div className="w-full px-4 mb-2">
                  <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg px-4 py-3 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-orange-500 text-lg">🎁</span>
                      <div className="flex-1">
                        <p className="font-medium text-orange-800 mb-1">
                          免费额度已用完
                        </p>
                        <p className="text-xs text-orange-700 mb-2">
                          登录账号即可获赠更多免费额度，继续创作精彩内容！
                        </p>
                        <button
                          onClick={() => window.open('https://memoraid.dpdns.org/user', '_blank')}
                          className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:from-orange-600 hover:to-yellow-600 transition shadow-sm"
                        >
                          立即登录领取
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="w-full px-4 mb-2">
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-start gap-2 text-left">
                    <X className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="break-words flex-1">{errorMessage}</span>
                    <button 
                      onClick={() => setErrorMessage(null)}
                      className="text-red-400 hover:text-red-600 transition shrink-0"
                      title="关闭"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <p className="text-gray-600 text-sm px-4">
                {t.homeDescription}
              </p>

              {!loading ? (
                <div className="flex flex-col gap-3 w-full items-center">
                  {/* 四个主要功能按钮放在一起 - 公众号放最前，写文档放最后 */}
                  <div className="flex gap-2 w-96">
                    <button
                      onClick={handleGenerateAndPublishToWeixin}
                      className="flex-1 bg-green-500 text-white px-2 py-3 rounded-lg flex items-center gap-1 hover:bg-green-600 transition justify-center"
                      title={t.publishToWeixin || '发公众号'}
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span className="text-xs font-medium whitespace-nowrap">{t.publishToWeixin || '公众号'}</span>
                    </button>
                    <button
                      onClick={handleGenerateAndPublishToToutiao}
                      className="flex-1 bg-red-600 text-white px-2 py-3 rounded-lg flex items-center gap-1 hover:bg-red-700 transition justify-center"
                      title={t.publishToToutiao}
                    >
                      <Newspaper className="w-4 h-4" />
                      <span className="text-xs font-medium whitespace-nowrap">{t.publishToToutiao}</span>
                    </button>
                    <button
                      onClick={handleGenerateAndPublishToZhihu}
                      className="flex-1 bg-blue-500 text-white px-2 py-3 rounded-lg flex items-center gap-1 hover:bg-blue-600 transition justify-center"
                      title={t.publishToZhihu}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span className="text-xs font-medium whitespace-nowrap">{t.publishToZhihu}</span>
                    </button>
                    <button
                      onClick={handleGenerateAndPublishToXiaohongshu}
                      className="flex-1 bg-pink-500 text-white px-2 py-3 rounded-lg flex items-center gap-1 hover:bg-pink-600 transition justify-center"
                      title={t.publishToXiaohongshu}
                    >
                      <BookHeart className="w-4 h-4" />
                      <span className="text-xs font-medium whitespace-nowrap">{t.publishToXiaohongshu}</span>
                    </button>
                    <button
                      onClick={handleSummarize}
                      className="flex-1 bg-gray-700 text-white px-2 py-3 rounded-lg flex items-center gap-1 hover:bg-gray-800 transition justify-center"
                      title={t.generateTechDoc}
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-xs font-medium whitespace-nowrap">{t.generateTechDoc}</span>
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
              {/* 移除"结果"文字标签 */}
              <div></div>
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
                      code({ node, inline, className, children, ...props }: any) {
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
                      p: ({ children }: any) => {
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

            {/* Token 消耗统计显示 */}
            {tokenUsage && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700 flex items-center justify-between shrink-0">
                <span className="font-medium">Token 消耗</span>
                <span>
                  输入 {tokenUsage.promptTokens.toLocaleString()} / 输出 {tokenUsage.completionTokens.toLocaleString()} / 总计 {tokenUsage.totalTokens.toLocaleString()}
                </span>
              </div>
            )}

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
                onClick={handlePublishToWeixin}
                className="flex-1 bg-green-500 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-green-600 transition"
                title={t.weixin || '公众号'}
              >
                <MessageCircle className="w-4 h-4" />
                <span className="text-xs">{t.weixin || '公众号'}</span>
              </button>
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
              <button
                onClick={handlePublishToXiaohongshu}
                className="flex-1 bg-pink-500 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-pink-600 transition"
                title={t.xiaohongshu}
              >
                <BookHeart className="w-4 h-4" />
                <span className="text-xs">{t.xiaohongshu}</span>
              </button>
            </div>

            <div className="pt-2 border-t mt-2 shrink-0 flex flex-col gap-2">
              {/* Refinement Chat History */}
              {conversationHistory.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-2 p-2 bg-gray-50 rounded border text-xs mb-1">
                  {conversationHistory.filter(msg => msg.role !== 'system' && !(msg.role === 'user' && msg.content.includes('Please summarize'))).map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-2 rounded-lg ${msg.role === 'user'
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
                      onChange={e => setSaveConfig({ ...saveConfig, fileName: e.target.value })}
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
                          onChange={e => setSaveConfig({ ...saveConfig, directory: e.target.value })}
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
                      onChange={e => setSaveConfig({ ...saveConfig, message: e.target.value })}
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

      {/* 用户反馈弹窗 */}
      {isFeedbackModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                用户反馈
              </h3>
              <button
                onClick={() => {
                  setIsFeedbackModalOpen(false);
                  setFeedbackContent('');
                  setFeedbackType('experience');
                  setFeedbackSubmitStatus('idle');
                  setFeedbackErrorMessage('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* 反馈类型选择 */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">反馈类型</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFeedbackType('experience')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                      feedbackType === 'experience'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    使用体验
                  </button>
                  <button
                    onClick={() => setFeedbackType('suggestion')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                      feedbackType === 'suggestion'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    优化建议
                  </button>
                  <button
                    onClick={() => setFeedbackType('bug')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                      feedbackType === 'bug'
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    问题反馈
                  </button>
                </div>
              </div>

              {/* 反馈内容输入 */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">反馈内容</label>
                <textarea
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  placeholder={
                    feedbackType === 'experience'
                      ? '请分享您的使用体验...'
                      : feedbackType === 'suggestion'
                      ? '请提出您的优化建议...'
                      : '请描述您遇到的问题...'
                  }
                  className="w-full p-3 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                />
                <p className="text-xs text-gray-400">
                  {feedbackContent.length} / 500 字符
                </p>
              </div>

              {/* 状态提示 */}
              {feedbackSubmitStatus === 'success' && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>感谢您的反馈！我们会认真查看并改进。</span>
                </div>
              )}
              {feedbackSubmitStatus === 'error' && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                  <X className="w-4 h-4" />
                  <span>{feedbackErrorMessage}</span>
                </div>
              )}

              {/* 提交按钮 */}
              <button
                onClick={handleSubmitFeedback}
                disabled={isSubmittingFeedback || !feedbackContent.trim() || feedbackSubmitStatus === 'success'}
                className="w-full bg-blue-500 text-white py-2.5 rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {isSubmittingFeedback ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    提交中...
                  </>
                ) : feedbackSubmitStatus === 'success' ? (
                  <>
                    <Check className="w-4 h-4" />
                    提交成功
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    提交反馈
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
