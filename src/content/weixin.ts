import { reportError } from '../utils/debug';

// WeChat Official Account Publish Content Script
// 微信公众号发布页面自动化 - 基于 Playwright 录制

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string;
  timestamp: number;
}

// ============================================
// 微信公众号页面元素选择器配置
// ============================================
const SELECTORS = {
  // 标题输入框 - Playwright: getByRole('textbox', { name: '请在这里输入标题' })
  titleInput: [
    'input[placeholder*="请在这里输入标题"]',
    'textarea[placeholder*="请在这里输入标题"]',
    '#title',
    '.title-input input',
    '.title-input textarea'
  ],
  
  // 编辑器正文 - Playwright: div:has-text("从这里开始写正文")
  editor: [
    '#ueditor_0',
    '.edui-body-container',
    '[contenteditable="true"]',
    '.rich_media_content'
  ],
  
  // 图片按钮 - Playwright: locator('#js_editor_insertimage')
  imageButton: [
    '#js_editor_insertimage',
    '.edui-for-insertimage',
    '[title="图片"]'
  ],
  
  // AI 配图按钮 - Playwright: getByText('AI 配图')
  aiImageButton: [
    // 通过文本匹配
  ],
  
  // AI 配图输入框 - Playwright: getByRole('textbox', { name: '请描述你想要创作的内容' })
  aiPromptInput: [
    'input[placeholder*="请描述你想要创作的内容"]',
    'textarea[placeholder*="请描述你想要创作的内容"]',
    '.ai-image-input input',
    '.ai-image-input textarea'
  ],
  
  // 开始创作按钮 - Playwright: getByRole('button', { name: '开始创作' })
  startCreateButton: [
    'button:contains("开始创作")',
    '.ai-image-create-btn'
  ],
  
  // AI 生成的图片操作按钮（插入图片）
  aiImageInsertButton: [
    '.ai-image-operation-group div:nth-child(2)',
    '.ai-image-insert'
  ],
  
  // 封面添加按钮 - Playwright: locator('.icon20_common.add_cover')
  coverAddButton: [
    '.icon20_common.add_cover',
    '.add_cover',
    '[class*="add_cover"]'
  ],
  
  // 从正文选择链接 - Playwright: getByRole('link', { name: '从正文选择' })
  selectFromContentLink: [
    'a:contains("从正文选择")',
    '.js_cover_from_article'
  ],
  
  // 封面图片选择 - Playwright: locator('.icon_card_selected_global')
  coverImageSelect: [
    '.icon_card_selected_global',
    '.card_mask_global',
    '.cover-select-item'
  ],
  
  // 下一步按钮 - Playwright: getByRole('button', { name: '下一步' })
  nextStepButton: [
    'button:contains("下一步")',
    '.weui-desktop-btn_primary:contains("下一步")'
  ],
  
  // 确认按钮 - Playwright: getByRole('button', { name: '确认' })
  confirmButton: [
    'button:contains("确认")',
    '.weui-desktop-btn_primary:contains("确认")'
  ],
  
  // 原创声明 - Playwright: getByText('未声明')
  originalDeclare: [
    // 通过文本匹配 "未声明"
  ],
  
  // 原创作者输入框 - Playwright: locator('#js_original_edit_box').getByRole('textbox', { name: '请输入作者' })
  originalAuthorInput: [
    '#js_original_edit_box input[placeholder*="请输入作者"]',
    '#js_original_edit_box textarea[placeholder*="请输入作者"]'
  ],
  
  // 确定按钮（原创声明）
  originalConfirmButton: [
    '#js_original_edit_box button:contains("确定")',
    '.js_original_confirm'
  ],
  
  // 预览按钮 - Playwright: getByRole('button', { name: '预览' })
  previewButton: [
    'button:contains("预览")',
    '#js_preview'
  ],
  
  // 取消按钮 - Playwright: getByRole('button', { name: '取消' })
  cancelButton: [
    'button:contains("取消")',
    '.weui-desktop-btn_default:contains("取消")'
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

const findElementByText = (text: string, tagNames: string[] = ['button', 'span', 'div', 'a', 'label']): HTMLElement | null => {
  for (const tag of tagNames) {
    const elements = document.querySelectorAll(tag);
    for (const el of elements) {
      const elText = (el as HTMLElement).innerText?.trim();
      if (elText === text && isElementVisible(el as HTMLElement)) {
        return el as HTMLElement;
      }
    }
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

const waitForElement = (selectors: string[], timeout = 10000): Promise<HTMLElement | null> => {
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

// ============================================
// Logger UI
// ============================================
class WeixinLogger {
  private container: HTMLDivElement;
  private logContent: HTMLDivElement;
  private stopBtn: HTMLButtonElement;
  private onStop?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'memoraid-weixin-logger';
    this.container.style.cssText = 'position:fixed;top:20px;left:20px;width:400px;max-height:500px;background:rgba(0,0,0,0.9);color:#07c160;font-family:Consolas,Monaco,monospace;font-size:12px;border-radius:8px;padding:12px;z-index:20000;display:none;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.6);border:1px solid #07c160;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;';
    
    const title = document.createElement('span');
    title.innerHTML = '📱 <span style="color:#fff;font-weight:bold;">Memoraid</span> 公众号助手';
    
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
    copyBtn.style.cssText = 'background:#07c160;color:white;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;';
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
    if (type === 'error') { reportError(message, { type, context: 'WeixinContentScript' }); }
  }
}

const logger = new WeixinLogger();

// ============================================
// 核心功能
// ============================================

let isFlowCancelled = false;

/**
 * 填充标题
 */
const fillTitle = async (title: string): Promise<boolean> => {
  logger.log('查找标题输入框...', 'info');
  
  const titleInput = await waitForElement(SELECTORS.titleInput, 5000);
  if (!titleInput) {
    logger.log('未找到标题输入框', 'error');
    return false;
  }
  
  logger.log('填充标题', 'action');
  simulateClick(titleInput);
  await new Promise(r => setTimeout(r, 200));
  simulateInput(titleInput, title);
  
  logger.log('标题已填充', 'success');
  return true;
};

/**
 * 填充正文
 * 公众号编辑器使用富文本格式（HTML）
 */
const fillContent = async (content: string, htmlContent?: string): Promise<boolean> => {
  logger.log('查找编辑器...', 'info');
  
  // 等待编辑器加载
  await new Promise(r => setTimeout(r, 1500));
  
  // 查找编辑器 - 微信公众号使用 contenteditable 的 div
  let editor: HTMLElement | null = null;
  
  // 方法1: 查找 contenteditable 元素
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    if (isElementVisible(el as HTMLElement)) {
      // 排除标题输入框
      const placeholder = el.getAttribute('data-placeholder') || '';
      if (!placeholder.includes('标题')) {
        editor = el as HTMLElement;
        break;
      }
    }
  }
  
  // 方法2: 通过类名查找
  if (!editor) {
    editor = findElement(SELECTORS.editor);
  }
  
  // 方法3: 在 iframe 中查找
  if (!editor) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          const editorInIframe = iframeDoc.querySelector('[contenteditable="true"], .edui-body-container');
          if (editorInIframe) {
            editor = editorInIframe as HTMLElement;
            break;
          }
        }
      } catch (e) { /* 跨域限制 */ }
    }
  }
  
  // 方法4: 通过占位文本查找
  if (!editor) {
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const text = div.textContent?.trim();
      if ((text?.includes('从这里开始写正文') || text?.includes('请输入正文')) && 
          isElementVisible(div as HTMLElement)) {
        editor = div as HTMLElement;
        break;
      }
    }
  }
  
  if (!editor) {
    logger.log('未找到编辑器', 'error');
    return false;
  }
  
  logger.log('填充正文内容（富文本格式）', 'action');
  
  // 点击编辑器获取焦点
  simulateClick(editor);
  editor.focus();
  await new Promise(r => setTimeout(r, 300));
  
  // 清空现有内容
  editor.innerHTML = '';
  
  // 插入内容 - 优先使用 HTML 格式
  if (htmlContent) {
    // 处理 HTML 内容，确保格式正确
    // 公众号编辑器需要特定的 HTML 结构
    let processedHtml = htmlContent;
    
    // 将 <p> 标签转换为带样式的段落
    processedHtml = processedHtml.replace(/<p>/g, '<p style="margin-bottom: 1em;">');
    
    // 将 <h1>, <h2>, <h3> 转换为带样式的标题
    processedHtml = processedHtml.replace(/<h1>/g, '<h1 style="font-size: 24px; font-weight: bold; margin: 1em 0;">');
    processedHtml = processedHtml.replace(/<h2>/g, '<h2 style="font-size: 20px; font-weight: bold; margin: 1em 0;">');
    processedHtml = processedHtml.replace(/<h3>/g, '<h3 style="font-size: 18px; font-weight: bold; margin: 1em 0;">');
    
    // 将 <strong> 和 <b> 保持不变
    // 将 <em> 和 <i> 保持不变
    
    // 将 <ul> 和 <ol> 添加样式
    processedHtml = processedHtml.replace(/<ul>/g, '<ul style="margin: 1em 0; padding-left: 2em;">');
    processedHtml = processedHtml.replace(/<ol>/g, '<ol style="margin: 1em 0; padding-left: 2em;">');
    
    // 将 <blockquote> 添加样式
    processedHtml = processedHtml.replace(/<blockquote>/g, '<blockquote style="border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666;">');
    
    // 将 <code> 添加样式
    processedHtml = processedHtml.replace(/<code>/g, '<code style="background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-family: monospace;">');
    
    // 将 <pre> 添加样式
    processedHtml = processedHtml.replace(/<pre>/g, '<pre style="background: #f5f5f5; padding: 1em; border-radius: 5px; overflow-x: auto; font-family: monospace;">');
    
    try {
      document.execCommand('insertHTML', false, processedHtml);
    } catch (e) {
      // 备用方法：直接设置 innerHTML
      editor.innerHTML = processedHtml;
    }
  } else {
    // 如果没有 HTML，将 Markdown 转换为简单的 HTML
    let simpleHtml = content
      // 标题
      .replace(/^### (.+)$/gm, '<h3 style="font-size: 18px; font-weight: bold; margin: 1em 0;">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size: 20px; font-weight: bold; margin: 1em 0;">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size: 24px; font-weight: bold; margin: 1em 0;">$1</h1>')
      // 粗体
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // 无序列表
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // 换行转段落
      .replace(/\n\n/g, '</p><p style="margin-bottom: 1em;">')
      .replace(/\n/g, '<br>');
    
    // 包装在段落中
    simpleHtml = '<p style="margin-bottom: 1em;">' + simpleHtml + '</p>';
    
    // 处理列表
    simpleHtml = simpleHtml.replace(/(<li>.*?<\/li>)+/g, '<ul style="margin: 1em 0; padding-left: 2em;">$&</ul>');
    
    try {
      document.execCommand('insertHTML', false, simpleHtml);
    } catch (e) {
      editor.innerHTML = simpleHtml;
    }
  }
  
  // 触发输入事件，确保编辑器识别内容变化
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  
  logger.log('正文已填充', 'success');
  return true;
};

