import React, { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS, getSettings, saveSettings } from '../utils/storage';

interface ProviderConfig {
  name: string;
  baseUrl: string;
  models: string[];
}

const PROVIDERS: Record<string, ProviderConfig> = {
  'apiyi': {
    name: 'API Yi (Default)',
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

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('apiyi');

  useEffect(() => {
    getSettings().then((saved) => {
      setSettings(saved);
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
    if (providerKey !== 'custom') {
      setSettings(prev => ({
        ...prev,
        provider: providerKey,
        baseUrl: config.baseUrl,
        model: config.models[0] || ''
      }));
    } else {
       setSettings(prev => ({
        ...prev,
        provider: providerKey
      }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
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
        <label className="block text-sm font-medium">API Key</label>
        <input
          type="password"
          name="apiKey"
          value={settings.apiKey}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          placeholder={`Enter your ${PROVIDERS[selectedProvider]?.name} API Key`}
        />
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

      <div className="space-y-2">
        <label className="block text-sm font-medium">System Prompt (Rules)</label>
        <textarea
          name="systemPrompt"
          value={settings.systemPrompt}
          onChange={handleChange}
          className="w-full p-2 border rounded h-32"
          placeholder="Enter summarization rules..."
        />
      </div>

      <button
        onClick={handleSave}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
      >
        Save Settings
      </button>
      
      {status && <p className="text-center text-green-600 text-sm">{status}</p>}
    </div>
  );
};

export default Settings;
