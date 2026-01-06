import React, { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS, getSettings, saveSettings } from '../utils/storage';
import { SYSTEM_PROMPTS } from '../utils/prompts';
import { getTranslation } from '../utils/i18n';
import { Eye, EyeOff, Github, Loader2, CheckCircle, XCircle, Newspaper, RefreshCw } from 'lucide-react';
import { validateGitHubConnection } from '../utils/github';

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
  'yi': {
    name: '01.AI (Yi)',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-34b-chat-0205', 'yi-34b-chat-200k', 'yi-spark']
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

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('apiyi');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showToutiaoCookie, setShowToutiaoCookie] = useState(false);
  const [fetchingToutiao, setFetchingToutiao] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyingApi, setVerifyingApi] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [apiVerifyStatus, setApiVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  
  const t = getTranslation(settings.language || 'zh-CN');

  useEffect(() => {
    getSettings().then((saved) => {
      // Ensure apiKeys object exists (migration for old settings)
      const initializedSettings = {
        ...saved,
        apiKeys: saved.apiKeys || {},
        github: saved.github || DEFAULT_SETTINGS.github
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

  const handleToutiaoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      toutiao: {
        ...prev.toutiao || { cookie: '' },
        [name]: value
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
        const confirmLogin = confirm('No Toutiao login cookies found. Would you like to open the Toutiao login page?');
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

      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Newspaper className="w-4 h-4" />
          Toutiao Configuration
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
             <div className="flex justify-between items-center">
               <label className="block text-xs font-medium text-gray-600">Cookie (Required for Publishing)</label>
               <button
                 type="button"
                 onClick={handleAutoFetchToutiaoCookie}
                 disabled={fetchingToutiao}
                 className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
               >
                 {fetchingToutiao ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                 Auto Fetch
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
               Login to mp.toutiao.com, open DevTools, copy 'cookie' from any network request header.
             </p>
          </div>
        </div>
      </div>

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

      <div className="space-y-2">
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

      <div className="pt-2">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue700 transition"
        >
          {status || t.saveButton}
        </button>
      </div>
    </div>
  );
};

export default Settings;