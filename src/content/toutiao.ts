import { reportArticlePublish } from '../utils/debug';
import { ImageHandler } from '../utils/imageHandler';
import { DOMHelper } from '../utils/domHelper';
import { UnifiedLogger } from '../utils/logger';

// 【调试】立即执行的日志，确认 content script 是否被加载
console.log('🚀 [Toutiao] Content script 文件已加载！', window.location.href);

// 【调试】修改页面标题，确保能看到 script 被加载
try {
  const originalTitle = document.title;
  document.title = '✅ Memoraid已加载 - ' + originalTitle;
  console.log('🎯 [Toutiao] 页面标题已修改，确认 script 执行');
} catch (e) {
  console.error('❌ [Toutiao] 修改标题失败:', e);
}

// Toutiao Publish Content Script - 元素识别版
// 完全通过 DOM 选择器操作，不依赖截图和 AI 对话

interface PublishData {
  title: string;
  content: string;
  htmlContent?: string;
  sourceUrl?: string;
  sourceImages?: string[];
  timestamp: number;
  generatedId?: string;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; // AI token 消耗数据
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
// DOM 工具函数 - 使用统一工具类
// ============================================

const findElement = (selectors: string[]): HTMLElement | null => DOMHelper.findElement(selectors);
const isElementVisible = (el: HTMLElement): boolean => DOMHelper.isElementVisible(el);
const simulateClick = (element: HTMLElement) => DOMHelper.simulateClick(element);
const simulateInput = (element: HTMLElement, value: string) => DOMHelper.simulateInput(element, value);
const waitForElement = (selectors: string[], timeout = 5000): Promise<HTMLElement | null> => 
  DOMHelper.waitForElement(selectors, timeout);

// 使用统一的图片处理工具类
const getImageUrlFromElement = (el: HTMLElement): string => ImageHandler.getImageUrlFromElement(el);

const getCandidateImageGroups = (container: ParentNode, maxCandidates = 10): Array<{ index: number; url: string }> => {
  const groups = Array.from(container.querySelectorAll('.img')).filter(el => isElementVisible(el as HTMLElement)) as HTMLElement[];
  const out: Array<{ index: number; url: string }> = [];
  for (let i = 0; i < groups.length && out.length < maxCandidates; i++) {
    const g = groups[i];
    const url = getImageUrlFromElement(g);
    if (!url || url.startsWith('data:')) continue;
    out.push({ index: i, url });
  }
  return out;
};

const pickBestImageGroupIndexWithAI = async (keyword: string, container: ParentNode): Promise<number | null> => {
  const candidates = getCandidateImageGroups(container, 10);
  if (candidates.length <= 1) return null;

  const titleEl = findElement(SELECTORS.titleInput);
  const title = titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement
    ? (titleEl.value || '').trim()
    : (titleEl?.innerText || '').trim();

  const editorEl = findElement(SELECTORS.editor);
  const contentSnippet = (editorEl?.innerText || '').trim().slice(0, 800);

  // 使用ImageHandler的AI选图功能
  const bestIndex = await ImageHandler.pickBestImageWithAI(
    keyword,
    candidates,
    title,
    contentSnippet
  );

  if (bestIndex !== null) {
    const bestUrl = candidates[bestIndex]?.url;
    logger.log(`AI 推荐第 ${bestIndex + 1} 张图片: ${bestUrl}`, 'info');
  }

  return bestIndex;
};

// 使用统一的图片处理工具类
const setInputFiles = (input: HTMLInputElement, files: File[]) => ImageHandler.setInputFiles(input, files);
const dataUrlToFile = (dataUrl: string, filename?: string) => ImageHandler.dataUrlToFile(dataUrl, filename);

const waitForImageFileInput = async (timeout = 8000): Promise<HTMLInputElement | null> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const dialog = findElement(SELECTORS.imageDialog) || document;
    const inputs = Array.from(dialog.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
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

const tryClickLocalUploadMenu = async (): Promise<void> => {
  const uploadTexts = ['上传图片', '本地上传', '本地图片', '上传', '本地', '本地上传图片'];
  const dialog = findElement(SELECTORS.imageDialog) || document;
  const elements = dialog.querySelectorAll('div, span, a, li, button');
  for (const el of elements) {
    const text = (el as HTMLElement).innerText?.trim();
    if (!text) continue;
    if (uploadTexts.includes(text) && isElementVisible(el as HTMLElement)) {
      simulateClick(el as HTMLElement);
      await new Promise(r => setTimeout(r, 400));
      break;
    }
  }
};

// 已移除 openImageDialogFromToolbarPreserveCursor，使用直接复制粘贴方式

/**
 * 方法1: 直接复制粘贴图片（推荐，更快更可靠）
 */
const copyAndPasteImageFromUrl = async (imageUrl: string): Promise<boolean> => {
  try {
    logger.log('使用复制粘贴方式插入图片', 'info');
    
    const editor = findElement(SELECTORS.editor);
    if (!editor) {
      logger.log('未找到编辑器', 'error');
      return false;
    }

    // 使用ImageHandler直接复制粘贴
    const success = await ImageHandler.copyAndPasteImage(
      imageUrl,
      editor,
      pendingSourceUrl || window.location.href
    );

    if (success) {
      logger.log('图片复制粘贴成功', 'success');
      await new Promise(r => setTimeout(r, 1000));
      return true;
    }

    logger.log('复制粘贴失败，尝试备用方法', 'warn');
    return false;
  } catch (error) {
    logger.log(`复制粘贴异常: ${error}`, 'error');
    return false;
  }
};

/**
 * 方法2: 通过文件上传（备用方法）
 */
const uploadAndInsertImageFromUrl = async (imageUrl: string): Promise<boolean> => {
  try {
    logger.log('使用文件上传方式插入图片', 'info');
    
    const dataUrl = await ImageHandler.fetchImageDataUrl(
      imageUrl,
      pendingSourceUrl || window.location.href
    );
    
    if (!dataUrl) {
      logger.log('无法获取图片DataURL', 'error');
      return false;
    }

    const file = dataUrlToFile(dataUrl);

    await tryClickLocalUploadMenu();
    const input = await waitForImageFileInput(8000);
    if (!input) {
      logger.log('未找到文件输入框', 'error');
      return false;
    }
    
    setInputFiles(input, [file]);

    await new Promise(r => setTimeout(r, 1500));
    await clickConfirmButton().catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch (error) {
    logger.log(`文件上传异常: ${error}`, 'error');
    return false;
  }
};

/**
 * 智能插入图片（优先复制粘贴，失败则使用上传）
 */
const insertImageFromUrl = async (imageUrl: string): Promise<boolean> => {
  // 先尝试复制粘贴（更快更可靠）
  const copyPasteSuccess = await copyAndPasteImageFromUrl(imageUrl);
  if (copyPasteSuccess) {
    return true;
  }

  // 复制粘贴失败，尝试文件上传
  logger.log('尝试备用上传方法', 'warn');
  return await uploadAndInsertImageFromUrl(imageUrl);
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

// 编辑器辅助函数 - 使用本地实现（特定于头条编辑器）
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
  
  placeholders.sort((a, b) => a.position - b.position);
  return placeholders;
};

// ============================================
// Logger UI - 使用统一样式
// ============================================
const logger = new UnifiedLogger({
  title: 'Memoraid 头条助手',
  icon: '📰',
  position: 'top-left'
});

// ============================================
// 图片操作核心功能 - 元素识别版
// ============================================

let isFlowCancelled = false;
let pendingSourceImages: string[] = [];
let pendingSourceUrl: string | undefined;

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
  
  // 查找封面区域
  const coverArea = document.querySelector('.article-cover, [class*="article-cover"]');
  if (!coverArea) {
    logger.log('未找到封面区域', 'error');
    return false;
  }
  
  // 方法1: 查找 .add-icon 元素（可能是 SVG 或其父元素）
  let clickTarget: HTMLElement | null = null;
  
  const addIcon = coverArea.querySelector('.add-icon');
  if (addIcon) {
    // 如果是 SVG 元素，找到它的可点击父元素
    if (addIcon instanceof SVGElement) {
      clickTarget = addIcon.closest('div, button, a') as HTMLElement;
      if (!clickTarget) {
        clickTarget = addIcon.parentElement as HTMLElement;
      }
    } else {
      clickTarget = addIcon as HTMLElement;
    }
  }
  
  // 方法2: 查找 .article-cover-add
  if (!clickTarget) {
    clickTarget = coverArea.querySelector('.article-cover-add') as HTMLElement;
  }
  
  // 方法3: 查找任何包含 "add" 的可点击元素
  if (!clickTarget) {
    const candidates = coverArea.querySelectorAll('div, button, a, span');
    for (const el of candidates) {
      const className = (el as HTMLElement).className || '';
      if (className.includes('add') && isElementVisible(el as HTMLElement)) {
        clickTarget = el as HTMLElement;
        break;
      }
    }
  }
  
  // 方法4: 直接点击封面区域本身
  if (!clickTarget) {
    clickTarget = coverArea as HTMLElement;
  }
  
  if (!clickTarget) {
    logger.log('未找到封面上传入口', 'error');
    return false;
  }
  
  logger.log('点击封面添加图标', 'action');
  simulateClick(clickTarget);
  
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
  const dialog = findElement(SELECTORS.imageDialog);
  const smartIndex = await pickBestImageGroupIndexWithAI(keyword, dialog || document);
  if (!await selectImage(smartIndex ?? imageIndex)) return false;
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
  const dialog = findElement(SELECTORS.imageDialog);
  const smartIndex = await pickBestImageGroupIndexWithAI(keyword, dialog || document);
  if (!await selectImage(smartIndex ?? imageIndex)) return false;
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

const insertSourceImageAtPlaceholder = async (placeholder: { text: string; keyword: string }, imageUrl: string): Promise<boolean> => {
  if (isFlowCancelled) return false;
  logger.log(`处理占位符(来源图): ${placeholder.text}`, 'info');

  if (!selectTextInEditor(placeholder.text)) {
    logger.log(`未找到占位符文本: ${placeholder.text}`, 'warn');
    return false;
  }
  
  // 先不删除占位符，等图片插入成功后再删除
  const success = await insertImageFromUrl(imageUrl);
  
  if (success) {
    // 图片插入成功，删除占位符
    if (selectTextInEditor(placeholder.text)) {
      document.execCommand('delete');
      await new Promise(r => setTimeout(r, 300));
    }
    logger.log(`占位符 "${placeholder.text}" 已替换为来源图片`, 'success');
    return true;
  } else {
    // 图片插入失败，保留占位符，尝试使用图库搜索
    logger.log(`来源图片插入失败，尝试使用图库搜索: ${placeholder.keyword}`, 'warn');
    
    // 删除占位符
    if (selectTextInEditor(placeholder.text)) {
      document.execCommand('delete');
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 尝试通过图库搜索插入
    try {
      if (!await openImageDialogFromToolbar()) {
        logger.log('无法打开图片对话框', 'error');
        return false;
      }
      if (isFlowCancelled) return false;
      
      const searchSuccess = await searchAndSelectImage(placeholder.keyword);
      if (searchSuccess) {
        logger.log(`占位符 "${placeholder.text}" 已通过图库搜索替换`, 'success');
        return true;
      }
    } catch (error) {
      logger.log(`图库搜索也失败: ${error}`, 'error');
    }
    
    return false;
  }
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
  
  // 调试日志
  logger.log(`可用素材图片数量: ${pendingSourceImages.length}`, 'info');
  if (pendingSourceImages.length > 0) {
    logger.log(`素材图片列表: ${pendingSourceImages.slice(0, 3).join(', ')}...`, 'info');
  }

  let successCount = 0;

  for (let i = 0; i < placeholders.length; i++) {
    if (isFlowCancelled) break;

    const placeholder = placeholders[i];
    
    // 默认不优先使用素材来源图片
    const sourceUrl = undefined;
    
    if (sourceUrl) {
      logger.log(`占位符 ${i + 1}: 使用素材来源图片 ${sourceUrl}`, 'info');
    } else {
      logger.log(`占位符 ${i + 1}: 使用图库搜索 "${placeholder.keyword}"`, 'info');
    }

    const success = sourceUrl
      ? await insertSourceImageAtPlaceholder(placeholder, sourceUrl).catch(() => false)
      : false;

    const finalSuccess = success ? true : await insertImageAtPlaceholder(placeholder);
    if (finalSuccess) {
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
  // logger.clear();
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
      const published = await autoPublishArticle();
      if (published) {
      }
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
  // logger.clear();
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
  // logger.clear();
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
  // logger.clear();
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
  // 【调试】使用 console.log 和 logger 双重日志
  console.log('🔍 [Toutiao] fillContent 函数开始执行...');
  console.log('[Toutiao] Content script 已加载，检查待发布数据...');
  
  // 使用 UI logger 确保用户能看到
  logger.log('📋 检查待发布数据...', 'info');
  
  try {
    const data = await chrome.storage.local.get('pending_toutiao_publish');
    console.log('[Toutiao] Storage 数据:', data);
    
    if (!data || !data.pending_toutiao_publish) {
      console.log('[Toutiao] 没有待发布数据，跳过填充');
      return;
    }
    
    const payload: PublishData = data.pending_toutiao_publish;
    if (Date.now() - payload.timestamp > 5 * 60 * 1000) {
      console.log('[Toutiao] 数据已过期，清除');
      chrome.storage.local.remove('pending_toutiao_publish');
      return;
    }
    
    console.log('[Toutiao] 找到待发布数据:', {
      title: payload.title,
      timestamp: payload.timestamp,
      age: Math.floor((Date.now() - payload.timestamp) / 1000) + 's'
    });
    
    pendingSourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages.filter(u => typeof u === 'string') : [];
    pendingSourceUrl = payload.sourceUrl;
    
    // 调试日志
    console.log('[Toutiao] 素材来源图片数量:', pendingSourceImages.length);
    console.log('[Toutiao] 素材来源图片列表:', pendingSourceImages);

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

    const settings = await chrome.storage.sync.get(['autoPublishAll', 'toutiao']);
    const autoPublish = settings.autoPublishAll === true
      ? true
      : settings.autoPublishAll === false
      ? false
      : settings.toutiao?.autoPublish !== false;

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

  const normalizeUrl = (href: string): string => {
    try {
      return new URL(href, window.location.href).toString();
    } catch {
      return href;
    }
  };

  const findPublishedUrl = (): string | null => {
    const hrefCandidates: string[] = [];
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href) hrefCandidates.push(normalizeUrl(href));
    }

    const text = document.body?.innerText || '';
    const textMatch =
      text.match(/https?:\/\/(?:www\.)?toutiao\.com\/article\/\d+\/?/i)?.[0] ||
      text.match(/https?:\/\/mp\.toutiao\.com\/a\d+/i)?.[0];
    if (textMatch) hrefCandidates.push(textMatch);

    for (const url of hrefCandidates) {
      const u = url.trim();
      if (!u) continue;
      if (u.includes('toutiao.com/article/')) return u;
      if (u.includes('mp.toutiao.com/a')) return u;
    }
    return null;
  };

  const reportOnce = (trigger: string, publishedUrl: string) => {
    if (hasReported) return;
    hasReported = true;

    // 优先使用缓存的标题
    const pendingTitle = sessionStorage.getItem('memoraid_pending_title');
    const finalTitle = (pendingTitle || getCurrentTitle() || document.title || '未命名文章').trim();
    
    // 读取 generatedId (重要:用于关联AI生成的记录)
    const generatedId = sessionStorage.getItem('memoraid_generated_id') || undefined;
    
    // 读取 token 数据
    const tokenUsageStr = sessionStorage.getItem('memoraid_token_usage');
    let tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
    if (tokenUsageStr) {
      try {
        tokenUsage = JSON.parse(tokenUsageStr);
      } catch (e) {
        console.error('解析 token 数据失败:', e);
      }
    }
    
    console.log('[Toutiao] 准备上报文章:', {
      trigger,
      title: finalTitle,
      url: publishedUrl,
      generatedId,
      hasTokenUsage: !!tokenUsage
    });
    
    // 如果成功上报，清除保存的标题和token数据
    // 注意: 不清除 generatedId，因为可能需要多次上报
    if (pendingTitle) {
      sessionStorage.removeItem('memoraid_pending_title');
    }
    if (tokenUsageStr) {
      sessionStorage.removeItem('memoraid_token_usage');
    }

    reportArticlePublish({
      platform: 'toutiao',
      title: finalTitle,
      url: publishedUrl,
      status: 'published',
      extra: { 
        trigger,
        // 记录 token 消耗数据
        promptTokens: tokenUsage?.promptTokens,
        completionTokens: tokenUsage?.completionTokens,
        totalTokens: tokenUsage?.totalTokens,
      },
      generatedId // 使用读取的 generatedId
    });
    
    console.log('[Toutiao] 文章上报成功');
  };

  const maybeReport = (trigger: string) => {
    if (!armed || hasReported) return;
    const publishedUrl = findPublishedUrl();
    console.log('[Toutiao] maybeReport 检查:', { trigger, armed, hasReported, foundUrl: !!publishedUrl });
    if (publishedUrl) reportOnce(trigger, publishedUrl);
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.('button') as HTMLElement | null;
    if (!btn) return;
    const text = (btn.innerText || '').trim();
    if (!text) return;
    if (text.includes('确认发布')) {
      armed = true;
      armAt = Date.now();
      setTimeout(() => maybeReport('click:confirm_publish'), 1500);
      return;
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
// 初始化和导出
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => fillContent());
} else {
  fillContent();
}

installPublishReporting();

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
