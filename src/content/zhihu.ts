import { reportError } from '../utils/debug';
import { DOMHelper } from '../utils/domHelper';
import { ImageHandler } from '../utils/imageHandler';

// Zhihu Publish Content Script - 基于 Playwright 录制
// 知乎专栏发布页面自动化

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string;
  sourceUrl?: string;
  sourceImages?: string[];
  timestamp: number;
  generatedId?: string;
  // Token 消耗数据
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  autoPublish?: boolean; // 是否自动发布（定时任务会强制设置为 true）
}

// ============================================
// 知乎页面元素选择器配置 - 基于 Playwright 录制
// ============================================
const SELECTORS = {
  // 标题输入框 - Playwright: getByPlaceholder('请输入标题（最多 100 个字）')
  titleInput: [
    'textarea[placeholder*="请输入标题"]',
    'textarea[placeholder*="100 个字"]',
    'input[placeholder*="请输入标题"]',
    '.WriteIndex-titleInput textarea',
    '.PostEditor-titleInput textarea'
  ],
  
  // 编辑器正文 - Playwright: div:has-text("请输入正文")
  editor: [
    '.public-DraftEditor-content',
    '[contenteditable="true"]',
    '.DraftEditor-root [contenteditable="true"]',
    '.PostEditor-content [contenteditable="true"]'
  ],
  
  // 图片按钮 - Playwright: getByRole('button', { name: '图片' })
  imageButton: [
    'button[aria-label="图片"]',
    'button:contains("图片")',
    '.Editable-toolbarButton--image',
    '[data-tooltip="图片"]'
  ],
  
  // 公共图片库按钮 - Playwright: getByRole('button', { name: '公共图片库' })
  publicLibraryButton: [
    'button:contains("公共图片库")',
    '.ImageUploader-publicButton'
  ],
  
  // 图片搜索框 - Playwright: getByRole('textbox', { name: '输入关键字查找图片' })
  imageSearchInput: [
    'input[placeholder*="输入关键字"]',
    'input[placeholder*="查找图片"]',
    '.ImageSearch-input input'
  ],
  
  // 图片列表项
  imageItem: [
    '.css-128iodx',
    '.ImageSearch-item',
    '.Image-item',
    '[class*="ImageSearch"] img'
  ],
  
  // 插入图片按钮 - Playwright: getByRole('button', { name: '插入图片' })
  insertImageButton: [
    'button:contains("插入图片")',
    '.ImageUploader-insertButton'
  ],
  
  // 添加话题按钮 - Playwright: getByRole('button', { name: '添加话题' })
  addTopicButton: [
    'button:contains("添加话题")',
    '.TopicSelector-addButton'
  ],
  
  // 话题搜索框 - Playwright: getByRole('textbox', { name: '搜索话题' })
  topicSearchInput: [
    'input[placeholder*="搜索话题"]',
    '.TopicSelector-searchInput input'
  ],
  
  // 发布按钮 - Playwright: getByRole('button', { name: '发布' })
  publishButton: [
    'button:contains("发布")',
    '.PublishPanel-button',
    '.PostEditor-publishButton'
  ]
};

// ============================================
// DOM 工具函数 - 使用统一工具类
// ============================================

const findElement = (selectors: string[]): HTMLElement | null => DOMHelper.findElement(selectors);
const isElementVisible = (el: HTMLElement): boolean => DOMHelper.isElementVisible(el);
const simulateClick = (element: HTMLElement) => DOMHelper.simulateClick(element);
const simulateInput = (element: HTMLElement, value: string) => DOMHelper.simulateInput(element, value);

// 使用 ImageHandler 工具类
const isMediaAiEnabled = async (): Promise<boolean> => ImageHandler.isMediaAiEnabled();
const createThumbnailDataUrl = async (dataUrl: string, maxDim = 512): Promise<string | null> => 
  ImageHandler.createThumbnailDataUrl(dataUrl, maxDim);
const getImageMetaFromDataUrl = async (dataUrl: string): Promise<{ width: number; height: number; aspect: number } | null> => 
  ImageHandler.getImageMetaFromDataUrl(dataUrl);
const dataUrlToBlob = (dataUrl: string): { blob: Blob; mimeType: string } => ImageHandler.dataUrlToBlob(dataUrl);
const getFileExtensionByMime = (mimeType: string): string => ImageHandler.getFileExtensionByMime(mimeType);
const setInputFiles = (input: HTMLInputElement, files: File[]) => ImageHandler.setInputFiles(input, files);

// 知乎特有的 AI 选图逻辑
const pickBestImageIndexWithAI = async (keyword: string, maxCandidates = 10): Promise<number | null> => {
  const enabled = await isMediaAiEnabled();
  if (!enabled) return null;

  const containers = Array.from(document.querySelectorAll('.css-128iodx')) as HTMLElement[];
  const candidates: Array<{ index: number; url: string; element: HTMLElement }> = [];
  for (let i = 0; i < containers.length && candidates.length < maxCandidates; i++) {
    const el = containers[i];
    if (!isElementVisible(el)) continue;
    const img = el.querySelector('img') as HTMLImageElement | null;
    const url = (img?.currentSrc || img?.src || '').trim();
    if (!url || url.startsWith('data:')) continue;
    candidates.push({ index: i, url, element: el });
  }
  if (candidates.length <= 1) return null;

  const titleEl = findElement(SELECTORS.titleInput);
  const title = titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
    ? (titleEl.value || '').trim()
    : (titleEl?.innerText || '').trim();

  const editorEl = findElement(SELECTORS.editor);
  const contentSnippet = (editorEl?.innerText || '').trim().slice(0, 800);

  const images: Array<{ url: string; thumbDataUrl: string; width?: number; height?: number; aspect?: number }> = [];
  for (const c of candidates) {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_DATA_URL', payload: { url: c.url, referrer: window.location.href } });
    const dataUrl = resp?.success ? (resp.dataUrl as string | undefined) : undefined;
    if (!dataUrl) continue;
    const meta = await getImageMetaFromDataUrl(dataUrl);
    const thumb = await createThumbnailDataUrl(dataUrl, 512);
    if (!thumb) continue;
    images.push({ url: c.url, thumbDataUrl: thumb, width: meta?.width, height: meta?.height, aspect: meta?.aspect });
  }
  if (images.length <= 1) return null;

  const aiResp = await chrome.runtime.sendMessage({
    type: 'AI_RANK_IMAGES',
    payload: {
      title,
      context: [`关键词：${keyword}`, contentSnippet ? `正文片段：${contentSnippet}` : ''].filter(Boolean).join('\n'),
      images,
      maxPick: Math.min(10, images.length)
    }
  });
  const skippedCode = aiResp?.success ? (aiResp.result?.skipped?.code as string | undefined) : undefined;
  if (skippedCode) {
    if (skippedCode === 'missing_apiyi_key') {
      logger.log('AI 图文增强已开启，但未配置 apiyi API Key，本次不会调用 apiyi 选图', 'warn');
    } else if (skippedCode === 'media_ai_disabled') {
      logger.log('AI 图文增强未开启，本次不会调用 apiyi 选图', 'warn');
    } else {
      logger.log(`AI 选图已跳过：${skippedCode}`, 'warn');
    }
    return null;
  }
  const errorMsg = aiResp?.success ? (aiResp.result?.error as string | undefined) : undefined;
  if (errorMsg) {
    logger.log(`AI 选图调用失败，本次不会调用 apiyi 选图：${String(errorMsg).slice(0, 160)}`, 'warn');
    return null;
  }
  const ordered = aiResp?.success ? (aiResp.result?.orderedUrls as string[] | undefined) : undefined;
  const reason = aiResp?.success ? (aiResp.result?.picked?.[0]?.reason as string | undefined) : undefined;
  const bestUrl = ordered?.[0];
  if (!bestUrl) return null;
  logger.log(`AI 选图：${bestUrl}${reason ? `（理由：${reason.slice(0, 120)}）` : ''}`, 'info');
  const hit = candidates.find(c => c.url === bestUrl);
  return hit ? hit.index : null;
};

const clickLocalUpload = async (): Promise<boolean> => {
  const uploadTexts = ['本地上传', '上传图片', '本地图片', '上传', '本地'];
  const elements = document.querySelectorAll('div, span, a, li, button');
  for (const el of elements) {
    const text = (el as HTMLElement).innerText?.trim();
    if (!text) continue;
    if (uploadTexts.includes(text) && isElementVisible(el as HTMLElement)) {
      simulateClick(el as HTMLElement);
      await new Promise(r => setTimeout(r, 400));
      return true;
    }
  }
  return false;
};

const waitForImageFileInput = async (timeout = 8000): Promise<HTMLInputElement | null> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    const candidate = inputs.find(input => {
      if (input.disabled) return false;
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      if (accept && !accept.includes('image')) return false;
      return true;
    });
    if (candidate) return candidate;
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
};

const uploadAndInsertSourceImage = async (imageUrl: string): Promise<boolean> => {
  const resp = await chrome.runtime.sendMessage({
    type: 'FETCH_IMAGE_DATA_URL',
    payload: { url: imageUrl, referrer: pendingSourceUrl || window.location.href }
  });
  const dataUrl = resp?.success ? (resp.dataUrl as string | undefined) : undefined;
  if (!dataUrl) return false;

  const { blob, mimeType } = dataUrlToBlob(dataUrl);
  const ext = getFileExtensionByMime(mimeType);
  const file = new File([blob], `memoraid-${Date.now()}.${ext}`, { type: mimeType });

  await clickLocalUpload();
  const input = await waitForImageFileInput(8000);
  if (!input) return false;
  setInputFiles(input, [file]);

  await new Promise(r => setTimeout(r, 1800));
  const inserted = await clickInsertImage().catch(() => false);
  await new Promise(r => setTimeout(r, 1200));
  return inserted;
};

// ============================================
// Logger UI - 与头条保持一致
// ============================================
class ZhihuLogger {
  private container: HTMLDivElement;
  private logContent: HTMLDivElement;
  private stopBtn: HTMLButtonElement;
  private onStop?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'memoraid-zhihu-logger';
    this.container.style.cssText = 'position:fixed;top:20px;left:20px;width:380px;max-height:500px;background:rgba(0,0,0,0.9);color:#0af;font-family:Consolas,Monaco,monospace;font-size:12px;border-radius:8px;padding:12px;z-index:20000;display:none;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.6);border:1px solid #0af;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;';
    
    const title = document.createElement('span');
    title.innerHTML = '📘 <span style="color:#fff;font-weight:bold;">Memoraid</span> 知乎助手';
    
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:6px;';

    this.stopBtn = document.createElement('button');
    this.stopBtn.innerText = '停止';
    this.stopBtn.style.cssText = 'background:#d32f2f;color:white;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;display:none;';
    this.stopBtn.onclick = () => {
      if (this.onStop) this.onStop();
      this.log('🛑 已停止', 'error');
      this.stopBtn.style.display = 'none';
    };

