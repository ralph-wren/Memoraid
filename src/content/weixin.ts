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
  // 远程调试发现: id="ai-image-prompt", class="chat_textarea"
  aiPromptInput: [
    '#ai-image-prompt',                                    // 精确ID选择器（远程调试发现）
    'textarea.chat_textarea',                              // 精确class选择器
    'textarea[placeholder*="请描述你想要创作的内容"]',
    'input[placeholder*="请描述你想要创作的内容"]',
    'textarea[placeholder*="描述"]',
    'input[placeholder*="描述"]',
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
  // 注意：不要再调用 element.click()，避免重复点击
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
  
  // 移除封面提示词（[封面: xxx]），封面提示词会单独用于生成封面
  content = removeCoverPromptFromContent(content);
  if (htmlContent) {
    htmlContent = removeCoverPromptFromContent(htmlContent);
  }
  
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
 * 输入关键词后点击"重新创作"/"开始创作"按钮，等待 AI 生成图片
 * @param prompt 图片描述关键词
 * @param setRatio 是否设置图片尺寸（正文图片也设置为 1:1 或其他尺寸）
 */
const generateAIImage = async (prompt: string, setRatio: boolean = true): Promise<boolean> => {
  logger.log(`AI 配图关键词: ${prompt}`, 'info');
  
  // 记录点击创作按钮前的 ai-image-list 数量
  const initialListCount = document.querySelectorAll('.ai-image-list').length;
  logger.log(`初始 ai-image-list 数量: ${initialListCount}`, 'info');
  
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
  
  await new Promise(r => setTimeout(r, 500));
  
  // 设置图片尺寸（正文图片设置为 1:1，保持默认即可，或者可以选择其他尺寸）
  if (setRatio) {
    logger.log('检查图片尺寸设置...', 'info');
    
    // 查找当前尺寸按钮
    let ratioBtn: HTMLElement | null = null;
    const ratioBtns = document.querySelectorAll('button, div, span');
    for (const btn of ratioBtns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if ((text === '1:1' || text === '1:1 ↓' || text?.match(/^\d+:\d+/)) && isElementVisible(btn as HTMLElement)) {
        const dialog = btn.closest('.weui-desktop-dialog, [class*="dialog"], [class*="modal"]');
        if (dialog) {
          ratioBtn = btn as HTMLElement;
          break;
        }
      }
    }
    
    if (ratioBtn) {
      // 正文图片保持 1:1 即可，不需要改变
      logger.log('正文图片使用默认尺寸 1:1', 'info');
    }
  }
  
  await new Promise(r => setTimeout(r, 300));
  
  // 点击"重新创作"或"开始创作"按钮
  logger.log('查找创作按钮...', 'info');
  
  let createBtn: HTMLElement | null = null;
  
  // 方法1: 通过文本查找"重新创作"或"开始创作"
  createBtn = findElementByText('重新创作', ['button', 'div', 'span']);
  if (!createBtn) {
    createBtn = findElementByText('开始创作', ['button', 'div', 'span']);
  }
  
  // 方法2: 通过类名查找
  if (!createBtn) {
    const btns = document.querySelectorAll('button, .weui-desktop-btn_primary');
    for (const btn of btns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if ((text === '重新创作' || text === '开始创作') && isElementVisible(btn as HTMLElement)) {
        createBtn = btn as HTMLElement;
        break;
      }
    }
  }
  
  if (!createBtn) {
    logger.log('未找到创作按钮', 'error');
    return false;
  }
  
  logger.log('点击创作按钮', 'action');
  simulateClick(createBtn);
  
  // 等待 AI 生成图片（需要较长时间，30-60秒）
  logger.log('⏳ 等待 AI 生成图片（约30-60秒）...', 'info');
  
  // 等待生成完成的策略：
  // 1. 检测是否有新的 ai-image-list 出现（新生成的图片会在新列表中）
  // 2. 检测生成进度（百分比）是否消失
  // 3. 检测新图片是否加载完成（没有加载中的状态）
  
  const maxWaitTime = 90000; // 最长等待90秒
  const startTime = Date.now();
  let generationComplete = false;
  
  // 先等待一小段时间让生成开始
  await new Promise(r => setTimeout(r, 3000));
  
  while (Date.now() - startTime < maxWaitTime) {
    // 检查1: 是否有新的 ai-image-list 出现
    const currentListCount = document.querySelectorAll('.ai-image-list').length;
    
    // 检查2: 检测是否有正在生成的进度指示器（百分比文字如 "18%"）
    const hasLoadingProgress = Array.from(document.querySelectorAll('.ai-image-item, [class*="ai-image"]')).some(el => {
      const text = (el as HTMLElement).innerText || '';
      // 检测是否包含百分比（如 "18%", "25%" 等）
      return /\d+%/.test(text) && !text.includes('100%');
    });
    
    // 检查3: 检测是否有加载中的动画或 loading 状态
    const hasLoadingSpinner = document.querySelector('.ai-image-item .loading, .ai-image-item [class*="loading"], .ai-image-generating');
    
    // 如果有新列表出现，且没有正在加载的进度，说明生成完成
    if (currentListCount > initialListCount && !hasLoadingProgress && !hasLoadingSpinner) {
      logger.log(`检测到新的 ai-image-list（${initialListCount} -> ${currentListCount}），生成完成`, 'success');
      generationComplete = true;
      break;
    }
    
    // 如果列表数量没变，但检测到新图片（通过检查最后一个列表中的图片是否都加载完成）
    if (!hasLoadingProgress && !hasLoadingSpinner) {
      const lastList = document.querySelectorAll('.ai-image-list')[currentListCount - 1];
      if (lastList) {
        const items = lastList.querySelectorAll('.ai-image-item');
        // 检查是否有新生成的图片（有 operation-group 且图片已加载）
        const hasNewImages = Array.from(items).some(item => {
          const hasOpGroup = item.querySelector('.ai-image-operation-group');
          const img = item.querySelector('img');
          const hasLoadedImg = img && img.complete && img.naturalWidth > 0;
          const itemText = (item as HTMLElement).innerText || '';
          const isNotLoading = !/\d+%/.test(itemText);
          return hasOpGroup && hasLoadedImg && isNotLoading;
        });
        
        if (hasNewImages && items.length >= 4) {
          // 额外等待确保所有图片都加载完成
          await new Promise(r => setTimeout(r, 2000));
          
          // 再次检查是否还有加载中的
          const stillLoading = Array.from(document.querySelectorAll('.ai-image-item')).some(el => {
            const text = (el as HTMLElement).innerText || '';
            return /\d+%/.test(text) && !text.includes('100%');
          });
          
          if (!stillLoading) {
            logger.log('所有图片生成完成', 'success');
            generationComplete = true;
            break;
          }
        }
      }
    }
    
    // 每2秒检查一次
    await new Promise(r => setTimeout(r, 2000));
    
    // 显示等待进度
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      const loadingItems = Array.from(document.querySelectorAll('.ai-image-item')).filter(el => {
        const text = (el as HTMLElement).innerText || '';
        return /\d+%/.test(text);
      });
      logger.log(`⏳ 已等待 ${elapsed} 秒... (${loadingItems.length} 张图片生成中)`, 'info');
    }
  }
  
  if (!generationComplete) {
    logger.log('AI 图片生成超时，尝试继续...', 'warn');
    // 即使超时也尝试继续，可能图片已经生成了
  }
  
  // 额外等待确保 UI 完全更新
  await new Promise(r => setTimeout(r, 2000));
  
  logger.log('AI 图片生成流程完成', 'success');
  return true;
};

