import { reportError } from '../utils/debug';

// Toutiao Publish Content Script - 元素识别版
// 完全通过 DOM 选择器操作，不依赖截图和 AI 对话

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string;
  timestamp: number;
}

// ============================================
// 头条页面元素选择器配置 - 基于 Playwright 录制
// ============================================
const SELECTORS = {
  // 标题输入框 - Playwright: getByRole('textbox', { name: '请输入文章标题（2～30个字）' })
  titleInput: [
    'textarea[placeholder*="请输入文章标题"]',
    'textarea[placeholder*="2～30个字"]',
    'textarea[placeholder*="标题"]',
    '.article-title textarea',
    '.article-title-wrap textarea'
  ],
  
  // 编辑器主体 - Playwright: div:has-text("请输入正文")
  editor: [
    '.ProseMirror',
    '.syl-editor .ProseMirror',
    '[contenteditable="true"]',
    '.editor-content'
  ],
  
  // 编辑器工具栏图片按钮 - Playwright: .syl-toolbar-tool.image > div > .syl-toolbar-button
  imageToolbarButton: [
    '.syl-toolbar-tool.image > div > .syl-toolbar-button',
    '.syl-toolbar-tool.image .syl-toolbar-button',
    '.syl-toolbar-tool.image',
    '[class*="syl-toolbar-tool"][class*="image"]'
  ],
  
  // 封面添加按钮 - Playwright: .add-icon > path:nth-child(2)
  coverAddButton: [
    '.add-icon',
    '.add-icon path',
    '.article-cover-add .add-icon',
    '.article-cover-add',
    '[class*="cover"] .add-icon',
    '[class*="cover-add"]'
  ],
  
  // 抽屉遮罩层 - Playwright: .byte-drawer-mask
  drawerMask: [
    '.byte-drawer-mask'
  ],
  
  // 图片对话框/弹窗
  imageDialog: [
    '.byte-modal',
    '.byte-modal-body',
    '.byte-drawer',
    '[role="dialog"]'
  ],
  
  // 热点图库标签 - 使用热点图库（内容更丰富，免费正版图片内容太少）
  hotLibraryTab: [
    // 通过文本匹配（在代码中特殊处理）
  ],
  
  // 图库搜索框 - Playwright: getByRole('textbox', { name: '建议输入关键词组合，如：苹果 绿色' })
  librarySearchInput: [
    'input[placeholder*="建议输入关键词"]',
    'input[placeholder*="苹果 绿色"]',
    'input[placeholder*="关键词组合"]',
    '.byte-input__inner[placeholder*="关键词"]',
    '.byte-input__inner[placeholder*="搜索"]'
  ],
  
  // 搜索按钮 - Playwright 录制: .ui-search > span
  searchButton: [
    '.ui-search > span',
    '.ui-search',
    '.btn-search',
    '.search-btn',
    '[class*="btn-search"]'
  ],
  
  // 图片列表项 - Playwright 录制: .img, getByRole('listitem')
  imageItem: [
    '.img',
    'li',
    '[role="listitem"]',
    '.image-item',
    '.pic-item',
    '[class*="image-item"]',
    '[class*="pic-item"]'
  ],
  
  // 确认按钮 - Playwright: getByRole('button', { name: '确定' })
  confirmButton: [
    'button:contains("确定")',
    '.byte-btn-primary',
    '.byte-modal-footer .byte-btn-primary'
  ],
  
  // 封面区域
  coverArea: [
    '.article-cover',
    '.article-cover-wrap',
    '[class*="article-cover"]'
  ],
  
  // 关闭按钮
  closeButton: [
    '.byte-modal-close',
    '.byte-icon-close',
    '[aria-label="Close"]'
  ],
  
  // 预览并发布按钮 - Playwright: getByRole('button', { name: '预览并发布' })
  publishPreviewButton: [
    'button:contains("预览并发布")',
    '.byte-btn:contains("预览并发布")',
    '[class*="publish"] button'
  ],
  
  // 确认发布按钮 - Playwright: getByRole('button', { name: '确认发布' })
  confirmPublishButton: [
    'button:contains("确认发布")',
    '.byte-btn-primary:contains("确认发布")',
    '.byte-modal button:contains("确认发布")'
  ],
  
  // 预览按钮 - Playwright: getByRole('button', { name: '预览', exact: true })
  previewButton: [
    'button:contains("预览")'
  ]
};

// ============================================
// DOM 工具函数 - 增强版
// ============================================

/**
 * 查找元素 - 支持多种选择器
 */
const findElement = (selectors: string[]): HTMLElement | null => {
  for (const selector of selectors) {
    try {
      // 处理 :contains() 伪选择器（jQuery 风格）
      if (selector.includes(':contains(')) {
        const match = selector.match(/(.+):contains\("([^"]+)"\)/);
        if (match) {
          const [, baseSelector, text] = match;
          const elements = document.querySelectorAll(baseSelector);
          for (const el of elements) {
            if (el.textContent?.includes(text)) {
              return el as HTMLElement;
            }
          }
        }
        continue;
      }
      
      const el = document.querySelector(selector);
      if (el && isElementVisible(el as HTMLElement)) {
        return el as HTMLElement;
      }
    } catch (e) { 
      // 选择器语法错误，跳过
    }
  }
  return null;
};

/**
 * 查找所有匹配的元素
 * @internal 保留供将来使用
 */
// @ts-ignore - 保留供将来使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _findAllElements = (selectors: string[]): HTMLElement[] => {
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  
  for (const selector of selectors) {
    try {
      if (selector.includes(':contains(')) {
        const match = selector.match(/(.+):contains\("([^"]+)"\)/);
        if (match) {
          const [, baseSelector, text] = match;
          const elements = document.querySelectorAll(baseSelector);
          for (const el of elements) {
            if (el.textContent?.includes(text) && !seen.has(el as HTMLElement)) {
              seen.add(el as HTMLElement);
              results.push(el as HTMLElement);
            }
          }
        }
        continue;
      }
      
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (!seen.has(el as HTMLElement) && isElementVisible(el as HTMLElement)) {
          seen.add(el as HTMLElement);
          results.push(el as HTMLElement);
        }
      }
    } catch (e) { /* ignore */ }
  }
  return results;
};

/**
 * 检查元素是否可见
 */
const isElementVisible = (el: HTMLElement): boolean => {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
};

/**
 * 等待元素出现
 */
