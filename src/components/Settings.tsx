import React, { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS, getSettings, saveSettings, syncSettings, restoreSettings, ArticleStyleSettings } from '../utils/storage';
import { SYSTEM_PROMPTS, TOUTIAO_DEFAULT_PROMPT, ZHIHU_DEFAULT_PROMPT } from '../utils/prompts';
import { getTranslation } from '../utils/i18n';
import { Eye, EyeOff, Github, Loader2, CheckCircle, XCircle, Newspaper, RefreshCw, Cloud, Lock, Key, Bug, Palette, Send, BookOpen, RotateCcw } from 'lucide-react';
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
}

const PROVIDERS: Record<string, ProviderConfig> = {
  'apiyi': {
    name: 'API Yi (Default - Recommended, Supports Multiple Models)',
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
  const [status, setStatus] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('apiyi');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showToutiaoCookie, setShowToutiaoCookie] = useState(false);
  const [showZhihuCookie, setShowZhihuCookie] = useState(false);
  const [fetchingToutiao, setFetchingToutiao] = useState(false);
  const [fetchingZhihu, setFetchingZhihu] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyingApi, setVerifyingApi] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [apiVerifyStatus, setApiVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'restoring' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [showEncKey, setShowEncKey] = useState(false);
  
  const t = getTranslation(settings.language || 'zh-CN');

  useEffect(() => {
    const loadSettings = () => {
        getSettings().then((saved) => {
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
        });
    };

    loadSettings();

    const handleStorageChange = () => {
        loadSettings();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const providerKey = e.target.value;
    setSelectedProvider(providerKey);
    
    const config = PROVIDERS[providerKey];
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
          setSyncMessage({ type: 'success', text: 'Settings synced to cloud!' });
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
      const cookies = await chrome.cookies.getAll({ domain: 'toutiao.com' });
      const relevantCookies = cookies.filter(c => c.domain.includes('toutiao.com'));
      
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
      const cookies = await chrome.cookies.getAll({ domain: 'zhihu.com' });
      const relevantCookies = cookies.filter(c => c.domain.includes('zhihu.com'));
      
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

  const handleSave = async () => {
    await saveSettings(settings);
    setStatus(t.savedMessage);
    setTimeout(() => setStatus(''), 2000);
  };

  const currentModels = PROVIDERS[selectedProvider]?.models || [];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold mb-4">{t.settingsTitle}</h2>

      {/* ========== 公共设置 ========== */}
      
      {/* 语言设置 */}
      <div className="space-y-2">
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
              <button
                onClick={handleVerifyApi}
                disabled={verifyingApi}
                className={`flex items-center gap-1 text-xs transition ${
                  apiVerifyStatus === 'success' 
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
              {getProviderLink(selectedProvider) && (
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

      {/* 系统提示词 */}
      <div className="border-t pt-4 space-y-2">
        <div className="flex justify-between items-center">
            <label className="block text-sm font-medium">{t.systemPromptLabel}</label>
            <button
                type="button"
                onClick={() => setSettings(prev => ({ 
                  ...prev, 
                  systemPrompt: SYSTEM_PROMPTS[prev.language || 'zh-CN'] || DEFAULT_SETTINGS.systemPrompt 
                }))}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
                {t.resetButton}
            </button>
        </div>
        <textarea
          name="systemPrompt"
          value={settings.systemPrompt}
          onChange={handleChange}
          className="w-full p-2 border rounded h-32"
          placeholder={t.promptPlaceholder}
        />
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
          
          {/* 自动发布开关 */}
          <div className="bg-white rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Send className={`w-4 h-4 ${settings.toutiao?.autoPublish ? 'text-green-500' : 'text-gray-400'}`} />
                    <div>
                        <span className="font-medium text-gray-800 text-sm">{t.autoPublish}</span>
                        <p className="text-[10px] text-gray-500">{t.autoPublishHintToutiao}</p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={settings.toutiao?.autoPublish || false}
                        onChange={(e) => setSettings({ 
                          ...settings, 
                          toutiao: {
                            ...settings.toutiao || { cookie: '' },
                            autoPublish: e.target.checked
                          }
                        })}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                </label>
            </div>
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
          
          {/* 知乎自动发布开关 */}
          <div className="bg-white rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Send className={`w-4 h-4 ${settings.zhihu?.autoPublish ? 'text-blue-500' : 'text-gray-400'}`} />
                    <div>
                        <span className="font-medium text-gray-800 text-sm">{t.autoPublish}</span>
                        <p className="text-[10px] text-gray-500">{t.autoPublishHintZhihu}</p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={settings.zhihu?.autoPublish || false}
                        onChange={(e) => setSettings({ 
                          ...settings, 
                          zhihu: {
                            ...settings.zhihu || { cookie: '' },
                            autoPublish: e.target.checked
                          }
                        })}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
            </div>
          </div>
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
              className={`h-[38px] px-3 rounded flex items-center gap-2 text-sm font-medium border transition ${
                verifyStatus === 'success' 
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

      {/* ========== 同步与备份 ========== */}
      <div className="border-t pt-4">
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
                        <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.033s2.701-6.033,6.033-6.033c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/></svg>
                        {t.googleLogin}
                    </button>
                    <button
                        onClick={() => handleLogin('github')}
                        className="flex-1 py-2 px-3 border rounded flex items-center justify-center gap-2 hover:bg-gray-50 text-sm font-medium transition"
                    >
                        <Github className="w-4 h-4" />
                        {t.githubLogin}
                    </button>
                </div>
                {syncMessage && (
                    <div className={`text-xs p-2 rounded text-center ${
                        syncMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
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
                     <div className={`text-xs p-2 rounded text-center ${
                         syncMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
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

      {/* ========== 调试模式 ========== */}
      <div className="border-t pt-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                  <Bug className={`w-5 h-5 ${settings.debugMode ? 'text-orange-500' : 'text-gray-400'}`} />
                  <div>
                      <span className="font-medium text-gray-800">{t.debugModeTitle}</span>
                      <p className="text-xs text-gray-500">{t.debugModeHint}</p>
                  </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={settings.debugMode || false}
                      onChange={(e) => setSettings({ ...settings, debugMode: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
              </label>
          </div>
        </div>
      </div>

      {/* ========== 保存按钮 ========== */}
      <div className="pt-2">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 transition"
        >
          {status || t.saveButton}
        </button>
      </div>
    </div>
  );
};

export default Settings;