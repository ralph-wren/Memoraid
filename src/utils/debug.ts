import { getSettings } from './storage';

const normalizeBackendUrl = (input: string): string => {
  if (!input) return 'https://memoraid.dpdns.org';
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') && !trimmed.includes('localhost') && !trimmed.includes('127.0.0.1')) {
    return trimmed.replace(/^http:\/\//, 'https://');
  }
  return trimmed;
};

export const reportError = async (error: Error | string, context?: any) => {
  try {
    const settings = await getSettings();
    if (!settings.debugMode) return;

    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    const payload = {
      error: errorMsg,
      stack,
      context,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Fire and forget - don't await result to avoid blocking
    const backendUrls = Array.from(
      new Set([
        normalizeBackendUrl(settings.sync?.backendUrl || ''),
        'https://memoraid.dpdns.org'
      ])
    );

    for (const backendUrl of backendUrls) {
      fetch(`${backendUrl}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }).catch(() => undefined);
    }

  } catch (e) {
    console.error('Error reporting failed:', e);
  }
};

export const reportArticlePublish = async (args: {
  platform: string;
  title: string;
  url?: string;
  summary?: string;
  cover?: string;
  publishTime?: number;
  status?: string;
  extra?: Record<string, unknown>;
  generatedId?: string;
  logs?: Array<{ time: number; level: string; message: string }>; // 【新增2026-03-28】发布日志
}) => {
  try {
    console.log('[reportArticlePublish] 开始上报文章:', {
      platform: args.platform,
      title: args.title,
      status: args.status,
      hasUrl: !!args.url,
      hasGeneratedId: !!args.generatedId,
      hasLogs: !!args.logs && args.logs.length > 0
    });

    let urlText = typeof args.url === 'string' ? args.url.trim() : '';
    const isGenerated = args.status === 'generated';

    // 如果是 generated 状态且没有 URL，生成一个临时 ID
    if (isGenerated && !urlText) {
      urlText = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log('[reportArticlePublish] 生成临时ID:', urlText);
    }

    // 只有非 generated 状态才强制检查 http
    if (!isGenerated && (!urlText || !(urlText.startsWith('http://') || urlText.startsWith('https://')))) {
      console.log('[reportArticlePublish] 跳过上报: URL无效且非generated状态');
      return;
    }

    const settings = await getSettings();
    const backendUrls = Array.from(
      new Set([
        normalizeBackendUrl(settings.sync?.backendUrl || ''),
        'https://memoraid.dpdns.org'
      ])
    );
    const email = settings.sync?.email || settings.anonymousId || 'unknown';
    // 如果提供了 generatedId，则优先使用它作为 articleId，以便关联更新
    const articleId = args.generatedId || urlText;

    console.log('[reportArticlePublish] 上报配置:', {
      backendUrls,
      email,
      articleId,
      hasToken: !!settings.sync?.token
    });

    try {
      if (typeof sessionStorage !== 'undefined' && !isGenerated) {
        const dedupeKey = `memoraid_reported_url:${args.platform}`;
        const last = sessionStorage.getItem(dedupeKey);
        if (last === urlText) {
          console.log('[reportArticlePublish] 跳过上报: 已上报过此URL');
          return articleId;
        }
        sessionStorage.setItem(dedupeKey, urlText);
      }
    } catch {
    }

    const payload = {
      platform: args.platform,
      account: {
        id: email,
        name: email,
        avatar: '',
        extra: { source: 'extension' }
      },
      articles: [
        {
          id: articleId,
          title: args.title,
          summary: args.summary || '',
          cover: args.cover || '',
          url: isGenerated ? '' : urlText, // 生成的文章 URL 留空，或者是真实的 URL
          publishTime: args.publishTime || Math.floor(Date.now() / 1000),
          status: args.status || 'published',
          extra: args.extra || {},
          logs: args.logs || [] // 【新增2026-03-28】传递发布日志
        }
      ]
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.sync?.token) headers.Authorization = `Bearer ${settings.sync.token}`;

    console.log('[reportArticlePublish] 发送请求到后端...');
    
    for (const backendUrl of backendUrls) {
      fetch(`${backendUrl}/api/articles/report`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }).then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          console.log('[reportArticlePublish] 上报成功:', data);
        } else {
          const errorText = await response.text();
          console.error('[reportArticlePublish] 上报失败:', response.status, errorText);
        }
      }).catch((error) => {
        console.error('[reportArticlePublish] 网络错误:', error);
      });
    }
    
    return articleId;
  } catch (error) {
    console.error('[reportArticlePublish] 异常:', error);
    return undefined;
  }
};