const waitForElement = (selectors: string[], timeout = 5000): Promise<HTMLElement | null> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const el = findElement(selectors);
      if (el) { resolve(el); return; }
      if (Date.now() - startTime > timeout) { resolve(null); return; }
      requestAnimationFrame(check);
    };
    check();
  });
};

/**
 * 等待对话框出现
 */
const waitForDialog = async (timeout = 3000): Promise<HTMLElement | null> => {
  return waitForElement(SELECTORS.imageDialog, timeout);
};

/**
 * 等待对话框关闭
 */
const waitForDialogClose = async (timeout = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const dialog = findElement(SELECTORS.imageDialog);
      if (!dialog) { resolve(true); return; }
      if (Date.now() - startTime > timeout) { resolve(false); return; }
      requestAnimationFrame(check);
    };
    check();
  });
};

/**
 * 模拟点击 - 增强版（同步执行）
 */
const simulateClick = (element: HTMLElement) => {
  // 确保元素可见
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  
  // 触发完整的鼠标事件序列
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY
  };
  
  element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  element.dispatchEvent(new MouseEvent('click', eventOptions));
  
  // 备用：直接调用 click
  element.click();
};

/**
 * 模拟输入 - 增强版
 */
const simulateInput = (element: HTMLElement, value: string) => {
  element.focus();
  
  // 清空现有内容
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
    document.execCommand('delete');
  }
  
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

  if (element instanceof HTMLInputElement && nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(element, value);
  } else {
    element.innerText = value;
  }
  
  // 触发各种输入事件
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
};

/**
 * 模拟键盘输入（逐字符）
 * @internal 保留供将来使用
 */
// @ts-ignore - 保留供将来使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _simulateTyping = async (element: HTMLElement, value: string, delay = 50): Promise<void> => {
  element.focus();
  
  for (const char of value) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value += char;
    } else {
      element.innerText += char;
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    
    await new Promise(r => setTimeout(r, delay));
  }
  
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

/**
 * 在编辑器中选中文本
 */
const selectTextInEditor = (searchText: string): boolean => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return false;

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
      node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
  }
  return false;
};

/**
 * 将光标移动到编辑器指定位置
 */
const moveCursorToPosition = (position: 'start' | 'end' | 'afterText', afterText?: string): boolean => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return false;
  
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  
  if (position === 'start') {
    range.setStart(editor, 0);
    range.collapse(true);
  } else if (position === 'end') {
    range.selectNodeContents(editor);
    range.collapse(false);
  } else if (position === 'afterText' && afterText) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes(afterText)) {
        const endIndex = node.textContent.indexOf(afterText) + afterText.length;
        range.setStart(node, endIndex);
        range.collapse(true);
        break;
      }
    }
  }
  
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
};

/**
 * 查找图片占位符
 */
const findImagePlaceholders = (): { text: string; keyword: string; position: number }[] => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return [];
  
  const content = editor.innerText || '';
  const placeholders: { text: string; keyword: string; position: number }[] = [];
  
  const patterns = [
    /\[图片[：:]\s*([^\]]+)\]/g,
    /【图片[：:]\s*([^】]+)】/g,
    /\[IMAGE[：:]\s*([^\]]+)\]/gi,
    /\{\{image[：:]\s*([^}]+)\}\}/gi,
    /\[插入图片[：:]\s*([^\]]+)\]/g,
    /\[配图[：:]\s*([^\]]+)\]/g,
    /【配图[：:]\s*([^】]+)】/g,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      placeholders.push({ 
        text: match[0], 
        keyword: match[1].trim(),
        position: match.index
      });
    }
  }
  
  // 按位置排序
  placeholders.sort((a, b) => a.position - b.position);
  return placeholders;
};

/**
 * 通过文本内容查找元素
 * @internal 保留供将来使用
 */
// @ts-ignore - 保留供将来使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _findElementByText = (text: string, tagNames: string[] = ['button', 'span', 'div', 'a']): HTMLElement | null => {
  for (const tag of tagNames) {
    const elements = document.querySelectorAll(tag);
    for (const el of elements) {
      const elText = (el as HTMLElement).innerText?.trim();
      if (elText === text || elText?.includes(text)) {
        if (isElementVisible(el as HTMLElement)) {
          return el as HTMLElement;
        }
      }
    }
  }
  return null;
};

/**
 * 在对话框内查找元素
 * @internal 保留供将来使用
 */
// @ts-ignore - 保留供将来使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _findElementInDialog = (selectors: string[]): HTMLElement | null => {
  const dialog = findElement(SELECTORS.imageDialog);
  if (!dialog) return null;
  
  for (const selector of selectors) {
    try {
      const el = dialog.querySelector(selector);
      if (el && isElementVisible(el as HTMLElement)) {
        return el as HTMLElement;
      }
    } catch (e) { /* ignore */ }
  }
  return null;
};

// ============================================
// Logger UI
// ============================================
class AILogger {
  private container: HTMLDivElement;
  private logContent: HTMLDivElement;
  private stopBtn: HTMLButtonElement;
  private onStop?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'memoraid-ai-logger';
    // 移到左上角，避免遮挡右侧的图片选择区域和确定按钮
    this.container.style.cssText = 'position:fixed;top:20px;left:20px;width:380px;max-height:500px;background:rgba(0,0,0,0.9);color:#0f0;font-family:Consolas,Monaco,monospace;font-size:12px;border-radius:8px;padding:12px;z-index:20000;display:none;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.6);border:1px solid #333;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;';
    
    const title = document.createElement('span');
    title.innerHTML = '🤖 <span style="color:#fff;font-weight:bold;">Memoraid</span> 自动化';
    
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
    if (type === 'error') { reportError(message, { type, context: 'ToutiaoContentScript' }); }
  }
}

const logger = new AILogger();

// ============================================
// 图片操作核心功能 - 元素识别版
// ============================================

let isFlowCancelled = false;

/**
 * 滚动到页面指定位置
 */
