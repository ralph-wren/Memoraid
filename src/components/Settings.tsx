import React, { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS, getSettings, saveSettings, syncSettings, restoreSettings, ArticleStyleSettings } from '../utils/storage';
import { SYSTEM_PROMPTS, TOUTIAO_DEFAULT_PROMPT, ZHIHU_DEFAULT_PROMPT, WEIXIN_DEFAULT_PROMPT, XIAOHONGSHU_DEFAULT_PROMPT, PROMPT_VERSIONS } from '../utils/prompts';
import { getTranslation } from '../utils/i18n';
import { Eye, EyeOff, Loader2, CheckCircle, XCircle, Newspaper, RefreshCw, Cloud, Lock, Key, Palette, Send, BookOpen, RotateCcw, FileText, MessageCircle, Github, Heart } from 'lucide-react';
import { validateGitHubConnection } from '../utils/github';
import { generateRandomString } from '../utils/crypto';

const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }
];

interface ProviderConfig {
  name: string;
  baseUrl: string;
  models: string[];
  isShared?: boolean; // 是否是共享密钥（用户无法查看）
}

// 后端 API 地址
const BACKEND_URL = 'http://memoraid.dpdns.org';

const PROVIDERS: Record<string, ProviderConfig> = {
  'memoraid': {
    name: '🆓 Memoraid (Free - DeepSeek, 10 articles/user)',
    baseUrl: 'https://memoraid.dpdns.org/api/ai',
    models: ['deepseek-chat'],
    isShared: true
  },
  'apiyi': {
    name: 'API Yi (Recommended, Supports Multiple Models)',
    baseUrl: 'https://api.apiyi.com/v1',
    models: ['gpt-4o', 'gpt-4-turbo', 'claude-3-5-sonnet', 'claude-3-opus', 'gemini-1.5-pro', 'yi-large', 'deepseek-chat']
  },
  'deepseek': {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-coder']
  },
  'dashscope': {
    name: 'Aliyun Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long']
  },
  'zhipu': {
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-air', 'glm-4-flash', 'glm-3-turbo']
  },
  'moonshot': {
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  'doubao': {
    name: 'Doubao (Volcengine)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['ep-2024...', 'doubao-pro-32k', 'doubao-lite-32k'] // 提示用户通常需要 Endpoint ID
  },
  'openai': {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o']
  },
  'custom': {
    name: 'Custom',
    baseUrl: '',
    models: []
  }
};

const getProviderLink = (provider: string): string | null => {
  switch (provider) {
    case 'memoraid':
      return null;
    case 'apiyi':
      return 'https://api.apiyi.com/register/?aff_code=pBOp';
    case 'yi':
      return 'https://platform.lingyiwanwu.com/';
    case 'deepseek':
      return 'https://platform.deepseek.com/api_keys';
    case 'dashscope':
      return 'https://dashscope.console.aliyun.com/apiKey';
    case 'zhipu':
      return 'https://open.bigmodel.cn/usercenter/apikeys';
    case 'moonshot':
      return 'https://platform.moonshot.cn/console/api-keys';
    case 'doubao':
      return 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey';
    case 'openai':
      return 'https://platform.openai.com/api-keys';
    default:
      return null;
  }
};

// 风格滑动条组件
interface StyleSliderProps {
  label: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (value: number) => void;
}

