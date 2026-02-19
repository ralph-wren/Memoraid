import { reportArticlePublish } from '../utils/debug';
import OpenAI from 'openai';
import { marked } from 'marked';
import { getSettings, saveSettings, DEFAULT_SETTINGS, addHistoryItem } from '../utils/storage';
import { ExtractionResult, ActiveTask, ChatMessage } from '../utils/types';
import { generateArticlePrompt, TOUTIAO_DEFAULT_PROMPT, WEIXIN_DEFAULT_PROMPT, ZHIHU_DEFAULT_PROMPT, XIAOHONGSHU_DEFAULT_PROMPT } from '../utils/prompts';
import { generateRandomString } from '../utils/crypto';

console.log('Background service worker started');

let currentTask: ActiveTask | null = null;
let abortController: AbortController | null = null;

// Initialize state from storage on startup
chrome.storage.local.get(['currentTask'], (result) => {
  if (result.currentTask) {
    currentTask = result.currentTask;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// ========== Cookie 自动更新监听器 ==========
// 当用户登录/退出平台时，自动更新设置中的 cookie

// 防抖定时器，避免频繁更新
let cookieUpdateTimers: { [key: string]: NodeJS.Timeout } = {};

// 监听 cookie 变化
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  const { cookie } = changeInfo;
  const domain = cookie.domain;

  // 判断是哪个平台的 cookie 变化
  let platform: 'toutiao' | 'zhihu' | 'weixin' | null = null;

  if (domain.includes('toutiao.com')) {
    platform = 'toutiao';
  } else if (domain.includes('zhihu.com')) {
    platform = 'zhihu';
  } else if (domain.includes('qq.com')) {
    platform = 'weixin';
  }

  if (!platform) return;

  // 使用防抖，避免短时间内多次 cookie 变化导致频繁更新
  // 等待 2 秒后再更新，确保所有 cookie 都已设置完成
  if (cookieUpdateTimers[platform]) {
    clearTimeout(cookieUpdateTimers[platform]);
  }

  cookieUpdateTimers[platform] = setTimeout(async () => {
    console.log(`[Cookie Monitor] Detected ${platform} cookie change, auto-updating...`);
    await updatePlatformCookie(platform!);
    delete cookieUpdateTimers[platform!];
  }, 2000);
});

// 更新指定平台的 cookie
async function updatePlatformCookie(platform: 'toutiao' | 'zhihu' | 'weixin') {
  try {
    const settings = await getSettings();
    const now = Date.now() / 1000;

    let url: string;
    let settingsKey: 'toutiao' | 'zhihu' | 'weixin';

    switch (platform) {
      case 'toutiao':
        url = 'https://mp.toutiao.com/';
        settingsKey = 'toutiao';
        break;
      case 'zhihu':
        url = 'https://zhuanlan.zhihu.com/';
        settingsKey = 'zhihu';
        break;
      case 'weixin':
        url = 'https://mp.weixin.qq.com/';
        settingsKey = 'weixin';
        break;
    }

    // 使用 URL 方式获取该平台所有有效的 cookie
    const cookies = await chrome.cookies.getAll({ url });

    // 过滤：只保留未过期且有值的 cookie
    const validCookies = cookies.filter(c => {
      if (c.expirationDate && c.expirationDate < now) return false;
      if (!c.value || c.value.trim() === '') return false;
      return true;
    });

    if (validCookies.length > 0) {
      const cookieStr = validCookies.map(c => `${c.name}=${c.value}`).join('; ');

      // 检查 cookie 是否有变化，避免无意义的更新
      const currentCookie = settings[settingsKey]?.cookie || '';
      if (cookieStr !== currentCookie) {
        console.log(`[Cookie Monitor] Updating ${platform} cookie (${validCookies.length} cookies)`);

        const newSettings = {
          ...settings,
          [settingsKey]: {
            ...settings[settingsKey],
            cookie: cookieStr
          }
        };

        await saveSettings(newSettings);
        console.log(`[Cookie Monitor] ${platform} cookie updated successfully`);
      }
    } else {
      // 没有有效 cookie，可能是用户退出登录了
      // 清空设置中的 cookie
      const currentCookie = settings[settingsKey]?.cookie || '';
      if (currentCookie) {
        console.log(`[Cookie Monitor] ${platform} cookies cleared (user logged out?)`);

        const newSettings = {
          ...settings,
          [settingsKey]: {
            ...settings[settingsKey],
            cookie: ''
          }
        };

        await saveSettings(newSettings);
      }
    }
  } catch (error) {
    console.error(`[Cookie Monitor] Failed to update ${platform} cookie:`, error);
  }
}

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_LOGIN') {
    handleLogin(message.payload.provider)
      .then(() => sendResponse({ success: true }))
      .catch((e: any) => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  if (message.type === 'START_SUMMARIZATION') {
    startSummarization(message.payload);
    sendResponse({ success: true });
    return true; // async response
  }

  if (message.type === 'START_ARTICLE_GENERATION') {
    startArticleGeneration(message.payload);
    sendResponse({ success: true });
    return true; // async response
  }

  if (message.type === 'START_REFINEMENT') {
    const { messages, title } = message.payload;
    startRefinement(messages, title);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PUBLISH_TO_TOUTIAO') {
    handlePublishToToutiao(message.payload);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PUBLISH_TO_ZHIHU') {
    handlePublishToZhihu(message.payload);
    sendResponse({ success: true });
    return true;
  }

  // 一键生成文章并发布到头条
  if (message.type === 'GENERATE_AND_PUBLISH_TOUTIAO') {
    startArticleGenerationAndPublish(message.payload, 'toutiao');
    sendResponse({ success: true });
    return true;
  }

  // 一键生成文章并发布到知乎
  if (message.type === 'GENERATE_AND_PUBLISH_ZHIHU') {
    startArticleGenerationAndPublish(message.payload, 'zhihu');
    sendResponse({ success: true });
    return true;
  }

  // 一键生成文章并发布到微信公众号
  if (message.type === 'GENERATE_AND_PUBLISH_WEIXIN') {
    startArticleGenerationAndPublish(message.payload, 'weixin');
    sendResponse({ success: true });
    return true;
  }

  // 一键生成文章并发布到小红书
  if (message.type === 'GENERATE_AND_PUBLISH_XIAOHONGSHU') {
    startArticleGenerationAndPublish(message.payload, 'xiaohongshu');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PUBLISH_TO_WEIXIN') {
    handlePublishToWeixin(message.payload);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PUBLISH_TO_XIAOHONGSHU') {
    handlePublishToXiaohongshu(message.payload);
    sendResponse({ success: true });
    return true;
  }

  // 新增：初始化完整生成流程（抓取+生成+发布）
  // 这将抓取逻辑从 Popup 移至 Background，解决 Popup 关闭导致任务中断的问题
  if (message.type === 'INITIATE_GENERATE_AND_PUBLISH') {
    const { platform, tabId } = message.payload;
    // 异步执行，不等待结果直接返回成功
    handleInitiateProcess(platform, tabId);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CANCEL_SUMMARIZATION') {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    stopTimer(); // Ensure timer stops immediately
    currentTask = null;
    chrome.storage.local.remove('currentTask');
    broadcastUpdate();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    // Return the memory state which should be in sync with storage
    sendResponse(currentTask);
    return true;
  }

  if (message.type === 'CLEAR_STATUS') {
    currentTask = null;
    chrome.storage.local.remove('currentTask');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'ANALYZE_SCREENSHOT') {
    handleAnalyzeScreenshot(message.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 处理链接内容获取请求（用于增强版内容抓取）
  if (message.type === 'FETCH_LINK_CONTENT') {
    fetchLinkContent(message.payload.url, message.payload.timeout)
      .then(content => sendResponse({ success: true, content }))
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 处理图片获取请求（用于绕过防盗链/CORS，返回 base64 data URL）
  if (message.type === 'FETCH_IMAGE_DATA_URL') {
    fetchImageAsDataUrl(message.payload.url, message.payload.referrer)
      .then(({ dataUrl, mimeType }) => sendResponse({ success: true, dataUrl, mimeType }))
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 新增：下载图片为 Blob（用于上传）
  if (message.type === 'DOWNLOAD_IMAGE_AS_BLOB') {
    downloadImageAsBlob(message.payload.url, message.payload.referrer)
      .then(({ blob, mimeType, filename }) => {
        // 将 Blob 转换为 ArrayBuffer 以便传输
        return blob.arrayBuffer().then(arrayBuffer => {
          sendResponse({
            success: true,
            arrayBuffer: Array.from(new Uint8Array(arrayBuffer)),
            mimeType,
            filename,
            size: blob.size
          });
        });
      })
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 新增：通过 R2 中转下载图片（绕过防盗链）
  if (message.type === 'DOWNLOAD_IMAGE_VIA_R2') {
    downloadImageViaR2(message.payload.url, message.payload.referrer)
      .then(r2Url => sendResponse({ success: true, r2Url }))
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 处理分页图片获取请求（用于增强版内容抓取）
  if (message.type === 'FETCH_PAGE_IMAGES') {
    fetchPageImages(message.payload.url, message.payload.maxCount)
      .then(images => sendResponse({ success: true, images }))
      .catch(e => sendResponse({ success: false, error: e.message || String(e) }));
    return true;
  }

  // 兼容旧消息：AI_RANK_IMAGES（内部复用 AI_MEDIA_ENHANCE 结果结构）
  if (message.type === 'AI_RANK_IMAGES') {
    // 功能已移除，直接返回空结果
    sendResponse({ success: true, result: { orderedUrls: [] } });
    return true;
  }

  // 处理图片 OCR 识别请求（使用 AI 视觉能力识别图片中的文字）
  if (message.type === 'OCR_IMAGE') {
    // 功能已移除，直接返回提示信息
    sendResponse({ success: false, error: '图片文字识别功能已移除' });
    return true;
  }

  if (message.type === 'AI_MEDIA_ENHANCE') {
    // 功能已移除，直接返回空结果
    sendResponse({ success: true, result: {} });
    return true;
  }

  // 处理 PING 请求（用于检测扩展连接是否有效，特别是 bfcache 恢复后）
  if (message.type === 'PING') {
    sendResponse({ success: true, pong: true });
    return false; // 同步响应
  }
});

// 已移除 handleAiMediaEnhance 和 handleOcrImage 函数

async function handleInitiateProcess(platform: 'toutiao' | 'zhihu' | 'weixin' | 'xiaohongshu', tabId: number) {
  const platformName = platform === 'toutiao' ? '头条' :
    platform === 'zhihu' ? '知乎' :
      platform === 'xiaohongshu' ? '小红书' : '公众号';

  // 1. 设置初始状态，让用户立即看到反馈
  currentTask = {
    status: 'Processing...',
    message: `正在从页面抓取内容...`,
    progress: 5,
    title: '正在抓取...'
  };
  chrome.storage.local.set({ currentTask });
  broadcastUpdate();

  try {
    console.log(`[Background] 开始抓取内容 (Tab: ${tabId})...`);

    // 2. 从 Background 发送消息给 Content Script
    // 注意：这里需要处理 Content Script 可能未加载或连接失败的情况
    let response;
    let retryCount = 0;
    const maxRetries = 10; // 增加重试次数，应对微博等慢加载页面

    while (retryCount < maxRetries) {
      try {
        // 每次重试前检查 Tab 是否还存在且 url 没变（这就太复杂了，先只发消息）
        response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' });
        if (response) break;
      } catch (e) {
        console.log(`[Background] 抓取通信尝试 ${retryCount + 1}/${maxRetries} 失败，等待重试...`);
      }

      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 800)); // 每次等待 800ms
      }
    }

    if (!response) {
      console.error('抓取通信最终失败');
      throw new Error('无法连接到页面，请刷新页面后重试');
    }

    if (!response) {
      throw new Error('页面无响应，请刷新后重试');
    }

    if (response.type === 'ERROR') {
      throw new Error(response.payload || '内容抓取失败');
    }

    const extraction = response.payload;
    console.log(`[Background] 抓取成功: ${extraction.title}`);

    // 更新状态
    updateTaskState({
      message: '抓取完成，准备生成文章...',
      progress: 20,
      title: extraction.title
    });

    // 3. 开始生成和发布流程
    await startArticleGenerationAndPublish(extraction, platform);

  } catch (error: any) {
    console.error('流程失败:', error);
    updateTaskState({
      status: 'Error',
      message: error.message || '处理过程中发生错误',
      progress: 0,
      error: error.message
    });

    // 发送错误通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icon-128.png'),
      title: '任务失败',
      message: error.message || `发布到${platformName}失败`
    });
  }
}

/**
 * 获取链接页面的文本内容
 * @param url 要获取的链接URL
 * @param timeout 超时时间（毫秒）
 */
async function fetchLinkContent(url: string, timeout: number = 5000): Promise<string> {
  console.log(`[Background] Fetching link content: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // 简单提取文本内容（移除HTML标签）
    // 创建一个临时的DOM解析器
    const textContent = extractTextFromHtml(html);

    console.log(`[Background] Fetched ${textContent.length} chars from ${url}`);
    return textContent;

  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchImageAsDataUrl(url: string, referrer?: string): Promise<{ dataUrl: string; mimeType: string }> {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  // 策略 1: 尝试使用图片代理服务（绕过防盗链）
  if (host.endsWith('sinaimg.cn')) {
    console.log(`[fetchImageAsDataUrl] 检测到微博图片，尝试使用代理服务`);

    // 尝试多个图片代理服务
    const proxyServices = [
      // 方案 1: 直接尝试（可能失败）
      { url: url, name: '直接访问' },
      // 方案 2: 使用 images.weserv.nl 代理
      { url: `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}`, name: 'weserv.nl' },
      // 方案 3: 使用 imageproxy.pimg.tw 代理
      { url: `https://imageproxy.pimg.tw/resize?url=${encodeURIComponent(url)}`, name: 'pimg.tw' },
    ];

    for (const proxy of proxyServices) {
      try {
        console.log(`[fetchImageAsDataUrl] 尝试代理: ${proxy.name}`);
        const response = await fetch(proxy.url, {
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        console.log(`[fetchImageAsDataUrl] ${proxy.name} 响应: ${response.status}`);

        if (response.ok) {
          const blob = await response.blob();
          if (blob.size >= 1024) {
            const mimeType = (blob.type || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binary);
            const dataUrl = `data:${mimeType};base64,${base64}`;
            console.log(`[fetchImageAsDataUrl] ✅ ${proxy.name} 成功，大小: ${(blob.size / 1024).toFixed(1)} KB`);
            return { dataUrl, mimeType };
          }
        }
      } catch (e) {
        console.log(`[fetchImageAsDataUrl] ${proxy.name} 失败:`, e);
      }
    }
  }

  // 策略 2: 传统的 referrer 策略（作为后备）
  const fallbackReferrers = [
    referrer,
    host.endsWith('sinaimg.cn') ? 'https://weibo.com/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://m.weibo.cn/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://s.weibo.com/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://www.weibo.com/' : undefined,
  ].filter(Boolean) as string[];

  let lastErr: unknown = null;
  const attempts = fallbackReferrers.length ? fallbackReferrers : [undefined];

  for (let i = 0; i < attempts.length; i++) {
    const r = attempts[i];
    try {
      console.log(`[fetchImageAsDataUrl] 尝试 referrer ${i + 1}/${attempts.length}: ${r || 'none'}`);

      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        referrer: r,
        referrerPolicy: r ? 'unsafe-url' : 'no-referrer',
        headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(r ? { 'Referer': r } as any : {}),
        },
      });

      console.log(`[fetchImageAsDataUrl] 响应状态: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        lastErr = new Error(`HTTP ${response.status} ${response.statusText}`);
        console.log(`[fetchImageAsDataUrl] 请求失败: ${lastErr}`);
        continue;
      }

      const ct = (response.headers.get('content-type') || '').toLowerCase();
      console.log(`[fetchImageAsDataUrl] Content-Type: ${ct}`);

      if (ct && !ct.startsWith('image/')) {
        lastErr = new Error(`Unexpected content-type: ${ct}`);
        console.log(`[fetchImageAsDataUrl] 内容类型错误: ${lastErr}`);
        continue;
      }

      const blob = await response.blob();
      console.log(`[fetchImageAsDataUrl] Blob 大小: ${blob.size} bytes, 类型: ${blob.type}`);

      if (blob.size < 1024) {
        lastErr = new Error(`图片太小 (${blob.size} bytes)，可能是错误页面`);
        console.log(`[fetchImageAsDataUrl] ${lastErr}`);
        continue;
      }

      const mimeType = (blob.type || response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      console.log(`[fetchImageAsDataUrl] 成功获取图片，base64 长度: ${dataUrl.length}`);
      return { dataUrl, mimeType };
    } catch (e) {
      lastErr = e;
      console.error(`[fetchImageAsDataUrl] 异常:`, e);
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'unknown');
  console.error(`[fetchImageAsDataUrl] 所有尝试均失败: ${msg}`);
  throw new Error(`Failed to fetch image: ${msg}`);
}

/**
 * 通过 R2 中转下载图片（绕过防盗链）
 * 1. 调用后端 API，让后端下载图片
 * 2. 后端上传到 R2
 * 3. 返回 R2 的公开 URL
 */
async function downloadImageViaR2(url: string, _referrer?: string): Promise<string> {
  console.log(`[downloadImageViaR2] 开始处理: ${url}`);

  try {
    const settings = await getSettings();
    const backendUrl = settings.sync?.backendUrl || DEFAULT_SETTINGS.sync!.backendUrl;

    console.log(`[downloadImageViaR2] 调用后端 API: ${backendUrl}/api/upload-from-url`);

    const uploadResponse = await fetch(`${backendUrl}/api/upload-from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`后端 API 失败: HTTP ${uploadResponse.status} - ${errorText}`);
    }

    const result = await uploadResponse.json();

    if (!result.success || !result.url) {
      throw new Error(`后端 API 失败: ${result.error || '未知错误'}`);
    }

    console.log(`[downloadImageViaR2] ✅ 成功，R2 URL: ${result.url}`);
    return result.url;

  } catch (error: any) {
    console.error(`[downloadImageViaR2] 失败:`, error);
    throw new Error(`通过 R2 中转失败: ${error.message || String(error)}`);
  }
}