const scrollToPosition = async (position: 'top' | 'bottom' | 'element', element?: HTMLElement): Promise<void> => {
  if (position === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (position === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else if (position === 'element' && element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise(r => setTimeout(r, 500));
};

/**
 * 滚动到页面底部（封面区域）
 */
const scrollToBottom = async (): Promise<void> => {
  logger.log('滚动到页面底部...', 'info');
  await scrollToPosition('bottom');
  await new Promise(r => setTimeout(r, 500));
};

/**
 * 关闭抽屉遮罩层（如果存在）
 * Playwright: await page.locator('.byte-drawer-mask').click();
 */
const closeDrawerMask = async (): Promise<void> => {
  const mask = document.querySelector('.byte-drawer-mask') as HTMLElement;
  if (mask && isElementVisible(mask)) {
    logger.log('关闭抽屉遮罩层', 'action');
    simulateClick(mask);
    await new Promise(r => setTimeout(r, 500));
  }
};

/**
 * 通过工具栏按钮打开图片对话框（用于文章中间插入图片）
 * Playwright: .syl-toolbar-tool.image > div > .syl-toolbar-button
 */
const openImageDialogFromToolbar = async (): Promise<boolean> => {
  logger.log('查找编辑器工具栏图片按钮...', 'info');
  
  // 首先点击编辑器正文区域获得焦点
  // Playwright: await page.locator('div').filter({ hasText: /^请输入正文$/ }).click();
  const editor = findElement(SELECTORS.editor);
  if (editor) {
    logger.log('点击编辑器获得焦点', 'action');
    simulateClick(editor);
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 使用 Playwright 录制的精确选择器
  // Playwright: .syl-toolbar-tool.image > div > .syl-toolbar-button
  let imageBtn = document.querySelector('.syl-toolbar-tool.image > div > .syl-toolbar-button') as HTMLElement;
  
  // 备用方法1: 查找 .syl-toolbar-tool.image
  if (!imageBtn) {
    imageBtn = document.querySelector('.syl-toolbar-tool.image') as HTMLElement;
  }
  
  // 备用方法2: 查找包含 image 类的工具栏按钮
  if (!imageBtn) {
    const toolbarTools = document.querySelectorAll('.syl-toolbar-tool');
    for (const tool of toolbarTools) {
      if (tool.classList.contains('image')) {
        imageBtn = tool as HTMLElement;
        break;
      }
    }
  }
  
  if (!imageBtn) {
    logger.log('未找到图片工具栏按钮', 'error');
    return false;
  }
  
  logger.log('点击图片工具栏按钮', 'action');
  simulateClick(imageBtn);
  
  // 等待对话框出现
  await new Promise(r => setTimeout(r, 500));
  const dialog = await waitForDialog(3000);
  if (!dialog) {
    logger.log('图片对话框未打开', 'error');
    return false;
  }
  
  logger.log('图片对话框已打开', 'success');
  return true;
};

/**
 * 通过封面区域打开图片对话框（用于设置封面）
 * Playwright: await page.locator('.add-icon > path:nth-child(2)').click();
 */
const openImageDialogFromCover = async (): Promise<boolean> => {
  logger.log('查找封面上传区域...', 'info');
  
  // 先滚动到底部，确保封面区域可见
  await scrollToBottom();
  await new Promise(r => setTimeout(r, 500));
  
  // 关闭可能存在的抽屉遮罩
  await closeDrawerMask();
  
  // 使用 Playwright 录制的选择器: .add-icon
  let coverAddBtn = document.querySelector('.add-icon') as HTMLElement;
  
  // 备用方法：查找 .article-cover-add
  if (!coverAddBtn) {
    coverAddBtn = document.querySelector('.article-cover-add') as HTMLElement;
  }
  
  // 备用方法：在封面区域内查找 SVG 或添加按钮
  if (!coverAddBtn) {
    const coverArea = document.querySelector('.article-cover, [class*="article-cover"]');
    if (coverArea) {
      coverAddBtn = coverArea.querySelector('.add-icon, svg, [class*="add"]') as HTMLElement;
    }
  }
  
  if (!coverAddBtn) {
    logger.log('未找到封面上传入口', 'error');
    return false;
  }
  
  logger.log('点击封面添加图标', 'action');
  simulateClick(coverAddBtn);
  
  // 等待对话框出现
  await new Promise(r => setTimeout(r, 500));
  const dialog = await waitForDialog(3000);
  if (!dialog) {
    logger.log('封面图片对话框未打开', 'error');
    return false;
  }
  
  logger.log('封面图片对话框已打开', 'success');
  return true;
};

/**
 * 切换到热点图库标签（内容更丰富）
 * 注意：不使用"免费正版图片"，因为内容太少
 */
const switchToHotLibrary = async (): Promise<boolean> => {
  await new Promise(r => setTimeout(r, 500));
  logger.log('查找热点图库标签...', 'info');
  
  // 方法1: 直接通过文本内容查找（模拟 Playwright 的 getByText）
  const allElements = document.querySelectorAll('*');
  let hotTab: HTMLElement | null = null;
  
  for (const el of allElements) {
    const text = (el as HTMLElement).innerText?.trim();
    // 精确匹配 "热点图库"
    if (text === '热点图库') {
      // 确保是可点击的元素（不是父容器）
      const children = el.children;
      let hasTextChild = false;
      for (const child of children) {
        if ((child as HTMLElement).innerText?.trim() === '热点图库') {
          hasTextChild = true;
          break;
        }
      }
      if (!hasTextChild && isElementVisible(el as HTMLElement)) {
        hotTab = el as HTMLElement;
        logger.log('找到热点图库标签 (精确匹配)', 'success');
        break;
      }
    }
  }
  
  // 方法2: 查找标签页容器中的元素
  if (!hotTab) {
    const dialog = findElement(SELECTORS.imageDialog);
    const searchContainer = dialog || document;
    const tabs = searchContainer.querySelectorAll(
      '.byte-tabs-header-title, .byte-tabs-item, [role="tab"], [class*="tab"]'
    );
    
    for (const tab of tabs) {
      const text = (tab.textContent || '').trim();
      if (text.includes('热点图库')) {
        hotTab = tab as HTMLElement;
        logger.log(`找到热点图库标签: "${text}"`, 'success');
        break;
      }
    }
  }
  
  if (!hotTab) {
    logger.log('未找到热点图库标签', 'warn');
    return false;
  }
  
  // 检查是否已经选中
  const isActive = hotTab.classList.contains('byte-tabs-header-title-active') ||
                   hotTab.classList.contains('active') ||
                   hotTab.getAttribute('aria-selected') === 'true';
  
  if (isActive) {
    logger.log('热点图库标签已选中', 'info');
    return true;
  }
  
  logger.log('切换到热点图库', 'action');
  simulateClick(hotTab);
  await new Promise(r => setTimeout(r, 1000));
  return true;
};

/**
 * 在图库中搜索图片
 * Playwright 录制: 
 *   await page.getByRole('textbox', { name: '建议输入关键词组合，如：苹果 绿色' }).click();
 *   await page.getByRole('textbox', { name: '建议输入关键词组合，如：苹果 绿色' }).fill('富士山');
 *   await page.locator('.ui-search > span').click();
 */
const searchInLibrary = async (keyword: string): Promise<boolean> => {
  logger.log(`搜索关键词: "${keyword}"`, 'info');
  
  // 使用 Playwright 录制的选择器查找搜索框
  // 通过 placeholder 属性查找
  let searchInput = document.querySelector('input[placeholder*="建议输入关键词"]') as HTMLElement;
  
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="苹果 绿色"]') as HTMLElement;
  }
  
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="关键词组合"]') as HTMLElement;
  }
  
  // 备用方法：在对话框内查找输入框
  if (!searchInput) {
    const dialog = findElement(SELECTORS.imageDialog);
    if (dialog) {
      const inputs = dialog.querySelectorAll('input[type="text"], input:not([type]), .byte-input__inner');
      for (const input of inputs) {
        if (isElementVisible(input as HTMLElement)) {
          searchInput = input as HTMLElement;
          break;
        }
      }
    }
  }
  
  if (!searchInput) {
    logger.log('未找到搜索框', 'error');
    return false;
  }
  
  // 点击搜索框
  logger.log('点击搜索框', 'action');
  simulateClick(searchInput);
  await new Promise(r => setTimeout(r, 200));
  
  // 清空并输入关键词
  logger.log('输入搜索关键词', 'action');
  searchInput.focus();
  
  if (searchInput instanceof HTMLInputElement) {
    searchInput.value = '';
    searchInput.value = keyword;
  }
  
  // 触发输入事件
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  
  // 点击搜索按钮 - Playwright 录制: .ui-search > span
  let searchBtn = document.querySelector('.ui-search > span') as HTMLElement;
  
  // 备用选择器
  if (!searchBtn) {
    searchBtn = document.querySelector('.ui-search') as HTMLElement;
  }
  if (!searchBtn) {
    searchBtn = document.querySelector('.btn-search') as HTMLElement;
  }
  if (!searchBtn) {
    searchBtn = document.querySelector('[class*="search"] button, [class*="search"] span') as HTMLElement;
  }
  
  if (searchBtn) {
    logger.log('点击搜索按钮', 'action');
    simulateClick(searchBtn);
  } else {
    // 备用：按回车键
    logger.log('按回车键搜索', 'action');
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  
  logger.log('等待搜索结果...', 'info');
  await new Promise(r => setTimeout(r, 2000));
  return true;
};

/**
 * 选择图片（支持选择第N张）
 * 
 * 热点图库的选择流程（两步）：
 * 1. 搜索后显示图片列表（左侧搜索结果，每个是一组图片 li.item）
 * 2. 点击图片组后，右侧会展示该组的子图片列表
 * 3. 点击右侧子图片列表中的图片 → 确认按钮出现
 * 
 * 关键：左侧 li.item 有标题文字，右侧子图片 li 是空文本的
 * 
 * Playwright 录制: 
 *   await page.locator('.img').first().click();  // 第一次点击：选择图片组（左侧）
 *   await page.getByRole('listitem').filter({ hasText: /^$/ }).first().click();  // 第二次点击：选择具体图片（右侧，空文本）
 */
const selectImage = async (index = 0): Promise<boolean> => {
  logger.log(`查找图片列表，准备选择第 ${index + 1} 张...`, 'info');
  await new Promise(r => setTimeout(r, 500));
  
  const dialog = findElement(SELECTORS.imageDialog);
  const searchContainer = dialog || document;
  
  // ========== 第一步: 点击左侧 .img 选择图片组 ==========
  let imgElements = Array.from(searchContainer.querySelectorAll('.img'))
    .filter(el => isElementVisible(el as HTMLElement));
  
  logger.log(`通过 .img 找到 ${imgElements.length} 个图片组`, 'info');
  
  if (imgElements.length === 0) {
    logger.log('未找到可选择的图片', 'error');
    return false;
  }
  
  // 选择指定索引的图片组
  const targetIndex = Math.min(index, imgElements.length - 1);
  const targetImage = imgElements[targetIndex] as HTMLElement;
  
  logger.log(`点击第 ${targetIndex + 1} 个图片组（左侧）`, 'action');
  targetImage.click();
  
  // 等待右侧图片列表展示
  logger.log('等待右侧子图片列表展示...', 'info');
  await new Promise(r => setTimeout(r, 1500));
  
  // ========== 第二步: 在右侧子图片列表中选择具体图片 ==========
  // 关键：右侧子图片是空文本的 li 元素（没有标题）
  // Playwright: getByRole('listitem').filter({ hasText: /^$/ })
  logger.log('查找右侧子图片列表（空文本的 li）...', 'info');
  
  // 重新获取对话框
  const updatedDialog = findElement(SELECTORS.imageDialog);
  const updatedContainer = updatedDialog || document;
  
  // 查找所有 li 元素
  const allLiElements = updatedContainer.querySelectorAll('li');
  logger.log(`找到 ${allLiElements.length} 个 li 元素`, 'info');
  
  // 筛选出空文本的 li（右侧子图片）
  const emptyTextLiElements: HTMLElement[] = [];
  const hasTextLiElements: HTMLElement[] = [];
  
  for (const li of allLiElements) {
    const el = li as HTMLElement;
    if (!isElementVisible(el)) continue;
    
    const text = el.innerText?.trim() || '';
    if (text === '') {
      emptyTextLiElements.push(el);
    } else {
      hasTextLiElements.push(el);
    }
  }
  
  logger.log(`空文本 li: ${emptyTextLiElements.length} 个, 有文本 li: ${hasTextLiElements.length} 个`, 'info');
  
  // 优先点击空文本的 li（右侧子图片）
  if (emptyTextLiElements.length > 0) {
    const selectedImage = emptyTextLiElements[0];
    logger.log(`点击右侧子图片（空文本 li）: ${selectedImage.className}`, 'action');
    selectedImage.click();
    
    // 等待选中状态更新
    await new Promise(r => setTimeout(r, 1000));
    logger.log('图片已选中，等待确认按钮出现...', 'info');
  } else {
    // 备用方案：查找未选中的 li.item
    logger.log('未找到空文本 li，尝试查找未选中的 li.item...', 'warn');
    
    const allListItems = updatedContainer.querySelectorAll('li.item');
    for (const item of allListItems) {
      const el = item as HTMLElement;
      if (isElementVisible(el) && !el.classList.contains('select')) {
        logger.log(`点击未选中的 li.item: ${el.className}`, 'action');
        el.click();
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }
  }
  
  return true;
};

/**
 * 点击确认按钮
 * Playwright: await page.getByRole('button', { name: '确定' }).click();
 * 注意：确认按钮只有在图片被选中后才会出现/可用
 */
const clickConfirmButton = async (): Promise<boolean> => {
  logger.log('查找确认按钮...', 'info');
  
  // 等待确认按钮出现（最多等待 3 秒，每 500ms 检查一次）
  let confirmBtn: HTMLElement | null = null;
  const maxAttempts = 6;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    
    // 方法1: 直接查找所有按钮，找文本为"确定"的
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '确定' && isElementVisible(btn as HTMLElement)) {
        // 检查按钮是否可用（不是禁用状态）
        const isDisabled = btn.hasAttribute('disabled') ||
                           btn.classList.contains('byte-btn-disabled') ||
                           btn.classList.contains('disabled');
        if (!isDisabled) {
          confirmBtn = btn as HTMLElement;
          logger.log(`找到确定按钮 (尝试 ${attempt + 1}/${maxAttempts})`, 'success');
          break;
        }
      }
    }
    
    if (confirmBtn) break;
    
    // 方法2: 查找 .byte-btn-primary 按钮
    if (!confirmBtn) {
      const primaryBtns = document.querySelectorAll('.byte-btn-primary');
      for (const btn of primaryBtns) {
        const text = (btn as HTMLElement).innerText?.trim();
        if ((text === '确定' || text.includes('确定')) && isElementVisible(btn as HTMLElement)) {
          const isDisabled = btn.hasAttribute('disabled') ||
                             btn.classList.contains('byte-btn-disabled');
          if (!isDisabled) {
            confirmBtn = btn as HTMLElement;
            logger.log(`找到确定按钮 (.byte-btn-primary, 尝试 ${attempt + 1})`, 'success');
            break;
          }
        }
      }
    }
    
    if (confirmBtn) break;
    
    if (attempt < maxAttempts - 1) {
      logger.log(`等待确认按钮出现... (${attempt + 1}/${maxAttempts})`, 'info');
    }
  }
  
  if (!confirmBtn) {
    logger.log('未找到可用的确认按钮', 'error');
    return false;
  }
  
  logger.log('点击确定按钮', 'action');
  simulateClick(confirmBtn);
  await new Promise(r => setTimeout(r, 1000));
  
  // 等待对话框关闭
  const closed = await waitForDialogClose(3000);
  if (closed) {
    logger.log('对话框已关闭', 'success');
  }
  
  return true;
};