/**
 * 选择并插入 AI 配图
 * AI 生成完成后，需要先悬浮在图片上让"插入"按钮显示，然后点击
 * 
 * 根据 Playwright 录制：
 * await page1.locator('div:nth-child(11) > .ai-image-list > div:nth-child(4) > .ai-image-operation-group > div:nth-child(2)').click();
 * 
 * 关键：
 * 1. 需要先悬浮在图片上，让 operation-group 显示
 * 2. 插入按钮是 .ai-image-operation-group 的第二个子 div
 * 3. 只点击一次，避免重复插入
 */
const insertAIImage = async (): Promise<boolean> => {
  logger.log('查找 AI 生成的图片...', 'info');
  
  // 等待一下确保 UI 更新
  await new Promise(r => setTimeout(r, 1000));
  
  // 关键：查找所有 ai-image-list，选择最后一个（新生成的图片在最后）
  const allImageLists = document.querySelectorAll('.ai-image-list');
  logger.log(`找到 ${allImageLists.length} 个 ai-image-list`, 'info');
  
  if (allImageLists.length === 0) {
    logger.log('未找到 ai-image-list', 'error');
    return false;
  }
  
  // 选择最后一个 ai-image-list（新生成的图片）
  const lastImageList = allImageLists[allImageLists.length - 1];
  logger.log('选择最后一个 ai-image-list（新生成的图片）', 'info');
  
  // 查找最后一个列表中的图片项
  const items = lastImageList.querySelectorAll('.ai-image-item, [class*="ai-image-item"]');
  logger.log(`最后一个列表中有 ${items.length} 个图片项`, 'info');
  
  if (items.length === 0) {
    logger.log('未找到图片项', 'error');
    return false;
  }
  
  // 选择第一个图片项（通常是最好的一张）
  const targetItem = items[0] as HTMLElement;
  
  if (!targetItem) {
    logger.log('未找到目标图片项', 'error');
    return false;
  }
  
  // 关键步骤：模拟鼠标悬浮在图片上，让"插入"按钮显示出来
  logger.log('悬浮在图片上显示操作按钮...', 'action');
  
  // 滚动到图片位置
  targetItem.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  
  // 模拟鼠标悬浮事件
  const rect = targetItem.getBoundingClientRect();
  const hoverOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  
  targetItem.dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
  targetItem.dispatchEvent(new MouseEvent('mouseover', hoverOptions));
  targetItem.dispatchEvent(new MouseEvent('mousemove', hoverOptions));
  
  // 等待操作按钮显示
  await new Promise(r => setTimeout(r, 800));
  
  // 现在查找插入按钮
  let insertBtn: HTMLElement | null = null;
  
  // 方法1：在当前图片项中查找 operation-group 的第二个子元素
  const operationGroup = targetItem.querySelector('.ai-image-operation-group');
  if (operationGroup) {
    logger.log('找到 operation-group', 'info');
    const secondChild = operationGroup.children[1] as HTMLElement;
    if (secondChild) {
      insertBtn = secondChild;
      logger.log('找到插入按钮（operation-group 第二个子元素）', 'success');
    }
  }
  
  // 方法2：通过文本"插入"查找
  if (!insertBtn) {
    const btns = targetItem.querySelectorAll('div, span, button');
    for (const btn of btns) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === '插入') {
        insertBtn = btn as HTMLElement;
        logger.log('通过文本"插入"找到按钮', 'success');
        break;
      }
    }
  }
  
  // 方法3：在整个最后一个列表中查找可见的插入按钮
  if (!insertBtn) {
    const allBtns = lastImageList.querySelectorAll('.ai-image-operation-group div, .ai-image-finetuning-btn');
    for (const btn of allBtns) {
      const text = (btn as HTMLElement).innerText?.trim();
      const style = window.getComputedStyle(btn as HTMLElement);
      if (text === '插入' && style.display !== 'none' && style.visibility !== 'hidden') {
        insertBtn = btn as HTMLElement;
        logger.log('在列表中找到可见的插入按钮', 'success');
        break;
      }
    }
  }
  
  // 方法4：如果还没找到，尝试悬浮在其他图片上
  if (!insertBtn) {
    logger.log('尝试悬浮在其他图片上...', 'info');
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement;
      
      // 悬浮
      item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      
      // 查找插入按钮
      const opGroup = item.querySelector('.ai-image-operation-group');
      if (opGroup) {
        const btn = opGroup.children[1] as HTMLElement;
        if (btn) {
          insertBtn = btn;
          logger.log(`在第 ${i + 1} 张图片上找到插入按钮`, 'success');
          break;
        }
      }
      
      // 通过文本查找
      const textBtns = item.querySelectorAll('div, span');
      for (const btn of textBtns) {
        if ((btn as HTMLElement).innerText?.trim() === '插入') {
          insertBtn = btn as HTMLElement;
          logger.log(`在第 ${i + 1} 张图片上通过文本找到插入按钮`, 'success');
          break;
        }
      }
      
      if (insertBtn) break;
    }
  }
  
  if (!insertBtn) {
    logger.log('未找到插入按钮', 'error');
    return false;
  }
  
  logger.log('点击插入图片（仅一次）', 'action');
  
  // 确保按钮可见
  insertBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 200));
  
  // 只点击一次插入按钮
  simulateClick(insertBtn);
  
  // 等待图片插入完成
  await new Promise(r => setTimeout(r, 1500));
  
  logger.log('AI 图片已插入', 'success');
  return true;
};

/**
 * 使用 AI 生成封面图片
 * 关键：必须在封面区域悬浮后点击"AI 配图"按钮，这样生成的图片才会设置为封面
 * 而不是使用正文的图片插入方式
 * @param title 文章标题
 * @param content 文章内容（包含封面提示词）
 * 
 * 根据 Playwright 录制，封面 AI 配图的正确流程：
 * 1. 悬浮在封面区域，触发菜单显示
 * 2. 点击 getByRole('link', { name: 'AI 配图' }) - 封面区域的 AI 配图链接
 * 3. 输入提示词，设置 16:9 尺寸，点击"开始创作"
 * 4. 生成完成后，悬浮图片，点击 operation-group 的第二个子元素（使用按钮）
 * 5. 点击"确认"按钮完成封面设置
 * 
 * 注意：封面的 AI 配图链接和正文的不同！
 * - 封面：getByRole('link', { name: 'AI 配图' }) - 在封面悬浮菜单中
 * - 正文：locator('#js_editor_insertimage').getByText('AI 配图') - 在图片按钮下拉菜单中
 */