    const copyBtn = document.createElement('button');
    copyBtn.innerText = '复制';
    copyBtn.style.cssText = 'background:#1976d2;color:white;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.logContent.innerText);
      copyBtn.innerText = '已复制';
      setTimeout(() => { copyBtn.innerText = '复制'; }, 1500);
    };

    const closeBtn = document.createElement('span');
    closeBtn.innerText = '✕';
    closeBtn.style.cssText = 'cursor:pointer;color:#888;font-size:16px;margin-left:8px;';
    closeBtn.onclick = () => {
      if (this.onStop) this.onStop();
      this.container.style.display = 'none';
    };

    controls.appendChild(this.stopBtn);
    controls.appendChild(copyBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

    this.logContent = document.createElement('div');
    this.logContent.style.cssText = 'overflow-y:auto;flex:1;min-height:100px;max-height:400px;';

    this.container.appendChild(header);
    this.container.appendChild(this.logContent);
    document.body.appendChild(this.container);
  }

  show() { this.container.style.display = 'flex'; }
  hide() { this.container.style.display = 'none'; }
  setStopCallback(cb: () => void) { this.onStop = cb; this.stopBtn.style.display = 'block'; }
  hideStopButton() { this.stopBtn.style.display = 'none'; }
  clear() { this.logContent.innerHTML = ''; }

  log(message: string, type: 'info' | 'action' | 'error' | 'success' | 'warn' = 'info') {
    this.show();
    const line = document.createElement('div');
    line.style.cssText = 'margin-top:4px;word-wrap:break-word;white-space:pre-wrap;line-height:1.4;';
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const colors: Record<string, string> = { info: '#aaa', action: '#0ff', error: '#f55', success: '#4f4', warn: '#fb0' };
    const icons: Record<string, string> = { info: 'ℹ️', action: '▶️', error: '❌', success: '✅', warn: '⚠️' };
    line.innerHTML = `<span style="color:#555">[${time}]</span> ${icons[type]} <span style="color:${colors[type]}">${message}</span>`;
    this.logContent.appendChild(line);
    this.logContent.scrollTop = this.logContent.scrollHeight;
    if (type === 'error') { reportError(message, { type, context: 'ZhihuContentScript' }); }
  }
}

const logger = new ZhihuLogger();

// ============================================
// 图片操作功能
// ============================================

let isFlowCancelled = false;
let isFlowRunning = false; // 添加锁机制，防止多个流程同时执行
let pendingSourceImages: string[] = [];
let pendingSourceUrl: string | undefined;

const openImageDialog = async (): Promise<boolean> => {
  logger.log('查找图片按钮...', 'info');
  
  // 先点击编辑器获得焦点
  const editor = findElement(SELECTORS.editor);
  if (editor) {
    simulateClick(editor);
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 查找图片按钮 - Playwright: getByRole('button', { name: '图片' })
  let imageBtn: HTMLElement | null = null;
  
  // 方法1: 通过 aria-label (最精确)
  imageBtn = document.querySelector('button[aria-label="图片"]') as HTMLElement;
  if (imageBtn) {
    logger.log('通过 aria-label 找到图片按钮', 'info');
  }
  
  // 方法2: 通过 data-tooltip
  if (!imageBtn) {
    imageBtn = document.querySelector('button[data-tooltip="图片"]') as HTMLElement;
    if (imageBtn) {
      logger.log('通过 data-tooltip 找到图片按钮', 'info');
    }
  }
  
  // 方法3: 通过按钮文本精确匹配
  if (!imageBtn) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '图片' && isElementVisible(btn as HTMLElement)) {
        imageBtn = btn as HTMLElement;
        logger.log('通过文本找到图片按钮', 'info');
        break;
      }
    }
  }
  
  // 方法4: 通过包含"图片"的按钮
  if (!imageBtn) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if ((btn as HTMLElement).innerText?.includes('图片') && isElementVisible(btn as HTMLElement)) {
        imageBtn = btn as HTMLElement;
        break;
      }
    }
  }
  
  if (!imageBtn) {
    logger.log('未找到图片按钮', 'error');
    return false;
  }
  
  logger.log('点击图片按钮', 'action');
  
  // 使用更完整的点击模拟，确保下拉菜单能弹出
  imageBtn.focus();
  await new Promise(r => setTimeout(r, 100));
  
  // 先尝试直接 click
  imageBtn.click();
  await new Promise(r => setTimeout(r, 500));
  
  // 检查是否有下拉菜单出现
  let menuAppeared = false;
  const checkMenu = () => {
    // 查找可能的下拉菜单
    const menus = document.querySelectorAll('[class*="Popover"], [class*="popover"], [class*="Dropdown"], [class*="dropdown"], [class*="Menu"], [class*="menu"], [role="menu"], [role="listbox"]');
    for (const menu of menus) {
      if (isElementVisible(menu as HTMLElement)) {
        const text = (menu as HTMLElement).innerText;
        if (text?.includes('公共图片库') || text?.includes('本地上传')) {
          return true;
        }
      }
    }
    // 也检查是否有"公共图片库"文本出现
    const xpath = "//*[contains(text(), '公共图片库')]";
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i) as HTMLElement;
      if (el && isElementVisible(el)) {
        return true;
      }
    }
    return false;
  };
  
  menuAppeared = checkMenu();
  
  // 如果菜单没出现，尝试用 simulateClick
  if (!menuAppeared) {
    logger.log('下拉菜单未出现，尝试模拟点击...', 'info');
    simulateClick(imageBtn);
    await new Promise(r => setTimeout(r, 800));
    menuAppeared = checkMenu();
  }
  
  // 如果还是没出现，再试一次
  if (!menuAppeared) {
    logger.log('再次尝试点击图片按钮...', 'info');
    // 尝试 mousedown + mouseup
    const rect = imageBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    imageBtn.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: window,
      clientX: centerX, clientY: centerY, button: 0
    }));
    await new Promise(r => setTimeout(r, 50));
    imageBtn.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, view: window,
      clientX: centerX, clientY: centerY, button: 0
    }));
    await new Promise(r => setTimeout(r, 800));
    menuAppeared = checkMenu();
  }
  
  if (menuAppeared) {
    logger.log('图片菜单已弹出', 'success');
  } else {
    logger.log('图片菜单可能未完全加载，继续尝试...', 'warn');
  }
  
  // 等待图片上传弹窗出现
  logger.log('等待图片弹窗加载...', 'info');
  await new Promise(r => setTimeout(r, 1000));
  
  return true;
};

/**
 * 打开图片对话框，但保持编辑器中的选中状态
 * 用于在占位符位置插入图片（替换选中的占位符文本）
 * @param preserveSelection 是否保持选中状态
 */
const openImageDialogPreserveSelection = async (preserveSelection: boolean): Promise<boolean> => {
  logger.log('查找图片按钮...', 'info');
  
  // 如果不需要保持选中状态，使用原来的方法
  if (!preserveSelection) {
    return openImageDialog();
  }
  
  // 保存当前选中状态
  const selection = window.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  
  if (savedRange) {
    logger.log('已保存选中状态', 'info');
  }
  
  // 查找图片按钮 - 不点击编辑器，直接查找按钮
  let imageBtn: HTMLElement | null = null;
  
  // 方法1: 通过 aria-label (最精确)
  imageBtn = document.querySelector('button[aria-label="图片"]') as HTMLElement;
  if (imageBtn) {
    logger.log('通过 aria-label 找到图片按钮', 'info');
  }
  
  // 方法2: 通过 data-tooltip
  if (!imageBtn) {
    imageBtn = document.querySelector('button[data-tooltip="图片"]') as HTMLElement;
    if (imageBtn) {
      logger.log('通过 data-tooltip 找到图片按钮', 'info');
    }
  }
  
  // 方法3: 通过按钮文本精确匹配
  if (!imageBtn) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '图片' && isElementVisible(btn as HTMLElement)) {
        imageBtn = btn as HTMLElement;
        logger.log('通过文本找到图片按钮', 'info');
        break;
      }
    }
  }
  
  // 方法4: 通过包含"图片"的按钮
  if (!imageBtn) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if ((btn as HTMLElement).innerText?.includes('图片') && isElementVisible(btn as HTMLElement)) {
        imageBtn = btn as HTMLElement;
        break;
      }
    }
  }
  
  if (!imageBtn) {
    logger.log('未找到图片按钮', 'error');
    return false;
  }
  
  logger.log('点击图片按钮（保持选中状态）', 'action');
  
  // 点击图片按钮，但不使用 focus() 以避免丢失选中状态
  imageBtn.click();
  await new Promise(r => setTimeout(r, 500));
  
  // 检查是否有下拉菜单出现
  let menuAppeared = false;
  const checkMenu = () => {
    const menus = document.querySelectorAll('[class*="Popover"], [class*="popover"], [class*="Dropdown"], [class*="dropdown"], [class*="Menu"], [class*="menu"], [role="menu"], [role="listbox"]');
    for (const menu of menus) {
      if (isElementVisible(menu as HTMLElement)) {
        const text = (menu as HTMLElement).innerText;
        if (text?.includes('公共图片库') || text?.includes('本地上传')) {
          return true;
        }
      }
    }
    const xpath = "//*[contains(text(), '公共图片库')]";
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i) as HTMLElement;
      if (el && isElementVisible(el)) {
        return true;
      }
    }
    return false;
  };
  
  menuAppeared = checkMenu();
  
  // 如果菜单没出现，尝试用 simulateClick（但不使用 scrollIntoView）
  if (!menuAppeared) {
    logger.log('下拉菜单未出现，尝试模拟点击...', 'info');
    const rect = imageBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY
    };
    
    imageBtn.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    imageBtn.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    imageBtn.dispatchEvent(new MouseEvent('click', eventOptions));
    
    await new Promise(r => setTimeout(r, 800));
    menuAppeared = checkMenu();
  }
  
  if (menuAppeared) {
    logger.log('图片菜单已弹出', 'success');
  } else {
    logger.log('图片菜单可能未完全加载，继续尝试...', 'warn');
  }
  
  // 等待图片上传弹窗出现
  logger.log('等待图片弹窗加载...', 'info');
  await new Promise(r => setTimeout(r, 1000));
  
  // 恢复选中状态（如果之前有保存）
  if (savedRange) {
    const newSelection = window.getSelection();
    newSelection?.removeAllRanges();
    newSelection?.addRange(savedRange);
    logger.log('已恢复选中状态', 'info');
  }
  
  return true;
};

