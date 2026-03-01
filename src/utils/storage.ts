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
  autoPublishAll?: boolean; // 自动发布（对所有平台生效）
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
  weixin?: {
    cookie: string;
    authorName?: string; // 原创声明作者名
    autoPublish?: boolean; // 是否自动发布
    customPrompt?: string; // 自定义提示词
  };
  xiaohongshu?: {
    cookie: string;
    autoPublish?: boolean; // 生成文章后是否自动发布到小红书
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
  promptVersions?: { // 提示词版本号，用于自动更新检测
    toutiao?: string;
    zhihu?: string;
    weixin?: string;
    xiaohongshu?: string;
  };
  anonymousId?: string; // 匿名用户唯一 ID
  scheduledTasks?: ScheduledTask[]; // 定时任务列表
}

// ============================================
// 定时任务相关类型定义
// ============================================

// 内容偏好分类（扩充覆盖范围，新增汽车、游戏、旅行、美食、数码、国际、军事、房产）
export type ContentCategory = 'tech' | 'society' | 'entertainment' | 'finance' | 'sports' | 'science' | 'health' | 'education' | 'crypto' | 'auto' | 'gaming' | 'travel' | 'food' | 'digital' | 'world' | 'military' | 'realestate';

// 内容偏好分类的中文映射
export const CONTENT_CATEGORIES: Record<ContentCategory, string> = {
  tech: '科技',
  society: '社会',
  entertainment: '娱乐',
  finance: '财经',
  sports: '体育',
  science: '科学',
  health: '健康',
  education: '教育',
  crypto: '加密货币',
  auto: '汽车',
  gaming: '游戏',
  travel: '旅行',
  food: '美食',
  digital: '数码',
  world: '国际',
  military: '军事',
  realestate: '房产',
};

// 发布平台类型
export type PublishPlatform = 'weixin' | 'toutiao' | 'zhihu' | 'xiaohongshu';

// 发布平台的中文映射
export const PUBLISH_PLATFORMS: Record<PublishPlatform, string> = {
  weixin: '微信公众号',
  toutiao: '头条号',
  zhihu: '知乎',
  xiaohongshu: '小红书',
};

// 定时任务调度类型
export type ScheduleType = 'daily' | 'weekly' | 'interval';

// 定时任务配置
export interface ScheduledTask {
  id: string;                        // 唯一标识
  enabled: boolean;                  // 是否启用
  name: string;                      // 任务名称
  scheduleType: ScheduleType;        // 调度类型：每天/每周/间隔
  hour: number;                      // 执行小时（0-23）
  minute: number;                    // 执行分钟（0-59）
  weekdays?: number[];               // 周几执行（0=周日, 1=周一...6=周六），仅 weekly 类型
  intervalMinutes?: number;          // 间隔分钟数，仅 interval 类型
  newsSourceUrl: string;             // 新闻源 URL
  categories: ContentCategory[];     // 内容偏好分类
  platforms: PublishPlatform[];      // 发布到哪些平台
  lastRunTime?: number;              // 上次执行时间戳
  lastRunStatus?: 'success' | 'failed' | 'running'; // 上次执行状态
  lastRunError?: string;             // 上次执行失败的错误信息
  createdAt: number;                 // 创建时间
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiKeys: {}, // Initialize empty map
  baseUrl: 'https://memoraid.dpdns.org/api/ai', // Default to our backend proxy
  model: 'deepseek-chat',
  provider: 'memoraid', // Custom provider that uses our backend
  language: 'zh-CN',
  autoPublishAll: false,
  github: {
    token: '',
    owner: '',
    repo: '',
    branch: 'main'
  },
  toutiao: {
    cookie: '',
    autoPublish: true,
    customPrompt: TOUTIAO_DEFAULT_PROMPT
  },
  zhihu: {
    cookie: '',
    autoPublish: true,
    customPrompt: ZHIHU_DEFAULT_PROMPT
  },
  weixin: {
    cookie: '',
    authorName: '',
    autoPublish: true,
    customPrompt: ''
  },
  xiaohongshu: {
    cookie: '',
    autoPublish: true,
    customPrompt: ''
  },
  systemPrompt: SYSTEM_PROMPTS['zh-CN'],
  sync: {
    enabled: false,
    backendUrl: 'https://memoraid.dpdns.org',
    encryptionKey: '123456'
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
  },
  anonymousId: '',
  scheduledTasks: [] // 默认无定时任务
};

export const getSettings = async (): Promise<AppSettings> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      const settings = items as AppSettings;
      
      // 如果没有匿名 ID，生成一个并保存
      if (!settings.anonymousId) {
        settings.anonymousId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        chrome.storage.sync.set({ anonymousId: settings.anonymousId });
      }
      
      resolve(settings);
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

