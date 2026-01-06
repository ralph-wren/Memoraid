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
  systemPrompt: SYSTEM_PROMPTS['zh-CN']
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