const clickPublicLibrary = async (): Promise<boolean> => {
  logger.log('查找公共图片库按钮...', 'info');
  
  // 重试机制：最多尝试 8 次，每次间隔 500ms
  const maxAttempts = 8;
  let publicBtn: HTMLElement | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    
    // 方法1: 通过按钮文本精确匹配 (button 标签)
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '公共图片库' || text?.includes('公共图片库')) {
        if (isElementVisible(btn as HTMLElement)) {
          publicBtn = btn as HTMLElement;
          logger.log(`找到公共图片库按钮 [button] (尝试 ${attempt}/${maxAttempts})`, 'success');
          break;
        }
      }
    }
    
    if (publicBtn) break;
    
    // 方法2: 查找弹出层/模态框内的元素
    // 知乎的图片上传弹窗可能使用特定的 class
    const popups = document.querySelectorAll('[class*="Popover"], [class*="popover"], [class*="Modal"], [class*="modal"], [class*="Dropdown"], [class*="dropdown"], [class*="Menu"], [class*="menu"], [role="dialog"], [role="menu"], [role="listbox"]');
    for (const popup of popups) {
      if (!isElementVisible(popup as HTMLElement)) continue;
      
      // 在弹出层内查找包含"公共图片库"文本的元素
      const allInPopup = popup.querySelectorAll('*');
      for (const el of allInPopup) {
        const text = (el as HTMLElement).innerText?.trim();
        if (text === '公共图片库' && isElementVisible(el as HTMLElement)) {
          publicBtn = el as HTMLElement;
          logger.log(`在弹出层中找到公共图片库 (尝试 ${attempt}/${maxAttempts})`, 'success');
          break;
        }
      }
      if (publicBtn) break;
    }
    
    if (publicBtn) break;
    
    // 方法3: 全局搜索所有包含"公共图片库"文本的可见元素
    if (!publicBtn) {
      const allElements = document.querySelectorAll('div, span, a, li, p, label');
      for (const el of allElements) {
        // 只检查直接文本内容，避免匹配父容器
        const directText = Array.from(el.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim())
          .join('');
        
        if (directText === '公共图片库' && isElementVisible(el as HTMLElement)) {
          publicBtn = el as HTMLElement;
          logger.log(`通过直接文本找到公共图片库 (尝试 ${attempt}/${maxAttempts})`, 'success');
          break;
        }
        
        // 备用：检查 innerText 但确保是叶子节点
        const text = (el as HTMLElement).innerText?.trim();
        if (text === '公共图片库' && isElementVisible(el as HTMLElement)) {
          const children = el.querySelectorAll('*');
          let hasChildWithSameText = false;
          for (const child of children) {
            if ((child as HTMLElement).innerText?.trim() === '公共图片库') {
              hasChildWithSameText = true;
              break;
            }
          }
          if (!hasChildWithSameText) {
            publicBtn = el as HTMLElement;
            logger.log(`通过叶子节点找到公共图片库 (尝试 ${attempt}/${maxAttempts})`, 'success');
            break;
          }
        }
      }
    }
    
    if (publicBtn) break;
    
    // 方法4: 使用 XPath 查找包含"公共图片库"文本的元素
    if (!publicBtn) {
      const xpath = "//*[contains(text(), '公共图片库')]";
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const el = result.snapshotItem(i) as HTMLElement;
        if (el && isElementVisible(el)) {
          publicBtn = el;
          logger.log(`通过 XPath 找到公共图片库 (尝试 ${attempt}/${maxAttempts})`, 'success');
          break;
        }
      }
    }
    
    if (publicBtn) break;
    
    if (attempt < maxAttempts) {
      logger.log(`未找到公共图片库按钮，重试 ${attempt}/${maxAttempts}...`, 'info');
    }
  }
  
  if (!publicBtn) {
    logger.log('未找到公共图片库按钮', 'warn');
    // 打印调试信息 - 查找所有包含"图片"或"库"的元素
    logger.log('调试: 搜索包含"公共"或"图片库"的元素...', 'info');
    const allElements = document.querySelectorAll('*');
    let foundCount = 0;
    allElements.forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      if (text && (text.includes('公共') || text.includes('图片库')) && text.length < 20) {
        const visible = isElementVisible(el as HTMLElement);
        const tag = el.tagName.toLowerCase();
        if (visible && foundCount < 10) {
          logger.log(`  <${tag}>: "${text}"`, 'info');
          foundCount++;
        }
      }
    });
    return false;
  }
  
  logger.log('点击公共图片库', 'action');
  simulateClick(publicBtn);
  
  // 等待公共图片库界面加载
  logger.log('等待公共图片库界面加载...', 'info');
  await new Promise(r => setTimeout(r, 2000));
  
  return true;
};

const searchImage = async (keyword: string): Promise<boolean> => {
  logger.log(`搜索图片: ${keyword}`, 'info');
  
  // 增加等待时间，确保公共图片库界面完全加载
  // 公共图片库界面加载需要时间，搜索框可能延迟出现
  const maxSearchAttempts = 10;
  let searchInput: HTMLElement | null = null;
  
  for (let attempt = 1; attempt <= maxSearchAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 800));
    
    // 首先确保我们在公共图片库界面内
    // 查找对话框/模态框
    const modal = document.querySelector('[role="dialog"], [class*="Modal"], [class*="modal"], [class*="Popover"], [class*="popover"]');
    
    // 方法1: 在模态框内查找搜索框
    if (modal && isElementVisible(modal as HTMLElement)) {
      const inputs = modal.querySelectorAll('input');
      for (const input of inputs) {
        const placeholder = input.getAttribute('placeholder') || '';
        if (placeholder.includes('关键字') || placeholder.includes('查找') || placeholder.includes('搜索')) {
          if (isElementVisible(input as HTMLElement)) {
            searchInput = input as HTMLElement;
            logger.log(`在模态框中找到搜索框 (placeholder: ${placeholder}) [尝试 ${attempt}/${maxSearchAttempts}]`, 'info');
            break;
          }
        }
      }
      
      // 如果没找到带 placeholder 的，找第一个可见的 input
      if (!searchInput) {
        for (const input of inputs) {
          if (isElementVisible(input as HTMLElement)) {
            searchInput = input as HTMLElement;
            logger.log(`在模态框中找到输入框 [尝试 ${attempt}/${maxSearchAttempts}]`, 'info');
            break;
          }
        }
      }
    }
    
    // 方法2: 全局查找 - Playwright 录制的选择器
    if (!searchInput) {
      searchInput = document.querySelector('input[placeholder*="输入关键字查找图片"]') as HTMLElement;
      if (searchInput && isElementVisible(searchInput)) {
        logger.log(`通过 placeholder 找到搜索框 [尝试 ${attempt}/${maxSearchAttempts}]`, 'info');
      } else {
        searchInput = null;
      }
    }
    
    // 方法3: 部分匹配
    if (!searchInput) {
      const selectors = [
        'input[placeholder*="输入关键字"]',
        'input[placeholder*="关键字查找"]',
        'input[placeholder*="查找图片"]'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement;
        if (el && isElementVisible(el)) {
          searchInput = el;
          logger.log(`通过选择器 ${selector} 找到搜索框 [尝试 ${attempt}/${maxSearchAttempts}]`, 'info');
          break;
        }
      }
    }
    
    if (searchInput) break;
    
    if (attempt < maxSearchAttempts) {
      logger.log(`等待搜索框加载... (${attempt}/${maxSearchAttempts})`, 'info');
    }
  }
  
  if (!searchInput) {
    logger.log('未找到搜索框', 'error');
    // 打印页面上所有 input 的信息用于调试
    const allInputs = document.querySelectorAll('input');
    logger.log(`页面上共有 ${allInputs.length} 个 input 元素`, 'info');
    allInputs.forEach((input, i) => {
      const placeholder = input.getAttribute('placeholder') || '(无)';
      const visible = isElementVisible(input as HTMLElement);
      logger.log(`  input[${i}]: placeholder="${placeholder}", visible=${visible}`, 'info');
    });
    return false;
  }
  
  logger.log('点击搜索框', 'action');
  simulateClick(searchInput);
  await new Promise(r => setTimeout(r, 300));
  
  logger.log('输入搜索关键词', 'action');
  simulateInput(searchInput, keyword);
  await new Promise(r => setTimeout(r, 500));
  
  // ============================================
  // 关键修复：触发搜索
  // 从截图看到搜索框右边有一个放大镜图标按钮，需要点击它来触发搜索
  // ============================================
  logger.log('触发搜索...', 'info');
  
  // 重新获取模态框引用
  const currentModal = document.querySelector('[role="dialog"], [class*="Modal"], [class*="modal"], [class*="Popover"], [class*="popover"]');
  
  let searchTriggered = false;
  
  // 方法1: 查找搜索框旁边的放大镜图标按钮（最可能的方式）
  // 搜索框通常在一个容器内，放大镜图标在搜索框右边
  const searchInputParent = searchInput.parentElement;
  if (searchInputParent) {
    // 查找同级或子级的 svg/button/span 元素（放大镜图标）
    const iconElements = searchInputParent.querySelectorAll('svg, button, span, i, [class*="icon"], [class*="Icon"], [class*="search"], [class*="Search"]');
    for (const icon of iconElements) {
      if (icon !== searchInput && isElementVisible(icon as HTMLElement)) {
        const rect = (icon as HTMLElement).getBoundingClientRect();
        // 放大镜图标通常比较小，且在搜索框右边
        if (rect.width > 0 && rect.width < 50 && rect.height > 0 && rect.height < 50) {
          logger.log('找到搜索图标，点击触发搜索', 'action');
          simulateClick(icon as HTMLElement);
          searchTriggered = true;
          await new Promise(r => setTimeout(r, 500));
          break;
        }
      }
    }
  }
  
  // 方法2: 查找搜索框容器内的可点击元素
  if (!searchTriggered && searchInputParent) {
    // 有时候放大镜是 input 的兄弟元素
    const siblings = searchInputParent.children;
    for (const sibling of siblings) {
      if (sibling !== searchInput && isElementVisible(sibling as HTMLElement)) {
        const tagName = sibling.tagName.toLowerCase();
        if (tagName === 'svg' || tagName === 'button' || tagName === 'span' || tagName === 'i') {
          logger.log(`点击搜索框旁边的 ${tagName} 元素`, 'action');
          simulateClick(sibling as HTMLElement);
          searchTriggered = true;
          await new Promise(r => setTimeout(r, 500));
          break;
        }
      }
    }
  }
  
  // 方法3: 在模态框内查找 .css-13oeh20 按钮（之前的方法）
  if (!searchTriggered && currentModal && isElementVisible(currentModal as HTMLElement)) {
    const searchConfirmBtn = currentModal.querySelector('.css-13oeh20') as HTMLElement;
    if (searchConfirmBtn && isElementVisible(searchConfirmBtn)) {
      logger.log('点击搜索确认按钮 (.css-13oeh20)', 'action');
      simulateClick(searchConfirmBtn);
      searchTriggered = true;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // 方法4: 在模态框内查找"搜索"按钮
  if (!searchTriggered && currentModal) {
    const btns = currentModal.querySelectorAll('button');
    for (const btn of btns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '搜索' || text?.includes('搜索')) {
        if (isElementVisible(btn as HTMLElement)) {
          logger.log('点击"搜索"按钮', 'action');
          simulateClick(btn as HTMLElement);
          searchTriggered = true;
          await new Promise(r => setTimeout(r, 500));
          break;
        }
      }
    }
  }
  
  // 方法5: 模拟回车键（多种方式）
  if (!searchTriggered) {
    logger.log('尝试按回车键搜索', 'action');
    
    // 确保搜索框获得焦点
    searchInput.focus();
    await new Promise(r => setTimeout(r, 100));
    
    // 方式1: 使用 KeyboardEvent
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    searchInput.dispatchEvent(enterEvent);
    
    // 方式2: 也发送 keypress 和 keyup
    searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    
    // 方式3: 如果是 form 表单，尝试提交
    const form = searchInput.closest('form');
    if (form) {
      logger.log('找到表单，尝试提交', 'action');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    
    searchTriggered = true;
  }
  
  logger.log('等待搜索结果...', 'info');
  await new Promise(r => setTimeout(r, 3000)); // 增加等待时间，确保搜索结果加载
  
  return true;
};

const selectImage = async (index = 0): Promise<boolean> => {
  logger.log('选择图片...', 'info');
  
  // 等待搜索结果完全加载（增加等待时间）
  await new Promise(r => setTimeout(r, 1500));
  
  // 严格按照 Playwright 录制的步骤：
  // await page.locator('.css-128iodx').first().click();
  // 只点击一次 .css-128iodx 元素来选中图片
  
  // 重试机制：最多尝试 5 次
  const maxAttempts = 5;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const imageElements = document.querySelectorAll('.css-128iodx');
    logger.log(`找到 ${imageElements.length} 个 .css-128iodx 元素 (尝试 ${attempt}/${maxAttempts})`, 'info');
    
    if (imageElements.length > 0) {
      const targetIndex = Math.min(index, imageElements.length - 1);
      const targetElement = imageElements[targetIndex] as HTMLElement;
      
      if (isElementVisible(targetElement)) {
        logger.log(`点击第 ${targetIndex + 1} 个图片 (.css-128iodx)`, 'action');
        
        // 只使用一种点击方式，避免重复点击导致取消选中
        const rect = targetElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const mouseEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: centerX,
          clientY: centerY,
          button: 0,
          buttons: 1
        };
        
        targetElement.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
        await new Promise(r => setTimeout(r, 50));
        targetElement.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
        targetElement.dispatchEvent(new MouseEvent('click', mouseEventInit));
        
        await new Promise(r => setTimeout(r, 800));
        
        logger.log('图片选择完成', 'success');
        return true;
      } else {
        logger.log('.css-128iodx 元素不可见', 'warn');
      }
    }
    
    // 等待后重试
    if (attempt < maxAttempts) {
      logger.log(`等待图片加载...`, 'info');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // 备用方法：查找模态框内的图片
  logger.log('尝试备用方法查找图片...', 'info');
  const modal = document.querySelector('[role="dialog"], [class*="Modal"], [class*="modal"]');
  if (modal) {
    const imgs = modal.querySelectorAll('img');
    const validImgs: HTMLElement[] = [];
    
    imgs.forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.width >= 80 && rect.height >= 80 && isElementVisible(img as HTMLElement)) {
        validImgs.push(img as HTMLElement);
      }
    });
    
    logger.log(`在模态框中找到 ${validImgs.length} 张图片`, 'info');
    
    if (validImgs.length > 0) {
      const targetImg = validImgs[Math.min(index, validImgs.length - 1)];
      logger.log('点击图片', 'action');
      targetImg.click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    }
  }
  
  logger.log('未找到可选择的图片', 'error');
  return false;
};

