import { reportError } from '../utils/debug';

// Zhihu Publish Content Script - 基于 Playwright 录制
// 知乎专栏发布页面自动化

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string;
  timestamp: number;
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
// DOM 工具函数
// ============================================

const findElement = (selectors: string[]): HTMLElement | null => {
  for (const selector of selectors) {
    try {
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
    } catch (e) { /* ignore */ }
  }
  return null;
};

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

const simulateClick = (element: HTMLElement) => {
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  
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
  element.click();
};

const simulateInput = (element: HTMLElement, value: string) => {
  element.focus();
  
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
  
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
};

// ============================================
// Logger UI
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

    const closeBtn = document.createElement('span');
    closeBtn.innerText = '✕';
    closeBtn.style.cssText = 'cursor:pointer;color:#888;font-size:16px;margin-left:8px;';
    closeBtn.onclick = () => {
      if (this.onStop) this.onStop();
      this.container.style.display = 'none';
    };

    controls.appendChild(this.stopBtn);
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
  await new Promise(r => setTimeout(r, 500));
  
  // 方法1: Playwright 录制的选择器 - getByRole('textbox', { name: '输入关键字查找图片' })
  let searchInput = document.querySelector('input[placeholder*="输入关键字查找图片"]') as HTMLElement;
  
  // 方法2: 部分匹配
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="输入关键字"]') as HTMLElement;
  }
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="关键字查找"]') as HTMLElement;
  }
  if (!searchInput) {
    searchInput = document.querySelector('input[placeholder*="查找图片"]') as HTMLElement;
  }
  
  // 方法3: 查找所有可见的 input 元素
  if (!searchInput) {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      const placeholder = input.getAttribute('placeholder') || '';
      if (placeholder.includes('关键') || placeholder.includes('查找') || placeholder.includes('搜索')) {
        if (isElementVisible(input as HTMLElement)) {
          searchInput = input as HTMLElement;
          logger.log(`找到搜索框 (placeholder: ${placeholder})`, 'info');
          break;
        }
      }
    }
  }
  
  // 方法4: 查找对话框内的第一个可见 input
  if (!searchInput) {
    const modal = document.querySelector('[class*="Modal"], [class*="modal"], [class*="Dialog"], [role="dialog"]');
    if (modal) {
      const inputs = modal.querySelectorAll('input');
      for (const input of inputs) {
        if (isElementVisible(input as HTMLElement)) {
          searchInput = input as HTMLElement;
          logger.log('在对话框中找到输入框', 'info');
          break;
        }
      }
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
  await new Promise(r => setTimeout(r, 300));
  
  // 根据 Playwright 录制：await page.locator('.css-13oeh20').click();
  // .css-13oeh20 是搜索确认按钮
  logger.log('查找搜索确认按钮 (.css-13oeh20)...', 'info');
  const searchConfirmBtn = document.querySelector('.css-13oeh20') as HTMLElement;
  
  if (searchConfirmBtn && isElementVisible(searchConfirmBtn)) {
    logger.log('点击搜索确认按钮 (.css-13oeh20)', 'action');
    simulateClick(searchConfirmBtn);
    await new Promise(r => setTimeout(r, 500));
  } else {
    // 备用方法：按回车键或点击搜索按钮
    const searchBtns = document.querySelectorAll('button');
    let searchBtn: HTMLElement | null = null;
    for (const btn of searchBtns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '搜索' || text?.includes('搜索')) {
        if (isElementVisible(btn as HTMLElement)) {
          searchBtn = btn as HTMLElement;
          break;
        }
      }
    }
    
    if (searchBtn) {
      logger.log('点击搜索按钮', 'action');
      simulateClick(searchBtn);
    } else {
      // 按回车键
      logger.log('按回车键搜索', 'action');
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  }
  
  logger.log('等待搜索结果...', 'info');
  await new Promise(r => setTimeout(r, 2500));
  
  return true;
};

const selectImage = async (index = 0): Promise<boolean> => {
  logger.log('选择图片...', 'info');
  await new Promise(r => setTimeout(r, 500));
  
  // 严格按照 Playwright 录制的步骤：
  // await page.locator('.css-128iodx').first().click();
  // 只点击一次 .css-128iodx 元素来选中图片
  
  const imageElements = document.querySelectorAll('.css-128iodx');
  logger.log(`找到 ${imageElements.length} 个 .css-128iodx 元素`, 'info');
  
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

// ============================================
// 主流程
// ============================================

const runSmartImageFlow = async (keyword?: string, autoPublish = false) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  logger.log('🚀 开始知乎图片处理...', 'info');
  
  try {
    const searchKeyword = keyword || extractKeywordFromTitle() || '风景';
    
    // 1. 打开图片对话框
    if (!await openImageDialog()) return;
    if (isFlowCancelled) return;
    
    // 2. 点击公共图片库（必须成功，否则无法搜索）
    const publicLibrarySuccess = await clickPublicLibrary();
    if (!publicLibrarySuccess) {
      logger.log('无法打开公共图片库，跳过图片插入', 'error');
      return;
    }
    if (isFlowCancelled) return;
    
    // 3. 搜索图片
    if (!await searchImage(searchKeyword)) return;
    if (isFlowCancelled) return;
    
    // 4. 选择图片
    if (!await selectImage(0)) return;
    if (isFlowCancelled) return;
    
    // 5. 插入图片
    if (!await clickInsertImage()) return;
    
    logger.log('✅ 图片插入完成！', 'success');
    
    // 6. 如果开启自动发布
    if (autoPublish && !isFlowCancelled) {
      logger.log('📤 自动发布文章...', 'info');
      await new Promise(r => setTimeout(r, 1000));
      await clickPublish();
    }
    
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 流程错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
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

// ============================================
// 自动填充逻辑
// ============================================

const fillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_zhihu_publish');
    if (!data || !data.pending_zhihu_publish) return;
    
    const payload: PublishData = data.pending_zhihu_publish;
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_zhihu_publish');
      return;
    }

    // 读取自动发布设置
    const settings = await chrome.storage.sync.get(['zhihu']);
    const autoPublish = settings.zhihu?.autoPublish || false;

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
          if (payload.htmlContent) {
            document.execCommand('insertHTML', false, payload.htmlContent);
            logger.log('✅ 内容已填充 (HTML)', 'success');
          } else {
            document.execCommand('insertText', false, payload.content);
            logger.log('✅ 内容已填充 (文本)', 'success');
          }
        } else {
          logger.log('ℹ️ 编辑器已有内容，跳过填充', 'info');
        }
        
        chrome.storage.local.remove('pending_zhihu_publish');
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
          setTimeout(() => runSmartImageFlow(undefined, autoPublish), 2000);
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

// 导出供外部调用
(window as any).memoraidZhihuRunImageFlow = runSmartImageFlow;
(window as any).memoraidZhihuAddTopic = addTopic;
(window as any).memoraidZhihuPublish = clickPublish;

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
});

console.log(`
📘 Memoraid 知乎助手已加载

可用命令：
  memoraidZhihuRunImageFlow("关键词")  - 插入图片
  memoraidZhihuAddTopic("话题")        - 添加话题
  memoraidZhihuPublish()               - 发布文章
`);