/**
 * 打开图片对话框
 */
const openImageDialog = async (): Promise<boolean> => {
  logger.log('查找图片按钮...', 'info');
  
  const imageBtn = findElement(SELECTORS.imageButton);
  if (!imageBtn) {
    logger.log('未找到图片按钮', 'error');
    return false;
  }
  
  logger.log('点击图片按钮', 'action');
  simulateClick(imageBtn);
  await new Promise(r => setTimeout(r, 1000));
  
  return true;
};

/**
 * 点击 AI 配图
 */
const clickAIImage = async (): Promise<boolean> => {
  logger.log('查找 AI 配图选项...', 'info');
  
  // 等待下拉菜单出现
  await new Promise(r => setTimeout(r, 500));
  
  // 方法1: 通过文本查找 "AI 配图" 或 "AI配图"
  let aiBtn = findElementByText('AI 配图', ['div', 'span', 'a', 'li', 'button']);
  if (!aiBtn) {
    aiBtn = findElementByText('AI配图', ['div', 'span', 'a', 'li', 'button']);
  }
  
  // 方法2: 在下拉菜单中查找
  if (!aiBtn) {
    const dropdownMenus = document.querySelectorAll('.weui-desktop-dropdown__list, .dropdown-menu, [class*="dropdown"], [class*="menu"]');
    for (const menu of dropdownMenus) {
      if (isElementVisible(menu as HTMLElement)) {
        const items = menu.querySelectorAll('div, span, a, li');
        for (const item of items) {
          const text = (item as HTMLElement).innerText?.trim();
          if (text === 'AI 配图' || text === 'AI配图') {
            aiBtn = item as HTMLElement;
            break;
          }
        }
        if (aiBtn) break;
      }
    }
  }
  
  // 方法3: 在图片插入区域查找
  if (!aiBtn) {
    const imagePanel = document.querySelector('#js_editor_insertimage, .edui-for-insertimage, [class*="insertimage"]');
    if (imagePanel) {
      const items = imagePanel.querySelectorAll('div, span, a');
      for (const item of items) {
        const text = (item as HTMLElement).innerText?.trim();
        if (text === 'AI 配图' || text === 'AI配图') {
          aiBtn = item as HTMLElement;
          break;
        }
      }
    }
  }
  
  // 方法4: 全局搜索包含 AI 配图的可见元素
  if (!aiBtn) {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const htmlEl = el as HTMLElement;
      // 只检查叶子节点或文本直接匹配的元素
      if (htmlEl.childElementCount === 0 || htmlEl.children.length === 0) {
        const text = htmlEl.innerText?.trim();
        if ((text === 'AI 配图' || text === 'AI配图') && isElementVisible(htmlEl)) {
          aiBtn = htmlEl;
          break;
        }
      }
    }
  }
  
  if (!aiBtn) {
    logger.log('未找到 AI 配图按钮', 'error');
    return false;
  }
  
  logger.log('点击 AI 配图选项', 'action');
  
  // 确保元素可见并滚动到视图
  aiBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 200));
  
  // 模拟完整的鼠标事件序列
  simulateClick(aiBtn);
  
  // 等待 AI 配图面板打开
  await new Promise(r => setTimeout(r, 1500));
  
  // 验证是否成功打开 AI 配图面板（查找输入框）
  const aiInputSelectors = [
    'input[placeholder*="描述"]',
    'textarea[placeholder*="描述"]',
    'input[placeholder*="创作"]',
    'textarea[placeholder*="创作"]',
    '.ai-image-input',
    '[class*="ai-image"] input',
    '[class*="ai-image"] textarea'
  ];
  
  let aiPanelOpened = false;
  for (const selector of aiInputSelectors) {
    const input = document.querySelector(selector);
    if (input && isElementVisible(input as HTMLElement)) {
      aiPanelOpened = true;
      break;
    }
  }
  
  if (aiPanelOpened) {
    logger.log('AI 配图面板已打开', 'success');
    return true;
  } else {
    logger.log('AI 配图面板可能未完全打开，继续尝试...', 'warn');
    return true; // 仍然返回 true，让后续流程继续
  }
};