const setCoverWithAI = async (title?: string, content?: string): Promise<boolean> => {
  logger.log('🎨 使用 AI 生成封面图片...', 'info');
  
  // 获取文章标题和内容
  const articleTitle = title || getArticleTitle();
  const articleContent = content || getArticleContent();
  
  if (!articleTitle) {
    logger.log('未找到文章标题，无法生成封面', 'warn');
    return false;
  }
  
  // 从内容中提取封面提示词（[封面: xxx] 格式）
  const coverPromptData = extractCoverPrompt(articleContent);
  let coverPrompt: string;
  
  if (coverPromptData) {
    // 使用 AI 生成的封面提示词
    coverPrompt = coverPromptData.prompt;
    logger.log(`使用文章中的封面提示词: ${coverPrompt.substring(0, 50)}...`, 'info');
  } else {
    // 如果没有封面提示词，使用自动生成的
    coverPrompt = generateImagePrompt(articleTitle, articleContent, undefined, true);
    logger.log(`自动生成封面提示词: ${coverPrompt.substring(0, 50)}...`, 'info');
  }
  
  // 滚动到页面底部，确保封面区域可见
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 500));
  
  // 步骤1: 查找封面区域 - 使用精确的选择器
  // 根据截图: div.select-cover__btn.js_cover_btn_area.select-cover__mask
  logger.log('查找封面区域...', 'info');
  
  let coverArea: HTMLElement | null = null;
  
  // 方法1: 使用精确的类名选择器
  coverArea = document.querySelector('.select-cover__btn.js_cover_btn_area.select-cover__mask') as HTMLElement;
  if (coverArea) {
    logger.log('找到封面区域: select-cover__btn', 'info');
  }
  
  // 方法2: 查找包含"拖拽或选择封面"文本的区域
  if (!coverArea) {
    const allElements = document.querySelectorAll('div, span');
    for (const el of allElements) {
      const text = (el as HTMLElement).innerText?.trim();
      if (text === '拖拽或选择封面' || text?.includes('拖拽或选择封面')) {
        // 找到文本后，向上查找可悬浮的父容器
        coverArea = el.closest('.select-cover__btn, .js_cover_btn_area, [class*="cover_btn"]') as HTMLElement;
        if (!coverArea) {
          coverArea = el.parentElement as HTMLElement;
        }
        logger.log('找到封面区域: 拖拽或选择封面', 'info');
        break;
      }
    }
  }
  
  // 方法3: 查找封面添加按钮区域
  if (!coverArea) {
    coverArea = findElement(SELECTORS.coverAddButton);
  }
  
  if (!coverArea) {
    logger.log('未找到封面区域', 'error');
    return false;
  }
  
  // 滚动到封面区域
  coverArea.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 500));
  
  // 步骤2: 关键！必须正确悬浮在封面区域上，触发封面专用的弹出菜单
  // 根据 HTML 结构分析，封面的 AI 配图链接在 pop-opr__group 弹出菜单中
  // 选择器是：a.pop-opr__button.js_aiImage
  logger.log('悬浮在封面区域显示菜单...', 'action');
  
  // 查找封面区域的可点击按钮（.select-cover__btn.js_cover_btn_area）
  let coverBtn = coverArea.closest('.select-cover__btn.js_cover_btn_area') as HTMLElement;
  if (!coverBtn) {
    coverBtn = document.querySelector('.select-cover__btn.js_cover_btn_area') as HTMLElement;
  }
  if (!coverBtn) {
    coverBtn = coverArea;
  }
  
  logger.log(`封面按钮: ${coverBtn.className || 'unknown'}`, 'info');
  
  // 滚动到封面按钮
  coverBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  
  const rect = coverBtn.getBoundingClientRect();
  const hoverOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  
  // 多次触发悬浮事件，确保弹出菜单显示
  for (let i = 0; i < 3; i++) {
    coverBtn.dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
    coverBtn.dispatchEvent(new MouseEvent('mouseover', hoverOptions));
    coverBtn.dispatchEvent(new MouseEvent('mousemove', hoverOptions));
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 等待弹出菜单出现
  await new Promise(r => setTimeout(r, 1000));
  
  // 步骤3: 查找并点击封面区域的 "AI 配图" 链接
  // 关键：封面的 AI 配图链接在 pop-opr__group 弹出菜单中，选择器是 a.js_aiImage
  logger.log('查找封面 AI 配图链接...', 'info');
  
  let aiCoverBtn: HTMLElement | null = null;
  
  // 方法1: 使用精确的选择器 a.js_aiImage（封面专用）
  aiCoverBtn = document.querySelector('a.js_aiImage, a.pop-opr__button.js_aiImage') as HTMLElement;
  if (aiCoverBtn && isElementVisible(aiCoverBtn)) {
    logger.log('通过 a.js_aiImage 找到封面 AI 配图链接', 'success');
  } else {
    aiCoverBtn = null;
  }
  
  // 方法2: 在 pop-opr__group 弹出菜单中查找
  if (!aiCoverBtn) {
    const popOprGroup = document.querySelector('.pop-opr__group, #js_cover_null, .pop-opr__group-select-cover') as HTMLElement;
    if (popOprGroup && isElementVisible(popOprGroup)) {
      logger.log('找到封面弹出菜单 pop-opr__group', 'info');
      const links = popOprGroup.querySelectorAll('a, li');
      for (const link of links) {
        const text = (link as HTMLElement).innerText?.trim();
        if (text === 'AI 配图' || text === 'AI配图') {
          aiCoverBtn = link as HTMLElement;
          logger.log('在 pop-opr__group 中找到 AI 配图链接', 'success');
          break;
        }
      }
    }
  }
  
  // 方法3: 如果弹出菜单没显示，点击封面区域触发
  if (!aiCoverBtn) {
    logger.log('点击封面区域触发弹出菜单...', 'info');
    
    // 点击封面按钮
    simulateClick(coverBtn);
    await new Promise(r => setTimeout(r, 1000));
    
    // 再次查找 a.js_aiImage
    aiCoverBtn = document.querySelector('a.js_aiImage, a.pop-opr__button.js_aiImage') as HTMLElement;
    if (aiCoverBtn && isElementVisible(aiCoverBtn)) {
      logger.log('点击后通过 a.js_aiImage 找到封面 AI 配图链接', 'success');
    } else {
      aiCoverBtn = null;
      
      // 在 pop-opr__group 中查找
      const popOprGroup = document.querySelector('.pop-opr__group, #js_cover_null') as HTMLElement;
      if (popOprGroup) {
        const links = popOprGroup.querySelectorAll('a, li');
        for (const link of links) {
          const text = (link as HTMLElement).innerText?.trim();
          if (text === 'AI 配图' || text === 'AI配图') {
            aiCoverBtn = link as HTMLElement;
            logger.log('点击后在 pop-opr__group 中找到 AI 配图链接', 'success');
            break;
          }
        }
      }
    }
  }
  
  // 方法4: 全局查找封面 AI 配图链接（排除正文区域）
  if (!aiCoverBtn) {
    logger.log('全局查找封面 AI 配图链接（排除正文区域）...', 'info');
    
    // 查找所有包含 "AI 配图" 的链接
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = (link as HTMLElement).innerText?.trim();
      if ((text === 'AI 配图' || text === 'AI配图') && isElementVisible(link as HTMLElement)) {
        // 排除正文图片按钮区域的 AI 配图（在 tpl_dropdown_menu 中）
        const isInEditorDropdown = link.closest('.tpl_dropdown_menu, #js_editor_insertimage, .edui-for-insertimage');
        if (!isInEditorDropdown) {
          aiCoverBtn = link as HTMLElement;
          logger.log('全局找到封面 AI 配图链接（已排除正文区域）', 'success');
          break;
        }
      }
    }
  }
  
  if (!aiCoverBtn) {
    logger.log('未找到封面 AI 配图按钮，尝试从正文选择', 'warn');
    return await setCoverFromContent();
  }
  
  // 点击封面区域的 AI 配图按钮
  logger.log('点击封面 AI 配图按钮', 'action');
  simulateClick(aiCoverBtn);
  
  // 关键：等待 AI 配图弹窗完全加载（封面弹窗可能需要更长时间）
  logger.log('等待 AI 配图弹窗加载...', 'info');
  await new Promise(r => setTimeout(r, 3000));
  
  // 步骤5: 输入封面提示词（使用前面提取或生成的 coverPrompt）
  logger.log(`封面提示词: ${coverPrompt.substring(0, 60)}...`, 'info');
  
  // 查找并输入提示词 - 使用更全面的查找方法
  let promptInput: HTMLElement | null = null;
  
  // 方法1: 在弹窗中查找输入框
  const dialogs = document.querySelectorAll('.weui-desktop-dialog, [class*="dialog"], [class*="modal"]');
  for (const dialog of dialogs) {
    if (isElementVisible(dialog as HTMLElement)) {
      const inputs = dialog.querySelectorAll('input, textarea');
      for (const input of inputs) {
        const placeholder = input.getAttribute('placeholder') || '';
        if ((placeholder.includes('描述') || placeholder.includes('创作') || placeholder.includes('输入')) && 
            isElementVisible(input as HTMLElement)) {
          promptInput = input as HTMLElement;
          logger.log('在弹窗中找到输入框', 'info');
          break;
        }
      }
      if (promptInput) break;
      
      // 如果没找到带 placeholder 的，尝试找任何可见的输入框
      if (!promptInput) {
        const anyInput = dialog.querySelector('input:not([type="hidden"]), textarea') as HTMLElement;
        if (anyInput && isElementVisible(anyInput)) {
          promptInput = anyInput;
          logger.log('在弹窗中找到输入框（无 placeholder）', 'info');
          break;
        }
      }
    }
  }
  
  // 方法2: 通过 placeholder 全局查找
  if (!promptInput) {
    const inputs = document.querySelectorAll('input, textarea');
    for (const input of inputs) {
      const placeholder = input.getAttribute('placeholder') || '';
      if ((placeholder.includes('描述') || placeholder.includes('创作')) && isElementVisible(input as HTMLElement)) {
        promptInput = input as HTMLElement;
        logger.log('通过 placeholder 找到输入框', 'info');
        break;
      }
    }
  }
  
  // 方法3: 使用预定义的选择器
  if (!promptInput) {
    promptInput = await waitForElement(SELECTORS.aiPromptInput, 5000);
    if (promptInput) {
      logger.log('通过预定义选择器找到输入框', 'info');
    }
  }
  
  // 方法4: 查找 AI 配图相关的输入框
  if (!promptInput) {
    const aiInputSelectors = [
      '.ai-image-input input',
      '.ai-image-input textarea',
      '[class*="ai-image"] input',
      '[class*="ai-image"] textarea',
      '.weui-desktop-dialog input[type="text"]',
      '.weui-desktop-dialog textarea'
    ];
    for (const selector of aiInputSelectors) {
      const input = document.querySelector(selector) as HTMLElement;
      if (input && isElementVisible(input)) {
        promptInput = input;
        logger.log(`通过选择器 ${selector} 找到输入框`, 'info');
        break;
      }
    }
  }
  
  // 方法5: 如果还没找到，等待更长时间再试
  if (!promptInput) {
    logger.log('输入框未立即出现，等待更长时间...', 'info');
    await new Promise(r => setTimeout(r, 2000));
    
    // 再次尝试查找
    const allInputs = document.querySelectorAll('input:not([type="hidden"]), textarea');
    for (const input of allInputs) {
      if (isElementVisible(input as HTMLElement)) {
        const rect = (input as HTMLElement).getBoundingClientRect();
        // 检查是否在屏幕可见区域内
        if (rect.top > 0 && rect.top < window.innerHeight) {
          promptInput = input as HTMLElement;
          logger.log('延迟后找到可见输入框', 'info');
          break;
        }
      }
    }
  }
  
  if (promptInput) {
    simulateClick(promptInput);
    await new Promise(r => setTimeout(r, 200));
    simulateInput(promptInput, coverPrompt);
    logger.log('已输入封面提示词', 'success');
  } else {
    logger.log('未找到提示词输入框', 'error');
    // 打印当前页面上所有可见的输入框，便于调试
    const visibleInputs = Array.from(document.querySelectorAll('input, textarea')).filter(el => isElementVisible(el as HTMLElement));
    logger.log(`当前页面有 ${visibleInputs.length} 个可见输入框`, 'info');
    for (let i = 0; i < Math.min(visibleInputs.length, 3); i++) {
      const input = visibleInputs[i] as HTMLElement;
      logger.log(`输入框 ${i + 1}: placeholder="${input.getAttribute('placeholder')}", class="${input.className}"`, 'info');
    }
    return false;
  }
  
  await new Promise(r => setTimeout(r, 500));
  
  // 步骤6: 关键！先设置图片尺寸为 16:9
  // 根据 Playwright 录制: 先点击 ':1' 展开尺寸选择，再点击 '.ratio_item_shape.ratio-16-9'
  logger.log('设置图片尺寸为 16:9...', 'action');
  
  // 查找当前尺寸按钮（显示 "1:1" 的按钮）
  let ratioBtn: HTMLElement | null = null;
  
  // 方法1: 查找包含 "1:1" 或 ":1" 文本的按钮
  const ratioBtns = document.querySelectorAll('button, div, span');
  for (const btn of ratioBtns) {
    const text = (btn as HTMLElement).innerText?.trim();
    if ((text === '1:1' || text === '1:1 ↓' || text?.includes(':1')) && isElementVisible(btn as HTMLElement)) {
      // 确保是在 AI 配图弹窗内
      const dialog = btn.closest('.weui-desktop-dialog, [class*="dialog"], [class*="modal"]');
      if (dialog) {
        ratioBtn = btn as HTMLElement;
        logger.log('找到尺寸选择按钮', 'info');
        break;
      }
    }
  }
  
  // 方法2: 查找 ratio 相关的元素
  if (!ratioBtn) {
    ratioBtn = document.querySelector('[class*="ratio"] button, [class*="ratio"] div') as HTMLElement;
  }
  
  if (ratioBtn) {
    // 点击展开尺寸选择
    simulateClick(ratioBtn);
    await new Promise(r => setTimeout(r, 500));
    
    // 查找并点击 16:9 选项
    let ratio16_9: HTMLElement | null = null;
    
    // 方法1: 使用精确的类名
    ratio16_9 = document.querySelector('.ratio_item_shape.ratio-16-9') as HTMLElement;
    
    // 方法2: 查找包含 "16:9" 文本的元素
    if (!ratio16_9) {
      const ratioItems = document.querySelectorAll('[class*="ratio"], div, span');
      for (const item of ratioItems) {
        const text = (item as HTMLElement).innerText?.trim();
        if (text === '16:9' && isElementVisible(item as HTMLElement)) {
          ratio16_9 = item as HTMLElement;
          break;
        }
      }
    }
    
    // 方法3: 查找 ratio-16-9 类
    if (!ratio16_9) {
      ratio16_9 = document.querySelector('[class*="16-9"], [class*="16_9"]') as HTMLElement;
    }
    
    if (ratio16_9) {
      logger.log('点击 16:9 尺寸', 'action');
      simulateClick(ratio16_9);
      await new Promise(r => setTimeout(r, 500));
      logger.log('已设置尺寸为 16:9', 'success');
    } else {
      logger.log('未找到 16:9 选项，使用默认尺寸', 'warn');
    }
  } else {
    logger.log('未找到尺寸选择按钮，使用默认尺寸', 'warn');
  }
  
  await new Promise(r => setTimeout(r, 300));
  
  // 步骤7: 点击"重新创作"按钮
  let createBtn = findElementByText('重新创作', ['button', 'div', 'span']);
  if (!createBtn) {
    createBtn = findElementByText('开始创作', ['button', 'div', 'span']);
  }
  
  if (!createBtn) {
    logger.log('未找到创作按钮', 'error');
    return false;
  }
  
  logger.log('点击创作封面', 'action');
  simulateClick(createBtn);
  
  // 步骤8: 等待生成完成
  logger.log('⏳ 等待封面生成（约30-60秒）...', 'info');
  await new Promise(r => setTimeout(r, 3000));
  
  const maxWaitTime = 90000;
  const startTime = Date.now();
  let generationComplete = false;
  
  while (Date.now() - startTime < maxWaitTime) {
    // 检查是否还有加载中的进度
    const hasLoadingProgress = Array.from(document.querySelectorAll('.ai-image-item, [class*="ai-image"]')).some(el => {
      const text = (el as HTMLElement).innerText || '';
      return /\d+%/.test(text) && !text.includes('100%');
    });
    
    if (!hasLoadingProgress) {
      // 检查是否有生成完成的图片
      const allLists = document.querySelectorAll('.ai-image-list');
      if (allLists.length > 0) {
        const lastList = allLists[allLists.length - 1];
        const items = lastList.querySelectorAll('.ai-image-item');
        if (items.length > 0) {
          const img = items[0].querySelector('img');
          if (img && img.complete && img.naturalWidth > 0) {
            logger.log('封面图片生成完成', 'success');
            generationComplete = true;
            break;
          }
        }
      }
    }
    
    await new Promise(r => setTimeout(r, 2000));
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      logger.log(`⏳ 已等待 ${elapsed} 秒...`, 'info');
    }
  }
  
  if (!generationComplete) {
    logger.log('封面生成超时，尝试继续...', 'warn');
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 关键：在封面 AI 配图弹窗中，需要点击 operation-group 的第二个子元素
  // 根据 Playwright 录制：
  // await page.locator('div:nth-child(11) > .ai-image-list > div:nth-child(4) > .ai-image-operation-group > div:nth-child(2)').click();
  // await page.getByRole('button', { name: '确认' }).click();
  logger.log('选择封面图片...', 'action');
  
  const allLists = document.querySelectorAll('.ai-image-list');
  if (allLists.length > 0) {
    const lastList = allLists[allLists.length - 1];
    const items = lastList.querySelectorAll('.ai-image-item');
    
    if (items.length > 0) {
      const targetItem = items[0] as HTMLElement;
      
      // 悬浮显示操作按钮
      targetItem.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(r => setTimeout(r, 300));
      
      const itemRect = targetItem.getBoundingClientRect();
      targetItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: itemRect.left + itemRect.width / 2, clientY: itemRect.top + itemRect.height / 2 }));
      targetItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      
      // 根据 Playwright 录制，直接点击 operation-group 的第二个子元素
      // 这是封面 AI 配图弹窗中的"使用"按钮位置
      let useBtn: HTMLElement | null = null;
      
      const opGroup = targetItem.querySelector('.ai-image-operation-group');
      if (opGroup) {
        const children = opGroup.children;
        logger.log(`operation-group 有 ${children.length} 个子元素`, 'info');
        
        // 打印所有按钮的文字，便于调试
        for (let i = 0; i < children.length; i++) {
          const btn = children[i] as HTMLElement;
          const text = btn.innerText?.trim();
          logger.log(`按钮 ${i + 1}: "${text}"`, 'info');
        }
        
        // 根据 Playwright 录制，点击第二个子元素（div:nth-child(2)）
        const secondBtn = children[1] as HTMLElement;
        if (secondBtn) {
          const text = secondBtn.innerText?.trim();
          // 如果第二个按钮不是"插入"，则使用它（封面弹窗中应该是"使用"或类似的）
          // 如果是"插入"，说明打开的是正文的 AI 配图弹窗，需要警告
          if (text === '插入') {
            logger.log('⚠️ 检测到"插入"按钮，可能打开的是正文 AI 配图弹窗而非封面弹窗', 'warn');
            logger.log('尝试继续，但封面可能无法正确设置', 'warn');
          }
          useBtn = secondBtn;
          logger.log(`使用第二个按钮: "${text}"`, 'info');
        }
      }
      
      // 如果没找到 operation-group，尝试其他方法
      if (!useBtn) {
        // 尝试在图片项中查找任何可点击的按钮
        const btns = targetItem.querySelectorAll('div, span, button');
        for (const btn of btns) {
          const text = (btn as HTMLElement).innerText?.trim();
          if (text === '使用' || text === '选择' || text === '设为封面') {
            useBtn = btn as HTMLElement;
            logger.log(`通过文字找到按钮: "${text}"`, 'success');
            break;
          }
        }
      }
      
      if (useBtn) {
        logger.log('点击选择按钮', 'action');
        simulateClick(useBtn);
        await new Promise(r => setTimeout(r, 1500));
        
        // 关键：点击后需要点击"确认"按钮才能真正设置封面
        // 根据 Playwright 录制: await page.getByRole('button', { name: '确认' }).click();
        logger.log('查找确认按钮...', 'info');
        
        // 等待确认按钮出现
        await new Promise(r => setTimeout(r, 500));
        
        let confirmBtn: HTMLElement | null = null;
        
        // 方法1: 查找所有可见的"确认"按钮
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = (btn as HTMLElement).innerText?.trim();
          if (text === '确认' && isElementVisible(btn as HTMLElement)) {
            confirmBtn = btn as HTMLElement;
            logger.log('找到确认按钮', 'success');
            break;
          }
        }
        
        // 方法2: 在弹窗中查找
        if (!confirmBtn) {
          const dialogs = document.querySelectorAll('.weui-desktop-dialog, [class*="dialog"], [class*="modal"]');
          for (const dialog of dialogs) {
            if (isElementVisible(dialog as HTMLElement)) {
              const btns = dialog.querySelectorAll('button');
              for (const btn of btns) {
                const text = (btn as HTMLElement).innerText?.trim();
                if (text === '确认') {
                  confirmBtn = btn as HTMLElement;
                  logger.log('在弹窗中找到确认按钮', 'success');
                  break;
                }
              }
              if (confirmBtn) break;
            }
          }
        }
        
        // 方法3: 使用 findElementByText
        if (!confirmBtn) {
          confirmBtn = findElementByText('确认', ['button']);
        }
        
        if (confirmBtn) {
          logger.log('点击确认按钮', 'action');
          simulateClick(confirmBtn);
          await new Promise(r => setTimeout(r, 1000));
          logger.log('✅ AI 封面设置完成', 'success');
        } else {
          logger.log('未找到确认按钮，封面可能已设置或需要手动确认', 'warn');
        }
        
        return true;
      } else {
        // 如果实在找不到按钮，尝试直接点击图片
        logger.log('未找到操作按钮，尝试直接点击图片', 'warn');
        simulateClick(targetItem);
        await new Promise(r => setTimeout(r, 1500));
        
        // 检查是否有确认按钮需要点击
        const confirmBtn = findElementByText('确认', ['button']);
        if (confirmBtn) {
          logger.log('点击确认按钮', 'action');
          simulateClick(confirmBtn);
          await new Promise(r => setTimeout(r, 1000));
        }
        
        logger.log('✅ AI 封面设置完成', 'success');
        return true;
      }
    }
  }
  
  logger.log('未找到生成的封面图片', 'error');
  return false;
};