const clickInsertImage = async (): Promise<boolean> => {
  logger.log('查找插入图片按钮...', 'info');
  await new Promise(r => setTimeout(r, 500));
  
  let insertBtn: HTMLElement | null = null;
  
  // 方法1: 查找包含"插入图片"文本的按钮
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const text = (btn as HTMLElement).innerText?.trim();
    if (text === '插入图片' || text?.includes('插入图片')) {
      if (isElementVisible(btn as HTMLElement)) {
        insertBtn = btn as HTMLElement;
        logger.log('找到插入图片按钮', 'info');
        break;
      }
    }
  }
  
  // 方法2: 查找模态框内的插入按钮
  if (!insertBtn) {
    const modal = document.querySelector('[role="dialog"], [class*="Modal"], [class*="modal"]');
    if (modal) {
      const btns = modal.querySelectorAll('button');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '插入图片' || text?.includes('插入')) {
          if (isElementVisible(btn as HTMLElement)) {
            insertBtn = btn as HTMLElement;
            logger.log('在模态框中找到插入图片按钮', 'info');
            break;
          }
        }
      }
    }
  }
  
  if (!insertBtn) {
    logger.log('未找到插入图片按钮', 'error');
    // 调试：打印所有可见按钮
    const allBtns = document.querySelectorAll('button');
    logger.log(`页面上共有 ${allBtns.length} 个按钮`, 'info');
    allBtns.forEach((btn, i) => {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text && isElementVisible(btn as HTMLElement) && text.length < 20) {
        logger.log(`  button[${i}]: "${text}"`, 'info');
      }
    });
    return false;
  }
  
  logger.log('点击插入图片按钮', 'action');
  
  // 使用与选择图片相同的点击方式
  const rect = insertBtn.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    button: 0,
    buttons: 1
  };
  
  insertBtn.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
  await new Promise(r => setTimeout(r, 50));
  insertBtn.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
  insertBtn.dispatchEvent(new MouseEvent('click', mouseEventInit));
  
  await new Promise(r => setTimeout(r, 1500));
  
  logger.log('插入图片按钮已点击', 'success');
  return true;
};

const addTopic = async (topic: string): Promise<boolean> => {
  logger.log(`添加话题: ${topic}`, 'info');
  
  // 点击添加话题按钮
  const buttons = document.querySelectorAll('button');
  let addTopicBtn: HTMLElement | null = null;
  
  for (const btn of buttons) {
    if ((btn as HTMLElement).innerText?.includes('添加话题')) {
      addTopicBtn = btn as HTMLElement;
      break;
    }
  }
  
  if (!addTopicBtn) {
    logger.log('未找到添加话题按钮', 'warn');
    return false;
  }
  
  simulateClick(addTopicBtn);
  await new Promise(r => setTimeout(r, 500));
  
  // 搜索话题
  let topicInput = document.querySelector('input[placeholder*="搜索话题"]') as HTMLElement;
  if (!topicInput) {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      if (isElementVisible(input as HTMLElement)) {
        topicInput = input as HTMLElement;
        break;
      }
    }
  }
  
  if (topicInput) {
    simulateClick(topicInput);
    simulateInput(topicInput, topic);
    await new Promise(r => setTimeout(r, 1000));
    
    // 点击第一个话题结果
    const topicResults = document.querySelectorAll('button');
    for (const btn of topicResults) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === topic || text?.includes(topic)) {
        simulateClick(btn as HTMLElement);
        logger.log(`话题已添加: ${topic}`, 'success');
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    }
  }
  
  return false;
};

const clickPublish = async (): Promise<boolean> => {
  logger.log('查找发布按钮...', 'info');
  
  const buttons = document.querySelectorAll('button');
  let publishBtn: HTMLElement | null = null;
  
  for (const btn of buttons) {
    const text = (btn as HTMLElement).innerText?.trim();
    if (text === '发布' && isElementVisible(btn as HTMLElement)) {
      publishBtn = btn as HTMLElement;
      break;
    }
  }
  
  if (!publishBtn) {
    logger.log('未找到发布按钮', 'error');
    return false;
  }
  
  logger.log('点击发布按钮', 'action');
  simulateClick(publishBtn);
  await new Promise(r => setTimeout(r, 2000));
  
  logger.log('✅ 文章已发布！', 'success');
  return true;
};

/**
 * 投稿至问题功能
 * 根据远程调试分析的实际页面结构：
 * 1. 找到 #Popover6-toggle（显示"未选择"的下拉框）
 * 2. 等待问题列表弹出（.Modal 或 .QuestionSearchModal）
 * 3. 点击第一个问题的"选择"按钮（.css-1335jw2 button）
 * 4. 点击"确定"按钮确认（.Modal .Button--primary.Button--blue）
 * 5. 关闭弹窗
 */
