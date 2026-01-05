import React, { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS, getSettings, saveSettings } from '../utils/storage';
import { Eye, EyeOff, Github, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { validateGitHubConnection } from '../utils/github';

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

// ... (existing code)

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('apiyi');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');

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

  const handleVerifyGithub = async () => {
    if (!settings.github?.token || !settings.github?.owner || !settings.github?.repo) {
      alert('Please fill in Token, Owner, and Repo Name');
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
    setStatus('Saved!');
    setTimeout(() => setStatus(''), 2000);
  };

  const currentModels = PROVIDERS[selectedProvider]?.models || [];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold mb-4">Settings</h2>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Provider</label>
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
          <label className="block text-sm font-medium">API Key</label>
          {getProviderLink(selectedProvider) && (
            <a 
              href={getProviderLink(selectedProvider)!} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Get Key ↗
            </a>
          )}
        </div>
        <div className="relative">
          <input
            type={showApiKey ? "text" : "password"}
            name="apiKey"
            value={settings.apiKey}
            onChange={handleChange}
            className="w-full p-2 border rounded pr-10"
            placeholder={`Enter your ${PROVIDERS[selectedProvider]?.name} API Key`}
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
        <label className="block text-sm font-medium">Base URL</label>
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
        <label className="block text-sm font-medium">Model</label>
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
               <option value="custom">Manual Input...</option>
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
             Note: For Doubao, you usually need to use the Endpoint ID (e.g. ep-202406...) as the model name.
           </p>
        )}
      </div>

      <div className="border-t pt-4">
        <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
          <Github className="w-4 h-4" />
          GitHub Integration (Save Target)
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
             <label className="block text-xs font-medium text-gray-600">Personal Access Token (Repo Scope)</label>
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
               <label className="block text-xs font-medium text-gray-600">Owner (User/Org)</label>
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
               <label className="block text-xs font-medium text-gray-600">Repo Name</label>
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
               <label className="block text-xs font-medium text-gray-600">Branch (Default: main)</label>
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
              title="Verify Connection"
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
              {verifying ? '...' : 'Verify'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
            <label className="block text-sm font-medium">System Prompt (Rules)</label>
            <button
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, systemPrompt: DEFAULT_SETTINGS.systemPrompt }))}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
                Reset to Default
            </button>
        </div>
        <textarea
          name="systemPrompt"
          value={settings.systemPrompt}
          onChange={handleChange}
          className="w-full p-2 border rounded h-32"
          placeholder="Enter summarization rules..."
        />
      </div>

      <div className="sticky bottom-0 bg-white pt-4 border-t mt-4 pb-2">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition font-medium"
        >
          {status === 'Saved!' ? 'Saved Successfully!' : 'Save Settings'}
        </button>
      </div>
      
      {status && (
        <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded shadow-lg animate-in fade-in slide-in-from-top-2 z-50">
          {status}
        </div>
      )}
    </div>
  );
};

export default Settings;
