import { SYSTEM_PROMPTS } from './prompts';

export interface GitHubSettings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiKeys: {}, // Initialize empty map
  baseUrl: 'https://api.apiyi.com/v1',
  model: 'gpt-4o',
  provider: 'apiyi',
  language: 'zh-CN',
  github: {
    token: '',
    owner: '',
    repo: '',
    branch: 'main'
  },
  toutiao: {
    cookie: ''
  },
  systemPrompt: SYSTEM_PROMPTS['zh-CN'],
  sync: {
    enabled: false,
    backendUrl: 'https://memoraid-backend.iuyuger.workers.dev',
  },
  debugMode: false
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