/**
 * 下载图片为 Blob（用于文件上传）
 */
async function downloadImageAsBlob(url: string, referrer?: string): Promise<{ blob: Blob; mimeType: string; filename: string }> {
  console.log(`[downloadImageAsBlob] 开始下载: ${url}`);

  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  // 生成文件名
  const generateFilename = (mimeType: string): string => {
    const ext = mimeType.split('/')[1] || 'jpg';
    return `weibo-image-${Date.now()}.${ext}`;
  };

  // 策略 1: 尝试使用图片代理服务
  if (host.endsWith('sinaimg.cn')) {
    console.log(`[downloadImageAsBlob] 检测到微博图片，尝试使用代理服务`);

    // 尝试将 URL 转换为更通用的格式
    const cleanUrl = url.replace(/^https?:\/\//, '');

    const proxyServices = [
      // 方案 1: 使用 wsrv.nl (weserv.nl 的短域名)
      { url: `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}`, name: 'wsrv.nl' },
      // 方案 2: 使用 images.weserv.nl
      { url: `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}`, name: 'weserv.nl' },
      // 方案 3: 使用 imageproxy.pimg.tw
      { url: `https://imageproxy.pimg.tw/resize?url=${encodeURIComponent(url)}`, name: 'pimg.tw' },
      // 方案 4: 使用 img.shields.io (可能不支持，但值得一试)
      { url: `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(url)}`, name: 'shields.io' },
      // 方案 5: 直接访问（带完整 headers）
      {
        url: url, name: '直接访问(完整headers)', headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://weibo.com/',
          'Origin': 'https://weibo.com',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site',
        }
      },
    ];

    for (const proxy of proxyServices) {
      try {
        console.log(`[downloadImageAsBlob] 尝试代理: ${proxy.name}`);
        const response = await fetch(proxy.url, {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
          headers: proxy.headers || {
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        console.log(`[downloadImageAsBlob] ${proxy.name} 响应: ${response.status}`);

        if (response.ok) {
          const blob = await response.blob();
          console.log(`[downloadImageAsBlob] ${proxy.name} Blob大小: ${blob.size} bytes, 类型: ${blob.type}`);

          // 检查是否是有效的图片
          const mimeType = (blob.type || '').toLowerCase();
          const isValidImage = mimeType.startsWith('image/') &&
            !mimeType.includes('svg') &&
            blob.size >= 10240; // 至少 10KB

          if (isValidImage) {
            const cleanMimeType = (blob.type || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
            const filename = generateFilename(cleanMimeType);
            console.log(`[downloadImageAsBlob] ✅ ${proxy.name} 成功，大小: ${(blob.size / 1024).toFixed(1)} KB`);
            return { blob, mimeType: cleanMimeType, filename };
          } else {
            console.log(`[downloadImageAsBlob] ${proxy.name} 无效图片: 类型=${mimeType}, 大小=${blob.size} bytes`);
          }
        }
      } catch (e) {
        console.log(`[downloadImageAsBlob] ${proxy.name} 失败:`, e);
      }
    }
  }

  // 策略 2: 传统的 referrer 策略
  const fallbackReferrers = [
    referrer,
    host.endsWith('sinaimg.cn') ? 'https://weibo.com/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://m.weibo.cn/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://s.weibo.com/' : undefined,
    host.endsWith('sinaimg.cn') ? 'https://www.weibo.com/' : undefined,
  ].filter(Boolean) as string[];

  let lastErr: unknown = null;
  const attempts = fallbackReferrers.length ? fallbackReferrers : [undefined];

  for (let i = 0; i < attempts.length; i++) {
    const r = attempts[i];
    try {
      console.log(`[downloadImageAsBlob] 尝试 referrer ${i + 1}/${attempts.length}: ${r || 'none'}`);

      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        referrer: r,
        referrerPolicy: r ? 'unsafe-url' : 'no-referrer',
        headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(r ? { 'Referer': r } as any : {}),
        },
      });

      console.log(`[downloadImageAsBlob] 响应状态: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        lastErr = new Error(`HTTP ${response.status} ${response.statusText}`);
        continue;
      }

      const blob = await response.blob();
      console.log(`[downloadImageAsBlob] Blob 大小: ${blob.size} bytes`);

      if (blob.size < 1024) {
        lastErr = new Error(`图片太小 (${blob.size} bytes)`);
        continue;
      }

      const mimeType = (blob.type || response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
      const filename = generateFilename(mimeType);

      console.log(`[downloadImageAsBlob] 成功下载图片: ${filename}, ${(blob.size / 1024).toFixed(1)} KB`);
      return { blob, mimeType, filename };
    } catch (e) {
      lastErr = e;
      console.error(`[downloadImageAsBlob] 异常:`, e);
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'unknown');
  console.error(`[downloadImageAsBlob] 所有尝试均失败: ${msg}`);
  throw new Error(`Failed to download image: ${msg}`);
}

async function fetchPageImages(url: string, maxCount = 40): Promise<string[]> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const html = await response.text();
  const matches = html.match(/https?:\/\/(?:wx\d|tvax\d)\.sinaimg\.cn\/[a-zA-Z0-9/_\-.]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?/g) || [];
  const cleaned = matches
    .map(u => u.split('"')[0].split("'")[0].trim())
    .filter(Boolean)
    .filter(u => !new URL(u).hostname.toLowerCase().startsWith('tvax'));
  const uniq = Array.from(new Set(cleaned));
  return uniq.slice(0, Math.max(1, Number(maxCount) || 40));
}

// 已移除 handleOcrImage 函数

/**
 * 从HTML中提取纯文本内容
 */
function extractTextFromHtml(html: string): string {
  // 移除script和style标签及其内容
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // 移除HTML注释
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 移除所有HTML标签
  text = text.replace(/<[^>]+>/g, ' ');

  // 解码HTML实体
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&ldquo;/g, '"');
  text = text.replace(/&rdquo;/g, '"');
  text = text.replace(/&lsquo;/g, "'");
  text = text.replace(/&rsquo;/g, "'");
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');
  text = text.replace(/&#\d+;/g, ''); // 移除其他数字实体

  // 清理多余空白
  text = text.replace(/\s+/g, ' ');
  text = text.trim();

  return text;
}

async function handleAnalyzeScreenshot({ prompt, history }: { prompt: string, history?: any[] }) {
  try {
    const settings = await getSettings();
    let effectiveApiKey = settings.apiKeys?.[settings.provider] || settings.apiKey;

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing.`);
    }

    // 1. Capture Screenshot
    // Note: captureVisibleTab works in background script for the active tab of the current window
    // @ts-ignore - Chrome API types can be tricky with optional arguments
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 60 });

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL: settings.baseUrl,
    });

    // 2. Call AI with Vision
    const messages = [
      ...(history || []),
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
              detail: "low" // Use low detail for speed and cost, usually enough for UI buttons
            }
          }
        ]
      } as any // Cast to any to avoid type issues if installed SDK is slightly old
    ];

    const response = await openai.chat.completions.create({
      model: settings.model,
      messages: messages,
      max_tokens: 300
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Screenshot analysis failed:', error);
    throw error;
  }
}