const submitToQuestion = async (): Promise<boolean> => {
  // 不清除日志，保持连续显示
  logger.show();
  logger.log('🎯 开始投稿至问题...', 'info');
  
  // ============================================
  // 步骤1: 找到"投稿至问题"下拉框
  // 根据调试分析，下拉框 ID 是 #Popover6-toggle，显示"未选择"
  // ============================================
  let submitToggle: HTMLElement | null = null;
  
  // 方法1: 直接通过已知的 Popover ID 查找（最精确）
  logger.log('查找"投稿至问题"下拉框...', 'info');
  
  // 遍历可能的 Popover ID
  for (let i = 1; i <= 20; i++) {
    const toggle = document.querySelector(`#Popover${i}-toggle`) as HTMLElement;
    if (toggle && isElementVisible(toggle)) {
      const text = toggle.innerText?.trim();
      // 检查是否是"未选择"或已选择的问题（投稿至问题的下拉框）
      if (text === '未选择' || text?.includes('未选择')) {
        // 进一步确认：检查附近是否有"投稿至问题"文字
        const parent = toggle.closest('[class*="FormItem"], [class*="form-item"]') || 
                       toggle.parentElement?.parentElement?.parentElement;
        if (parent && (parent as HTMLElement).innerText?.includes('投稿至问题')) {
          submitToggle = toggle;
          logger.log(`找到投稿至问题下拉框: #Popover${i}-toggle`, 'success');
          break;
        }
      }
    }
  }
  
  // 方法2: 查找包含"未选择"文本且在"投稿至问题"区域的按钮
  if (!submitToggle) {
    logger.log('尝试通过文本查找...', 'info');
    const allButtons = document.querySelectorAll('button[role="combobox"], button[id*="Popover"]');
    for (const btn of allButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '未选择' && isElementVisible(btn as HTMLElement)) {
        // 检查是否在"投稿至问题"区域
        const parent = (btn as HTMLElement).closest('[class*="FormItem"]') || 
                       btn.parentElement?.parentElement?.parentElement;
        if (parent && (parent as HTMLElement).innerText?.includes('投稿')) {
          submitToggle = btn as HTMLElement;
          logger.log('通过文本找到投稿至问题下拉框', 'success');
          break;
        }
      }
    }
  }
  
  // 方法3: 查找"投稿至问题"标签旁边的下拉框
  if (!submitToggle) {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = (el as HTMLElement).innerText?.trim();
      if (text === '投稿至问题' && isElementVisible(el as HTMLElement)) {
        // 找到标签后，在其父容器中查找下拉框
        const container = el.parentElement?.parentElement;
        if (container) {
          const toggle = container.querySelector('button[role="combobox"], [id*="Popover"][id*="toggle"]') as HTMLElement;
          if (toggle && isElementVisible(toggle)) {
            submitToggle = toggle;
            logger.log('在投稿至问题区域找到下拉框', 'success');
            break;
          }
        }
      }
    }
  }
  
  if (!submitToggle) {
    logger.log('未找到投稿至问题的下拉框', 'error');
    return false;
  }
  
  // 点击下拉框打开问题选择面板
  logger.log('点击投稿至问题下拉框', 'action');
  simulateClick(submitToggle);
  await new Promise(r => setTimeout(r, 2000));
  
  // ============================================
  // 步骤2: 等待问题列表加载，然后点击"选择"按钮
  // 根据调试分析，"选择"按钮在 .css-1335jw2 容器内
  // ============================================
  logger.log('等待问题列表加载...', 'info');
  
  let selectBtn: HTMLElement | null = null;
  const maxSelectAttempts = 10;
  
  for (let attempt = 1; attempt <= maxSelectAttempts; attempt++) {
    // 方法1: 使用精确的 CSS 选择器（根据调试分析）
    selectBtn = document.querySelector('.css-1335jw2 button') as HTMLElement;
    if (selectBtn && isElementVisible(selectBtn)) {
      logger.log(`通过 .css-1335jw2 找到"选择"按钮 [尝试 ${attempt}/${maxSelectAttempts}]`, 'success');
      break;
    }
    
    // 方法2: 在 Modal 内查找 Button--secondary.Button--blue
    const modal = document.querySelector('.Modal, .QuestionSearchModal, [role="dialog"]');
    if (modal) {
      const btns = modal.querySelectorAll('.Button--secondary.Button--blue');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '选择' && isElementVisible(btn as HTMLElement)) {
          selectBtn = btn as HTMLElement;
          logger.log(`在 Modal 中找到"选择"按钮 [尝试 ${attempt}/${maxSelectAttempts}]`, 'success');
          break;
        }
      }
    }
    
    if (selectBtn) break;
    
    // 方法3: 全局查找文本为"选择"的按钮
    if (!selectBtn) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '选择' && isElementVisible(btn as HTMLElement)) {
          // 确保是在 Modal 内的按钮
          const inModal = btn.closest('.Modal, .QuestionSearchModal, [role="dialog"]');
          if (inModal) {
            selectBtn = btn as HTMLElement;
            logger.log(`找到"选择"按钮 [尝试 ${attempt}/${maxSelectAttempts}]`, 'success');
            break;
          }
        }
      }
    }
    
    if (selectBtn) break;
    
    if (attempt < maxSelectAttempts) {
      logger.log(`等待问题列表... (${attempt}/${maxSelectAttempts})`, 'info');
      await new Promise(r => setTimeout(r, 800));
    }
  }
  
  if (!selectBtn) {
    logger.log('未找到"选择"按钮，可能没有推荐问题', 'warn');
    // 尝试关闭弹窗
    const closeBtn = document.querySelector('.Modal-closeButton, [aria-label="关闭"]') as HTMLElement;
    if (closeBtn) {
      simulateClick(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    return false;
  }
  
  // 点击"选择"按钮
  logger.log('点击"选择"按钮选择第一个问题', 'action');
  selectBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  
  // 使用简单直接的点击方式
  selectBtn.click();
  
  logger.log('已点击"选择"按钮', 'info');
  await new Promise(r => setTimeout(r, 1500));
  
  // 验证选择是否成功（检查"已选择"状态）
  const statusText = document.querySelector('.css-1tnqzyy');
  if (statusText) {
    const status = (statusText as HTMLElement).innerText;
    logger.log(`选择状态: ${status}`, 'info');
  }
  
  // ============================================
  // 步骤3: 点击"确定"按钮确认选择
  // 根据调试分析，确定按钮是 .Modal .Button--primary.Button--blue
  // ============================================
  logger.log('查找"确定"按钮...', 'info');
  let confirmBtn: HTMLElement | null = null;
  
  // 方法1: 使用精确的 CSS 选择器
  confirmBtn = document.querySelector('.Modal .Button--primary.Button--blue') as HTMLElement;
  if (confirmBtn && isElementVisible(confirmBtn)) {
    const text = (confirmBtn as HTMLElement).innerText?.trim();
    if (text === '确定') {
      logger.log('通过 CSS 选择器找到"确定"按钮', 'success');
    } else {
      confirmBtn = null;
    }
  }
  
  // 方法2: 在 Modal 内查找文本为"确定"的按钮
  if (!confirmBtn) {
    const modal = document.querySelector('.Modal, .QuestionSearchModal, [role="dialog"]');
    if (modal) {
      const btns = modal.querySelectorAll('button');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '确定' && isElementVisible(btn as HTMLElement)) {
          confirmBtn = btn as HTMLElement;
          logger.log('在 Modal 中找到"确定"按钮', 'success');
          break;
        }
      }
    }
  }
  
  if (confirmBtn) {
    logger.log('点击"确定"按钮', 'action');
    confirmBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    logger.log('已点击"确定"按钮', 'info');
  } else {
    logger.log('未找到"确定"按钮', 'warn');
  }
  
  // ============================================
  // 步骤4: 验证并关闭弹窗
  // ============================================
  await new Promise(r => setTimeout(r, 500));
  
  // 检查下拉框是否已更新（不再显示"未选择"）
  const updatedToggle = submitToggle;
  if (updatedToggle) {
    const newText = updatedToggle.innerText?.trim();
    if (newText && newText !== '未选择') {
      logger.log(`✅ 投稿至问题完成！已选择: ${newText.substring(0, 30)}...`, 'success');
    } else {
      logger.log('⚠️ 投稿至问题可能未成功，下拉框仍显示"未选择"', 'warn');
    }
  }
  
  // 如果 Modal 还在，尝试关闭
  const remainingModal = document.querySelector('.Modal, .QuestionSearchModal, [role="dialog"]');
  if (remainingModal && isElementVisible(remainingModal as HTMLElement)) {
    logger.log('关闭弹窗...', 'info');
    const closeBtn = remainingModal.querySelector('.Modal-closeButton, [aria-label="关闭"]') as HTMLElement;
    if (closeBtn && isElementVisible(closeBtn)) {
      closeBtn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  return true;
};

// 关闭图片对话框的辅助函数
const closeImageDialog = async (): Promise<void> => {
  // 尝试多种方式关闭对话框
  const closeSelectors = [
    '[aria-label="关闭"]',
    '[class*="close"]',
    'button[aria-label="Close"]',
    '.Modal-closeButton',
    '[class*="Modal"] [class*="close"]'
  ];
  
  for (const selector of closeSelectors) {
    const closeBtn = document.querySelector(selector) as HTMLElement;
    if (closeBtn && isElementVisible(closeBtn)) {
      closeBtn.click();
      await new Promise(r => setTimeout(r, 500));
      return;
    }
  }
  
  // 尝试按 ESC 键关闭
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  
  // 点击对话框外部关闭
  const modal = document.querySelector('[class*="Modal-mask"], [class*="modal-mask"], [class*="Overlay"]') as HTMLElement;
  if (modal && isElementVisible(modal)) {
    modal.click();
    await new Promise(r => setTimeout(r, 500));
  }
};


/**
 * 查找所有图片占位符
 */
const findImagePlaceholders = (): { text: string; keyword: string }[] => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return [];
  
  const content = editor.innerText || '';
  const placeholders: { text: string; keyword: string }[] = [];
  
  // 匹配多种格式的图片占位符
  // 注意：需要匹配中英文冒号和空格的各种组合
  const patterns = [
    /\[图片[：:]\s*([^\]]+)\]/g,




  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      placeholders.push({ 
        text: match[0], 
        keyword: match[1].trim()
      });
    }
  }
  
  return placeholders;
};

/**
 * 删除编辑器中的指定文本
 */
const deleteTextInEditor = async (searchText: string): Promise<boolean> => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return false;

  // 多次尝试删除，确保删除成功
  for (let attempt = 0; attempt < 3; attempt++) {
    let found = false;
    
    // 方法1: TreeWalker (精确匹配)
    try {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.includes(searchText)) {
          const range = document.createRange();
          const startIndex = node.textContent.indexOf(searchText);
          range.setStart(node, startIndex);
          range.setEnd(node, startIndex + searchText.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          
          document.execCommand('delete');
          found = true;
          await new Promise(r => setTimeout(r, 200));
          break;
        }
      }
    } catch (e) {
      console.warn('TreeWalker delete failed', e);
    }

    // 方法2: 正则模糊匹配 (处理空格/特殊字符)
    if (!found) {
      try {
        const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patternStr = escaped.replace(/\\:|\\：/g, '[:：]').replace(/\\ /g, '\\s*');
        const regex = new RegExp(patternStr);
        
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        
        while ((node = walker.nextNode())) {
          const text = node.textContent || '';
          const match = regex.exec(text);
          if (match) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            
            document.execCommand('delete');
            found = true;
            await new Promise(r => setTimeout(r, 200));
            break;
          }
        }
      } catch (e) {
        console.warn('Regex delete failed', e);
      }
    }
    
    // 方法3: window.find (最后尝试)
    if (!found) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) selection.collapseToStart();
        
        if ((window as any).find(searchText, false, false, true, false, false, false)) {
          document.execCommand('delete');
          found = true;
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.warn('window.find delete failed', e);
      }
    }
    
    if (!found) {
      // 检查是否还存在 (使用正则检查)
      const currentContent = editor.innerText || '';
      const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patternStr = escaped.replace(/\\:|\\：/g, '[:：]').replace(/\\ /g, '\\s*');
      const regex = new RegExp(patternStr);
      
      if (!regex.test(currentContent)) {
        return true; // 已经不存在了
      }
    } else {
      // 删除成功后，再次检查是否还有残留
      const currentContent = editor.innerText || '';
      const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patternStr = escaped.replace(/\\:|\\：/g, '[:：]').replace(/\\ /g, '\\s*');
      const regex = new RegExp(patternStr);
      
      if (!regex.test(currentContent)) {
        return true;
      }
      // 如果还有，继续循环删除
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  // 最后检查
  const finalContent = editor.innerText || '';
  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternStr = escaped.replace(/\\:|\\：/g, '[:：]').replace(/\\ /g, '\\s*');
  const regex = new RegExp(patternStr);
  return !regex.test(finalContent);
};

/**
 * 选中编辑器中的指定文本（不删除）
 * 用于在占位符位置插入图片
 */