/**
 * 关闭当前对话框
 */
const closeDialog = async (): Promise<void> => {
  const closeBtn = findElement(SELECTORS.closeButton);
  if (closeBtn) {
    simulateClick(closeBtn);
    await new Promise(r => setTimeout(r, 500));
  } else {
    // 尝试按 ESC 键
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
  }
};

// 导出 closeDialog 供外部使用
(window as any).memoraidCloseDialog = closeDialog;

/**
 * 完整的图片搜索和选择流程
 * 基于 Playwright 录制的操作顺序
 */
const searchAndSelectImage = async (keyword: string, imageIndex = 0): Promise<boolean> => {
  // 1. 切换到热点图库（内容更丰富）
  if (!await switchToHotLibrary()) {
    logger.log('切换热点图库失败，尝试继续...', 'warn');
  }
  if (isFlowCancelled) return false;
  
  // 2. 搜索图片
  if (!await searchInLibrary(keyword)) return false;
  if (isFlowCancelled) return false;
  
  // 3. 选择图片
  if (!await selectImage(imageIndex)) return false;
  if (isFlowCancelled) return false;
  
  // 4. 确认插入
  if (!await clickConfirmButton()) return false;
  
  return true;
};

/**
 * 点击搜索建议/热词
 * Playwright: await page.getByText('富士山樱花').click();
 */