/**
 * 设置封面图片（从正文选择）- 备用方案
 * 需要先悬浮在封面区域，等菜单出现后再点击"从正文选择"
 */
const setCoverFromContent = async (): Promise<boolean> => {
  logger.log('设置封面图片...', 'info');
  
  // 滚动到页面底部，确保封面区域可见
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 500));
  
  // 查找封面区域 - 查找包含"拖拽或选择封面"文本的区域
  let coverArea: HTMLElement | null = null;
  
  // 方法1: 查找包含"拖拽或选择封面"文本的区域
  const allElements = document.querySelectorAll('div, span');
  for (const el of allElements) {
    const text = (el as HTMLElement).innerText?.trim();
    if (text === '拖拽或选择封面' || text?.includes('拖拽或选择封面')) {
      coverArea = el as HTMLElement;
      logger.log('找到封面区域: 拖拽或选择封面', 'info');
      break;
    }
  }
  
  // 方法2: 查找封面添加按钮区域
  if (!coverArea) {
    coverArea = findElement(SELECTORS.coverAddButton);
    if (coverArea) {
      logger.log('找到封面区域: add_cover', 'info');
    }
  }
  
  // 方法3: 查找封面容器
  if (!coverArea) {
    coverArea = document.querySelector('.cover-wrap, .js_cover_area, [class*="cover"]') as HTMLElement;
    if (coverArea) {
      logger.log('找到封面区域: cover class', 'info');
    }
  }
  
  if (!coverArea) {
    logger.log('未找到封面区域', 'error');
    return false;
  }
  
  // 滚动到封面区域
  coverArea.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  
  // 关键：悬浮在封面区域上，触发菜单显示
  logger.log('悬浮在封面区域显示菜单...', 'action');
  
  // 获取封面区域的父容器（需要悬浮在更大的区域上）
  // 尝试找到包含封面区域的父容器
  let coverContainer = coverArea.closest('[class*="cover-wrap"], [class*="cover_wrap"], .cover-container') as HTMLElement;
  if (!coverContainer) {
    // 向上查找几层父元素
    coverContainer = coverArea.parentElement?.parentElement as HTMLElement || coverArea;
  }
  
  // 模拟鼠标悬浮事件 - 在封面区域上
  const rect = coverArea.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const hoverOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY
  };
  
  // 先在父容器上触发悬浮
  if (coverContainer && coverContainer !== coverArea) {
    coverContainer.dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
    coverContainer.dispatchEvent(new MouseEvent('mouseover', hoverOptions));
    coverContainer.dispatchEvent(new MouseEvent('mousemove', hoverOptions));
  }
  
  // 再在封面区域上触发悬浮
  coverArea.dispatchEvent(new MouseEvent('mouseenter', hoverOptions));
  coverArea.dispatchEvent(new MouseEvent('mouseover', hoverOptions));
  coverArea.dispatchEvent(new MouseEvent('mousemove', hoverOptions));
  
  // 等待菜单出现
  await new Promise(r => setTimeout(r, 1000));
  
  // 查找"从正文选择"选项
  logger.log('查找"从正文选择"选项...', 'info');
  
  let selectFromContentLink: HTMLElement | null = null;
  
  // 方法1: 通过文本查找
  selectFromContentLink = findElementByText('从正文选择', ['a', 'span', 'div', 'li']);
  
  // 如果没找到，再次悬浮并等待
  if (!selectFromContentLink) {
    logger.log('第一次未找到，再次悬浮...', 'info');
    
    // 再次触发悬浮事件
    coverArea.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: centerX, clientY: centerY }));
    coverArea.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: centerX, clientY: centerY }));
    
    await new Promise(r => setTimeout(r, 1000));
    
    selectFromContentLink = findElementByText('从正文选择', ['a', 'span', 'div', 'li']);
  }
  
  // 方法2: 在下拉菜单中查找
  if (!selectFromContentLink) {
    const dropdowns = document.querySelectorAll('.weui-desktop-dropdown__list, .dropdown-menu, [class*="dropdown"], [class*="menu"], [class*="popover"]');
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
  
  // 方法3: 点击封面区域后再查找
  if (!selectFromContentLink) {
    logger.log('尝试点击封面区域...', 'info');
    
    // 点击封面区域
    coverArea.dispatchEvent(new MouseEvent('mousedown', hoverOptions));
    coverArea.dispatchEvent(new MouseEvent('mouseup', hoverOptions));
    coverArea.dispatchEvent(new MouseEvent('click', hoverOptions));
    
    await new Promise(r => setTimeout(r, 1000));
    
    selectFromContentLink = findElementByText('从正文选择', ['a', 'span', 'div', 'li']);
  }
  
  // 方法4: 全局搜索所有可见的"从正文选择"
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
    logger.log('未找到"从正文选择"链接，可能需要手动操作', 'error');
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
 * 提示词要复杂、具体，贴合文章内容
 * @param title 文章标题
 * @param content 文章内容
 * @param keyword 图片关键词（来自占位符）
 * @param isCover 是否是封面图（封面需要更吸引人）
 */
const generateImagePrompt = (title: string, content: string, keyword?: string, isCover = false): string => {
  // 清理内容，移除特殊字符
  const cleanContent = content.replace(/[#*\[\]【】：:]/g, '').substring(0, 300);
  
  // 提取文章主题关键词
  const titleKeywords = title.replace(/[，。！？、""'']/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 3).join('、');
  
  // 从内容中提取关键句子
  const sentences = cleanContent.split(/[。！？\n]/).filter(s => s.length > 10 && s.length < 50);
  const keySentence = sentences[0] || '';
  
  if (isCover) {
    // 封面图提示词 - 要吸引人、有视觉冲击力
    const coverPrompts = [
      `公众号封面图，主题"${title}"，画面要有强烈视觉冲击力，色彩鲜艳醒目，构图大气，能吸引读者点击，现代设计风格，高清质感，适合社交媒体传播`,
      `一张吸引眼球的封面配图，表现"${titleKeywords}"的核心概念，画面简洁有力，主体突出，色彩对比强烈，让人一眼就想点进来看，专业设计感，适合微信公众号`,
      `创意封面设计，围绕"${title}"主题，画面要有故事感和悬念感，引发读者好奇心，色彩搭配时尚，构图新颖独特，高端大气，适合自媒体文章封面`,
      `震撼的视觉封面，主题是"${keySentence.substring(0, 20) || title}"，画面要有冲击力和感染力，能引起情感共鸣，色彩饱满，细节精致，让人忍不住想了解更多`
    ];
    return coverPrompts[Math.floor(Math.random() * coverPrompts.length)];
  }
  
  if (keyword) {
    // 有具体关键词的配图 - 根据关键词和上下文生成
    const contextPrompts = [
      `一幅精美的插画，主题是"${keyword}"，与文章"${title}"相关，画面要能准确表达${keyword}的含义和情感，色彩和谐，构图精美，现代扁平化设计风格，适合公众号文章配图`,
      `创意配图，表现"${keyword}"的场景或概念，结合文章主题"${titleKeywords}"，画面生动形象，细节丰富，色彩明快，有艺术感和设计感，高清质感`,
      `一张关于"${keyword}"的概念图，要能让读者一眼理解其含义，画面简洁但有深度，色彩搭配专业，构图平衡，适合在"${title}"这篇文章中使用`,
      `插画设计，核心元素是"${keyword}"，风格要与"${keySentence.substring(0, 15) || title}"的氛围相符，画面有层次感，色彩鲜明但不刺眼，专业美观`
    ];
    return contextPrompts[Math.floor(Math.random() * contextPrompts.length)];
  }
  
  // 通用配图 - 根据文章整体内容生成
  const generalPrompts = [
    `一幅与"${title}"主题相关的精美插画，画面要能概括文章核心观点"${keySentence.substring(0, 25)}"，色彩和谐统一，构图大气，现代简约设计风格，高清质感，适合公众号文章`,
    `创意配图，围绕"${titleKeywords}"展开，画面要有故事性和感染力，能引起读者共鸣，色彩搭配时尚，细节精致，专业设计感`,
    `一张能代表文章"${title}"核心内容的概念图，画面简洁有力，主体突出，色彩明快，让读者一眼就能理解文章主旨，适合社交媒体传播`
  ];
  return generalPrompts[Math.floor(Math.random() * generalPrompts.length)];
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

/**
 * 从内容中提取封面提示词
 * 格式: [封面: xxx] 或 【封面: xxx】
 * @param content 文章内容
 * @returns 封面提示词，如果没有则返回 null
 */
const extractCoverPrompt = (content: string): { text: string; prompt: string } | null => {
  const patterns = [
    /\[封面[：:]\s*([^\]]+)\]/,
    /【封面[：:]\s*([^】]+)】/,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return {
        text: match[0],
        prompt: match[1].trim()
      };
    }
  }
  
  return null;
};

/**
 * 从内容中移除封面提示词
 * @param content 文章内容
 * @returns 移除封面提示词后的内容
 */
const removeCoverPromptFromContent = (content: string): string => {
  // 移除 [封面: xxx] 或 【封面: xxx】 格式的封面提示词
  let cleaned = content
    .replace(/\[封面[：:]\s*[^\]]+\]\s*/g, '')
    .replace(/【封面[：:]\s*[^】]+】\s*/g, '');
  
  // 清理多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  
  return cleaned;
};

/**
 * 在编辑器中查找并选中占位符文本
 * @param placeholderText 占位符文本，如 "[图片: 手机签到]"
 * @returns 是否成功选中
 */
const selectPlaceholderInEditor = (placeholderText: string): boolean => {
  const editor = findElement(SELECTORS.editor);
  if (!editor) return false;
  
  // 使用 TreeWalker 遍历所有文本节点
  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const index = text.indexOf(placeholderText);
    
    if (index !== -1) {
      // 找到了占位符，创建选区
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + placeholderText.length);
      
      // 清除现有选区并设置新选区
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 滚动到选中位置
        const rect = range.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          const element = node.parentElement;
          element?.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
        
        logger.log(`已选中占位符: ${placeholderText}`, 'success');
        return true;
      }
    }
  }
  
  logger.log(`未找到占位符: ${placeholderText}`, 'warn');
  return false;
};