const StyleSlider: React.FC<StyleSliderProps> = ({ label, leftLabel, rightLabel, value, onChange }) => {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-14 text-right flex-shrink-0">{leftLabel}</span>
        <div className="flex-1 relative h-6 flex items-center">
          <div
            className="absolute inset-x-0 h-2 rounded-full"
            style={{
              background: `linear-gradient(to right, 
                #ef4444 0%, 
                #f97316 15%, 
                #eab308 30%, 
                #22c55e 50%, 
                #eab308 70%, 
                #f97316 85%, 
                #ef4444 100%)`
            }}
          />
          {/* 中间标记线 */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/60 pointer-events-none z-10"></div>
          <input
            type="range"
            min="0"
            max="100"
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value))}
            className="absolute inset-x-0 w-full h-2 appearance-none cursor-pointer bg-transparent z-20"
            style={{
              WebkitAppearance: 'none',
            }}
          />
          <style>{`
            input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: white;
              border: 2px solid #6366f1;
              cursor: pointer;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              transition: transform 0.1s;
            }
            input[type="range"]::-webkit-slider-thumb:hover {
              transform: scale(1.1);
            }
            input[type="range"]::-moz-range-thumb {
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: white;
              border: 2px solid #6366f1;
              cursor: pointer;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }
          `}</style>
        </div>
        <span className="text-[10px] text-gray-500 w-14 flex-shrink-0">{rightLabel}</span>
      </div>
    </div>
  );
};

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const latestSettingsRef = React.useRef<AppSettings>(DEFAULT_SETTINGS);
  const hasLoadedRef = React.useRef(false);
  const isDirtyRef = React.useRef(false);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('nvidia');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showToutiaoCookie, setShowToutiaoCookie] = useState(false);
  const [showZhihuCookie, setShowZhihuCookie] = useState(false);
  const [showWeixinCookie, setShowWeixinCookie] = useState(false);
  const [showXiaohongshuCookie, setShowXiaohongshuCookie] = useState(false);
  const [fetchingToutiao, setFetchingToutiao] = useState(false);
  const [fetchingZhihu, setFetchingZhihu] = useState(false);
  const [fetchingWeixin, setFetchingWeixin] = useState(false);
  const [fetchingXiaohongshu, setFetchingXiaohongshu] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyingApi, setVerifyingApi] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [apiVerifyStatus, setApiVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'restoring' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [showEncKey, setShowEncKey] = useState(false);

  const t = getTranslation(settings.language || 'zh-CN');

  latestSettingsRef.current = settings;

  useEffect(() => {
    return () => {
      if (!hasLoadedRef.current) return;
      if (!isDirtyRef.current) return;
      saveSettings(latestSettingsRef.current);
    };
  }, []);

  // 自动保存：当 settings 变化时自动保存（防抖）
  const isInitialMount = React.useRef(true);
  useEffect(() => {
    // 跳过初始加载时的保存
    if (isInitialMount.current) {
      return;
    }

    isDirtyRef.current = true;
    setAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      await saveSettings(settings);
      isDirtyRef.current = false;
      setAutoSaveStatus('saved');
      // 2秒后恢复 idle 状态
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    }, 500); // 500ms 防抖

    return () => {
      clearTimeout(timer);
    };
  }, [settings]);

  useEffect(() => {
    const loadSettings = async () => {
      const saved = await getSettings();
      // Ensure apiKeys object exists (migration for old settings)
      const initializedSettings = {
        ...saved,
        apiKeys: saved.apiKeys || {},
        github: saved.github || DEFAULT_SETTINGS.github,
        sync: saved.sync || DEFAULT_SETTINGS.sync
      };

      // Migrate old single key if needed
      if (saved.apiKey && !initializedSettings.apiKeys[saved.provider || 'apiyi']) {
        initializedSettings.apiKeys[saved.provider || 'apiyi'] = saved.apiKey;
      }

      // 如果是 nvidia/memoraid provider，从后端获取共享密钥
      const providerKey = saved.provider || 'memoraid';
      if (PROVIDERS[providerKey]?.isShared) {
        try {
          let clientIdData = await chrome.storage.local.get(['clientId']);
          if (!clientIdData.clientId) {
            clientIdData.clientId = 'client_' + Math.random().toString(36).substring(2, 15);
            await chrome.storage.local.set({ clientId: clientIdData.clientId });
          }

          // For Memoraid proxy, we don't really need to fetch a key from backend as it's handled server-side
          // But to keep logic consistent or if we implement per-client token later...
          // For now, let's just set a dummy key or fetch it if endpoint exists.
          // Since we hardcoded the key in backend for now, we don't need to fetch it to frontend.
          // We can just set a dummy key so UI shows "Configured".
          
          if (providerKey === 'memoraid') {
             initializedSettings.apiKey = 'managed-by-backend';
          } else {
              const response = await fetch(`${BACKEND_URL}/api-key/nvidia`, {
                headers: {
                  'X-Client-Id': clientIdData.clientId
                }
              });

              if (response.ok) {
                const data = await response.json();
                initializedSettings.apiKey = data.apiKey;
              }
          }
        } catch (error) {
          console.error('Failed to fetch shared API key:', error);
        }
      }

      latestSettingsRef.current = initializedSettings;
      hasLoadedRef.current = true;
      isDirtyRef.current = false;
      setIsSettingsLoaded(true);
      setSettings(initializedSettings);

      if (saved.provider && PROVIDERS[saved.provider]) {
        setSelectedProvider(saved.provider);
      } else {
        // Fallback logic
        const foundProvider = Object.entries(PROVIDERS).find(([key, config]) =>
          key !== 'custom' && config.baseUrl === saved.baseUrl
        );
        if (foundProvider) {
          setSelectedProvider(foundProvider[0]);
        } else {
          setSelectedProvider('custom');
        }
      }

      // 标记初始化完成，之后的 settings 变化才会触发自动保存
      setTimeout(() => {
        isInitialMount.current = false;
      }, 100);
    };

    loadSettings();

    const handleStorageChange = () => {
      // 如果有未保存的更改，说明用户正在操作，此时忽略外部存储的变化，避免覆盖用户输入
      if (isDirtyRef.current) return;
      loadSettings();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // 检查并更新提示词版本
  useEffect(() => {
    const checkAndUpdatePrompts = async () => {
      if (!isSettingsLoaded) return;

      let needsUpdate = false;
      const newSettings = { ...settings };

      // 检查头条提示词版本
      if (settings.promptVersions?.toutiao !== PROMPT_VERSIONS.TOUTIAO) {
        newSettings.toutiao = {
          ...newSettings.toutiao,
          cookie: newSettings.toutiao?.cookie || '',
          customPrompt: TOUTIAO_DEFAULT_PROMPT
        };
        needsUpdate = true;
        console.log('[Prompt Update] 头条提示词已更新到版本:', PROMPT_VERSIONS.TOUTIAO);
      }

      // 检查知乎提示词版本
      if (settings.promptVersions?.zhihu !== PROMPT_VERSIONS.ZHIHU) {
        newSettings.zhihu = {
          ...newSettings.zhihu,
          cookie: newSettings.zhihu?.cookie || '',
          customPrompt: ZHIHU_DEFAULT_PROMPT
        };
        needsUpdate = true;
        console.log('[Prompt Update] 知乎提示词已更新到版本:', PROMPT_VERSIONS.ZHIHU);
      }

      // 检查微信提示词版本
      if (settings.promptVersions?.weixin !== PROMPT_VERSIONS.WEIXIN) {
        newSettings.weixin = {
          ...newSettings.weixin,
          cookie: newSettings.weixin?.cookie || '',
          customPrompt: WEIXIN_DEFAULT_PROMPT
        };
        needsUpdate = true;
        console.log('[Prompt Update] 微信提示词已更新到版本:', PROMPT_VERSIONS.WEIXIN);
      }

      // 检查小红书提示词版本
      if (settings.promptVersions?.xiaohongshu !== PROMPT_VERSIONS.XIAOHONGSHU) {
        newSettings.xiaohongshu = {
          ...newSettings.xiaohongshu,
          cookie: newSettings.xiaohongshu?.cookie || '',
          customPrompt: XIAOHONGSHU_DEFAULT_PROMPT
        };
        needsUpdate = true;
        console.log('[Prompt Update] 小红书提示词已更新到版本:', PROMPT_VERSIONS.XIAOHONGSHU);
      }

      if (needsUpdate) {
        // 更新版本号
        newSettings.promptVersions = {
          toutiao: PROMPT_VERSIONS.TOUTIAO,
          zhihu: PROMPT_VERSIONS.ZHIHU,
          weixin: PROMPT_VERSIONS.WEIXIN,
          xiaohongshu: PROMPT_VERSIONS.XIAOHONGSHU
        };

        // 阻止自动保存触发
        isInitialMount.current = true;
        setSettings(newSettings);
        await saveSettings(newSettings);
        // 恢复自动保存
        setTimeout(() => {
          isInitialMount.current = false;
        }, 100);
      }
    };

    checkAndUpdatePrompts();
  }, [isSettingsLoaded, settings.promptVersions]);

  const handleProviderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const providerKey = e.target.value;
    setSelectedProvider(providerKey);

    const config = PROVIDERS[providerKey];

    // 如果是共享密钥的 provider（如 memoraid），从后端获取密钥或设置默认
    if (config.isShared) {
      if (providerKey === 'memoraid') {
         setSettings(prev => ({
            ...prev,
            provider: providerKey,
            baseUrl: config.baseUrl,
            model: config.models[0] || '',
            apiKey: 'managed-by-backend'
         }));
         return;
      }

      try {
        // 生成或获取客户端 ID（用于密钥分配的一致性）
        let clientId = await chrome.storage.local.get(['clientId']);
        if (!clientId.clientId) {
          clientId.clientId = 'client_' + Math.random().toString(36).substring(2, 15);
          await chrome.storage.local.set({ clientId: clientId.clientId });
        }

        const response = await fetch(`${BACKEND_URL}/api-key/nvidia`, {
          headers: {
            'X-Client-Id': clientId.clientId
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSettings(prev => ({
            ...prev,
            provider: providerKey,
            baseUrl: config.baseUrl,
            model: config.models[0] || '',
            apiKey: data.apiKey
          }));
          return;
        }
      } catch (error) {
        console.error('Failed to fetch shared API key:', error);
      }

      // 如果获取失败，仍然设置其他配置，但不设置 apiKey
      setSettings(prev => ({
        ...prev,
        provider: providerKey,
        baseUrl: config.baseUrl,
        model: config.models[0] || '',
        apiKey: ''
      }));
    } else {
      setSettings(prev => {
        const newSettings = { ...prev, provider: providerKey };

        // Update Base URL and Model if not custom
        if (providerKey !== 'custom') {
          newSettings.baseUrl = config.baseUrl;
          newSettings.model = config.models[0] || '';
        }

        // Switch to the stored API Key for this provider
        newSettings.apiKey = prev.apiKeys?.[providerKey] || '';

        return newSettings;
      });
    }
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    setSettings(prev => {
      const isDefaultPrompt = !prev.systemPrompt || Object.values(SYSTEM_PROMPTS).includes(prev.systemPrompt);
      return {
        ...prev,
        language: lang,
        // If the current prompt is one of the defaults, switch it to the new language default
        systemPrompt: isDefaultPrompt ? (SYSTEM_PROMPTS[lang] || prev.systemPrompt) : prev.systemPrompt
      };
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'apiKey') {
      setSettings(prev => ({
        ...prev,
        apiKey: value,
        apiKeys: {
          ...prev.apiKeys,
          [selectedProvider]: value
        }
      }));
    } else {
      setSettings(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleToutiaoChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      toutiao: {
        ...prev.toutiao || { cookie: '' },
        [name]: value
      }
    }));
  };

  const handleGithubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      github: {
        ...prev.github || { token: '', owner: '', repo: '', branch: 'main' },
        [name]: value
      }
    }));
  };

  const handleZhihuChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      zhihu: {
        ...prev.zhihu || { cookie: '' },
        [name]: value
      }
    }));
  };

  // 处理微信公众号配置变化
  const handleWeixinChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      weixin: {
        ...prev.weixin || { cookie: '' },
        [name]: value
      }
    }));
  };

  // 处理小红书配置变化
  const handleXiaohongshuChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      xiaohongshu: {
        ...prev.xiaohongshu || { cookie: '' },
        [name]: value
      }
    }));
  };

  // 处理文章风格滑动条变化
  const handleStyleChange = (key: keyof ArticleStyleSettings, value: number) => {
    setSettings(prev => ({
      ...prev,
      articleStyle: {
        ...prev.articleStyle || DEFAULT_SETTINGS.articleStyle!,
        [key]: value
      }
    }));
  };

  const handleSyncChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      sync: {
        ...prev.sync || DEFAULT_SETTINGS.sync!,
        [name]: value
      }
    }));
  };

  const handleLogin = async (provider: 'google' | 'github') => {
    setSyncStatus('syncing');
    setSyncMessage(null);

    try {
      console.log('Starting login flow for:', provider);
      const response = await chrome.runtime.sendMessage({
        type: 'START_LOGIN',
        payload: { provider }
      });

      console.log('Login response:', response);

      if (response && response.success) {
        setSyncStatus('success');
        setSyncMessage({ type: 'success', text: '登录成功！' });
      } else {
        throw new Error(response?.error || '登录失败');
      }
    } catch (e: any) {
      console.error('Login error:', e);
      setSyncStatus('error');
      setSyncMessage({ type: 'error', text: e.message || String(e) });
    } finally {
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncMessage(null);
      }, 10000);
    }
  };

  const handleLogout = async () => {
    const newSettings = {
      ...settings,
      sync: {
        ...settings.sync!,
        token: undefined,
        email: undefined,
        enabled: false
      }
    };
    setSettings(newSettings);
    await saveSettings(newSettings);
    setSyncStatus('idle');
    setSyncMessage(null);
  };

  const handleSyncNow = async () => {
    setSyncStatus('syncing');
    setSyncMessage(null);
    try {
      const updated = await syncSettings(settings);
      setSettings(updated);
      await saveSettings(updated);
      setSyncStatus('success');
      setSyncMessage({ type: 'success', text: t.settingsSynced });
    } catch (e) {
      console.error(e);
      setSyncStatus('error');
      const msg = (e as Error).message;
      let userMsg = 'Sync failed: ' + msg;

      if (msg.includes('401')) userMsg = 'Sync failed: Unauthorized (Check Token)';
      if (msg.includes('500')) userMsg = 'Sync failed: Server Error';
      if (msg.includes('Failed to fetch')) userMsg = 'Sync failed: Network Error (Check URL)';

      setSyncMessage({ type: 'error', text: userMsg });
    } finally {
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncMessage(null);
      }, 3000);
    }
  };

  const handleRestore = async () => {
    setSyncStatus('restoring');
    setSyncMessage(null);
    try {
      const restored = await restoreSettings(settings);
      setSettings(restored);
      await saveSettings(restored);
      setSyncStatus('success');
      setSyncMessage({ type: 'success', text: 'Settings restored from cloud!' });
    } catch (e) {
      console.error(e);
      setSyncStatus('error');
      setSyncMessage({ type: 'error', text: 'Restore failed: ' + (e as Error).message });
    } finally {
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncMessage(null);
      }, 3000);
    }
  };

  const handleGenerateKey = () => {
    const key = generateRandomString();
    setSettings(prev => ({
      ...prev,
      sync: {
        ...prev.sync!,
        encryptionKey: key
      }
    }));
  };


  const handleAutoFetchToutiaoCookie = async () => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      alert('This feature requires the Chrome Extension environment.');
      return;
    }

    setFetchingToutiao(true);
    try {
      // 使用 URL 方式获取 cookie，这样可以获取到所有相关域名的 cookie
      const cookies = await chrome.cookies.getAll({ url: 'https://mp.toutiao.com/' });

      // 过滤：只保留未过期的 cookie
      const now = Date.now() / 1000; // 当前时间戳（秒）
      const relevantCookies = cookies.filter(c => {
        // 检查是否过期（expirationDate 为 undefined 表示会话 cookie，不会过期）
        if (c.expirationDate && c.expirationDate < now) return false;
        // 过滤掉空值的 cookie
        if (!c.value || c.value.trim() === '') return false;
        return true;
      });

      console.log(`[Cookie] Fetched ${relevantCookies.length} toutiao cookies`);

      if (relevantCookies.length > 0) {
        const cookieStr = relevantCookies.map(c => `${c.name}=${c.value}`).join('; ');
        setSettings(prev => ({
          ...prev,
          toutiao: {
            ...prev.toutiao,
            cookie: cookieStr
          }
        }));
      } else {
        const confirmLogin = confirm(t.noToutiaoCookie);
        if (confirmLogin) {
          chrome.tabs.create({ url: 'https://mp.toutiao.com/' });
        }
      }
    } catch (error) {
      console.error("Failed to fetch cookies:", error);
      alert('Failed to fetch cookies. Please try manually.');
    } finally {
      setFetchingToutiao(false);
    }
  };

  const handleAutoFetchZhihuCookie = async () => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      alert('This feature requires the Chrome Extension environment.');
      return;
    }

    setFetchingZhihu(true);
    try {
      // 使用 URL 方式获取 cookie，这样可以获取到所有相关域名的 cookie（包括 .zhihu.com 和 zhuanlan.zhihu.com）
      const cookies = await chrome.cookies.getAll({ url: 'https://zhuanlan.zhihu.com/' });

      // 过滤：只保留未过期的 cookie
      const now = Date.now() / 1000; // 当前时间戳（秒）
      const relevantCookies = cookies.filter(c => {
        // 检查是否过期（expirationDate 为 undefined 表示会话 cookie，不会过期）
        if (c.expirationDate && c.expirationDate < now) return false;
        // 过滤掉空值的 cookie
        if (!c.value || c.value.trim() === '') return false;
        return true;
      });

      console.log(`[Cookie] Fetched ${relevantCookies.length} zhihu cookies`);

      if (relevantCookies.length > 0) {
        const cookieStr = relevantCookies.map(c => `${c.name}=${c.value}`).join('; ');
        setSettings(prev => ({
          ...prev,
          zhihu: {
            ...prev.zhihu,
            cookie: cookieStr
          }
        }));
      } else {
        const confirmLogin = confirm(t.noZhihuCookie);
        if (confirmLogin) {
          chrome.tabs.create({ url: 'https://www.zhihu.com/signin' });
        }
      }
    } catch (error) {
      console.error("Failed to fetch Zhihu cookies:", error);
      alert('Failed to fetch cookies. Please try manually.');
    } finally {
      setFetchingZhihu(false);
    }
  };

  // 自动获取微信公众号 Cookie
  const handleAutoFetchWeixinCookie = async () => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      alert('This feature requires the Chrome Extension environment.');
      return;
    }

    setFetchingWeixin(true);
    try {
      // 使用 URL 方式获取 cookie，这样可以获取到所有相关域名的 cookie
      const cookies = await chrome.cookies.getAll({ url: 'https://mp.weixin.qq.com/' });

      // 过滤：只保留未过期的 cookie
      const now = Date.now() / 1000; // 当前时间戳（秒）
      const relevantCookies = cookies.filter(c => {
        // 检查是否过期（expirationDate 为 undefined 表示会话 cookie，不会过期）
        if (c.expirationDate && c.expirationDate < now) return false;
        // 过滤掉空值的 cookie
        if (!c.value || c.value.trim() === '') return false;
        return true;
      });

      console.log(`[Cookie] Fetched ${relevantCookies.length} weixin cookies`);

      if (relevantCookies.length > 0) {
        const cookieStr = relevantCookies.map(c => `${c.name}=${c.value}`).join('; ');
        setSettings(prev => ({
          ...prev,
          weixin: {
            ...prev.weixin,
            cookie: cookieStr
          }
        }));
      } else {
        const confirmLogin = confirm(t.noWeixinCookie);
        if (confirmLogin) {
          chrome.tabs.create({ url: 'https://mp.weixin.qq.com/' });
        }
      }
    } catch (error) {
      console.error("Failed to fetch Weixin cookies:", error);
      alert('Failed to fetch cookies. Please try manually.');
    } finally {
      setFetchingWeixin(false);
    }
  };

  // 自动获取小红书 Cookie
  const handleAutoFetchXiaohongshuCookie = async () => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      alert('This feature requires the Chrome Extension environment.');
      return;
    }

    setFetchingXiaohongshu(true);
    try {
      const cookies = await chrome.cookies.getAll({ url: 'https://creator.xiaohongshu.com/' });
      const now = Date.now() / 1000;
      const relevantCookies = cookies.filter(c => {
        if (c.expirationDate && c.expirationDate < now) return false;
        if (!c.value || c.value.trim() === '') return false;
        return true;
      });

      if (relevantCookies.length > 0) {
        const cookieStr = relevantCookies.map(c => `${c.name}=${c.value}`).join('; ');
        setSettings(prev => ({
          ...prev,
          xiaohongshu: {
            ...prev.xiaohongshu || { cookie: '' },
            cookie: cookieStr
          }
        }));
      } else {
        const confirmLogin = confirm('未找到小红书 Cookie，是否前往创作者平台登录？');
        if (confirmLogin) {
          chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=article' });
        }
      }
    } catch (error) {
      console.error("Failed to fetch Xiaohongshu cookies:", error);
      alert('获取 Cookie 失败，请手动输入。');
    } finally {
      setFetchingXiaohongshu(false);
    }
  };

  const handleVerifyApi = async () => {
    if (!settings.apiKey) {
      alert(t.apiKeyPlaceholder);
      return;
    }

    setVerifyingApi(true);
    setApiVerifyStatus('idle');

    try {
      let url = settings.baseUrl;
      if (!url.endsWith('/')) url += '/';
      const endpoint = `${url}chat/completions`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        })
      });

      if (response.ok) {
        setApiVerifyStatus('success');
      } else {
        console.error('Verification failed', await response.text());
        setApiVerifyStatus('error');
      }
    } catch (e) {
      console.error(e);
      setApiVerifyStatus('error');
    } finally {
      setVerifyingApi(false);
    }
  };

  const handleVerifyGithub = async () => {
    if (!settings.github?.token || !settings.github?.owner || !settings.github?.repo) {
      alert(t.fillGithubAlert);
      return;
    }

    setVerifying(true);
    setVerifyStatus('idle');
    try {
      const isValid = await validateGitHubConnection(settings.github);
      setVerifyStatus(isValid ? 'success' : 'error');
    } catch (error) {
      console.error(error);
      setVerifyStatus('error');
    } finally {
      setVerifying(false);
    }
  };

  const currentModels = PROVIDERS[selectedProvider]?.models || [];

  if (!isSettingsLoaded) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold mb-4">{t.settingsTitle}</h2>
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载设置中...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold mb-4">{t.settingsTitle}</h2>

      {/* ========== 同步与备份 ========== */}
      <div className="pb-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Cloud className="w-4 h-4" />
          {t.syncBackupTitle}
        </h3>

        {!settings.sync?.token ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              {t.syncDescription}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleLogin('google')}
                className="flex-1 py-2 px-3 border rounded flex items-center justify-center gap-2 hover:bg-gray-50 text-sm font-medium transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.033s2.701-6.033,6.033-6.033c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z" /></svg>
                {t.googleLogin}
              </button>
              <button
                onClick={() => handleLogin('github')}
                className="flex-1 py-2 px-3 border rounded flex items-center justify-center gap-2 hover:bg-gray-50 text-sm font-medium transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                {t.githubLogin}
              </button>
            </div>
            {syncMessage && (
              <div className={`text-xs p-2 rounded text-center ${syncMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                }`}>
                {syncMessage.text}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 bg-gray-50 p-3 rounded-lg border">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium text-gray-700">{settings.sync.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="text-xs text-red-600 hover:text-red-800"
              >
                {t.logout}
              </button>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {t.encryptionKeyLabel}
                </label>
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-[10px]"
                >
                  <Key className="w-3 h-3" />
                  {t.randomGenerate}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showEncKey ? "text" : "password"}
                  name="encryptionKey"
                  value={settings.sync?.encryptionKey || ''}
                  onChange={handleSyncChange}
                  className="w-full p-2 border rounded pr-10 text-sm font-mono"
                  placeholder="Enter a secret passphrase..."
                />
                <button
                  type="button"
                  onClick={() => setShowEncKey(!showEncKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
                >
                  {showEncKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                {t.encryptionKeyHint}
              </p>
              {settings.sync?.encryptionKey === '123456' && (
                <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  默认密钥不安全，请修改
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSyncNow}
                disabled={syncStatus !== 'idle'}
                className="flex-1 bg-blue-600 text-white py-1.5 rounded text-xs font-medium hover:bg-blue-700 transition flex items-center justify-center gap-1.5"
              >
                {syncStatus === 'syncing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                {t.syncUp}
              </button>
              <button
                onClick={handleRestore}
                disabled={syncStatus !== 'idle'}
                className="flex-1 bg-white border text-gray-700 py-1.5 rounded text-xs font-medium hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
              >
                {syncStatus === 'restoring' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {t.restore}
              </button>
            </div>

            {syncMessage && (
              <div className={`text-xs p-2 rounded text-center ${syncMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                }`}>
                {syncMessage.text}
              </div>
            )}

            {settings.sync.lastSynced && (
              <p className="text-[10px] text-center text-gray-400">
                {t.lastSynced}: {new Date(settings.sync.lastSynced).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ========== 公共设置 ========== */}

      {/* 语言设置 */}
      <div className="border-t pt-4 space-y-2">
        <label className="block text-sm font-medium">{t.languageLabel}</label>
        <select
          value={settings.language || 'zh-CN'}
          onChange={handleLanguageChange}
          className="w-full p-2 border rounded"
        >
          {LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500">
          {t.languageHint}
        </p>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className={`w-5 h-5 ${(settings.autoPublishAll ?? false) ? 'text-green-500' : 'text-gray-400'}`} />
              <div>
                <span className="font-medium text-gray-800">{t.autoPublishAllTitle}</span>
                <p className="text-xs text-gray-500">{t.autoPublishAllHint}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.autoPublishAll ?? false}
                onChange={(e) => {
                  isDirtyRef.current = true;
                  setSettings({ ...settings, autoPublishAll: e.target.checked });
                }}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
        </div>
      </div>

      {/* AI 模型配置 */}
      <div className="border-t pt-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium">{t.providerLabel}</label>
          <select
            value={selectedProvider}
            onChange={handleProviderChange}
            className="w-full p-2 border rounded"
          >
            {Object.entries(PROVIDERS).map(([key, config]) => (
              <option key={key} value={key}>
                {config.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="block text-sm font-medium">{t.apiKeyLabel}</label>
            <div className="flex items-center gap-3">
              {!PROVIDERS[selectedProvider]?.isShared && (
                <button
                  onClick={handleVerifyApi}
                  disabled={verifyingApi}
                  className={`flex items-center gap-1 text-xs transition ${apiVerifyStatus === 'success'
                    ? 'text-green-600'
                    : apiVerifyStatus === 'error'
                      ? 'text-red-600'
                      : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  {verifyingApi ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : apiVerifyStatus === 'success' ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : apiVerifyStatus === 'error' ? (
                    <XCircle className="w-3 h-3" />
                  ) : (
                    <CheckCircle className="w-3 h-3" />
                  )}
                  {verifyingApi ? t.verifying : t.verifyButton}
                </button>
              )}
              {getProviderLink(selectedProvider) && !PROVIDERS[selectedProvider]?.isShared && (
                <a
                  href={getProviderLink(selectedProvider)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  {t.getKey} ↗
                </a>
              )}
            </div>
          </div>

          {/* 共享密钥提示（如 NVIDIA） */}
          {PROVIDERS[selectedProvider]?.isShared ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">
                    🎉 免费共享密钥已自动配置
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    所有用户共用此密钥，有速率限制。如遇到限流，请稍后重试或切换其他服务商。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                name="apiKey"
                value={settings.apiKey}
                onChange={handleChange}
                className="w-full p-2 border rounded pr-10"
                placeholder={t.apiKeyPlaceholder}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">{t.baseUrlLabel}</label>
          <input
            type="text"
            name="baseUrl"
            value={settings.baseUrl}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            placeholder="https://api.example.com/v1"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">{t.modelLabel}</label>
          <div className="flex flex-col gap-2">
            {selectedProvider !== 'custom' && currentModels.length > 0 && (
              <select
                name="model"
                value={settings.model}
                onChange={handleChange}
                className="p-2 border rounded w-full"
              >
                {currentModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="custom">{t.manualInput}</option>
              </select>
            )}

            {(selectedProvider === 'custom' || !currentModels.includes(settings.model)) && (
              <input
                type="text"
                name="model"
                value={settings.model}
                onChange={handleChange}
                className="w-full p-2 border rounded"
                placeholder="e.g. yi-34b-chat-0205"
              />
            )}
          </div>
          {selectedProvider === 'doubao' && (
            <p className="text-xs text-orange-600">
              {t.doubaoHint}
            </p>
          )}
        </div>
      </div>

      {/* 文章风格设置 */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-3 flex items-center gap-2">
          <Palette className="w-4 h-4" />
          {t.articleStyleTitle}
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          {t.articleStyleHint}
        </p>
        <div className="space-y-4">
          <StyleSlider
            label={t.styleStance}
            leftLabel={t.styleStanceLeft}
            rightLabel={t.styleStanceRight}
            value={settings.articleStyle?.objectivity ?? 50}
            onChange={(v) => handleStyleChange('objectivity', v)}
          />
          <StyleSlider
            label={t.styleEmotion}
            leftLabel={t.styleEmotionLeft}
            rightLabel={t.styleEmotionRight}
            value={settings.articleStyle?.sentiment ?? 60}
            onChange={(v) => handleStyleChange('sentiment', v)}
          />
          <StyleSlider
            label={t.styleTone}
            leftLabel={t.styleToneLeft}
            rightLabel={t.styleToneRight}
            value={settings.articleStyle?.tone ?? 50}
            onChange={(v) => handleStyleChange('tone', v)}
          />
          <StyleSlider
            label={t.stylePoliteness}
            leftLabel={t.stylePolitenessLeft}
            rightLabel={t.stylePolitenessRight}
            value={settings.articleStyle?.politeness ?? 60}
            onChange={(v) => handleStyleChange('politeness', v)}
          />
          <StyleSlider
            label={t.styleFormality}
            leftLabel={t.styleFormalityLeft}
            rightLabel={t.styleFormalityRight}
            value={settings.articleStyle?.formality ?? 30}
            onChange={(v) => handleStyleChange('formality', v)}
          />
          <StyleSlider
            label={t.styleHumor}
            leftLabel={t.styleHumorLeft}
            rightLabel={t.styleHumorRight}
            value={settings.articleStyle?.humor ?? 40}
            onChange={(v) => handleStyleChange('humor', v)}
          />
          <button
            type="button"
            onClick={() => setSettings(prev => ({
              ...prev,
              articleStyle: DEFAULT_SETTINGS.articleStyle
            }))}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            {t.resetToDefaultStyle}
          </button>
        </div>
      </div>

      {/* ========== 微信公众号配置 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-green-500" />
          {t.weixinConfigTitle}
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.cookieLabel}</label>
              <button
                type="button"
                onClick={handleAutoFetchWeixinCookie}
                disabled={fetchingWeixin}
                className="text-green-600 hover:text-green-800 flex items-center gap-1 text-xs"
              >
                {fetchingWeixin ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {t.autoFetch}
              </button>
            </div>
            <div className="relative">
              <input
                type={showWeixinCookie ? "text" : "password"}
                name="cookie"
                value={settings.weixin?.cookie || ''}
                onChange={handleWeixinChange}
                className="w-full p-2 border rounded pr-10 text-sm"
                placeholder={t.cookieLabel}
              />
              <button
                type="button"
                onClick={() => setShowWeixinCookie(!showWeixinCookie)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showWeixinCookie ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              {t.cookieHint}
            </p>
          </div>

          {/* 作者名称（原创声明用） */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">{t.authorNameLabel}</label>
            <input
              type="text"
              name="authorName"
              value={settings.weixin?.authorName || ''}
              onChange={handleWeixinChange}
              className="w-full p-2 border rounded text-sm"
              placeholder={t.authorNameLabel}
            />
            <p className="text-[10px] text-gray-400">
              {t.authorNameHint}
            </p>
          </div>

          {/* 微信自定义提示词 */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.customPromptLabel}</label>
              <button
                type="button"
                onClick={() => setSettings(prev => ({
                  ...prev,
                  weixin: {
                    ...prev.weixin || { cookie: '' },
                    customPrompt: WEIXIN_DEFAULT_PROMPT
                  }
                }))}
                className="text-green-600 hover:text-green-800 flex items-center gap-1 text-xs"
              >
                <RotateCcw className="w-3 h-3" />
                {t.resetToDefault}
              </button>
            </div>
            <textarea
              name="customPrompt"
              value={settings.weixin?.customPrompt || WEIXIN_DEFAULT_PROMPT}
              onChange={handleWeixinChange}
              className="w-full p-2 border rounded h-32 text-sm font-mono"
              placeholder={t.customPromptPlaceholder}
            />
            <p className="text-[10px] text-gray-400">
              {t.customPromptHint}
            </p>
          </div>


        </div>
      </div>

      {/* ========== 头条配置 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-red-500" />
          {t.toutiaoConfigTitle}
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.cookieLabel}</label>
              <button
                type="button"
                onClick={handleAutoFetchToutiaoCookie}
                disabled={fetchingToutiao}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
              >
                {fetchingToutiao ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {t.autoFetch}
              </button>
            </div>
            <div className="relative">
              <input
                type={showToutiaoCookie ? "text" : "password"}
                name="cookie"
                value={settings.toutiao?.cookie || ''}
                onChange={handleToutiaoChange}
                className="w-full p-2 border rounded pr-10 text-sm"
                placeholder="Paste your Toutiao cookie here..."
              />
              <button
                type="button"
                onClick={() => setShowToutiaoCookie(!showToutiaoCookie)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showToutiaoCookie ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              {t.cookieHint}
            </p>
          </div>

          {/* 头条自定义提示词 */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.customPromptLabel}</label>
              <button
                type="button"
                onClick={() => setSettings(prev => ({
                  ...prev,
                  toutiao: {
                    ...prev.toutiao || { cookie: '' },
                    customPrompt: TOUTIAO_DEFAULT_PROMPT
                  }
                }))}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
              >
                <RotateCcw className="w-3 h-3" />
                {t.resetToDefault}
              </button>
            </div>
            <textarea
              name="customPrompt"
              value={settings.toutiao?.customPrompt || TOUTIAO_DEFAULT_PROMPT}
              onChange={handleToutiaoChange}
              className="w-full p-2 border rounded h-32 text-sm font-mono"
              placeholder={t.customPromptPlaceholder}
            />
            <p className="text-[10px] text-gray-400">
              {t.customPromptHint}
            </p>
          </div>

        </div>
      </div>

      {/* ========== 知乎配置 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-500" />
          {t.zhihuConfigTitle}
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.cookieLabel}</label>
              <button
                type="button"
                onClick={handleAutoFetchZhihuCookie}
                disabled={fetchingZhihu}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
              >
                {fetchingZhihu ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {t.autoFetch}
              </button>
            </div>
            <div className="relative">
              <input
                type={showZhihuCookie ? "text" : "password"}
                name="cookie"
                value={settings.zhihu?.cookie || ''}
                onChange={handleZhihuChange}
                className="w-full p-2 border rounded pr-10 text-sm"
                placeholder={t.cookieLabel}
              />
              <button
                type="button"
                onClick={() => setShowZhihuCookie(!showZhihuCookie)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showZhihuCookie ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              {t.cookieHint}
            </p>
          </div>

          {/* 知乎自定义提示词 */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.customPromptLabel}</label>
              <button
                type="button"
                onClick={() => setSettings(prev => ({
                  ...prev,
                  zhihu: {
                    ...prev.zhihu || { cookie: '' },
                    customPrompt: ZHIHU_DEFAULT_PROMPT
                  }
                }))}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
              >
                <RotateCcw className="w-3 h-3" />
                {t.resetToDefault}
              </button>
            </div>
            <textarea
              name="customPrompt"
              value={settings.zhihu?.customPrompt || ZHIHU_DEFAULT_PROMPT}
              onChange={handleZhihuChange}
              className="w-full p-2 border rounded h-32 text-sm font-mono"
              placeholder={t.customPromptPlaceholder}
            />
            <p className="text-[10px] text-gray-400">
              {t.customPromptHint}
            </p>
          </div>

        </div>
      </div>

      {/* ========== 小红书配置 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Heart className="w-4 h-4 text-[#ff2442] fill-current" />
          小红书配置
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.cookieLabel}</label>
              <button
                type="button"
                onClick={handleAutoFetchXiaohongshuCookie}
                disabled={fetchingXiaohongshu}
                className="text-[#ff2442] hover:text-[#e61e3c] flex items-center gap-1 text-xs font-medium"
              >
                {fetchingXiaohongshu ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {t.autoFetch}
              </button>
            </div>
            <div className="relative">
              <input
                type={showXiaohongshuCookie ? "text" : "password"}
                name="cookie"
                value={settings.xiaohongshu?.cookie || ''}
                onChange={handleXiaohongshuChange}
                className="w-full p-2 border rounded pr-10 text-sm focus:border-[#ff2442] focus:ring-1 focus:ring-[#ff2442] outline-none"
                placeholder="Paste your Xiaohongshu cookie here..."
              />
              <button
                type="button"
                onClick={() => setShowXiaohongshuCookie(!showXiaohongshuCookie)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showXiaohongshuCookie ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              {t.cookieHint}
            </p>
          </div>

          {/* 小红书自定义提示词 */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-gray-600">{t.customPromptLabel}</label>
              <button
                type="button"
                onClick={() => setSettings(prev => ({
                  ...prev,
                  xiaohongshu: {
                    ...prev.xiaohongshu || { cookie: '' },
                    customPrompt: XIAOHONGSHU_DEFAULT_PROMPT
                  }
                }))}
                className="text-[#ff2442] hover:text-[#e61e3c] flex items-center gap-1 text-xs font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                {t.resetToDefault}
              </button>
            </div>
            <textarea
              name="customPrompt"
              value={settings.xiaohongshu?.customPrompt || XIAOHONGSHU_DEFAULT_PROMPT}
              onChange={handleXiaohongshuChange}
              className="w-full p-2 border rounded h-32 text-sm font-mono focus:border-[#ff2442] focus:ring-1 focus:ring-[#ff2442] outline-none"
              placeholder={t.customPromptPlaceholder}
            />
            <p className="text-[10px] text-gray-400">
              {t.customPromptHint}
            </p>
          </div>
        </div>
      </div>

      {/* ========== 技术文档提示词配置 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-500" />
          {t.systemPromptLabel}
        </h3>
        <div className="space-y-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSettings(prev => ({
                ...prev,
                systemPrompt: SYSTEM_PROMPTS[prev.language || 'zh-CN'] || DEFAULT_SETTINGS.systemPrompt
              }))}
              className="text-purple-600 hover:text-purple-800 flex items-center gap-1 text-xs"
            >
              <RotateCcw className="w-3 h-3" />
              {t.resetButton}
            </button>
          </div>
          <textarea
            name="systemPrompt"
            value={settings.systemPrompt}
            onChange={handleChange}
            className="w-full p-2 border rounded h-32 text-sm font-mono"
            placeholder={t.promptPlaceholder}
          />
          <p className="text-[10px] text-gray-400">
            用于生成技术文档的系统提示词，影响文档的结构和风格
          </p>
        </div>
      </div>



      {/* ========== GitHub 集成 ========== */}
      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Github className="w-4 h-4" />
          {t.githubTitle}
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">{t.tokenLabel}</label>
            <div className="relative">
              <input
                type={showGithubToken ? "text" : "password"}
                name="token"
                value={settings.github?.token || ''}
                onChange={handleGithubChange}
                className="w-full p-2 border rounded pr-10 text-sm"
                placeholder="ghp_..."
              />
              <button
                type="button"
                onClick={() => setShowGithubToken(!showGithubToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
              >
                {showGithubToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">{t.ownerLabel}</label>
              <input
                type="text"
                name="owner"
                value={settings.github?.owner || ''}
                onChange={handleGithubChange}
                className="w-full p-2 border rounded text-sm"
                placeholder="e.g. facebook"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">{t.repoLabel}</label>
              <input
                type="text"
                name="repo"
                value={settings.github?.repo || ''}
                onChange={handleGithubChange}
                className="w-full p-2 border rounded text-sm"
                placeholder="e.g. react"
              />
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="space-y-1 flex-1">
              <label className="block text-xs font-medium text-gray-600">{t.branchLabel}</label>
              <input
                type="text"
                name="branch"
                value={settings.github?.branch || 'main'}
                onChange={handleGithubChange}
                className="w-full p-2 border rounded text-sm"
                placeholder="main"
              />
            </div>
            <button
              onClick={handleVerifyGithub}
              disabled={verifying}
              className={`h-[38px] px-3 rounded flex items-center gap-2 text-sm font-medium border transition ${verifyStatus === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : verifyStatus === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              title={t.verifyTitle}
            >
              {verifying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : verifyStatus === 'success' ? (
                <CheckCircle className="w-4 h-4" />
              ) : verifyStatus === 'error' ? (
                <XCircle className="w-4 h-4" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              {verifying ? t.verifying : t.verifyButton}
            </button>
          </div>
        </div>
      </div>



      {/* ========== 自动保存状态提示 ========== */}
      {autoSaveStatus !== 'idle' && (
        <div className="pt-2 pb-2">
          <div className={`text-center text-xs py-2 rounded transition-all ${autoSaveStatus === 'saving'
            ? 'bg-blue-50 text-blue-600'
            : 'bg-green-50 text-green-600'
            }`}>
            {autoSaveStatus === 'saving' && (
              <span className="flex items-center justify-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t.autoSaving || '自动保存中...'}
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="flex items-center justify-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {t.autoSaved || '已自动保存'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