const selectTextInEditor = async (searchText: string): Promise<boolean> => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return false;

  // 确保编辑器获得焦点
  editor.focus();
  await new Promise(r => setTimeout(r, 100));

  // 方法1: 使用 TreeWalker (精确匹配)
  try {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes(searchText)) {
        const range = document.createRange();
        const startIndex = node.textContent.indexOf(searchText);
        range.setStart(node, startIndex);
        range.setEnd(node, startIndex + searchText.length);
        
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        
        logger.log(`已选中文本 (TreeWalker): "${searchText}"`, 'info');
        await new Promise(r => setTimeout(r, 200));
        return true;
      }
    }
  } catch (e) {
    logger.log(`TreeWalker 查找出错: ${e}`, 'warn');
  }

  // 方法2: 使用 window.find (浏览器原生查找)
  // 注意：window.find 会自动滚动并选中找到的文本
  try {
    // 先折叠选区到开头，避免从中间开始找
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      selection.collapseToStart();
    }
    
    if ((window as any).find(searchText, false, false, true, false, false, false)) {
      logger.log(`已选中文本 (window.find): "${searchText}"`, 'info');
      await new Promise(r => setTimeout(r, 200));
      return true;
    }
  } catch (e) {
    logger.log(`window.find 查找出错: ${e}`, 'warn');
  }

  // 方法3: 正则模糊匹配 (处理空格/特殊字符)
  try {
    // 构建灵活的正则: 转义特殊字符，并将空格替换为 \s*
    // e.g. "[图片: foo]" -> "\[\s*图片\s*[:：]\s*foo\s*\]"
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 允许冒号是中文或英文，允许任意空白
    const patternStr = escaped.replace(/\\:|\\：/g, '[:：]').replace(/\\ /g, '\\s*');
    const regex = new RegExp(patternStr);
    
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const match = regex.exec(text);
      if (match) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        
        logger.log(`已选中文本 (正则匹配): "${match[0]}"`, 'info');
        await new Promise(r => setTimeout(r, 200));
        return true;
      }
    }
  } catch (e) {
    logger.log(`正则匹配查找出错: ${e}`, 'warn');
  }

  // 方法4: 降级模糊匹配 (忽略所有空白字符)
  try {
    const cleanSearchText = searchText.replace(/\s+/g, '');
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const cleanText = text.replace(/\s+/g, '');
      if (cleanText.includes(cleanSearchText)) {
        // 这是一个近似匹配，我们需要找到原始文本中的位置
        // 由于位置映射复杂，我们尝试构建一个针对此节点的宽松正则
        const chars = cleanSearchText.split('');
        const nodePattern = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        const nodeRegex = new RegExp(nodePattern);
        
        const match = nodeRegex.exec(text);
        if (match) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          
          logger.log(`已选中文本 (降级模糊匹配): "${match[0]}"`, 'info');
          await new Promise(r => setTimeout(r, 200));
          return true;
        }
      }
    }
  } catch (e) {
    logger.log(`降级模糊匹配查找出错: ${e}`, 'warn');
  }
  
  logger.log(`未找到文本: "${searchText}"`, 'warn');
  return false;
};


/**
 * 只插入图片（不处理占位符）
 * @param keyword 搜索关键词
 * @param preserveSelection 是否在打开对话框前保持选中状态（用于替换占位符）
 */