/**
 * 生成 AI 配图
 * 输入关键词后会自动从图片库中搜索相关图片，选择第一张插入即可
 * @param prompt 图片描述关键词
 */
const generateAIImage = async (prompt: string): Promise<boolean> => {
  logger.log(`AI 配图关键词: ${prompt}`, 'info');
  
  // 查找输入框
  const promptInput = await waitForElement(SELECTORS.aiPromptInput, 5000);
  if (!promptInput) {
    // 备用方法：通过 placeholder 查找
    const inputs = document.querySelectorAll('input, textarea');
    for (const input of inputs) {
      const placeholder = input.getAttribute('placeholder') || '';
      if (placeholder.includes('描述') || placeholder.includes('创作')) {
        if (isElementVisible(input as HTMLElement)) {
          logger.log('通过 placeholder 找到输入框', 'info');
          simulateClick(input as HTMLElement);
          await new Promise(r => setTimeout(r, 200));
          simulateInput(input as HTMLElement, prompt);
          break;
        }
      }
    }
  } else {
    logger.log('输入图片关键词', 'action');
    simulateClick(promptInput);
    await new Promise(r => setTimeout(r, 200));
    simulateInput(promptInput, prompt);
  }
  
  // 等待图片库自动搜索并显示相关图片
  logger.log('⏳ 等待图片库搜索结果...', 'info');
  await new Promise(r => setTimeout(r, 2000));
  
  // 图片库会自动显示相关图片，不需要点击"开始创作"
  // 直接返回 true，让 insertAIImage 去选择图片
  logger.log('图片库已加载', 'success');
  return true;
};

/**
 * 选择并插入 AI 配图
 * 从图片库搜索结果中选择第一张图片插入
 * 需要先悬浮在图片上显示"插入"按钮，然后点击
 */
