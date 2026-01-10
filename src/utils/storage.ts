import { SYSTEM_PROMPTS, TOUTIAO_DEFAULT_PROMPT, ZHIHU_DEFAULT_PROMPT } from './prompts';

export interface GitHubSettings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

// 文章风格设置（滑动条范围 0-100）
// 0 = 左侧极端，50 = 中立，100 = 右侧极端
export interface ArticleStyleSettings {
  objectivity: number;    // 0=客观中立 → 100=极端偏激
  sentiment: number;      // 0=消极悲观 → 100=积极乐观
  tone: number;           // 0=讽刺批评 → 100=表扬赞美
  politeness: number;     // 0=粗鲁直接 → 100=礼貌委婉
  formality: number;      // 0=口语随意 → 100=正式书面
  humor: number;          // 0=严肃认真 → 100=幽默搞笑
}

export interface AppSettings {
  apiKey: string; // Current active key (legacy support/fallback)
  apiKeys: Record<string, string>; // Map of provider -> apiKey
  baseUrl: string;
  model: string;
  language: string;
  systemPrompt: string;
  provider: string;
  github?: GitHubSettings;
  toutiao?: {
    cookie: string;
    autoPublish?: boolean; // 生成文章后是否自动发布
    customPrompt?: string; // 自定义提示词
  };
  zhihu?: {
    cookie: string;
    autoPublish?: boolean; // 生成文章后是否自动发布到知乎
    customPrompt?: string; // 自定义提示词
  };
  sync?: {
    enabled: boolean;
    backendUrl: string; // e.g. https://my-worker.workers.dev
    token?: string; // Session token
    encryptionKey?: string; // User's passphrase (not stored in cloud)
    lastSynced?: number;
    email?: string;
  };
  debugMode?: boolean;
  articleStyle?: ArticleStyleSettings; // 文章风格设置
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiKeys: {}, // Initialize empty map
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  model: 'deepseek-ai/deepseek-r1',
  provider: 'nvidia',
  language: 'zh-CN',
  github: {
    token: '',
    owner: '',
    repo: '',
    branch: 'main'
  },
  toutiao: {
    cookie: '',
    autoPublish: false,
    customPrompt: TOUTIAO_DEFAULT_PROMPT
  },
  zhihu: {
    cookie: '',
    autoPublish: false,
    customPrompt: ZHIHU_DEFAULT_PROMPT
  },
  systemPrompt: SYSTEM_PROMPTS['zh-CN'],
  sync: {
    enabled: false,
    backendUrl: 'https://memoraid-backend.iuyuger.workers.dev',
  },
  debugMode: false,
  // 文章风格默认值（都设为中间值50，表示中立/平衡）
  articleStyle: {
    objectivity: 50,   // 中立
    sentiment: 60,     // 略微积极
    tone: 50,          // 中立
    politeness: 60,    // 略微礼貌
    formality: 30,     // 偏口语化
    humor: 40          // 略微轻松
  }
};

export const getSettings = async (): Promise<AppSettings> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve(items as AppSettings);
    });
  });
};

export const saveSettings = async (settings: AppSettings): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, () => {
      resolve();
    });
  });
};

export interface HistoryItem {
  id: string;
  title: string;
  date: number;
  content: string;
  url: string;
}

export const getHistory = async (): Promise<HistoryItem[]> => {
  return new Promise((resolve) => {
    chrome.storage.local.get('chatHistory', (result) => {
      resolve(result.chatHistory || []);
    });
  });
};

export const addHistoryItem = async (item: HistoryItem): Promise<void> => {
  const history = await getHistory();
  const newHistory = [item, ...history].slice(0, 50); // Keep last 50 items
  return new Promise((resolve) => {
    chrome.storage.local.set({ chatHistory: newHistory }, () => {
      resolve();
    });
  });
};

export const clearHistory = async (): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.remove('chatHistory', () => {
      resolve();
    });
  });
};

export const deleteHistoryItem = async (id: string): Promise<void> => {
  const history = await getHistory();
  const newHistory = history.filter(item => item.id !== id);
  return new Promise((resolve) => {
    chrome.storage.local.set({ chatHistory: newHistory }, () => {
      resolve();
    });
  });
};

import { encryptData, decryptData, generateRandomString } from './crypto';

export const syncSettings = async (settings: AppSettings): Promise<AppSettings> => {
  if (!settings.sync?.enabled || !settings.sync.token || !settings.sync.backendUrl) {
    throw new Error('Sync not configured');
  }
  
  // Use provided encryption key or generate one if missing (though UI should enforce it)
  const passphrase = settings.sync.encryptionKey || generateRandomString();
  
  // Prepare data to encrypt (exclude sync config itself to avoid loop/issues)
  const dataToEncrypt = JSON.stringify({
    ...settings,
    sync: undefined // Don't sync the sync config itself
  });
  
  const { encrypted, salt, iv } = await encryptData(dataToEncrypt, passphrase);
  
  const response = await fetch(`${settings.sync.backendUrl}/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.sync.token}`
    },
    body: JSON.stringify({
      encryptedData: encrypted,
      salt,
      iv
    })
  });
  
  if (!response.ok) {
      const errorText = await response.text();
      console.error('Sync failed:', response.status, response.statusText, errorText);
      throw new Error(`Failed to upload settings: ${response.status} ${response.statusText} - ${errorText}`);
    }
  
  return {
    ...settings,
    sync: {
      ...settings.sync,
      lastSynced: Date.now(),
      encryptionKey: passphrase // Ensure we save the key if we generated it
    }
  };
};

export const restoreSettings = async (currentSettings: AppSettings): Promise<AppSettings> => {
  if (!currentSettings.sync?.enabled || !currentSettings.sync.token || !currentSettings.sync.backendUrl) {
    throw new Error('Sync not configured');
  }

  const response = await fetch(`${currentSettings.sync.backendUrl}/settings`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${currentSettings.sync.token}`
    }
  });

  if (!response.ok) {
     if (response.status === 404) {
       throw new Error('No remote settings found');
     }
     throw new Error('Failed to fetch settings');
  }

  const { encrypted_data, salt, iv } = await response.json();
  
  if (!currentSettings.sync.encryptionKey) {
     throw new Error('Missing encryption key');
  }

  try {
    const decryptedJson = await decryptData(encrypted_data, currentSettings.sync.encryptionKey, salt, iv);
    const remoteSettings = JSON.parse(decryptedJson);
    
    // Merge remote settings with local sync config
    return {
      ...remoteSettings,
      sync: {
        ...currentSettings.sync,
        lastSynced: Date.now()
      }
    };
  } catch (e) {
    throw new Error('Decryption failed. Wrong key?');
  }
};