function updateTaskState(newState: Partial<ActiveTask>) {
  currentTask = { ...currentTask, ...newState } as ActiveTask;
  chrome.storage.local.set({ currentTask });
  broadcastUpdate();
}

let timerInterval: NodeJS.Timeout | null = null;
let startTime: number = 0;

function startTimer(baseMessage: string) {
  if (timerInterval) clearInterval(timerInterval);
  startTime = Date.now();

  timerInterval = setInterval(() => {
    if (!currentTask) {
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const message = `${baseMessage} (${elapsed}s)`;

    // Update task state without broadcasting every second to avoid UI flicker overkill, 
    // but here we want to show it, so we update storage and broadcast.
    // To optimize, maybe only broadcast if popup is open? 
    // For now, we update the task state.
    currentTask = { ...currentTask, message };
    chrome.storage.local.set({ currentTask });
    broadcastUpdate();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function startRefinement(messages: ChatMessage[], title?: string) {
  try {
    abortController = new AbortController();
    // Clear previous task state to avoid pollution, but we will merge new state in updateTaskState
    // so we set currentTask to empty object first if we want a fresh start, 
    // OR we just rely on overwriting fields.
    // For refinement, we want to ensure we track the title.

    // Explicitly set the initial state for refinement
    currentTask = {
      status: 'Refining...',
      message: 'Initializing refinement...',
      progress: 5,
      conversationHistory: messages,
      title: title
    };
    chrome.storage.local.set({ currentTask });
    broadcastUpdate();

    const settings = await getSettings();
    let effectiveApiKey = settings.apiKeys?.[settings.provider] || settings.apiKey;

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing. Please check settings.`);
    }

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL: settings.baseUrl,
    });

    updateTaskState({
      status: 'Refining...',
      message: 'Sending instructions to AI...',
      progress: 30,
      conversationHistory: messages
    });

    // Stream handling logic
    const stream = await openai.chat.completions.create({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert technical editor. The conversation history contains a markdown document generated by an assistant. The user will ask for changes, optimizations, or extensions to this specific document. You must REWRITE the entire document incorporating these changes based on the existing content. Return ONLY the updated markdown content. Do not generate a new document from scratch unless explicitly asked. Do not include conversational filler like "Here is the updated version".'
        },
        ...messages.filter(m => m.role !== 'system'),
      ] as any,
      stream: true,
    }, { signal: abortController.signal });

    const baseMessage = 'Generating response...';
    startTimer(baseMessage);

    let refinedContent = '';
    let lastUpdate = Date.now();

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      refinedContent += content;

      // Throttle updates to UI every 500ms
      const now = Date.now();
      if (now - lastUpdate > 500) {
        lastUpdate = now;
        // Update in-memory task state and broadcast, but AVOID storage writes for performance
        currentTask = {
          ...currentTask,
          status: 'Refining...',
          message: `${baseMessage} (${Math.floor(refinedContent.length / 100)}k chars)`,
          result: refinedContent, // Live preview
          progress: 50 + Math.min(40, Math.floor(refinedContent.length / 50)) // Fake progress based on length
        } as ActiveTask;
        broadcastUpdate();
      }
    }

    stopTimer();

    updateTaskState({
      status: 'Refining...',
      message: 'Processing response...',
      progress: 90,
      conversationHistory: messages
    });

    // Update history with assistant response
    const updatedHistory: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: refinedContent }
    ];

    // Generate new versioned title
    let newTitle = title || 'Untitled Chat';
    const versionMatch = newTitle.match(/\(v(\d+)\)$/);
    if (versionMatch) {
      const version = parseInt(versionMatch[1], 10) + 1;
      newTitle = newTitle.replace(/\(v\d+\)$/, `(v${version})`);
    } else {
      newTitle = `${newTitle} (v2)`;
    }

    // Save to History
    const newItem = {
      id: Date.now().toString(),
      title: newTitle,
      date: Date.now(),
      content: refinedContent,
      url: '' // We might not have URL here, but that's okay for refined docs
    };
    await addHistoryItem(newItem);

    // 记录生成文章（无需发布）
    const generatedId = await reportArticlePublish({
      platform: 'memoraid', // 默认平台
      title: newTitle,
      status: 'generated',
      summary: refinedContent.substring(0, 200),
      extra: {
        sourceUrl: '',
        sourceTitle: title || 'Untitled Chat'
      }
    });

    updateTaskState({
      status: 'Refined!',
      message: 'Refinement complete!',
      progress: 100,
      result: refinedContent,
      conversationHistory: updatedHistory,
      title: newTitle,
      generatedId // 保存生成的 ID
    });

  } catch (error: any) {
    stopTimer();
    if (error.name === 'AbortError') {
      console.log('Refinement cancelled');
      return;
    }
    console.error('Refinement error:', error);
    updateTaskState({
      status: 'Error',
      message: error.message || 'Refinement failed',
      progress: 0,
      error: error.message,
      conversationHistory: messages // Keep history so user can retry
    });
  } finally {
    abortController = null;
    stopTimer();
  }
}

async function startSummarization(extraction: ExtractionResult) {
  try {
    abortController = new AbortController();

    // Explicitly reset task for new summarization
    currentTask = {
      status: 'Processing...',
      message: 'Initializing...',
      progress: 5,
      title: extraction.title
    };
    chrome.storage.local.set({ currentTask });
    broadcastUpdate();

    const settings = await getSettings();

    // Determine the effective API Key:
    // 1. Try to get provider-specific key from the new apiKeys map
    // 2. Fallback to the legacy single 'apiKey' if not found
    let effectiveApiKey = settings.apiKeys?.[settings.provider] || settings.apiKey;

    // Special handling for 'custom' provider: might rely on the legacy field if not explicitly mapped,
    // but the UI now syncs custom key to apiKeys['custom'] too.

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing. Please check settings.`);
    }

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL: settings.baseUrl,
    });

    updateTaskState({ status: 'Processing...', message: 'Sending request to AI...', progress: 30 });

    // Format messages for better model understanding (avoid JSON confusion)
    const formattedContent = Array.isArray(extraction.messages)
      ? extraction.messages.map((m: any) => `### ${m.role ? m.role.toUpperCase() : 'CONTENT'}:\n${m.content}`).join('\n\n')
      : String(extraction.messages);

    const initialMessages = [
      { role: 'system', content: settings.systemPrompt },
      {
        role: 'user',
        content: `Please summarize the following content from ${extraction.url}.\n\nTitle: ${extraction.title}\n\nContent:\n${formattedContent}`
      }
    ];

    // Create a timeout promise that rejects after 180 seconds (extended for DeepSeek)
    // Note: For stream, we might want a "time to first byte" timeout instead, but 
    // keeping it simple for now: if the whole process takes > 3 mins, kill it.
    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
        // We can't easily reject the await stream loop from outside, 
        // but aborting the controller will throw an AbortError in the loop.
      }
    }, 180000);

    const stream = await openai.chat.completions.create({
      model: settings.model,
      messages: initialMessages as any,
      stream: true,
      temperature: 0.9, // 提高温度让回复更有创造性和多样化
    }, { signal: abortController.signal });

    const baseMessage = 'Generating summary...';
    // Initial update to show we are connected
    updateTaskState({ status: 'Processing...', message: baseMessage, progress: 50 });
    startTimer(baseMessage);

    let summary = '';
    let lastUpdate = Date.now();
    let hasReceivedContent = false;

    try {
      for await (const chunk of stream) {
        if (!hasReceivedContent) {
          // First byte received! Clear strict timeout and maybe set a longer one?
          // For now, we rely on the 3min global timeout or user cancel.
          hasReceivedContent = true;
        }

        const content = chunk.choices[0]?.delta?.content || '';
        summary += content;

        const now = Date.now();
        if (now - lastUpdate > 500) {
          lastUpdate = now;
          // Update in-memory task state and broadcast
          currentTask = {
            ...currentTask,
            status: 'Processing...',
            message: `${baseMessage} (${Math.floor(summary.length / 100)}k chars)`,
            result: summary, // Live preview
            progress: 50 + Math.min(40, Math.floor(summary.length / 100))
          } as ActiveTask;
          broadcastUpdate();
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    stopTimer();

    updateTaskState({ status: 'Processing...', message: 'Finalizing...', progress: 95 });

    // Improved content extraction logic:
    // 1. Check if the ENTIRE content is wrapped in a markdown code block.
    // We only extract if the code block starts at the beginning and ends at the end.
    // This prevents extracting a small internal code block (e.g. a Java example) and losing the rest of the document.
    const outerCodeBlockRegex = /^```(?:markdown)?\s*([\s\S]*?)\s*```$/i;
    const outerMatch = summary.trim().match(outerCodeBlockRegex);

    if (outerMatch && outerMatch[1]) {
      // Only if the whole thing is a block, we unwrap it.
      summary = outerMatch[1];
    } else {
      // Otherwise, just strip any accidental leading/trailing backticks if they look like wrappers
      // but be careful not to touch internal code blocks.
      // Actually, if it's not a full wrapper, we assume the content is raw markdown.
      // We just do a safety trim.
      summary = summary.trim();
    }

    // 2. Clean Front Matter: Ensure it starts exactly with "---"
    // Find the FIRST occurrence of "---\n" or "---\r\n" which signifies the start of Front Matter
    // We look for:
    // - "---" followed by newline
    // - followed by typical Front Matter keys like "title:", "date:", "layout:" to reduce false positives
    const frontMatterStartRegex = /---\s*\n(?:\s*title:|\s*date:|\s*layout:)/;
    const match = summary.match(frontMatterStartRegex);

    if (match) {
      // If we found a valid Front Matter start, discard everything before it
      summary = summary.slice(match.index);
    } else {
      // Relaxed fallback: just look for the first "---" followed by a newline if the strict check failed
      // This helps if the model output format is slightly off but still has Front Matter
      const simpleMatch = summary.match(/---\s*\n/);
      if (simpleMatch && summary.indexOf('title:', simpleMatch.index!) > simpleMatch.index!) {
        summary = summary.slice(simpleMatch.index);
      }
    }

    // 3. Ensure Title in Body: Check if the body (after Front Matter) starts with an H1 title
    // Find the end of Front Matter
    const frontMatterEndRegex = /^---\s*$/m;
    const frontMatterEndMatch = summary.substring(3).match(frontMatterEndRegex); // Skip first '---'

    if (frontMatterEndMatch) {
      // We found the closing '---'
      let bodyStartIndex = 3 + frontMatterEndMatch.index! + frontMatterEndMatch[0].length;
      let body = summary.substring(bodyStartIndex);

      // Remove stray code block fences immediately after Front Matter
      // This handles cases where LLM wraps output in ```markdown ... ``` and we only stripped the opening
      const strayFenceMatch = body.match(/^\s*```(?:markdown)?\s*\n?/);
      if (strayFenceMatch) {
        const matchLen = strayFenceMatch[0].length;
        summary = summary.substring(0, bodyStartIndex) + summary.substring(bodyStartIndex + matchLen);
        body = summary.substring(bodyStartIndex);
      }

      // Check if body starts with H1 (ignoring whitespace)
      if (!/^\s*#\s+/.test(body)) {
        // Insert title
        const titleToInsert = extraction.title || 'Untitled';
        summary = summary.substring(0, bodyStartIndex) + `\n\n# ${titleToInsert}\n` + body;
      }
    } else {
      // No valid Front Matter structure found (or only opening '---')
      // Check if the whole text starts with H1
      if (!/^\s*#\s+/.test(summary)) {
        const titleToInsert = extraction.title || 'Untitled';
        summary = `# ${titleToInsert}\n\n` + summary;
      }
    }

    // 4. Final Cleanup: Remove trailing code block fences
    summary = summary.trim();
    if (summary.endsWith('```')) {
      summary = summary.substring(0, summary.length - 3).trim();
    }

    // Save to History
    const newItem = {
      id: Date.now().toString(),
      title: extraction.title || 'Untitled Chat',
      date: Date.now(),
      content: summary,
      url: extraction.url
    };

    await addHistoryItem(newItem);

    // 记录生成的摘要文章
    const generatedId = await reportArticlePublish({
      platform: 'memoraid',
      title: extraction.title || 'Untitled Chat',
      status: 'generated',
      summary: summary.substring(0, 200),
      extra: {
        sourceUrl: extraction.url,
        type: 'summarization'
      }
    });

    updateTaskState({
      status: 'Done!',
      message: 'Summary generated successfully!',
      progress: 100,
      result: summary,
      conversationHistory: [
        ...initialMessages as ChatMessage[],
        { role: 'assistant', content: summary }
      ],
      generatedId // 保存生成的 ID
    });

    // Set badge to indicate completion
    chrome.action.setBadgeText({ text: '1' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

    // Send Notification
    const iconUrl = chrome.runtime.getURL('public/icon-128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: 'Chat Export Complete',
      message: `Summary generated for: ${extraction.title || 'Untitled Chat'}`
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification failed:', chrome.runtime.lastError);
      } else {
        console.log('Notification sent:', notificationId);
      }
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Summarization cancelled');
      return; // Do nothing if cancelled
    }

    console.error('Summarization error:', error);
    updateTaskState({
      status: 'Error',
      message: error.message || 'An error occurred',
      progress: 0,
      error: error.message
    });

    // Send Error Notification
    const iconUrl = chrome.runtime.getURL('public/icon-128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: 'Chat Export Failed',
      message: error.message || 'Unknown error occurred'
    });
  } finally {
    stopTimer();
    abortController = null;
  }
}

function broadcastUpdate() {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: currentTask }).catch(() => {
    // Popup might be closed, which is expected
  });
}