/**
 * 关闭 AI 配图弹窗
 */
const closeAIImageDialog = async (): Promise<boolean> => {
  logger.log('关闭 AI 配图弹窗...', 'info');
  
  // 方法1: 查找关闭按钮（X）
  const closeButtons = document.querySelectorAll('.weui-desktop-dialog__close, .dialog-close, [class*="close"], .weui-desktop-icon-close');
  for (const btn of closeButtons) {
    if (isElementVisible(btn as HTMLElement)) {
      const parent = btn.closest('.weui-desktop-dialog, .dialog, [class*="dialog"]');
      if (parent) {
        logger.log('点击关闭按钮', 'action');
        simulateClick(btn as HTMLElement);
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    }
  }
  
  // 方法2: 点击弹窗外部区域（遮罩层）
  const masks = document.querySelectorAll('.weui-desktop-dialog__mask, .dialog-mask, [class*="mask"]');
  for (const mask of masks) {
    if (isElementVisible(mask as HTMLElement)) {
      logger.log('点击遮罩层关闭', 'action');
      simulateClick(mask as HTMLElement);
      await new Promise(r => setTimeout(r, 500));
      return true;
    }
  }
  
  // 方法3: 按 ESC 键
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  
  return true;
};

/**
 * 为单个占位符生成并插入 AI 图片
 * 关键：先选中占位符，再插入图片，这样图片会替换占位符
 * @param placeholder 占位符信息（keyword 就是 AI 提示词，直接使用不需要包装）
 * @param title 文章标题（备用）
 * @param content 文章内容（备用）
 * @returns 是否成功
 */
const generateAndInsertImageForPlaceholder = async (
  placeholder: { text: string; keyword: string },
  _title?: string,
  _content?: string
): Promise<boolean> => {
  logger.log(`处理占位符: ${placeholder.text}`, 'info');
  
  // 步骤1: 在编辑器中选中占位符
  if (!selectPlaceholderInEditor(placeholder.text)) {
    logger.log('无法选中占位符，跳过', 'warn');
    return false;
  }
  
  await new Promise(r => setTimeout(r, 300));
  
  // 步骤2: 打开图片对话框
  if (!await openImageDialog()) {
    logger.log('无法打开图片对话框', 'error');
    return false;
  }
  
  // 步骤3: 点击 AI 配图
  if (!await clickAIImage()) {
    logger.log('无法点击 AI 配图', 'error');
    await closeAIImageDialog();
    return false;
  }
  
  // 步骤4: 直接使用占位符中的关键词作为提示词，不需要额外包装
  // AI 给的是什么提示词就用什么
  const prompt = placeholder.keyword;
  
  logger.log(`AI 提示词: ${prompt}`, 'info');
  
  if (!await generateAIImage(prompt)) {
    logger.log('AI 图片生成失败', 'error');
    await closeAIImageDialog();
    return false;
  }
  
  // 步骤5: 插入图片（图片会插入到当前光标位置，即占位符位置）
  if (!await insertAIImage()) {
    logger.log('插入图片失败', 'error');
    await closeAIImageDialog();
    return false;
  }
  
  // 步骤6: 等待图片插入完成，弹窗会自动关闭
  await new Promise(r => setTimeout(r, 1000));
  
  logger.log(`占位符 "${placeholder.keyword}" 处理完成`, 'success');
  return true;
};

/**
 * 获取当前文章标题
 */
const getArticleTitle = (): string => {
  const titleEl = findElement(SELECTORS.titleInput);
  if (titleEl instanceof HTMLInputElement) {
    return titleEl.value || '';
  }
  return titleEl?.innerText || '';
};

/**
 * 获取当前文章内容
 */
const getArticleContent = (): string => {
  const editor = findElement(SELECTORS.editor);
  return editor?.innerText || '';
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
    // 支持多个图片占位符，为每个占位符生成不同的 AI 图片
    if (options.generateAI !== false) {
      logger.log('🎨 步骤3: 生成 AI 配图', 'info');
      
      // 查找文章中的图片占位符
      const placeholders = findImagePlaceholders();
      
      if (placeholders.length > 0) {
        logger.log(`找到 ${placeholders.length} 个图片占位符，开始逐个处理...`, 'info');
        
        for (let i = 0; i < placeholders.length; i++) {
          if (isFlowCancelled) return;
          
          const placeholder = placeholders[i];
          logger.log(`📷 处理第 ${i + 1}/${placeholders.length} 个图片: ${placeholder.keyword}`, 'info');
          
          // 为每个占位符生成并插入图片（传入标题和内容以生成更贴合的提示词）
          const success = await generateAndInsertImageForPlaceholder(placeholder, options.title, options.content);
          
          if (success) {
            logger.log(`✅ 第 ${i + 1} 张图片插入成功`, 'success');
          } else {
            logger.log(`⚠️ 第 ${i + 1} 张图片处理失败，继续下一个`, 'warn');
          }
          
          // 等待一段时间再处理下一个，避免操作过快
          if (i < placeholders.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        
        logger.log(`图片处理完成，共处理 ${placeholders.length} 个占位符`, 'success');
      } else {
        // 没有占位符，生成一张通用配图插入到文章末尾
        logger.log('未找到图片占位符，生成一张通用配图', 'info');
        
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
              
              // 插入最后一张图片（最新生成的）
              await insertAIImage();
            }
          }
        }
      }
    }
    if (isFlowCancelled) return;
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 4. 设置封面（使用 AI 生成吸引人的封面）
    logger.log('🖼️ 步骤4: 设置封面图片（AI 生成）', 'info');
    const coverSuccess = await setCoverWithAI(options.title, options.content);
    if (!coverSuccess) {
      logger.log('AI 封面生成失败，尝试从正文选择', 'warn');
      await setCoverFromContent();
    }
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
 * 图片会插入到占位符的位置，替换占位符文本
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
              await insertAIImage();
              logger.log('✅ AI 配图插入成功', 'success');
            }
          }
        }
      }
    } else {
      logger.log(`找到 ${placeholders.length} 个图片占位符`, 'info');
      
      let successCount = 0;
      
      for (let i = 0; i < placeholders.length; i++) {
        if (isFlowCancelled) break;
        
        const placeholder = placeholders[i];
        logger.log(`📷 处理第 ${i + 1}/${placeholders.length} 个: ${placeholder.keyword}`, 'info');
        
        // 使用新的函数处理每个占位符
        const success = await generateAndInsertImageForPlaceholder(placeholder);
        
        if (success) {
          successCount++;
          logger.log(`✅ 第 ${i + 1} 张图片插入成功`, 'success');
        } else {
          logger.log(`⚠️ 第 ${i + 1} 张图片处理失败`, 'warn');
        }
        
        // 等待一段时间再处理下一个
        if (i < placeholders.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      logger.log(`图片处理完成: ${successCount}/${placeholders.length} 成功`, 'info');
    }
    
    // 设置封面（使用 AI 生成）
    logger.log('🖼️ 设置封面图片（AI 生成）...', 'info');
    const coverSuccess = await setCoverWithAI();
    if (!coverSuccess) {
      logger.log('AI 封面生成失败，尝试从正文选择', 'warn');
      await setCoverFromContent();
    }
    
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

// ============================================
// 远程调试功能
// ============================================
import { showDebugPanel, startDebugSession, stopDebugSession, getDebugSessionStatus } from '../utils/remoteDebug';

// 导出远程调试功能到全局
(window as any).memoraidDebug = {
  showPanel: showDebugPanel,
  start: startDebugSession,
  stop: stopDebugSession,
  status: getDebugSessionStatus
};

// 监听调试消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHOW_DEBUG_PANEL') {
    showDebugPanel();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'START_DEBUG_SESSION') {
    startDebugSession().then(code => {
      sendResponse({ success: true, verificationCode: code });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  
  if (message.type === 'STOP_DEBUG_SESSION') {
    stopDebugSession().then(() => {
      sendResponse({ success: true });
    });
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

🔧 远程调试命令：
  memoraidDebug.showPanel()              - 显示调试面板
  memoraidDebug.start()                  - 启动调试会话（返回验证码）
  memoraidDebug.stop()                   - 停止调试会话
  memoraidDebug.status()                 - 获取调试状态

注意：AI 配图生成需要 30-60 秒，请耐心等待
`)