const insertAIImage = async (): Promise<boolean> => {
  logger.log('查找图片库搜索结果...', 'info');
  
  // 等待图片列表加载
  await new Promise(r => setTimeout(r, 1500));
  
  let insertBtn: HTMLElement | null = null;
  
  // 方法1: 查找"已在图片库中找到以下图片"区域，然后找到第一张图片并悬浮
  // 这个区域包含搜索结果的图片
  const searchResultArea = Array.from(document.querySelectorAll('div')).find(div => {
    const text = div.textContent || '';
    return text.includes('已在图片库中找到以下图片') && div.querySelector('img');
  });
  
  if (searchResultArea) {
    logger.log('找到图片库搜索结果区域', 'info');
    
    // 查找该区域内的第一张图片
    const images = searchResultArea.querySelectorAll('img');
    if (images.length > 0) {
      const firstImage = images[0] as HTMLElement;
      const imageContainer = firstImage.closest('div') as HTMLElement;
      
      if (imageContainer) {
        logger.log('悬浮在第一张图片上...', 'action');
        
        // 滚动到图片位置
        imageContainer.scrollIntoView({ behavior: 'instant', block: 'center' });
        await new Promise(r => setTimeout(r, 300));
        
        // 模拟鼠标悬浮
        const rect = imageContainer.getBoundingClientRect();
        const hoverOptions = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        };
        
        imageContainer.dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
        imageContainer.dispatchEvent(new MouseEvent('mouseover', hoverOptions));
        imageContainer.dispatchEvent(new MouseEvent('mousemove', hoverOptions));
        
        // 等待"插入"按钮出现
        await new Promise(r => setTimeout(r, 800));
        
        // 在图片容器内查找"插入"按钮
        const btnsInContainer = imageContainer.querySelectorAll('div, span, button');
        for (const btn of btnsInContainer) {
          const text = (btn as HTMLElement).innerText?.trim();
          if (text === '插入' && isElementVisible(btn as HTMLElement)) {
            insertBtn = btn as HTMLElement;
            logger.log('在图片容器内找到插入按钮', 'info');
            break;
          }
        }
        
        // 如果容器内没找到，在整个搜索结果区域内查找
        if (!insertBtn) {
          const btnsInArea = searchResultArea.querySelectorAll('div, span, button');
          for (const btn of btnsInArea) {
            const text = (btn as HTMLElement).innerText?.trim();
            if (text === '插入' && isElementVisible(btn as HTMLElement)) {
              insertBtn = btn as HTMLElement;
              logger.log('在搜索结果区域内找到插入按钮', 'info');
              break;
            }
          }
        }
      }
    }
  }
  
  // 方法2: 如果方法1失败，查找 AI 配图弹窗内的图片
  if (!insertBtn) {
    logger.log('尝试在 AI 配图弹窗内查找...', 'info');
    
    // 查找 AI 配图弹窗
    const aiDialog = document.querySelector('.weui-desktop-dialog, [class*="ai-image-dialog"], [class*="dialog"]');
    if (aiDialog) {
      // 查找弹窗内的图片
      const images = aiDialog.querySelectorAll('img');
      
      // 跳过历史图片（通常在顶部，较小），找到搜索结果图片
      for (const img of images) {
        const imgEl = img as HTMLElement;
        const rect = imgEl.getBoundingClientRect();
        
        // 搜索结果图片通常较大
        if (rect.width > 80 && rect.height > 80) {
          const imageContainer = imgEl.closest('div') as HTMLElement;
          if (imageContainer) {
            logger.log('悬浮在图片上...', 'action');
            
            // 模拟悬浮
            imageContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            imageContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise(r => setTimeout(r, 800));
            
            // 查找插入按钮
            const btns = imageContainer.querySelectorAll('div, span, button');
            for (const btn of btns) {
              const text = (btn as HTMLElement).innerText?.trim();
              if (text === '插入' && isElementVisible(btn as HTMLElement)) {
                insertBtn = btn as HTMLElement;
                break;
              }
            }
            
            if (insertBtn) break;
          }
        }
      }
    }
  }
  
  // 方法3: 直接查找可见的"插入"按钮，选择在 AI 配图区域内的第一个
  if (!insertBtn) {
    logger.log('尝试直接查找插入按钮...', 'info');
    
    const allInsertBtns = document.querySelectorAll('div, span, button');
    for (const btn of allInsertBtns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '插入' && isElementVisible(btn as HTMLElement)) {
        // 检查是否在 AI 配图相关区域内
        const parent = btn.closest('.weui-desktop-dialog, [class*="ai-image"], [class*="dialog"]');
        if (parent) {
          insertBtn = btn as HTMLElement;
          logger.log('找到 AI 配图区域内的插入按钮', 'info');
          break;
        }
      }
    }
  }
  
  if (!insertBtn) {
    logger.log('未找到插入按钮', 'error');
    return false;
  }
  
  logger.log('点击插入图片', 'action');
  simulateClick(insertBtn);
  await new Promise(r => setTimeout(r, 1000));
  
  logger.log('AI 图片已插入', 'success');
  return true;
};

/**
 * 设置封面图片（从正文选择）
 * 需要先悬浮在封面区域，等菜单出现后再点击"从正文选择"
 */