const clickSearchSuggestion = async (suggestionText: string): Promise<boolean> => {
  logger.log(`查找搜索建议: "${suggestionText}"`, 'info');
  
  // 查找包含指定文本的元素
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = (el as HTMLElement).innerText?.trim();
    if (text === suggestionText && isElementVisible(el as HTMLElement)) {
      // 确保不是父容器
      const children = el.children;
      let hasTextChild = false;
      for (const child of children) {
        if ((child as HTMLElement).innerText?.trim() === suggestionText) {
          hasTextChild = true;
          break;
        }
      }
      if (!hasTextChild) {
        logger.log(`点击搜索建议: "${suggestionText}"`, 'action');
        simulateClick(el as HTMLElement);
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    }
  }
  
  logger.log(`未找到搜索建议: "${suggestionText}"`, 'warn');
  return false;
};

/**
 * 带搜索建议的图片搜索和选择流程
 */
const searchAndSelectImageWithSuggestion = async (
  keyword: string, 
  suggestion?: string, 
  imageIndex = 0
): Promise<boolean> => {
  // 1. 切换到热点图库（内容更丰富）
  if (!await switchToHotLibrary()) {
    logger.log('切换热点图库失败，尝试继续...', 'warn');
  }
  if (isFlowCancelled) return false;
  
  // 2. 输入搜索关键词
  logger.log(`搜索关键词: "${keyword}"`, 'info');
  
  let searchInput = document.querySelector('input[placeholder*="建议输入关键词"]') as HTMLElement;
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="苹果 绿色"]') as HTMLElement;
  }
  
  if (searchInput) {
    simulateClick(searchInput);
    await new Promise(r => setTimeout(r, 200));
    
    if (searchInput instanceof HTMLInputElement) {
      searchInput.value = keyword;
    }
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    
    // 3. 如果有搜索建议，点击建议
    if (suggestion) {
      const clicked = await clickSearchSuggestion(suggestion);
      if (clicked) {
        await new Promise(r => setTimeout(r, 1500));
      } else {
        // 没找到建议，点击搜索按钮
        const searchBtn = document.querySelector('.btn-search') as HTMLElement;
        if (searchBtn) {
          simulateClick(searchBtn);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } else {
      // 没有建议，直接点击搜索按钮
      const searchBtn = document.querySelector('.btn-search') as HTMLElement;
      if (searchBtn) {
        simulateClick(searchBtn);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  if (isFlowCancelled) return false;
  
  // 4. 选择图片
  if (!await selectImage(imageIndex)) return false;
  if (isFlowCancelled) return false;
  
  // 5. 确认插入
  if (!await clickConfirmButton()) return false;
  
  return true;
};

/**
 * 插入图片到文章中间（通过工具栏）
 */
const insertInlineImage = async (keyword: string, afterText?: string): Promise<boolean> => {
  if (isFlowCancelled) return false;
  
  logger.log(`准备插入文章配图: "${keyword}"`, 'info');
  
  // 如果指定了位置，先移动光标
  if (afterText) {
    logger.log(`定位到文本: "${afterText}"`, 'info');
    if (!moveCursorToPosition('afterText', afterText)) {
      logger.log('未找到指定位置，将在当前位置插入', 'warn');
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 通过工具栏打开图片对话框
  if (!await openImageDialogFromToolbar()) {
    logger.log('无法通过工具栏打开图片对话框', 'error');
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 搜索并选择图片
  const success = await searchAndSelectImage(keyword);
  
  if (success) {
    logger.log(`文章配图 "${keyword}" 插入成功`, 'success');
  }
  
  return success;
};

/**
 * 替换图片占位符为实际图片
 */
const insertImageAtPlaceholder = async (placeholder: { text: string; keyword: string }): Promise<boolean> => {
  if (isFlowCancelled) return false;
  
  logger.log(`处理占位符: ${placeholder.text}`, 'info');
  
  // 选中占位符文本
  if (!selectTextInEditor(placeholder.text)) {
    logger.log(`未找到占位符文本: ${placeholder.text}`, 'warn');
    return false;
  }
  
  // 删除占位符
  document.execCommand('delete');
  await new Promise(r => setTimeout(r, 300));
  
  // 通过工具栏插入图片
  if (!await openImageDialogFromToolbar()) {
    logger.log('无法打开图片对话框', 'error');
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 搜索并选择图片
  const success = await searchAndSelectImage(placeholder.keyword);
  
  if (success) {
    logger.log(`占位符 "${placeholder.text}" 已替换为图片`, 'success');
  }
  
  return success;
};

/**
 * 设置封面图片
 */
const setCoverImage = async (keyword: string): Promise<boolean> => {
  logger.log(`设置封面图片: "${keyword}"`, 'info');
  
  // 通过封面区域打开图片对话框
  if (!await openImageDialogFromCover()) {
    logger.log('无法打开封面图片对话框', 'error');
    return false;
  }
  if (isFlowCancelled) return false;
  
  // 搜索并选择图片
  const success = await searchAndSelectImage(keyword);
  
  if (success) {
    logger.log('封面设置成功', 'success');
  }
  
  return success;
};

/**
 * 批量替换所有图片占位符
 */
const replaceAllImagePlaceholders = async (): Promise<number> => {
  const placeholders = findImagePlaceholders();
  if (placeholders.length === 0) {
    logger.log('未找到图片占位符', 'info');
    return 0;
  }
  
  logger.log(`找到 ${placeholders.length} 个图片占位符`, 'info');
  
  let successCount = 0;
  
  for (const placeholder of placeholders) {
    if (isFlowCancelled) break;
    
    const success = await insertImageAtPlaceholder(placeholder);
    if (success) {
      successCount++;
    }
    
    // 等待一下再处理下一个
    await new Promise(r => setTimeout(r, 1000));
  }
  
  logger.log(`成功替换 ${successCount}/${placeholders.length} 个占位符`, 'info');
  return successCount;
};

/**
 * 点击"预览并发布"按钮
 * Playwright: await page.getByRole('button', { name: '预览并发布' }).click();
 */
const clickPublishPreviewButton = async (): Promise<boolean> => {
  logger.log('查找"预览并发布"按钮...', 'info');
  
  // 方法1: 通过文本内容查找按钮
  const allButtons = document.querySelectorAll('button');
  let publishBtn: HTMLElement | null = null;
  
  for (const btn of allButtons) {
    const text = (btn as HTMLElement).innerText?.trim();
    if (text === '预览并发布' && isElementVisible(btn as HTMLElement)) {
      publishBtn = btn as HTMLElement;
      break;
    }
  }
  
  // 方法2: 查找包含"预览并发布"文本的按钮
  if (!publishBtn) {
    for (const btn of allButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text?.includes('预览并发布') && isElementVisible(btn as HTMLElement)) {
        publishBtn = btn as HTMLElement;
        break;
      }
    }
  }
  
  if (!publishBtn) {
    logger.log('未找到"预览并发布"按钮', 'error');
    return false;
  }
  
  logger.log('点击"预览并发布"按钮', 'action');
  simulateClick(publishBtn);
  await new Promise(r => setTimeout(r, 2000));
  
  return true;
};

/**
 * 点击"确认发布"按钮
 * Playwright: await page.getByRole('button', { name: '确认发布' }).click();
 */
const clickConfirmPublishButton = async (): Promise<boolean> => {
  logger.log('查找"确认发布"按钮...', 'info');
  
  // 等待确认对话框出现
  await new Promise(r => setTimeout(r, 1000));
  
  // 方法1: 通过文本内容查找按钮
  const allButtons = document.querySelectorAll('button');
  let confirmBtn: HTMLElement | null = null;
  
  for (const btn of allButtons) {
    const text = (btn as HTMLElement).innerText?.trim();
    if (text === '确认发布' && isElementVisible(btn as HTMLElement)) {
      confirmBtn = btn as HTMLElement;
      break;
    }
  }
  
  // 方法2: 在模态框中查找
  if (!confirmBtn) {
    const modal = document.querySelector('.byte-modal, [role="dialog"]');
    if (modal) {
      const modalButtons = modal.querySelectorAll('button');
      for (const btn of modalButtons) {
        const text = (btn as HTMLElement).innerText?.trim();
        if (text === '确认发布' || text?.includes('确认发布')) {
          confirmBtn = btn as HTMLElement;
          break;
        }
      }
    }
  }
  
  if (!confirmBtn) {
    logger.log('未找到"确认发布"按钮', 'error');
    return false;
  }
  
  logger.log('点击"确认发布"按钮', 'action');
  simulateClick(confirmBtn);
  await new Promise(r => setTimeout(r, 2000));
  
  logger.log('✅ 文章已发布！', 'success');
  return true;
};

/**
 * 自动发布文章（点击预览并发布 -> 确认发布）
 */
const autoPublishArticle = async (): Promise<boolean> => {
  logger.log('🚀 开始自动发布流程...', 'info');
  
  // 第一步：点击"预览并发布"
  if (!await clickPublishPreviewButton()) {
    logger.log('自动发布失败：无法点击预览并发布按钮', 'error');
    return false;
  }
  
  // 第二步：点击"确认发布"
  if (!await clickConfirmPublishButton()) {
    logger.log('自动发布失败：无法点击确认发布按钮', 'error');
    return false;
  }
  
  return true;
};

/**
 * 检查封面是否已设置
 */
const isCoverSet = (): boolean => {
  const coverArea = findElement(SELECTORS.coverArea);
  if (!coverArea) return true; // 找不到封面区域，假设已设置
  
  // 检查是否有图片
  const hasImage = coverArea.querySelector('img') !== null;
  
  // 检查是否有添加按钮（如果有添加按钮，说明还没设置）
  const hasAddButton = coverArea.querySelector('[class*="add"]') !== null ||
                       coverArea.querySelector('svg') !== null;
  
  return hasImage && !hasAddButton;
};

/**
 * 从文章内容提取关键词（用于封面图搜索）
 */
const extractKeywordsFromContent = (): string => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return '风景';
  
  const content = editor.innerText || '';
  
  // 简单的关键词提取：取标题或前几个词
  const titleEl = findElement(SELECTORS.titleInput);
  if (titleEl) {
    const title = (titleEl as HTMLInputElement | HTMLTextAreaElement).value || titleEl.innerText;
    if (title && title.length > 2) {
      // 取标题的前几个字作为关键词
      return title.substring(0, Math.min(title.length, 10)).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    }
  }
  
  // 从内容中提取
  const words = content.substring(0, 200).split(/[\s，。！？、；：""''（）【】\n]+/).filter(w => w.length >= 2);
  if (words.length > 0) {
    return words[0];
  }
  
  return '风景';
};

// ============================================
// AI 辅助功能（仅在必要时使用，作为备用）
// ============================================

/**
 * AI 分析文章内容，建议图片
 * @internal 保留供将来使用
 */
// @ts-ignore - 保留供将来使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _analyzeArticleForImages = async (): Promise<{ type: 'cover' | 'inline'; keyword: string; context?: string }[]> => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return [];
  
  const content = editor.innerText || '';
  if (content.length < 50) { 
    logger.log('文章内容太短，跳过 AI 分析', 'warn'); 
    return []; 
  }
  
  logger.log('使用 AI 分析文章内容（备用方案）...', 'info');
  
  const prompt = `分析以下文章内容，建议需要插入的图片。

文章内容：
${content.substring(0, 3000)}

请返回 JSON 数组，格式如下：
[
  { "type": "cover", "keyword": "封面图搜索关键词" },
  { "type": "inline", "keyword": "配图搜索关键词", "context": "图片应该插入在哪段文字附近（10字以内）" }
]

要求：
1. keyword 必须是中文
2. 最多建议 3 张图片
3. 只返回 JSON，不要其他内容`;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_SCREENSHOT', payload: { prompt } });
    if (response.success && response.result) {
      const jsonMatch = response.result.match(/\[[\s\S]*\]/);
      if (jsonMatch) { return JSON.parse(jsonMatch[0]); }
    }
  } catch (e) { 
    logger.log(`AI 分析失败: ${e}`, 'error'); 
  }
  return [];
};

// ============================================
// 主流程 - 智能图片处理
// ============================================

const runSmartImageFlow = async (autoPublish = false) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  logger.log('🚀 开始智能图片处理（元素识别模式）...', 'info');
  
  try {
    // 1. 首先处理已有的图片占位符
    logger.log('📝 步骤1: 检查图片占位符...', 'info');
    await replaceAllImagePlaceholders();
    
    if (isFlowCancelled) { 
      logger.log('流程已取消', 'warn'); 
      return; 
    }
    
    // 2. 检查是否需要设置封面
    logger.log('🖼️ 步骤2: 检查封面设置...', 'info');
    await scrollToBottom();
    
    if (!isCoverSet()) {
      logger.log('检测到需要设置封面', 'info');
      
      // 尝试从文章内容提取关键词
      let coverKeyword = extractKeywordsFromContent();
      logger.log(`使用关键词: "${coverKeyword}"`, 'info');
      
      // 如果关键词太短或无效，使用默认值
      if (!coverKeyword || coverKeyword.length < 2) {
        coverKeyword = '风景';
      }
      
      await setCoverImage(coverKeyword);
    } else {
      logger.log('封面已存在，跳过', 'info');
    }
    
    logger.log('✅ 图片处理完成！', 'success');
    
    // 3. 如果开启了自动发布，执行发布流程
    if (autoPublish && !isFlowCancelled) {
      logger.log('📤 步骤3: 自动发布文章...', 'info');
      await new Promise(r => setTimeout(r, 1000)); // 等待页面稳定
      await autoPublishArticle();
    }
    
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 流程错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
  }
};

/**
 * 手动插入封面图片
 */
const manualInsertCover = async (keyword?: string) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  
  const searchKeyword = keyword || extractKeywordsFromContent() || '风景';
  logger.log(`🖼️ 手动插入封面: "${searchKeyword}"`, 'info');
  
  try {
    await setCoverImage(searchKeyword);
    logger.log('✅ 封面插入完成', 'success');
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
  }
};

/**
 * 手动插入文章配图
 */
const manualInsertInlineImage = async (keyword: string, afterText?: string) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  
  logger.log(`📷 手动插入配图: "${keyword}"`, 'info');
  
  try {
    await insertInlineImage(keyword, afterText);
    logger.log('✅ 配图插入完成', 'success');
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
  }
};

/**
 * 调试：打印页面元素信息
 */
const debugPageElements = () => {
  logger.clear();
  logger.show();
  logger.log('🔍 调试：页面元素分析', 'info');
  
  // 检查编辑器
  const editor = findElement(SELECTORS.editor);
  logger.log(`编辑器: ${editor ? '✅ 找到' : '❌ 未找到'}`, editor ? 'success' : 'error');
  
  // 检查标题
  const title = findElement(SELECTORS.titleInput);
  logger.log(`标题输入框: ${title ? '✅ 找到' : '❌ 未找到'}`, title ? 'success' : 'error');
  
  // 检查工具栏
  const toolbar = document.querySelector('.syl-toolbar, [class*="toolbar"]');
  logger.log(`工具栏: ${toolbar ? '✅ 找到' : '❌ 未找到'}`, toolbar ? 'success' : 'error');
  
  // 检查工具栏按钮
  const toolbarButtons = document.querySelectorAll('.syl-toolbar-tool, [class*="toolbar"] button');
  logger.log(`工具栏按钮数量: ${toolbarButtons.length}`, 'info');
  
  // 列出工具栏按钮
  toolbarButtons.forEach((btn, i) => {
    const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || btn.getAttribute('data-name') || '';
    logger.log(`  按钮${i}: ${title || '(无标题)'}`, 'info');
  });
  
  // 检查封面区域
  const coverArea = findElement(SELECTORS.coverArea);
  logger.log(`封面区域: ${coverArea ? '✅ 找到' : '❌ 未找到'}`, coverArea ? 'success' : 'error');
  
  // 检查封面状态
  if (coverArea) {
    const hasCover = isCoverSet();
    logger.log(`封面状态: ${hasCover ? '已设置' : '未设置'}`, 'info');
  }
  
  // 检查图片占位符
  const placeholders = findImagePlaceholders();
  logger.log(`图片占位符数量: ${placeholders.length}`, 'info');
  placeholders.forEach((p, i) => {
    logger.log(`  占位符${i}: ${p.text} -> "${p.keyword}"`, 'info');
  });
};

// ============================================
// 自动填充逻辑
// ============================================

const fillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_toutiao_publish');
    if (!data || !data.pending_toutiao_publish) return;
    
    const payload: PublishData = data.pending_toutiao_publish;
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_toutiao_publish');
      return;
    }

    // 读取自动发布设置
    const settings = await chrome.storage.sync.get(['toutiao']);
    const autoPublish = settings.toutiao?.autoPublish || false;

    logger.log(`📄 准备填充内容: ${payload.title}`, 'info');
    if (autoPublish) {
      logger.log('🔔 自动发布已开启', 'info');
    }
    logger.log('⏳ 等待编辑器加载...', 'info');

    let attempts = 0;
    const maxAttempts = 15;
    
    const tryFill = async (): Promise<boolean> => {
      const titleEl = findElement(SELECTORS.titleInput);
      const editorEl = findElement(SELECTORS.editor);

      if (titleEl && editorEl) {
        // 检查标题是否已存在（不为空）
        const existingTitle = titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
          ? titleEl.value?.trim()
          : titleEl.innerText?.trim();
        
        if (!existingTitle || existingTitle.length === 0) {
          // 只有在标题为空时才填充
          simulateInput(titleEl, payload.title);
          logger.log('✅ 标题已填充', 'success');
        } else {
          logger.log(`ℹ️ 标题已存在: "${existingTitle}"，跳过填充`, 'info');
        }

        editorEl.click();
        editorEl.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // 检查编辑器是否已有内容
        const existingContent = editorEl.innerText?.trim();
        const hasPlaceholderOnly = existingContent === '请输入正文' || existingContent === '';
        
        if (hasPlaceholderOnly) {
          if (payload.htmlContent) {
            document.execCommand('insertHTML', false, payload.htmlContent);
            logger.log('✅ 内容已填充 (HTML)', 'success');
          } else {
            document.execCommand('insertText', false, payload.content);
            logger.log('✅ 内容已填充 (文本)', 'success');
          }
        } else {
          logger.log(`ℹ️ 编辑器已有内容，跳过填充`, 'info');
        }
        
        chrome.storage.local.remove('pending_toutiao_publish');
        return true;
      }
      return false;
    };

    const interval = setInterval(async () => {
      attempts++;
      const success = await tryFill();
      
      if (success || attempts >= maxAttempts) {
        clearInterval(interval);
        if (!success) {
          logger.log('❌ 自动填充失败：未找到编辑器', 'error');
        } else {
          logger.log('⏳ 2秒后开始智能图片处理...', 'info');
          setTimeout(() => runSmartImageFlow(autoPublish), 2000);
        }
      }
    }, 1000);

  } catch (error) {
    console.error('Memoraid: 填充内容错误', error);
    logger.log(`❌ 填充错误: ${error}`, 'error');
  }
};