async function handlePublishToToutiao(payload: { title: string; content: string; sourceUrl?: string; sourceImages?: string[]; generatedId?: string }) {
  try {
    const settings = await getSettings();
    const cookieStr = settings.toutiao?.cookie;

    if (cookieStr) {
      // Parse and set cookies
      // Cookies string format: key=value; key2=value2
      const cookies = cookieStr.split(';').map(c => c.trim()).filter(c => c);
      for (const cookie of cookies) {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) continue;

        const name = cookie.substring(0, separatorIndex);
        const value = cookie.substring(separatorIndex + 1);

        if (name && value) {
          try {
            await chrome.cookies.set({
              url: 'https://mp.toutiao.com',
              domain: '.toutiao.com',
              name,
              value,
              path: '/',
              secure: true,
              sameSite: 'no_restriction'
            });
          } catch (e) {
            console.error(`Failed to set cookie ${name}`, e);
          }
        }
      }
    }

    // Clean up content before publishing
    let cleanedContent = payload.content;

    // 1. Remove "封面图建议" section (including variations)
    // Pattern: "封面图建议：..." or "### 封面图建议" or "## 封面图建议" followed by content until next heading or double newline
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*封面图建议[：:].*/gm, ''); // Remove heading style
    cleanedContent = cleanedContent.replace(/^\*?\*?封面图建议\*?\*?[：:][^\n]*(\n(?![#\n])[^\n]*)*/gm, ''); // Remove paragraph style with continuation
    cleanedContent = cleanedContent.replace(/^封面图建议[：:][^\n]*\n?/gm, ''); // Simple single line

    // 2. Remove "Cover Image Suggestion" (English version)
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*Cover Image Suggestion[：:].*/gim, '');
    cleanedContent = cleanedContent.replace(/^Cover Image Suggestion[：:][^\n]*\n?/gim, '');

    // 3. Remove "其他备选标题" / "备选标题" section (including all variations)
    // This removes the heading and all following lines until the next heading or double newline
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*其他备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?其他备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^其他备选标题[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^备选标题[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');

    // 4. Remove blockquote style alternative titles (> 开头的备选标题列表)
    cleanedContent = cleanedContent.replace(/^>\s*[\d\.\-\*]*\s*[^>\n]*标题[^\n]*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/^>\s*[\d\.\-\*]+[^\n]+\n?/gm, ''); // Remove numbered list in blockquote after title

    // 3. Clean up multiple consecutive blank lines
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');
    cleanedContent = cleanedContent.trim();

    // 4. Extract the real title from the content (H1 heading)
    let articleTitle = payload.title;
    const h1Match = cleanedContent.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      const extractedTitle = h1Match[1].trim();
      // Only use extracted title if it's meaningful (not generic)
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home', 'Untitled'];
      const isGeneric = genericTitles.some(t => payload.title?.includes(t));
      if (isGeneric || !payload.title || payload.title.length < 3) {
        articleTitle = extractedTitle;
      }
      // If payload.title is meaningful, keep it but ensure it matches the H1
      // Actually, we should prefer the H1 title from the generated article
      if (extractedTitle.length > 3 && extractedTitle.length <= 30) {
        articleTitle = extractedTitle;
      }
    }

    // 5. Remove the H1 title from content (Toutiao has separate title field)
    cleanedContent = cleanedContent.replace(/^#\s+.+\n+/, '');
    cleanedContent = cleanedContent.trim();

    // Convert Markdown to HTML for Toutiao's rich text editor
    const htmlContent = await marked.parse(cleanedContent);

    // Save payload to storage for content script to pick up
    await chrome.storage.local.set({
      pending_toutiao_publish: {
        title: articleTitle,
        content: cleanedContent, // Keep cleaned markdown
        htmlContent: htmlContent, // Add converted HTML
        sourceUrl: payload.sourceUrl,
        sourceImages: Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string' && u.trim()) : undefined,
        timestamp: Date.now(),
        generatedId: payload.generatedId
      }
    });

    const tab = await chrome.tabs.create({
      url: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      active: true
    });

    if (!tab.id) throw new Error('Failed to create tab');

    // The content script (src/content/toutiao.ts) will handle the rest
    console.log('Opened Toutiao publish page, waiting for content script to fill...');

  } catch (error) {
    console.error('Publish failed', error);
  }
}

async function handlePublishToZhihu(payload: { title: string; content: string; sourceUrl?: string; sourceImages?: string[]; generatedId?: string }) {
  try {
    const settings = await getSettings();
    const cookieStr = settings.zhihu?.cookie;

    if (cookieStr) {
      // Parse and set cookies for zhihu.com
      const cookies = cookieStr.split(';').map(c => c.trim()).filter(c => c);
      for (const cookie of cookies) {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) continue;

        const name = cookie.substring(0, separatorIndex);
        const value = cookie.substring(separatorIndex + 1);

        if (name && value) {
          try {
            await chrome.cookies.set({
              url: 'https://zhuanlan.zhihu.com',
              domain: '.zhihu.com',
              name,
              value,
              path: '/',
              secure: true,
              sameSite: 'no_restriction'
            });
          } catch (e) {
            console.error(`Failed to set Zhihu cookie ${name}`, e);
          }
        }
      }
    }

    // Clean up content before publishing
    let cleanedContent = payload.content;

    // Remove metadata sections similar to Toutiao
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*封面图建议[：:].*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?封面图建议\*?\*?[：:][^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^封面图建议[：:][^\n]*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*其他备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?其他备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');

    // Clean up multiple consecutive blank lines
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');
    cleanedContent = cleanedContent.trim();

    // Extract the real title from the content (H1 heading)
    let articleTitle = payload.title;
    const h1Match = cleanedContent.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      const extractedTitle = h1Match[1].trim();
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home', 'Untitled'];
      const isGeneric = genericTitles.some(t => payload.title?.includes(t));
      if (isGeneric || !payload.title || payload.title.length < 3) {
        articleTitle = extractedTitle;
      }
      // 知乎标题限制100字
      if (extractedTitle.length > 3 && extractedTitle.length <= 100) {
        articleTitle = extractedTitle;
      }
    }

    // Remove the H1 title from content (Zhihu has separate title field)
    cleanedContent = cleanedContent.replace(/^#\s+.+\n+/, '');
    cleanedContent = cleanedContent.trim();

    // Convert Markdown to HTML for Zhihu's rich text editor
    const htmlContent = await marked.parse(cleanedContent);

    // Save payload to storage for content script to pick up
    await chrome.storage.local.set({
      pending_zhihu_publish: {
        title: articleTitle,
        content: cleanedContent,
        htmlContent: htmlContent,
        sourceUrl: payload.sourceUrl,
        sourceImages: Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string' && u.trim()) : undefined,
        timestamp: Date.now(),
        generatedId: payload.generatedId
      }
    });

    const tab = await chrome.tabs.create({
      url: 'https://zhuanlan.zhihu.com/write',
      active: true
    });

    if (!tab.id) throw new Error('Failed to create tab');

    // The content script (src/content/zhihu.ts) will handle the rest
    console.log('Opened Zhihu write page, waiting for content script to fill...');

  } catch (error) {
    console.error('Zhihu publish failed', error);
  }
}

async function handlePublishToWeixin(payload: { title: string; content: string; sourceUrl?: string; sourceImages?: string[]; generatedId?: string }) {
  try {
    const settings = await getSettings();
    const cookieStr = settings.weixin?.cookie;

    if (cookieStr) {
      // Parse and set cookies for mp.weixin.qq.com
      const cookies = cookieStr.split(';').map(c => c.trim()).filter(c => c);
      for (const cookie of cookies) {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) continue;

        const name = cookie.substring(0, separatorIndex);
        const value = cookie.substring(separatorIndex + 1);

        if (name && value) {
          try {
            await chrome.cookies.set({
              url: 'https://mp.weixin.qq.com',
              domain: '.qq.com',
              name,
              value,
              path: '/',
              secure: true,
              sameSite: 'no_restriction'
            });
          } catch (e) {
            console.error(`Failed to set Weixin cookie ${name}`, e);
          }
        }
      }
    }

    // Clean up content before publishing
    let cleanedContent = payload.content;

    // Remove metadata sections
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*封面图建议[：:].*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?封面图建议\*?\*?[：:][^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^封面图建议[：:][^\n]*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*其他备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?其他备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');

    // Clean up multiple consecutive blank lines
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');
    cleanedContent = cleanedContent.trim();

    // Extract the real title from the content (H1 heading)
    let articleTitle = payload.title;
    const h1Match = cleanedContent.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      const extractedTitle = h1Match[1].trim();
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home', 'Untitled'];
      const isGeneric = genericTitles.some(t => payload.title?.includes(t));
      if (isGeneric || !payload.title || payload.title.length < 3) {
        articleTitle = extractedTitle;
      }
      // 微信公众号标题限制64字
      if (extractedTitle.length > 3 && extractedTitle.length <= 64) {
        articleTitle = extractedTitle;
      }
    }

    // Remove the H1 title from content (Weixin has separate title field)
    cleanedContent = cleanedContent.replace(/^#\s+.+\n+/, '');
    cleanedContent = cleanedContent.trim();

    // Convert Markdown to HTML for Weixin's rich text editor
    const htmlContent = await marked.parse(cleanedContent);

    // Save payload to storage for content script to pick up
    await chrome.storage.local.set({
      pending_weixin_publish: {
        title: articleTitle,
        content: cleanedContent,
        htmlContent: htmlContent,
        sourceUrl: payload.sourceUrl,
        sourceImages: Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string' && u.trim()) : undefined,
        timestamp: Date.now(),
        generatedId: payload.generatedId
      }
    });

    // 打开或激活微信公众号页面
    const mpUrl = 'https://mp.weixin.qq.com/';

    // 优先查找编辑器页面
    const editorTabs = await chrome.tabs.query({ url: '*://mp.weixin.qq.com/*appmsg_edit*' });
    // 其次查找所有微信页面
    const allTabs = await chrome.tabs.query({ url: '*://mp.weixin.qq.com/*' });

    let tab: chrome.tabs.Tab;

    if (editorTabs.length > 0) {
      // 找到编辑器页面，复用它
      tab = editorTabs[0];
      await chrome.tabs.update(tab.id!, { active: true });
      // 重新加载页面以触发 content script
      await chrome.tabs.reload(tab.id!);
    } else if (allTabs.length > 0) {
      // 如果已有其他微信页面（如首页），复用第一个
      tab = allTabs[0];
      await chrome.tabs.update(tab.id!, { active: true });
      await chrome.tabs.reload(tab.id!);
    } else {
      // 否则创建新标签页
      tab = await chrome.tabs.create({
        url: mpUrl,
        active: true
      });
    }

    if (!tab.id) throw new Error('Failed to create or find tab');

    // The content script (src/content/weixin.ts) will handle the rest
    console.log('Opened Weixin publish page, waiting for content script to fill...');

  } catch (error) {
    console.error('Weixin publish failed', error);
  }
}

async function handlePublishToXiaohongshu(payload: { title: string, content: string, sourceUrl?: string, sourceImages?: string[], generatedId?: string }) {
  try {
    console.log('Handling publish to Xiaohongshu:', payload.title);

    // 1. 设置 Cookie (如果需要)
    const settings = await getSettings();
    if (settings.xiaohongshu?.cookie) {
      const cookieStr = settings.xiaohongshu.cookie;
      const cookies = cookieStr.split(';').map(c => c.trim()).filter(Boolean);

      for (const cookie of cookies) {
        const [name, value] = cookie.split('=');
        if (name && value) {
          try {
            await chrome.cookies.set({
              url: 'https://creator.xiaohongshu.com',
              domain: '.xiaohongshu.com',
              name,
              value,
              path: '/',
              secure: true,
              sameSite: 'no_restriction'
            });
          } catch (e) {
            console.error(`Failed to set Xiaohongshu cookie ${name}`, e);
          }
        }
      }
    }

    // 2. 清理文章内容
    let cleanedContent = payload.content;

    // 移除可能存在的元数据和标题建议
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*封面图建议[：:].*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?封面图建议\*?\*?[：:][^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^封面图建议[：:][^\n]*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*其他备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^#{1,3}\s*备选标题[：:]?.*(\n(?!#)[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?其他备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.replace(/^\*?\*?备选标题\*?\*?[：:]?[^\n]*(\n(?![#\n])[^\n]*)*/gm, '');
    cleanedContent = cleanedContent.trim();

    // 提取标题 (虽然小红书标题在 prompt 中已经要求不要单独一行，但为了保险起见处理一下)
    let articleTitle = payload.title;

    // 如果内容第一行是 H1 标题，尝试使用它作为标题并从正文中移除
    const h1Match = cleanedContent.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      const extractedTitle = h1Match[1].trim();
      // 如果原来的标题比较通用，使用提取的标题
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home', 'Untitled'];
      const isGeneric = genericTitles.some(t => payload.title?.includes(t));
      if (isGeneric || !payload.title || payload.title.length < 3) {
        articleTitle = extractedTitle;
      }
    }

    // 从正文中移除 H1 标题，因为小红书有专门的标题输入框
    cleanedContent = cleanedContent.replace(/^#\s+.+\n+/, '');

    // 3. 将数据保存到 Storage，供 Content Script 读取
    // 注意：pending_xiaohongshu_publish
    const publishData = {
      title: articleTitle,
      content: cleanedContent,
      sourceUrl: payload.sourceUrl,
      sourceImages: Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string' && u.trim()) : undefined,
      timestamp: Date.now(),
      generatedId: payload.generatedId
    };

    await chrome.storage.local.set({
      pending_xiaohongshu_publish: publishData
    });

    console.log('[Background] Xiaohongshu publish data saved:', publishData);

    // 4. 打开或激活小红书发布页面
    // 添加 from=tab_switch 参数确保页面显示"新的创作"按钮
    const publishUrl = 'https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=article';

    // 查找已有的小红书页面
    const existingTabs = await chrome.tabs.query({ url: '*://creator.xiaohongshu.com/*' });
    let tab: chrome.tabs.Tab;

    if (existingTabs.length > 0) {
      // 如果有发布页面，优先使用
      const publishTab = existingTabs.find(t => t.url && t.url.includes('/publish/publish'));
      if (publishTab) {
        tab = publishTab;
      } else {
        tab = existingTabs[0];
      }

      await chrome.tabs.update(tab.id!, { active: true, url: publishUrl });
      // 给一点时间让 url 更新，然后刷新触发 content script
      setTimeout(() => {
        chrome.tabs.reload(tab.id!);
      }, 500);
    } else {
      // 创建新标签页
      tab = await chrome.tabs.create({
        url: publishUrl,
        active: true
      });
    }

    console.log('Opened Xiaohongshu publish page, waiting for content script...');

  } catch (error) {
    console.error('Xiaohongshu publish failed', error);
  }
}

async function startArticleGeneration(extraction: ExtractionResult) {
  try {
    abortController = new AbortController();

    // Explicitly reset task for new generation
    currentTask = {
      status: 'Processing...',
      message: 'Initializing Article Generation...',
      progress: 5,
      title: extraction.title,
      sourceUrl: extraction.url,
      sourceImages: extraction.images
    };
    chrome.storage.local.set({ currentTask });
    broadcastUpdate();

    const settings = await getSettings();

    let effectiveApiKey = settings.apiKeys?.[settings.provider] || settings.apiKey;

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing. Please check settings.`);
    }

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL: settings.baseUrl,
    });

    updateTaskState({ status: 'Processing...', message: 'Sending request to AI...', progress: 30 });

    const formattedContent = Array.isArray(extraction.messages)
      ? extraction.messages.map((m: any) => `### ${m.role ? m.role.toUpperCase() : 'CONTENT'}:\n${m.content}`).join('\n\n')
      : String(extraction.messages);

    // 根据用户设置的文章风格生成动态提示词
    const articlePrompt = generateArticlePrompt(settings.articleStyle);

    const initialMessages = [
      { role: 'system', content: articlePrompt },
      {
        role: 'user',
        content: `请根据以下内容生成一篇自媒体文章。\n\n来源：${extraction.url}\n\n原标题：${extraction.title}\n\n内容：\n${formattedContent}`
      }
    ];

    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
    }, 180000);

    const stream = await openai.chat.completions.create({
      model: settings.model,
      messages: initialMessages as any,
      stream: true,
      temperature: 0.9, // 提高温度让回复更有创造性和多样化
    }, { signal: abortController.signal });

    const baseMessage = 'Generating article...';
    updateTaskState({ status: 'Processing...', message: baseMessage, progress: 50 });
    startTimer(baseMessage);

    let summary = '';
    let lastUpdate = Date.now();
    let hasReceivedContent = false;

    try {
      for await (const chunk of stream) {
        if (!hasReceivedContent) {
          hasReceivedContent = true;
        }

        const content = chunk.choices[0]?.delta?.content || '';
        summary += content;

        const now = Date.now();
        if (now - lastUpdate > 500) {
          lastUpdate = now;
          currentTask = {
            ...currentTask,
            status: 'Processing...',
            message: `${baseMessage} (${Math.floor(summary.length / 100)}k chars)`,
            result: summary,
            progress: 50 + Math.min(40, Math.floor(summary.length / 100))
          } as ActiveTask;
          broadcastUpdate();
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    stopTimer();

    updateTaskState({ status: 'Processing...', message: 'Finalizing...', progress: 95 });

    // Cleanup logic (similar to summarization)
    const outerCodeBlockRegex = /^```(?:markdown)?\s*([\s\S]*?)\s*```$/i;
    const outerMatch = summary.trim().match(outerCodeBlockRegex);

    if (outerMatch && outerMatch[1]) {
      summary = outerMatch[1];
    } else {
      summary = summary.trim();
    }

    // Basic Title Check (Article prompt asks for H1)
    const hasH1 = /^\s*#\s+/.test(summary);

    if (!hasH1) {
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home'];
      const isGeneric = genericTitles.some(t => extraction.title?.includes(t));

      if (!isGeneric && extraction.title) {
        summary = `# ${extraction.title}\n\n` + summary;
      } else {
        // Try to promote first line as title if it looks like one
        const lines = summary.split('\n');
        const firstLine = lines[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length < 100) {
          // Remove existing bolding/formatting if any
          const cleanTitle = firstLine.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '');
          summary = `# ${cleanTitle}\n\n` + lines.slice(1).join('\n');
        }
      }
    }

    // Cleanup trailing fences
    summary = summary.trim();
    if (summary.endsWith('```')) {
      summary = summary.substring(0, summary.length - 3).trim();
    }

    // 从生成的文章中提取真正的标题（H1）
    // 这样面板中显示的文件名就会和文章标题一致
    let finalTitle = extraction.title || 'Untitled Article';
    const h1TitleMatch = summary.match(/^#\s+(.+)$/m);
    if (h1TitleMatch && h1TitleMatch[1]) {
      const extractedTitle = h1TitleMatch[1].trim();
      // 如果提取的标题有意义（长度合适），就使用它
      if (extractedTitle.length >= 3 && extractedTitle.length <= 50) {
        finalTitle = extractedTitle;
      }
    }

    const newItem = {
      id: Date.now().toString(),
      title: finalTitle, // 使用从文章中提取的标题
      date: Date.now(),
      content: summary,
      url: extraction.url
    };

    await addHistoryItem(newItem);

    // 记录生成的文章
    const generatedId = await reportArticlePublish({
      platform: 'memoraid',
      title: finalTitle,
      status: 'generated',
      summary: summary.substring(0, 200),
      extra: {
        sourceUrl: extraction.url,
        type: 'article_generation'
      }
    });

    updateTaskState({
      status: 'Done!',
      message: 'Article generated successfully!',
      progress: 100,
      result: summary,
      title: finalTitle, // 同步更新任务状态中的标题
      sourceUrl: extraction.url,
      sourceImages: extraction.images,
      conversationHistory: [
        ...initialMessages as ChatMessage[],
        { role: 'assistant', content: summary }
      ],
      generatedId // 保存生成的 ID
    });

    chrome.action.setBadgeText({ text: '1' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

    const iconUrl = chrome.runtime.getURL('public/icon-128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: 'Article Generation Complete',
      message: `Article generated for: ${finalTitle}`
    });

    // 注意：已移除自动发布功能
    // 用户可以在结果页面手动选择发布到头条或知乎

    return summary; // 返回生成的文章内容，供其他函数使用

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Article generation cancelled');
      return null;
    }

    console.error('Article generation error:', error);
    updateTaskState({
      status: 'Error',
      message: error.message || 'An error occurred',
      progress: 0,
      error: error.message
    });

    const iconUrl = chrome.runtime.getURL('public/icon-128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: 'Article Generation Failed',
      message: error.message || 'Unknown error occurred'
    });
    return null;
  } finally {
    stopTimer();
    abortController = null;
  }
}

// 一键生成文章并发布到指定平台
async function startArticleGenerationAndPublish(extraction: ExtractionResult, platform: 'toutiao' | 'zhihu' | 'weixin' | 'xiaohongshu') {
  try {
    abortController = new AbortController();

    const platformName = platform === 'toutiao' ? '头条' : platform === 'zhihu' ? '知乎' : '公众号';

    // 初始化任务状态
    currentTask = {
      status: 'Processing...',
      message: `正在生成文章并准备发布到${platformName}...`,
      progress: 5,
      title: extraction.title,
      sourceUrl: extraction.url,
      sourceImages: extraction.images
    };
    chrome.storage.local.set({ currentTask });
    broadcastUpdate();

    const settings = await getSettings();

    let effectiveApiKey = settings.apiKeys?.[settings.provider] || settings.apiKey;

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing. Please check settings.`);
    }

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL: settings.baseUrl,
    });

    updateTaskState({ status: 'Processing...', message: '正在发送请求到 AI...', progress: 20 });

    const formattedContent = Array.isArray(extraction.messages)
      ? extraction.messages.map((m: any) => `### ${m.role ? m.role.toUpperCase() : 'CONTENT'}:\n${m.content}`).join('\n\n')
      : String(extraction.messages);

    // 根据用户设置的文章风格生成动态提示词（通用模板）
    const articlePrompt = generateArticlePrompt(settings.articleStyle);

    // 根据目标平台获取专属提示词
    // 通用提示词 + 平台专属提示词 = 完整提示词
    let platformPrompt = '';
    if (platform === 'toutiao') {
      // 头条：使用用户自定义提示词或默认头条提示词
      platformPrompt = settings.toutiao?.customPrompt || TOUTIAO_DEFAULT_PROMPT;
    } else if (platform === 'zhihu') {
      // 知乎：使用用户自定义提示词或默认知乎提示词
      platformPrompt = settings.zhihu?.customPrompt || ZHIHU_DEFAULT_PROMPT;
    } else if (platform === 'weixin') {
      // 公众号：使用用户自定义提示词或默认公众号提示词
      platformPrompt = settings.weixin?.customPrompt || WEIXIN_DEFAULT_PROMPT;
    } else if (platform === 'xiaohongshu') {
      // 小红书：使用用户自定义提示词或默认小红书提示词
      platformPrompt = settings.xiaohongshu?.customPrompt || XIAOHONGSHU_DEFAULT_PROMPT;
    }

    // ========== 组合完整提示词 ==========
    // 添加明确的分隔标记，让 AI 能清楚识别两部分提示词
    const fullPrompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 【第一部分：通用文章生成规则】
以下是所有平台共享的基础写作规则。
如果与后续的平台专属规则有冲突，请优先遵循平台专属规则。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${articlePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 【第二部分：${platformName}平台专属规则】
以下是${platformName}平台的专属规则，优先级最高！
当与上述通用规则冲突时，必须严格遵循本部分的规则。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${platformPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 【优先级提醒】
如果通用规则和${platformName}专属规则有任何冲突，请无条件遵循${platformName}专属规则！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    // 根据平台添加特殊提醒
    let platformReminder = '';
    if (platform === 'toutiao' || platform === 'zhihu') {
      platformReminder = `\n\n⚠️ 重要提醒：${platformName}平台的图片提示词必须是2-5个字的简短关键词（如\"卫星\"、\"星空\"），严禁使用长句子描述！`;
    } else if (platform === 'weixin') {
      // 只有公众号需要封面和摘要
      platformReminder = `\n\n⚠️ 重要提醒：${platformName}平台的图片提示词需要15-50字的详细场景描述，用于AI生成配图。文章最后必须包含[封面: xxx]和[摘要: xxx]。`;
    } else if (platform === 'xiaohongshu') {
      // 小红书不需要封面和摘要，但需要Emoji和话题
      platformReminder = `\n\n⚠️ 重要提醒（CRITICAL）：小红书平台必须使用【纯文本格式】！严禁使用Markdown标题、加粗或HTML标签。必须大量使用Emoji，分段要短，结尾必须包含至少5个话题标签。`;
    }

    const initialMessages = [
      { role: 'system', content: fullPrompt },
      {
        role: 'user',
        content: `请根据以下内容生成一篇自媒体文章，目标平台是${platformName}。${platformReminder}\n\n来源：${extraction.url}\n\n原标题：${extraction.title}\n\n内容：\n${formattedContent}`
      }
    ];

    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
    }, 180000);

    const stream = await openai.chat.completions.create({
      model: settings.model,
      messages: initialMessages as any,
      stream: true,
      temperature: 0.9, // 提高温度让回复更有创造性和多样化
    }, { signal: abortController.signal });

    const baseMessage = '正在生成文章...';
    updateTaskState({ status: 'Processing...', message: baseMessage, progress: 30 });
    startTimer(baseMessage);

    let summary = '';
    let lastUpdate = Date.now();

    try {
      for await (const chunk of stream) {
        // 检查是否已取消
        if (!abortController || abortController.signal.aborted) {
          break;
        }

        const content = chunk.choices[0]?.delta?.content || '';
        summary += content;

        const now = Date.now();
        if (now - lastUpdate > 500) {
          lastUpdate = now;
          currentTask = {
            ...currentTask,
            status: 'Processing...',
            message: `${baseMessage} (${Math.floor(summary.length / 100)}k 字符)`,
            result: summary,
            progress: 30 + Math.min(50, Math.floor(summary.length / 80))
          } as ActiveTask;
          broadcastUpdate();
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // 如果已取消，直接返回不继续处理
    if (!abortController || abortController.signal.aborted) {
      stopTimer();
      currentTask = null;
      chrome.storage.local.remove('currentTask');
      broadcastUpdate();
      return;
    }

    stopTimer();

    updateTaskState({ status: 'Processing...', message: '正在处理文章...', progress: 85 });

    // 清理文章内容
    const outerCodeBlockRegex = /^```(?:markdown)?\s*([\s\S]*?)\s*```$/i;
    const outerMatch = summary.trim().match(outerCodeBlockRegex);

    if (outerMatch && outerMatch[1]) {
      summary = outerMatch[1];
    } else {
      summary = summary.trim();
    }

    // 确保有标题
    const hasH1 = /^\s*#\s+/.test(summary);

    if (!hasH1) {
      const genericTitles = ['微博搜索', 'Weibo Search', '搜索', 'Search', '主页', 'Home'];
      const isGeneric = genericTitles.some(t => extraction.title?.includes(t));

      if (!isGeneric && extraction.title) {
        summary = `# ${extraction.title}\n\n` + summary;
      } else {
        const lines = summary.split('\n');
        const firstLine = lines[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length < 100) {
          const cleanTitle = firstLine.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '');
          summary = `# ${cleanTitle}\n\n` + lines.slice(1).join('\n');
        }
      }
    }

    summary = summary.trim();
    if (summary.endsWith('```')) {
      summary = summary.substring(0, summary.length - 3).trim();
    }

    // 提取标题
    let finalTitle = extraction.title || 'Untitled Article';
    const h1TitleMatch = summary.match(/^#\s+(.+)$/m);
    if (h1TitleMatch && h1TitleMatch[1]) {
      const extractedTitle = h1TitleMatch[1].trim();
      if (extractedTitle.length >= 3 && extractedTitle.length <= 50) {
        finalTitle = extractedTitle;
      }
    }

    // 保存到历史记录
    const newItem = {
      id: Date.now().toString(),
      title: finalTitle,
      date: Date.now(),
      content: summary,
      url: extraction.url
    };

    await addHistoryItem(newItem);

    // 记录生成的文章（无论发布是否成功）
    const generatedId = await reportArticlePublish({
      platform: platform,
      title: finalTitle,
      status: 'generated',
      summary: summary.substring(0, 200),
      extra: {
        sourceUrl: extraction.url,
        type: 'publish_generation'
      }
    });

    updateTaskState({
      status: 'Publishing...',
      message: `文章生成完成，正在跳转到${platformName}发布页面...`,
      progress: 95,
      result: summary,
      title: finalTitle,
      generatedId // 保存生成的 ID
    });

    // 根据平台发布
    if (platform === 'toutiao') {
      await handlePublishToToutiao({
        title: finalTitle,
        content: summary,
        sourceUrl: extraction.url,
        sourceImages: extraction.images,
        generatedId // 传递 generatedId
      });
    } else if (platform === 'zhihu') {
      await handlePublishToZhihu({
        title: finalTitle,
        content: summary,
        sourceUrl: extraction.url,
        sourceImages: extraction.images,
        generatedId // 传递 generatedId
      });
    } else if (platform === 'weixin') {
      await handlePublishToWeixin({
        title: finalTitle,
        content: summary,
        sourceUrl: extraction.url,
        sourceImages: extraction.images,
        generatedId // 传递 generatedId
      });
    } else if (platform === 'xiaohongshu') {
      await handlePublishToXiaohongshu({
        title: finalTitle,
        content: summary,
        sourceUrl: extraction.url,
        sourceImages: extraction.images,
        generatedId // 传递 generatedId
      });
    }

    // 清除任务状态（因为已经跳转到发布页面）
    currentTask = null;
    chrome.storage.local.remove('currentTask');
    broadcastUpdate();

  } catch (error: any) {
    stopTimer();

    if (error.name === 'AbortError') {
      console.log('Article generation cancelled');
      // 取消时清理任务状态，不跳转到发布页面
      currentTask = null;
      chrome.storage.local.remove('currentTask');
      broadcastUpdate();
      return;
    }

    console.error('Article generation and publish error:', error);
    updateTaskState({
      status: 'Error',
      message: error.message || '发生错误',
      progress: 0,
      error: error.message
    });

    const iconUrl = chrome.runtime.getURL('public/icon-128.png');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: '文章生成失败',
      message: error.message || '未知错误'
    });
  } finally {
    abortController = null;
  }
}

async function handleLogin(provider: 'google' | 'github') {
  const settings = await getSettings();
  const backendUrl = settings.sync?.backendUrl || DEFAULT_SETTINGS.sync!.backendUrl;
  const redirectUri = chrome.identity.getRedirectURL();

  console.log('=== Login Debug Info ===');
  console.log('Provider:', provider);
  console.log('Backend URL:', backendUrl);
  console.log('Redirect URI:', redirectUri);

  // 首先从后端获取 OAuth 配置
  let authConfig: { clientId: string; authUrl: string } | null = null;

  try {
    console.log('Fetching OAuth config from backend...');
    const configResponse = await fetch(`${backendUrl}/auth/config/${provider}`);
    if (configResponse.ok) {
      authConfig = await configResponse.json();
      console.log('OAuth config received:', authConfig);
    }
  } catch (e) {
    console.log('Failed to fetch OAuth config, will use backend redirect');
  }

  let authUrl: string;

  if (authConfig && authConfig.clientId) {
    // 直接构建 OAuth URL，跳过后端重定向
    if (provider === 'google') {
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${authConfig.clientId}` +
        `&redirect_uri=${encodeURIComponent(backendUrl + '/auth/callback/google')}` +
        `&response_type=code` +
        `&scope=email%20profile` +
        `&prompt=select_account` +
        `&state=${encodeURIComponent(redirectUri)}`;
    } else {
      authUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${authConfig.clientId}` +
        `&redirect_uri=${encodeURIComponent(backendUrl + '/auth/callback/github')}` +
        `&scope=user:email` +
        `&state=${encodeURIComponent(redirectUri)}`;
    }
  } else {
    // 回退到后端重定向方式
    authUrl = `${backendUrl}/auth/login/${provider}?redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  console.log('Auth URL:', authUrl);
  console.log('========================');

  return new Promise<void>((resolve, reject) => {
    console.log('Launching WebAuthFlow...');

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, async (redirectUrl) => {
      console.log('WebAuthFlow callback received');
      console.log('Redirect URL:', redirectUrl);
      console.log('Last Error:', chrome.runtime.lastError);

      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        console.error('Auth Flow Error:', errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      if (!redirectUrl) {
        console.error('No redirect URL received');
        reject(new Error('登录已取消或失败'));
        return;
      }

      try {
        console.log('Parsing redirect URL...');
        const url = new URL(redirectUrl);
        const token = url.searchParams.get('token');
        const email = url.searchParams.get('email');
        const error = url.searchParams.get('error');

        console.log('Token received:', !!token);
        console.log('Email received:', email);
        console.log('Error param:', error);

        if (error) {
          reject(new Error(`OAuth 错误: ${error}`));
          return;
        }

        if (token && email) {
          const currentSettings = await getSettings();
          const newSettings = {
            ...currentSettings,
            sync: {
              ...currentSettings.sync!,
              enabled: true,
              token: token,
              email: email,
              encryptionKey: currentSettings.sync?.encryptionKey || generateRandomString()
            }
          };
          await saveSettings(newSettings);
          console.log('Login successful, settings saved');
          resolve();
        } else {
          reject(new Error('未收到认证令牌'));
        }
      } catch (e: any) {
        console.error('Error parsing redirect URL:', e);
        reject(new Error('解析回调失败: ' + (e.message || String(e))));
      }
    });
  });
}