const setCoverFromContent = async (): Promise<boolean> => {
  logger.log('设置封面图片...', 'info');
  
  // 查找封面区域 - 可能是"拖拽或选择封面"区域
  let coverArea: HTMLElement | null = null;
  
  // 方法1: 查找包含"拖拽或选择封面"文本的区域
  const allElements = document.querySelectorAll('div, span');
  for (const el of allElements) {
    const text = (el as HTMLElement).innerText?.trim();
    if (text?.includes('拖拽或选择封面') || text?.includes('选择封面')) {
      coverArea = el as HTMLElement;
      break;
    }
  }
  
  // 方法2: 查找封面添加按钮区域
  if (!coverArea) {
    coverArea = findElement(SELECTORS.coverAddButton);
  }
  
  // 方法3: 查找封面容器
  if (!coverArea) {
    coverArea = document.querySelector('.cover-wrap, .js_cover_area, [class*="cover"]') as HTMLElement;
  }
  
  if (!coverArea) {
    logger.log('未找到封面区域', 'error');
    return false;
  }
  
  // 悬浮在封面区域上，触发菜单显示
  logger.log('悬浮在封面区域...', 'action');
  
  // 获取封面区域的父容器（可能需要悬浮在更大的区域上）
  const coverContainer = coverArea.closest('.cover-container, .js_cover_wrap, [class*="cover-wrap"]') || coverArea;
  
  // 模拟鼠标悬浮事件
  const rect = (coverContainer as HTMLElement).getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const hoverOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY
  };
  
  (coverContainer as HTMLElement).dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
  (coverContainer as HTMLElement).dispatchEvent(new MouseEvent('mouseover', hoverOptions));
  (coverContainer as HTMLElement).dispatchEvent(new MouseEvent('mousemove', hoverOptions));
  
  // 等待菜单出现
  await new Promise(r => setTimeout(r, 1000));
  
  // 也尝试点击封面区域（有些情况下需要点击才能显示菜单）
  simulateClick(coverArea);
  await new Promise(r => setTimeout(r, 800));
  
  // 查找"从正文选择"选项
  logger.log('查找"从正文选择"选项...', 'info');
  
  let selectFromContentLink: HTMLElement | null = null;
  
  // 方法1: 通过文本查找
  selectFromContentLink = findElementByText('从正文选择', ['a', 'span', 'div', 'li']);
  
  // 方法2: 在下拉菜单中查找
  if (!selectFromContentLink) {
    const dropdowns = document.querySelectorAll('.weui-desktop-dropdown__list, .dropdown-menu, [class*="dropdown"], [class*="menu"]');
    for (const dropdown of dropdowns) {
      if (isElementVisible(dropdown as HTMLElement)) {
        const items = dropdown.querySelectorAll('a, span, div, li');
        for (const item of items) {
          const text = (item as HTMLElement).innerText?.trim();
          if (text === '从正文选择') {
            selectFromContentLink = item as HTMLElement;
            break;
          }
        }
        if (selectFromContentLink) break;
      }
    }
  }
  
  // 方法3: 全局搜索
  if (!selectFromContentLink) {
    const allLinks = document.querySelectorAll('a, span, div');
    for (const link of allLinks) {
      const text = (link as HTMLElement).innerText?.trim();
      if (text === '从正文选择' && isElementVisible(link as HTMLElement)) {
        selectFromContentLink = link as HTMLElement;
        break;
      }
    }
  }
  
  if (!selectFromContentLink) {
    logger.log('未找到"从正文选择"链接', 'error');
    return false;
  }
  
  logger.log('点击从正文选择', 'action');
  simulateClick(selectFromContentLink);
  await new Promise(r => setTimeout(r, 1500));
  
  // 选择第一张图片
  logger.log('选择封面图片...', 'info');
  
  // 查找图片选择项
  let imageSelect: HTMLElement | null = null;
  
  // 方法1: 查找图片卡片
  imageSelect = document.querySelector('.icon_card_selected_global, .card_mask_global, .cover-select-item') as HTMLElement;
  
  // 方法2: 查找图片列表中的第一张
  if (!imageSelect) {
    const imageItems = document.querySelectorAll('.cover-image-item, .image-item, [class*="cover-item"]');
    if (imageItems.length > 0) {
      imageSelect = imageItems[0] as HTMLElement;
    }
  }
  
  // 方法3: 查找可点击的图片
  if (!imageSelect) {
    const images = document.querySelectorAll('.weui-desktop-dialog img, .cover-dialog img');
    if (images.length > 0) {
      imageSelect = images[0].closest('div') as HTMLElement || images[0] as HTMLElement;
    }
  }
  
  if (imageSelect) {
    logger.log('选择封面图片', 'action');
    simulateClick(imageSelect);
    await new Promise(r => setTimeout(r, 800));
  } else {
    logger.log('未找到可选择的图片', 'warn');
  }
  
  // 点击下一步
  let nextBtn = findElementByText('下一步', ['button']);
  if (nextBtn) {
    logger.log('点击下一步', 'action');
    simulateClick(nextBtn);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // 再次选择（裁剪确认页面）
  const imageSelect2 = document.querySelector('.icon_card_selected_global, .cover-crop-item') as HTMLElement;
  if (imageSelect2) {
    simulateClick(imageSelect2);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 再次点击下一步
  nextBtn = findElementByText('下一步', ['button']);
  if (nextBtn) {
    logger.log('点击下一步（裁剪确认）', 'action');
    simulateClick(nextBtn);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // 点击确认
  const confirmBtn = findElementByText('确认', ['button']);
  if (confirmBtn) {
    logger.log('点击确认', 'action');
    simulateClick(confirmBtn);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  logger.log('封面设置完成', 'success');
  return true;
};

/**
 * 声明原创
 * @param authorName 作者名称
 */
const declareOriginal = async (authorName: string): Promise<boolean> => {
  logger.log('声明原创...', 'info');
  
  // 点击"未声明"
  const undeclaredBtn = findElementByText('未声明', ['span', 'div', 'a', 'label']);
  if (!undeclaredBtn) {
    logger.log('未找到原创声明入口', 'warn');
    return false;
  }
  
  logger.log('点击未声明', 'action');
  simulateClick(undeclaredBtn);
  await new Promise(r => setTimeout(r, 1000));
  
  // 填写作者名称
  const authorInput = findElement(SELECTORS.originalAuthorInput);
  if (authorInput) {
    logger.log('填写作者名称', 'action');
    simulateClick(authorInput);
    await new Promise(r => setTimeout(r, 200));
    simulateInput(authorInput, authorName);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 重要：勾选"我已阅读并同意《微信公众平台原创声明及相关功能使用协议》"复选框
  logger.log('查找协议复选框...', 'info');
  
  // 方法1: 通过文本查找包含"我已阅读"的复选框或其标签
  let agreementCheckbox: HTMLElement | null = null;
  
  // 查找复选框 - 可能是 input[type="checkbox"] 或者自定义的复选框元素
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const parent = cb.closest('label, div, span');
    if (parent && parent.textContent?.includes('我已阅读')) {
      agreementCheckbox = cb as HTMLElement;
      break;
    }
  }
  
  // 方法2: 查找包含"我已阅读"文本的可点击元素（微信可能用自定义复选框）
  if (!agreementCheckbox) {
    const labels = document.querySelectorAll('label, .weui-desktop-form__check, .weui-desktop-checkbox');
    for (const label of labels) {
      if (label.textContent?.includes('我已阅读') && isElementVisible(label as HTMLElement)) {
        agreementCheckbox = label as HTMLElement;
        break;
      }
    }
  }
  
  // 方法3: 在原创声明弹窗内查找复选框
  if (!agreementCheckbox) {
    const originalBox = document.querySelector('#js_original_edit_box, .original-dialog, .weui-desktop-dialog');
    if (originalBox) {
      const cbInBox = originalBox.querySelector('input[type="checkbox"]') as HTMLElement;
      if (cbInBox) {
        agreementCheckbox = cbInBox;
      } else {
        // 查找自定义复选框
        const customCb = originalBox.querySelector('.weui-desktop-form__check-content, .checkbox, [class*="check"]') as HTMLElement;
        if (customCb && customCb.textContent?.includes('我已阅读')) {
          agreementCheckbox = customCb;
        }
      }
    }
  }
  
  // 方法4: 通过协议链接附近查找
  if (!agreementCheckbox) {
    const agreementLink = document.querySelector('a[href*="原创声明"], a:contains("原创声明")');
    if (agreementLink) {
      const container = agreementLink.closest('label, div');
      if (container) {
        const cb = container.querySelector('input[type="checkbox"]') as HTMLElement;
        if (cb) {
          agreementCheckbox = cb;
        } else {
          // 点击整个容器
          agreementCheckbox = container as HTMLElement;
        }
      }
    }
  }
  
  if (agreementCheckbox) {
    logger.log('勾选协议复选框', 'action');
    
    // 如果是 input checkbox，检查是否已勾选
    if (agreementCheckbox instanceof HTMLInputElement && agreementCheckbox.type === 'checkbox') {
      if (!agreementCheckbox.checked) {
        simulateClick(agreementCheckbox);
        // 也尝试直接设置 checked 属性
        agreementCheckbox.checked = true;
        agreementCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // 自定义复选框，直接点击
      simulateClick(agreementCheckbox);
    }
    
    await new Promise(r => setTimeout(r, 500));
    logger.log('协议已勾选', 'success');
  } else {
    logger.log('未找到协议复选框，尝试继续...', 'warn');
  }
  
  // 点击确定按钮
  logger.log('查找确定按钮...', 'info');
  
  // 查找弹窗内的确定按钮
  let confirmBtn: HTMLElement | null = null;
  
  // 方法1: 在原创声明弹窗内查找
  const originalBox = document.querySelector('#js_original_edit_box, .original-dialog, .weui-desktop-dialog');
  if (originalBox) {
    const btns = originalBox.querySelectorAll('button');
    for (const btn of btns) {
      const text = btn.textContent?.trim();
      if (text === '确定' || text === '确认') {
        confirmBtn = btn as HTMLElement;
        break;
      }
    }
  }
  
  // 方法2: 通过文本查找
  if (!confirmBtn) {
    confirmBtn = findElementByText('确定', ['button']);
  }
  
  if (confirmBtn) {
    logger.log('点击确定', 'action');
    simulateClick(confirmBtn);
    await new Promise(r => setTimeout(r, 1000));
  } else {
    logger.log('未找到确定按钮', 'error');
    return false;
  }
  
  logger.log('原创声明完成', 'success');
  return true;
};

/**
 * 点击预览
 */
const clickPreview = async (): Promise<boolean> => {
  logger.log('点击预览...', 'info');
  
  const previewBtn = findElementByText('预览', ['button']);
  if (!previewBtn) {
    logger.log('未找到预览按钮', 'error');
    return false;
  }
  
  logger.log('点击预览按钮', 'action');
  simulateClick(previewBtn);
  await new Promise(r => setTimeout(r, 2000));
  
  logger.log('预览已打开', 'success');
  return true;
};

/**
 * 取消预览
 */
const cancelPreview = async (): Promise<boolean> => {
  const cancelBtn = findElementByText('取消', ['button']);
  if (cancelBtn) {
    simulateClick(cancelBtn);
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
};

/**
 * 从文章内容生成 AI 配图提示词
 * 提示词要复杂一点，效果更好
 */
const generateImagePrompt = (title: string, content: string): string => {
  // 从标题和内容中提取关键信息
  const keywords: string[] = [];
  
  // 提取标题关键词
  if (title) {
    keywords.push(title.substring(0, 20));
  }
  
  // 从内容中提取前100个字符作为上下文
  const contentPreview = content.substring(0, 100).replace(/[#*\[\]]/g, '');
  
  // 生成复杂的提示词
  const prompts = [
    `一幅关于"${title}"的精美插画，现代简约风格，色彩鲜明，适合文章配图`,
    `${title}主题的创意图片，高清质感，专业设计感，适合自媒体文章`,
    `表现"${contentPreview.substring(0, 30)}"概念的艺术图片，简洁大气，视觉冲击力强`,
    `${title}相关的概念图，扁平化设计，色彩和谐，适合公众号文章封面`
  ];
  
  // 随机选择一个提示词模板
  return prompts[Math.floor(Math.random() * prompts.length)];
};

/**
 * 查找图片占位符
 */
const findImagePlaceholders = (): { text: string; keyword: string }[] => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return [];
  
  const content = editor.innerText || '';
  const placeholders: { text: string; keyword: string }[] = [];
  
  const patterns = [
    /\[图片[：:]\s*([^\]]+)\]/g,
    /【图片[：:]\s*([^】]+)】/g,
    /\[配图[：:]\s*([^\]]+)\]/g,
    /【配图[：:]\s*([^】]+)】/g,
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

// ============================================
// 主流程 - 基于 Playwright 录制
// ============================================

/**
 * 完整的发布流程
 * 基于 Playwright 录制的操作步骤
 */
const runPublishFlow = async (options: {
  title: string;
  content: string;
  htmlContent?: string;
  authorName?: string;
  generateAI?: boolean;
  aiPrompt?: string;
  autoPreview?: boolean;
}) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  logger.log('🚀 开始微信公众号发布流程...', 'info');
  
  try {
    // 1. 填充标题
    // Playwright: await page1.getByRole('textbox', { name: '请在这里输入标题' }).click();
    // Playwright: await page1.getByRole('textbox', { name: '请在这里输入标题' }).fill('这里是标题，最多64字');
    logger.log('📝 步骤1: 填充标题', 'info');
    if (!await fillTitle(options.title)) {
      logger.log('标题填充失败', 'error');
      return;
    }
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 500));
    
    // 2. 填充正文
    // Playwright: await page1.locator('div').filter({ hasText: /^从这里开始写正文$/ }).nth(5).click();
    // Playwright: await page1.locator('div').filter({ hasText: /^从这里开始写正文$/ }).nth(5).fill('从这里开始写正文\nv');
    logger.log('📝 步骤2: 填充正文', 'info');
    if (!await fillContent(options.content, options.htmlContent)) {
      logger.log('正文填充失败', 'error');
      return;
    }
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 3. 生成 AI 配图（如果启用）
    // Playwright: await page1.getByText('图片 本地上传 从图片库选择 微信扫码上传 AI 配图').click();
    // Playwright: await page1.locator('#js_editor_insertimage').getByText('AI 配图').click();
    // Playwright: await page1.getByRole('textbox', { name: '请描述你想要创作的内容' }).click();
    // Playwright: await page1.getByRole('textbox', { name: '请描述你想要创作的内容' }).fill('美女');
    // Playwright: await page1.getByRole('button', { name: '开始创作' }).click();
    if (options.generateAI !== false) {
      logger.log('🎨 步骤3: 生成 AI 配图', 'info');
      
      // 打开图片对话框
      if (!await openImageDialog()) {
        logger.log('无法打开图片对话框，跳过 AI 配图', 'warn');
      } else {
        if (isFlowCancelled) return;
        
        // 点击 AI 配图
        if (!await clickAIImage()) {
          logger.log('无法点击 AI 配图，跳过', 'warn');
        } else {
          if (isFlowCancelled) return;
          
          // 生成图片提示词
          const aiPrompt = options.aiPrompt || generateImagePrompt(options.title, options.content);
          logger.log(`AI 提示词: ${aiPrompt}`, 'info');
          
          // 生成 AI 图片
          if (await generateAIImage(aiPrompt)) {
            if (isFlowCancelled) return;
            
            // 插入最后一张图片（最新生成的，-1 表示最后一张）
            // 历史图片在前面，新生成的在后面
            await insertAIImage();
          }
        }
      }
    }
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 4. 设置封面（从正文选择）
    // Playwright: await page1.locator('.icon20_common.add_cover').click();
    // Playwright: await page1.getByRole('link', { name: '从正文选择' }).click();
    // Playwright: await page1.locator('.icon_card_selected_global').click();
    // Playwright: await page1.locator('.card_mask_global').click();
    // Playwright: await page1.getByRole('button', { name: '下一步' }).click();
    // Playwright: await page1.locator('.icon_card_selected_global').click();
    // Playwright: await page1.getByRole('button', { name: '下一步' }).click();
    // Playwright: await page1.getByRole('button', { name: '确认' }).click();
    logger.log('🖼️ 步骤4: 设置封面图片', 'info');
    await setCoverFromContent();
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 5. 声明原创
    // Playwright: await page1.getByText('未声明').click();
    // Playwright: await page1.locator('#js_original_edit_box').getByRole('textbox', { name: '请输入作者' }).click();
    // Playwright: await page1.locator('#js_original_edit_box').getByRole('textbox', { name: '请输入作者' }).fill('黄刚');
    // Playwright: await page1.getByRole('button', { name: '确定' }).click();
    if (options.authorName) {
      logger.log('✍️ 步骤5: 声明原创', 'info');
      await declareOriginal(options.authorName);
    }
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 6. 预览（可选）
    // Playwright: await page1.getByRole('button', { name: '预览' }).click();
    // Playwright: await page1.getByRole('button', { name: '取消' }).click();
    if (options.autoPreview) {
      logger.log('👁️ 步骤6: 预览文章', 'info');
      await clickPreview();
      await new Promise(r => setTimeout(r, 3000));
      await cancelPreview();
    }
    
    logger.log('✅ 公众号文章准备完成！请检查后手动发布', 'success');
    
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 流程错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
  }
};

/**
 * 智能图片处理流程
 * 处理文章中的图片占位符，使用 AI 生成配图
 */
const runSmartImageFlow = async (_autoPublish = false) => {
  isFlowCancelled = false;
  logger.clear();
  logger.show();
  logger.setStopCallback(() => { isFlowCancelled = true; });
  logger.log('🚀 开始智能图片处理...', 'info');
  
  try {
    // 查找图片占位符
    const placeholders = findImagePlaceholders();
    
    if (placeholders.length === 0) {
      logger.log('未找到图片占位符，尝试生成一张配图', 'info');
      
      // 获取标题作为提示词
      const titleEl = findElement(SELECTORS.titleInput);
      const title = titleEl instanceof HTMLInputElement ? titleEl.value : (titleEl?.innerText || '');
      
      if (title) {
        const prompt = generateImagePrompt(title, '');
        
        if (await openImageDialog()) {
          if (await clickAIImage()) {
            if (await generateAIImage(prompt)) {
              await insertAIImage();  // 选择新生成的图片
              logger.log('✅ AI 配图插入成功', 'success');
            }
          }
        }
      }
    } else {
      logger.log(`找到 ${placeholders.length} 个图片占位符`, 'info');
      
      for (let i = 0; i < placeholders.length; i++) {
        if (isFlowCancelled) break;
        
        const placeholder = placeholders[i];
        logger.log(`处理第 ${i + 1}/${placeholders.length} 个: ${placeholder.keyword}`, 'info');
        
        // 生成复杂的提示词
        const prompt = `一幅关于"${placeholder.keyword}"的精美插画，高清质感，现代设计风格，适合公众号文章配图，色彩鲜明，视觉冲击力强`;
        
        if (await openImageDialog()) {
          if (await clickAIImage()) {
            if (await generateAIImage(prompt)) {
              await insertAIImage();  // 选择最后一张（最新生成的）
              logger.log(`✅ 第 ${i + 1} 张图片插入成功`, 'success');
            }
          }
        }
        
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    // 设置封面
    logger.log('🖼️ 设置封面图片...', 'info');
    await setCoverFromContent();
    
    logger.log('✅ 图片处理完成！', 'success');
    
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.log(`❌ 流程错误: ${errorMsg}`, 'error');
  } finally {
    logger.hideStopButton();
  }
};

// ============================================
// 页面导航和登录检测
// ============================================

/**
 * 检测当前页面状态
 * @returns 'login' | 'home' | 'editor' | 'unknown'
 */
const detectPageState = (): 'login' | 'home' | 'editor' | 'unknown' => {
  const url = window.location.href;
  
  // 检测是否在登录页面或需要登录
  const loginIndicators = [
    document.querySelector('#jumpUrl'), // 登录跳转链接
    document.querySelector('a[href*="登录"]'),
    document.querySelector('.page_error_msg'), // 错误页面
  ];
  
  const needsLogin = loginIndicators.some(el => el !== null) || 
    document.body.innerText?.includes('请重新登录') ||
    document.body.innerText?.includes('请先登录');
  
  if (needsLogin) {
    return 'login';
  }
  
  // 检测是否在编辑页面
  if (url.includes('appmsg_edit') || url.includes('appmsg?t=media/appmsg_edit')) {
    return 'editor';
  }
  
  // 检测是否在首页（有"新的创作"区域）
  const homeIndicators = [
    document.querySelector('.new-creation_menu'),
    document.querySelector('.new-creation__menu-item'),
    document.querySelector('.new-creation_menuitem'),
    findElementByText('新的创作'),
    findElementByText('文章'),  // 首页有"文章"按钮
  ];
  
  if (homeIndicators.some(el => el !== null)) {
    return 'home';
  }
  
  return 'unknown';
};

/**
 * 点击"文章"按钮进入编辑页面
 */
const clickArticleButton = async (): Promise<boolean> => {
  logger.log('查找"文章"按钮...', 'info');
  
  // 方法1: 通过文本查找 "文章"
  let articleBtn = findElementByText('文章', ['div', 'span', 'a', 'button']);
  
  // 方法2: 通过类名查找（新的创作区域的第一个菜单项是"文章"）
  if (!articleBtn) {
    const menuItems = document.querySelectorAll('.new-creation__menu-item, .new-creation_menu-item, .new-creation_menuitem');
    if (menuItems.length > 0) {
      // 第一个通常是"文章"
      for (const item of menuItems) {
        const text = (item as HTMLElement).innerText?.trim();
        if (text === '文章' || text?.includes('文章')) {
          articleBtn = item as HTMLElement;
          break;
        }
      }
      // 如果没找到包含"文章"的，就用第一个
      if (!articleBtn && menuItems.length > 0) {
        articleBtn = menuItems[0] as HTMLElement;
      }
    }
  }
  
  // 方法3: 查找包含"文章"文本的可点击元素
  if (!articleBtn) {
    const allElements = document.querySelectorAll('div, span, a');
    for (const el of allElements) {
      const text = (el as HTMLElement).innerText?.trim();
      if (text === '文章' && isElementVisible(el as HTMLElement)) {
        // 检查是否在"新的创作"区域内
        const parent = el.closest('.new-creation_menu, .weui-desktop-panel');
        if (parent) {
          articleBtn = el as HTMLElement;
          break;
        }
      }
    }
  }
  
  if (!articleBtn) {
    logger.log('未找到"文章"按钮', 'error');
    return false;
  }
  
  logger.log('点击"文章"按钮', 'action');
  simulateClick(articleBtn);
  
  // 等待页面跳转
  await new Promise(r => setTimeout(r, 3000));
  
  return true;
};

/**
 * 等待页面加载完成并检测状态
 */
const waitForPageReady = async (maxWait = 10000): Promise<'login' | 'home' | 'editor' | 'unknown'> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    const state = detectPageState();
    if (state !== 'unknown') {
      return state;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  return 'unknown';
};

// ============================================
// 自动填充逻辑
// ============================================

const autoFillContent = async () => {
  try {
    const data = await chrome.storage.local.get('pending_weixin_publish');
    if (!data || !data.pending_weixin_publish) return;
    
    const payload: PublishData = data.pending_weixin_publish;
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      chrome.storage.local.remove('pending_weixin_publish');
      return;
    }

    // 读取设置
    const settings = await chrome.storage.sync.get(['weixin']);
    const authorName = settings.weixin?.authorName || '';
    const autoGenerateAI = settings.weixin?.autoGenerateAI !== false;

    logger.log(`📄 准备填充内容: ${payload.title}`, 'info');
    logger.log('⏳ 检测页面状态...', 'info');

    // 等待页面加载
    await new Promise(r => setTimeout(r, 2000));
    
    // 检测页面状态
    let pageState = await waitForPageReady(15000);
    logger.log(`页面状态: ${pageState}`, 'info');
    
    // 如果需要登录，提示用户
    if (pageState === 'login') {
      logger.log('⚠️ 请先登录微信公众平台', 'warn');
      logger.log('登录后页面会自动刷新，届时将继续填充内容', 'info');
      // 不清除 pending 数据，等用户登录后刷新页面再继续
      return;
    }
    
    // 如果在首页，点击"文章"按钮
    if (pageState === 'home') {
      logger.log('📍 当前在首页，正在进入文章编辑页面...', 'info');
      
      if (await clickArticleButton()) {
        // 等待页面跳转
        await new Promise(r => setTimeout(r, 3000));
        
        // 重新检测状态
        pageState = await waitForPageReady(10000);
        logger.log(`跳转后页面状态: ${pageState}`, 'info');
      } else {
        logger.log('❌ 无法进入编辑页面，请手动点击"文章"按钮', 'error');
        return;
      }
    }
    
    // 如果还不是编辑页面，等待更长时间
    if (pageState !== 'editor') {
      logger.log('⏳ 等待编辑器加载...', 'info');
      
      let attempts = 0;
      const maxAttempts = 20;
      
      const waitForEditor = async (): Promise<boolean> => {
        const titleEl = findElement(SELECTORS.titleInput);
        const editorEl = findElement(SELECTORS.editor);
        return !!(titleEl || editorEl);
      };
      
      while (attempts < maxAttempts) {
        if (await waitForEditor()) {
          break;
        }
        attempts++;
        await new Promise(r => setTimeout(r, 1500));
      }
      
      if (attempts >= maxAttempts) {
        logger.log('❌ 等待编辑器超时', 'error');
        return;
      }
    }
    
    // 等待编辑器完全加载
    await new Promise(r => setTimeout(r, 2000));
    
    // 运行完整发布流程
    await runPublishFlow({
      title: payload.title,
      content: payload.content,
      htmlContent: payload.htmlContent,
      authorName: authorName,
      generateAI: autoGenerateAI,
      autoPreview: false
    });
    
    chrome.storage.local.remove('pending_weixin_publish');

  } catch (error) {
    console.error('Memoraid: 微信公众号填充内容错误', error);
    logger.log(`❌ 填充错误: ${error}`, 'error');
  }
};

// ============================================
// 初始化
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => autoFillContent());
} else {
  autoFillContent();
}

// 导出供外部调用
(window as any).memoraidWeixinRunFlow = runPublishFlow;
(window as any).memoraidWeixinRunImageFlow = runSmartImageFlow;
(window as any).memoraidWeixinFillTitle = fillTitle;
(window as any).memoraidWeixinFillContent = fillContent;
(window as any).memoraidWeixinGenerateAI = generateAIImage;
(window as any).memoraidWeixinSetCover = setCoverFromContent;
(window as any).memoraidWeixinDeclareOriginal = declareOriginal;
(window as any).memoraidWeixinPreview = clickPreview;

// 消息监听
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'WEIXIN_RUN_FLOW') {
    runPublishFlow(message.payload);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'WEIXIN_RUN_IMAGE_FLOW') {
    runSmartImageFlow();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'WEIXIN_GENERATE_AI_IMAGE') {
    (async () => {
      if (await openImageDialog()) {
        if (await clickAIImage()) {
          await generateAIImage(message.prompt);
          await insertAIImage();  // 选择最后一张（最新生成的）
        }
      }
    })();
    sendResponse({ success: true });
    return true;
  }
});

console.log(`
📱 Memoraid 微信公众号助手已加载

可用命令：
  memoraidWeixinRunFlow({title, content, authorName, generateAI})  - 运行完整发布流程
  memoraidWeixinRunImageFlow()           - 运行智能图片处理
  memoraidWeixinFillTitle('标题')         - 填充标题
  memoraidWeixinFillContent('内容')       - 填充正文
  memoraidWeixinGenerateAI('提示词')      - 生成 AI 配图
  memoraidWeixinSetCover()               - 设置封面（从正文选择）
  memoraidWeixinDeclareOriginal('作者')   - 声明原创
  memoraidWeixinPreview()                - 预览文章

注意：AI 配图生成需要 30-60 秒，请耐心等待
`)