// ============================================
// 初始化和导出
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => fillContent());
} else {
  fillContent();
}

// 导出供外部调用的函数
(window as any).memoraidRunImageFlow = runSmartImageFlow;
(window as any).memoraidInsertCover = manualInsertCover;
(window as any).memoraidInsertInlineImage = manualInsertInlineImage;
(window as any).memoraidDebugElements = debugPageElements;
(window as any).memoraidCloseDialog = closeDialog;
(window as any).memoraidCloseDrawerMask = closeDrawerMask;
(window as any).memoraidSearchAndSelect = searchAndSelectImageWithSuggestion;

// 导出供消息通信使用
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TOUTIAO_INSERT_COVER') {
    manualInsertCover(message.keyword);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'TOUTIAO_INSERT_INLINE_IMAGE') {
    manualInsertInlineImage(message.keyword, message.afterText);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'TOUTIAO_RUN_IMAGE_FLOW') {
    runSmartImageFlow();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'TOUTIAO_DEBUG') {
    debugPageElements();
    sendResponse({ success: true });
    return true;
  }
});

// 控制台使用说明
console.log(`
🤖 Memoraid 头条图片助手已加载（元素识别模式 v2）
   基于 Playwright 录制的精确选择器

可用命令：
  memoraidRunImageFlow()           - 运行智能图片处理流程
  memoraidInsertCover('关键词')     - 手动插入封面图片
  memoraidInsertInlineImage('关键词')  - 手动插入文章配图
  memoraidDebugElements()          - 调试：显示页面元素信息
  memoraidCloseDialog()            - 关闭当前对话框
  memoraidCloseDrawerMask()        - 关闭抽屉遮罩层

高级命令：
  memoraidSearchAndSelect('关键词', '搜索建议', 图片索引)
    - 例: memoraidSearchAndSelect('富士山', '富士山樱花', 2)
    - 搜索"富士山"，点击建议"富士山樱花"，选择第3张图片

图片占位符格式（在文章中使用）：
  [图片: 关键词]  - 关键词要简短，2-4个字最佳
  【图片: 关键词】
  [配图: 关键词]

操作流程（基于 Playwright 录制）：
  1. 封面图片: .add-icon → 热点图库 → 搜索 → 选择 → 确定
  2. 文章配图: .syl-toolbar-tool.image → 热点图库 → 搜索 → 选择 → 确定
`);