const insertImageOnly = async (keyword: string, preserveSelection = false): Promise<boolean> => {
  if (isFlowCancelled) return false;
  
  // 1. 打开图片对话框（不点击编辑器，保持选中状态）
  if (!await openImageDialogPreserveSelection(preserveSelection)) {
    logger.log('无法打开图片对话框', 'warn');
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 2. 点击公共图片库
  const publicLibrarySuccess = await clickPublicLibrary();
  if (!publicLibrarySuccess) {
    logger.log('无法打开公共图片库', 'warn');
    await closeImageDialog();
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 3. 搜索图片
  if (!await searchImage(keyword)) {
    logger.log('搜索图片失败', 'warn');
    await closeImageDialog();
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 4. 选择图片
  const smartIndex = await pickBestImageIndexWithAI(keyword);
  if (!await selectImage(smartIndex ?? 0)) {
    logger.log('选择图片失败（可能没有搜索结果）', 'warn');
    await closeImageDialog();
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 5. 插入图片
  if (!await clickInsertImage()) {
    logger.log('插入图片失败', 'warn');
    return false;
  }
  
  logger.log(`图片 "${keyword}" 插入成功`, 'success');
  return true;
};

// ============================================
// 主流程
// ============================================

const runSmartImageFlow = async (keyword?: string, autoPublish = false) => {
  // 检查是否已有流程在运行，防止多个流程同时执行
  if (isFlowRunning) {
    logger.log('⚠️ 已有图片处理流程在运行，请等待完成', 'warn');
    return;
  }
  
  isFlowRunning = true; // 设置锁
  isFlowCancelled = false;
  // logger.clear();
  logger.show();
  logger.setStopCallback(() => { 
    isFlowCancelled = true; 
    isFlowRunning = false; // 取消时释放锁
  });
  logger.log('🚀 开始知乎图片处理...', 'info');
  
  try {
    // 默认不优先使用素材来源图片
    const preferSourceImages = false;

    // 先取消任何选中状态，避免干扰
    const selection = window.getSelection();
    selection?.removeAllRanges();
    
    // 点击编辑器外部区域，确保没有弹窗干扰
    const editor = findElement(SELECTORS.editor);
    if (editor) {
      editor.click();
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 查找所有图片占位符
    const placeholders = findImagePlaceholders();
    
    if (placeholders.length === 0) {
      // 如果没有找到图片占位符，使用默认关键词在末尾插入一张图片
      const searchKeyword = keyword || extractKeywordFromTitle() || '风景';
      logger.log(`未找到图片占位符，使用关键词: ${searchKeyword}`, 'info');
      
      // 移动光标到编辑器末尾
      if (editor) {
        editor.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      
      logger.log('步骤 1/5: 打开图片对话框', 'info');
      const dialogOpened = await openImageDialog();
      if (!dialogOpened) {
        logger.log('无法打开图片对话框，流程终止', 'error');
        return;
      }

      const sourceUrl = (preferSourceImages && pendingSourceImages.length > 0) ? pendingSourceImages[0] : undefined;
      if (sourceUrl) {
        logger.log('步骤 2/5: 本地上传来源图片', 'info');
        const ok = await uploadAndInsertSourceImage(sourceUrl);
        if (ok) {
          logger.log('✅ 图片插入成功！', 'success');
        } else {
          logger.log('来源图片插入失败，回退公共图片库', 'warn');
          await closeImageDialog();
          await insertImageOnly(searchKeyword, false);
        }
      } else {
        logger.log('步骤 2/5: 点击公共图片库', 'info');
        const publicLibraryOpened = await clickPublicLibrary();
        if (!publicLibraryOpened) {
          logger.log('无法打开公共图片库，流程终止', 'error');
          await closeImageDialog();
          return;
        }
        
        logger.log('步骤 3/5: 搜索图片', 'info');
        const searchSuccess = await searchImage(searchKeyword);
        if (!searchSuccess) {
          logger.log('搜索图片失败，流程终止', 'error');
          await closeImageDialog();
          return;
        }
        
        logger.log('步骤 4/5: 选择图片', 'info');
        const smartIndex = await pickBestImageIndexWithAI(searchKeyword);
        const selectSuccess = await selectImage(smartIndex ?? 0);
        if (!selectSuccess) {
          logger.log('选择图片失败，流程终止', 'error');
          await closeImageDialog();
          return;
        }
        
        logger.log('步骤 5/5: 插入图片', 'info');
        const insertSuccess = await clickInsertImage();
        if (insertSuccess) {
          logger.log('✅ 图片插入成功！', 'success');
        } else {
          logger.log('插入图片失败', 'error');
        }
      }
    } else {
      logger.log(`找到 ${placeholders.length} 个图片占位符`, 'info');
      placeholders.forEach((p, i) => {
        logger.log(`  ${i + 1}. ${p.text}`, 'info');
      });
      
      let successCount = 0;
      
      // 逐个处理占位符：选中占位符 -> 插入图片（图片会替换选中的文本）
      // 从后往前处理，避免位置偏移问题
      for (let i = placeholders.length - 1; i >= 0; i--) {
        if (isFlowCancelled) {
          logger.log('用户取消操作', 'warn');
          break;
        }
        
        const placeholder = placeholders[i];
        logger.log(`\n📷 处理第 ${placeholders.length - i}/${placeholders.length} 个占位符: ${placeholder.keyword}`, 'info');
        
        // 步骤1: 选中占位符文本
        let selected = await selectTextInEditor(placeholder.text);
        if (!selected) {
          logger.log(`无法选中占位符: ${placeholder.text}，尝试删除后在末尾插入`, 'warn');
          // 如果无法选中，尝试删除占位符并在末尾插入
          await deleteTextInEditor(placeholder.text);
          if (editor) {
            editor.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
            // 关键修正：手动设置光标到末尾后，必须标记为 selected=true，
            // 这样 insertImageOnly 才会调用 openImageDialogPreserveSelection
            // 从而保持我们刚刚设置的光标位置，而不是重新点击编辑器导致全选或光标重置
            
            // 额外安全检查：确保选区是折叠的（即光标状态，而不是选中状态）
            if (!sel?.isCollapsed) {
              logger.log('⚠️ 选区未折叠，强制折叠到末尾', 'warn');
              sel?.collapseToEnd();
            }
            
            selected = true;
          }
        }
        
        // 修复：检查数组边界，确保有足够的素材图片
        const sourceUrl = (preferSourceImages && i < pendingSourceImages.length) ? pendingSourceImages[i] : undefined;
        let success = false;
        if (sourceUrl) {
          try {
            const opened = await openImageDialogPreserveSelection(selected);
            if (opened) {
              success = await uploadAndInsertSourceImage(sourceUrl);
              if (!success) await closeImageDialog();
            }
          } catch {
            await closeImageDialog();
            success = false;
          }
          if (!success) {
            success = await insertImageOnly(placeholder.keyword, selected);
          }
        } else {
          success = await insertImageOnly(placeholder.keyword, selected);
        }
        
        if (success) {
          successCount++;
          logger.log(`占位符 "${placeholder.text}" 已替换为图片`, 'success');
        } else {
          logger.log(`第 ${placeholders.length - i} 张图片插入失败`, 'error');
          // 如果图片插入失败，确保删除占位符
          await deleteTextInEditor(placeholder.text);
        }
        
        // 等待图片加载完成后再继续下一个
        await new Promise(r => setTimeout(r, 2000));
      }
      
      logger.log(`\n🎉 图片处理完成！成功替换 ${successCount}/${placeholders.length} 个占位符`, 'success');
    }
    
    // ============================================
    // 图片处理完成后，触发 Markdown 解析（如果需要）
    // ============================================
    const editorForMarkdown = findElement(SELECTORS.editor);
    if (editorForMarkdown && sessionStorage.getItem('memoraid_needs_markdown_parse') === 'true') {
      logger.log('\n📝 开始触发 Markdown 解析...', 'info');
      sessionStorage.removeItem('memoraid_needs_markdown_parse');
      
      // 全选内容触发 Markdown 检测
      await selectAllAndTriggerMarkdownParse(editorForMarkdown);
      await new Promise(r => setTimeout(r, 500));
      
      // 检测并点击"确认并解析"按钮
      let found = false;
      for (let i = 0; i < 20 && !found; i++) {
        if (i > 0) {
          await new Promise(r => setTimeout(r, 200));
        }
        
        // 查找 Notification 中的"确认并解析"按钮
        const notifications = document.querySelectorAll('[class*="Notification"]');
        for (const notification of notifications) {
          if (!isElementVisible(notification as HTMLElement)) continue;
          const btns = notification.querySelectorAll('button');
          for (const btn of btns) {
            const text = (btn as HTMLElement).innerText?.trim();
            if (text === '确认并解析') {
              logger.log('🎯 找到"确认并解析"按钮，立即点击！', 'action');
              simulateClick(btn as HTMLElement);
              await new Promise(r => setTimeout(r, 1000));
              logger.log('✅ Markdown 格式已解析', 'success');
              found = true;
              break;
            }
          }
          if (found) break;
        }
        
        // 也查找 Button--link 类型的按钮
        if (!found) {
          const linkButtons = document.querySelectorAll('button[class*="Button--link"]');
          for (const btn of linkButtons) {
            const text = (btn as HTMLElement).innerText?.trim();
            if (text === '确认并解析' && isElementVisible(btn as HTMLElement)) {
              logger.log('🎯 找到"确认并解析"按钮，立即点击！', 'action');
              simulateClick(btn as HTMLElement);
              await new Promise(r => setTimeout(r, 1000));
              logger.log('✅ Markdown 格式已解析', 'success');
              found = true;
              break;
            }
          }
        }
      }
      
      if (!found) {
        logger.log('⚠️ 未找到"确认并解析"按钮', 'warn');
        await handleMarkdownParse();
      }
    }
    
    // ============================================
    // 投稿至问题
    // ============================================
    if (!isFlowCancelled) {
      logger.log('\n📋 2秒后开始投稿至问题...', 'info');
      await new Promise(r => setTimeout(r, 2000));
      await submitToQuestion();
    }
    
    // 如果开启自动发布
    if (autoPublish && !isFlowCancelled) {
      logger.log('📤 自动发布文章...', 'info');
      await new Promise(r => setTimeout(r, 1000));
      const published = await clickPublish();
      if (published) {
      }
    }
    
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 流程错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
    isFlowRunning = false; // 释放锁，允许下次执行
  }
};

const extractKeywordFromTitle = (): string => {
  const titleEl = findElement(SELECTORS.titleInput);
  if (titleEl) {
    const title = (titleEl as HTMLInputElement | HTMLTextAreaElement).value || titleEl.innerText;
    if (title && title.length > 2) {
      return title.substring(0, Math.min(title.length, 10)).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    }
  }
  return '风景';
};

const installPublishReporting = () => {
  let hasReported = false;
  let armed = false;
  let armAt = 0;

  const getCurrentTitle = (): string => {
    const titleEl = findElement(SELECTORS.titleInput);
    if (!titleEl) return '';
    return titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
      ? (titleEl.value || '').trim()
      : (titleEl.innerText || '').trim();
  };

  const findPublishedUrl = (): string | null => {
    const href = window.location.href;
    const editMatch = href.match(/https?:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)\/edit/i);
    if (editMatch?.[1]) return `https://zhuanlan.zhihu.com/p/${editMatch[1]}`;
    const publishedMatch = href.match(/https?:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)(?:$|[?#])/i);
    if (publishedMatch?.[1] && !href.includes('/edit')) return `https://zhuanlan.zhihu.com/p/${publishedMatch[1]}`;

    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const a of links) {
      const h = a.getAttribute('href') || '';
      if (!h) continue;
      let abs = '';
      try {
        abs = new URL(h, window.location.href).toString();
      } catch {
        abs = h;
      }
      const m = abs.match(/https?:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)(?:$|[?#])/i);
      if (m?.[1]) return `https://zhuanlan.zhihu.com/p/${m[1]}`;
    }
    return null;
  };

  // 清理标题,移除通知信息等额外文字
  const cleanTitle = (title: string): string => {
    if (!title) return '';
    // 移除知乎页面标题中的通知信息
    // 支持多种格式: (3 封私信 / 27 条消息)、[4 轮对话 / 45 条消息] 等
    let cleaned = title
      .replace(/[\(\[]\d+\s*[封轮].*?[\)\]]/g, '')  // 移除通知信息(支持圆括号和方括号)
      .replace(/\s*-\s*知乎.*$/g, '')  // 移除 "- 知乎" 后缀
      .trim();
    
    // 限制标题长度为100个字符(知乎标题输入框的限制)
    if (cleaned.length > 100) {
      cleaned = cleaned.substring(0, 100) + '...';
    }
    
    return cleaned;
  };

  const reportOnce = (trigger: string, publishedUrl: string) => {
    if (hasReported) return;
    hasReported = true;
    
    // 优先使用缓存的标题
    const pendingTitle = sessionStorage.getItem('memoraid_pending_title');
    let rawTitle = pendingTitle || getCurrentTitle() || document.title || '未命名文章';
    // 清理标题,移除通知等额外信息
    const finalTitle = cleanTitle(rawTitle);
    
    // 读取 token 数据
    const tokenUsageStr = sessionStorage.getItem('memoraid_token_usage');
    let tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
    if (tokenUsageStr) {
      try {
        tokenUsage = JSON.parse(tokenUsageStr);
      } catch (e) {
        console.error('[Memoraid Zhihu] 解析token数据失败:', e);
      }
    }
    
    console.log('[Memoraid Zhihu] 准备上报文章:', {
      trigger,
      url: publishedUrl,
      title: finalTitle,
      rawTitle,
      pendingTitle,
      tokenUsage
    });
    
    // 如果成功上报，清除保存的标题和token数据
    if (pendingTitle) {
      sessionStorage.removeItem('memoraid_pending_title');
    }
    if (tokenUsageStr) {
      sessionStorage.removeItem('memoraid_token_usage');
    }

    // 直接调用chrome.runtime.sendMessage,避免导入问题
    const generatedId = sessionStorage.getItem('memoraid_generated_id') || undefined;
    
    // 构建 extra 对象,包含 trigger 和 token 数据
    const extra: Record<string, unknown> = { trigger };
    if (tokenUsage) {
      extra.promptTokens = tokenUsage.promptTokens;
      extra.completionTokens = tokenUsage.completionTokens;
      extra.totalTokens = tokenUsage.totalTokens;
    }
    
    chrome.runtime.sendMessage({
      type: 'REPORT_ARTICLE_PUBLISH',
      payload: {
        platform: 'zhihu',
        title: finalTitle,
        url: publishedUrl,
        status: 'published',
        extra,
        generatedId
      }
    }).then(() => {
      console.log('[Memoraid Zhihu] 文章上报成功');
    }).catch((err: any) => {
      console.error('[Memoraid Zhihu] 文章上报失败:', err);
    });
  };

  const maybeReport = (trigger: string) => {
    if (!armed || hasReported) {
      console.log('[Memoraid Zhihu] 跳过上报:', { armed, hasReported, trigger });
      return;
    }
    const publishedUrl = findPublishedUrl();
    console.log('[Memoraid Zhihu] 查找发布URL:', { trigger, publishedUrl, currentUrl: window.location.href });
    if (publishedUrl) {
      reportOnce(trigger, publishedUrl);
    } else {
      console.log('[Memoraid Zhihu] 未找到发布URL,等待下次检测');
    }
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.('button') as HTMLElement | null;
    if (!btn) return;
    const text = (btn.innerText || '').trim();
    if (!text) return;
    console.log('[Memoraid Zhihu] 检测到按钮点击:', text);
    if (text === '发布' || text.includes('发布')) {
      console.log('[Memoraid Zhihu] 检测到发布按钮点击,启动监听');
      armed = true;
      armAt = Date.now();
      setTimeout(() => maybeReport('click:publish'), 1500);
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (hasReported) return;
    if (!armed) return;
    if (armed && Date.now() - armAt > 2 * 60 * 1000) return;
    for (const m of mutations) {
      if (m.addedNodes.length) {
        maybeReport('dom:mutation');
        if (hasReported) return;
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => {
    if (hasReported) return;
    maybeReport('page:initial_scan');
  }, 1500);
};

// ============================================
// 自动填充逻辑
// ============================================

/**
 * 检测并点击 Markdown 解析确认按钮
 * 当粘贴 Markdown 内容时，知乎会弹出一个 Notification 提示：
 * "识别到特殊格式，请确认是否 Markdown"，旁边有"确认并解析"按钮
 * 
 * 关键元素：
 * - 提示容器: <div class="css-vdqn4r Notification Notification--white ...">
 * - 确认按钮: <button class="Button css-1s3fe44 Button--link">确认并解析</button>
 * 
 * 注意：
 * 1. 这个提示会在几秒后自动消失，需要快速点击！
 * 2. 如果内容太短，可能不会显示提示，但底部会显示"Markdown 语法输入中"
 */
const handleMarkdownParse = async (): Promise<boolean> => {
  logger.log('🔍 检测 Markdown 格式解析提示...', 'info');
  
  // 首先检查是否已经在 Markdown 模式（底部显示"Markdown 语法输入中"）
  const markdownIndicator = document.evaluate(
    "//*[contains(text(), 'Markdown 语法输入中')]",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
  
  if (markdownIndicator && isElementVisible(markdownIndicator as HTMLElement)) {
    logger.log('✅ 已在 Markdown 模式（底部显示"Markdown 语法输入中"）', 'success');
    // 已经在 Markdown 模式，不需要点击确认按钮
    // 但我们仍然尝试查找并点击"确认并解析"按钮，以防有更好的渲染效果
  }
  
  // 快速检测，因为提示会自动消失
  const maxAttempts = 8;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 第一次立即检测，之后每次等待 300ms
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 方法1: 直接查找 Notification 容器内的"确认并解析"按钮（最精确）
    const notifications = document.querySelectorAll('[class*="Notification"]');
    for (const notification of notifications) {
      if (!isElementVisible(notification as HTMLElement)) continue;
      
      // 在 Notification 内查找按钮
      const btns = notification.querySelectorAll('button');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '确认并解析') {
          logger.log('在 Notification 中找到"确认并解析"按钮', 'info');
          simulateClick(btn as HTMLElement);
          await new Promise(r => setTimeout(r, 1000));
          logger.log('✅ Markdown 格式已解析', 'success');
          return true;
        }
      }
    }
    
    // 方法2: 查找 class 包含 Button--link 的"确认并解析"按钮
    const linkButtons = document.querySelectorAll('button[class*="Button--link"]');
    for (const btn of linkButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '确认并解析' && isElementVisible(btn as HTMLElement)) {
        logger.log('找到 Button--link 类型的"确认并解析"按钮', 'info');
        simulateClick(btn as HTMLElement);
        await new Promise(r => setTimeout(r, 1000));
        logger.log('✅ Markdown 格式已解析', 'success');
        return true;
      }
    }
    
    // 方法3: 查找所有包含"确认并解析"文本的按钮
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '确认并解析' && isElementVisible(btn as HTMLElement)) {
        logger.log('找到"确认并解析"按钮', 'info');
        simulateClick(btn as HTMLElement);
        await new Promise(r => setTimeout(r, 1000));
        logger.log('✅ Markdown 格式已解析', 'success');
        return true;
      }
    }
    
    if (attempt < maxAttempts) {
      logger.log(`等待 Markdown 解析提示... (${attempt}/${maxAttempts})`, 'info');
    }
  }
  
  // 如果没找到"确认并解析"按钮，但已经在 Markdown 模式，也算成功
  if (markdownIndicator) {
    logger.log('ℹ️ 未找到"确认并解析"按钮，但已在 Markdown 模式', 'info');
    return true;
  }
  
  logger.log('未检测到 Markdown 解析提示（提示可能已消失或内容不是 Markdown 格式）', 'info');
  return false;
};

/**
 * 使用 Ctrl+A 全选编辑器内容，触发 Markdown 解析
 * 根据 Playwright 录制：
 * 1. await page.getByRole('textbox').filter({ hasText: '...' }).press('ControlOrMeta+a');
 * 2. await page.locator('div').filter({ hasText: /^请输入正文$/ }).nth(1).click();
 * 3. await page.getByRole('button', { name: '确认并解析' }).nth(1).click();
 * 
 * 关键：第2步点击"请输入正文"区域可能是触发 Markdown 解析提示的关键！
 */
const selectAllAndTriggerMarkdownParse = async (editorEl: HTMLElement): Promise<void> => {
  logger.log('📝 全选内容以触发 Markdown 解析...', 'info');
  
  // 1. 先点击编辑器确保获得焦点
  editorEl.click();
  editorEl.focus();
  await new Promise(r => setTimeout(r, 300));
  
  // 2. 查找可编辑的 textbox 区域（根据 Playwright: getByRole('textbox')）
  const textboxes = document.querySelectorAll('[role="textbox"], [contenteditable="true"]');
  let targetTextbox: HTMLElement | null = null;
  
  for (const tb of textboxes) {
    if (isElementVisible(tb as HTMLElement) && (tb as HTMLElement).innerText?.length > 0) {
      targetTextbox = tb as HTMLElement;
      break;
    }
  }
  
  if (targetTextbox) {
    targetTextbox.focus();
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 3. 模拟 Ctrl+A 全选 - 使用多种方式确保生效
  const target = targetTextbox || editorEl;
  
  // 方式1: 使用 Selection API 全选
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection?.removeAllRanges();
  selection?.addRange(range);
  
  // 方式2: 发送键盘事件
  const ctrlADown = new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    which: 65,
    ctrlKey: true,
    metaKey: true, // 兼容 Mac
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(ctrlADown);
  
  await new Promise(r => setTimeout(r, 500));
  logger.log('内容已全选', 'info');
  
  // 4. 关键步骤：点击"请输入正文"区域（根据 Playwright 录制）
  // 这可能是触发 Markdown 解析提示的关键！
  logger.log('尝试点击编辑器占位符区域触发解析提示...', 'info');
  
  // 查找包含"请输入正文"文本的 div
  const allDivs = document.querySelectorAll('div');
  for (const div of allDivs) {
    const text = (div as HTMLElement).innerText?.trim();
    if (text === '请输入正文' && isElementVisible(div as HTMLElement)) {
      logger.log('找到"请输入正文"占位符，点击触发', 'action');
      simulateClick(div as HTMLElement);
      await new Promise(r => setTimeout(r, 500));
      break;
    }
  }
  
  // 5. 也尝试点击编辑器工具栏区域，可能触发解析
  const toolbar = document.querySelector('[class*="Toolbar"], [class*="toolbar"]');
  if (toolbar && isElementVisible(toolbar as HTMLElement)) {
    // 不点击工具栏，可能会触发其他操作
  }
};

const fillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_zhihu_publish');
    if (!data || !data.pending_zhihu_publish) return;
    
    const payload: PublishData = data.pending_zhihu_publish;
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_zhihu_publish');
      return;
    }
    pendingSourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string') : [];
    pendingSourceUrl = payload.sourceUrl;

    // 保存 generatedId 供发布上报使用
    if (payload.generatedId) {
      sessionStorage.setItem('memoraid_generated_id', payload.generatedId);
    } else {
      sessionStorage.removeItem('memoraid_generated_id');
    }

    // 保存 token 数据供发布上报使用
    if (payload.tokenUsage) {
      sessionStorage.setItem('memoraid_token_usage', JSON.stringify(payload.tokenUsage));
    } else {
      sessionStorage.removeItem('memoraid_token_usage');
    }

    // 保存标题，因为发布后页面可能无法获取标题输入框的值
    if (payload.title) {
      sessionStorage.setItem('memoraid_pending_title', payload.title);
    }

    // 优先使用 payload 中的 autoPublish 标识（定时任务会强制设置为 true）
    const autoPublish = payload.autoPublish !== undefined 
      ? payload.autoPublish  // 使用 payload 对象中的标识（定时任务强制为 true）
      : true;  // 默认开启自动发布

    logger.log(`📄 准备填充内容: ${payload.title}`, 'info');
    if (autoPublish) {
      logger.log('🔔 自动发布已开启', 'info');
    }
    logger.log('⏳ 等待编辑器加载...', 'info');

    let isFilling = false;
    let attempts = 0;
    const maxAttempts = 15;
    let isMarkdownContent: boolean = false; // 添加类型标记变量
    
    const tryFill = async (): Promise<boolean> => {
      if (isFilling) return false;
      isFilling = true;
      
      try {
        const titleEl = findElement(SELECTORS.titleInput);
        const editorEl = findElement(SELECTORS.editor);

        if (titleEl && editorEl) {
          // 填充标题
          const existingTitle = titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
            ? titleEl.value?.trim()
            : titleEl.innerText?.trim();
          
          if (!existingTitle || existingTitle.length === 0) {
            simulateInput(titleEl, payload.title);
            logger.log('✅ 标题已填充', 'success');
          } else {
            logger.log('ℹ️ 标题已存在，跳过填充', 'info');
          }

          // 填充正文
          editorEl.click();
          editorEl.focus();
          await new Promise(r => setTimeout(r, 300));
          
          const existingContent = editorEl.innerText?.trim();
          const hasPlaceholderOnly = existingContent === '请输入正文' || existingContent === '';
          
          if (hasPlaceholderOnly) {
            // 判断内容是否为 Markdown 格式
            const isMarkdown = !!(payload.content && (
              payload.content.includes('##') ||
              payload.content.includes('**') ||
              payload.content.includes('- ') ||
              payload.content.includes('1. ') ||
              payload.content.includes('```') ||
              payload.content.includes('> ')
            ));
            
            // 保存到外部变量
            isMarkdownContent = isMarkdown;
            
            // 如果是 Markdown，标记需要在图片处理后解析
            if (isMarkdown) {
              sessionStorage.setItem('memoraid_needs_markdown_parse', 'true');
            } else {
              sessionStorage.removeItem('memoraid_needs_markdown_parse');
            }
            
            if (isMarkdown) {
              logger.log('📝 检测到 Markdown 格式内容', 'info');
            }
            
            if (payload.htmlContent && !isMarkdown) {
              document.execCommand('insertHTML', false, payload.htmlContent);
              logger.log('✅ 内容已填充 (HTML)', 'success');
            } else {
              // 对于 Markdown 内容，先填充纯文本，不触发解析
              // 等图片处理完成后再触发 Markdown 解析
              document.execCommand('insertText', false, payload.content);
              logger.log('✅ 内容已填充 (文本)', 'success');
              
              // 不在这里触发 Markdown 解析，等图片处理完成后再解析
              if (isMarkdown) {
                logger.log('ℹ️ Markdown 解析将在图片处理后进行', 'info');
              }
            }
          } else {
            logger.log('ℹ️ 编辑器已有内容，跳过填充', 'info');
          }
          
          chrome.storage.local.remove('pending_zhihu_publish');
          
          return true;
        }
        return false;
      } finally {
        isFilling = false;
      }
    };

    const interval = setInterval(async () => {
      attempts++;
      const success = await tryFill();
      
      if (success || attempts >= maxAttempts) {
        clearInterval(interval);
        if (!success) {
          logger.log('❌ 自动填充失败：未找到编辑器', 'error');
        } else {
          // 关键修复：对于 Markdown 内容，先处理图片占位符，再触发解析
          // 这样可以避免占位符被解析成链接后无法找到
          if (isMarkdownContent) {
            logger.log('⏳ 1秒后开始智能图片处理（Markdown 解析前）...', 'info');
            setTimeout(() => runSmartImageFlow(undefined, autoPublish), 1000);
          } else {
            logger.log('⏳ 3秒后开始智能图片处理...', 'info');
            setTimeout(() => runSmartImageFlow(undefined, autoPublish), 3000);
          }
        }
      }
    }, 1000);

  } catch (error) {
    console.error('Memoraid: 知乎填充内容错误', error);
    logger.log(`❌ 填充错误: ${error}`, 'error');
  }
};

// ============================================
// 初始化
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => fillContent());
} else {
  fillContent();
}

installPublishReporting();

// 导出供外部调用
(window as any).memoraidZhihuRunImageFlow = runSmartImageFlow;
(window as any).memoraidZhihuAddTopic = addTopic;
(window as any).memoraidZhihuPublish = clickPublish;
(window as any).memoraidZhihuSubmitToQuestion = submitToQuestion; // 新增：投稿至问题

// 消息监听
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ZHIHU_INSERT_IMAGE') {
    runSmartImageFlow(message.keyword);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'ZHIHU_ADD_TOPIC') {
    addTopic(message.topic);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'ZHIHU_PUBLISH') {
    clickPublish();
    sendResponse({ success: true });
    return true;
  }
  
  // 新增：投稿至问题消息处理
  if (message.type === 'ZHIHU_SUBMIT_TO_QUESTION') {
    submitToQuestion();
    sendResponse({ success: true });
    return true;
  }
});

console.log(`
📘 Memoraid 知乎助手已加载

可用命令：
  memoraidZhihuRunImageFlow("关键词")  - 插入图片
  memoraidZhihuAddTopic("话题")        - 添加话题
  memoraidZhihuSubmitToQuestion()      - 投稿至问题（新增）
  memoraidZhihuPublish()               - 发布文章
`);
