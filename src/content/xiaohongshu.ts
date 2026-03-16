import { reportArticlePublish, reportError } from '../utils/debug';
import { DOMHelper } from '../utils/domHelper';
// import { ImageHandler } from '../utils/imageHandler';  // 预留给未来的图片处理功能

// Xiaohongshu(小红书) Publish Content Script - 基于 Playwright 录制
// 小红书创作者平台发布页面自动化
// URL: https://creator.xiaohongshu.com/publish/publish

/**
 * 发布数据接口
 */
interface PublishData {
    title: string;
    content: string;
    htmlContent?: string;
    sourceUrl?: string;
    sourceImages?: string[];
    intro?: string;  // 笔记简介(50-80字)
    topics?: string[];
    declaration?: string;
    timestamp: number;
    generatedId?: string;
    tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; // AI token 消耗数据
    autoPublish?: boolean; // 是否自动发布（定时任务会强制设置为 true）
}

// ============================================
// 小红书页面元素选择器配置 - 基于 Playwright 录制
// ============================================
const SELECTORS = {
    // "新的创作"按钮 - Playwright: getByRole('button', { name: '新的创作' })
    newCreationButton: [
        'button:has-text("新的创作")',
        'button:contains("新的创作")',
        '[class*="new-creation"]'
    ],

    // 标题输入框 - 增加更具体的层级
    titleInput: [
        '.title-input input',
        '.title-wrapper input',
        '.title-wrapper [contenteditable]',
        'input[placeholder*="输入标题"]',
        'textarea[placeholder*="输入标题"]',
        '[placeholder*="请输入标题"]'
    ],

    // 正文编辑器
    // 说明：小红书文章发布页目前使用 tiptap/ProseMirror（contenteditable），不是 Slate。
    // 这里优先匹配 ProseMirror，其次再兜底 Slate/Quill。
    editor: [
        '.tiptap.ProseMirror[contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        '.rich-editor-content [data-slate-editor="true"]',
        '[data-slate-editor="true"]',
        '.rich-editor-content',
        '.ql-editor'
    ],

    // 一键排版按钮 - Playwright: getByRole('button', { name: '一键排版' })
    autoFormatButton: [
        'button:has-text("一键排版")',
        'button:contains("一键排版")',
        '.auto-format-button',
        '.rich-editor-toolbar button:has-text("排版")'
    ],

    // 「模板与封面」面板按钮
    templateAndCoverButton: [
        'button:has-text("模板与封面")',
        'button:contains("模板与封面")',
        '[role="button"]:has-text("模板与封面")'
    ],

    // 面板内 Tab：选择模板
    templateTab: [
        ':has-text("选择模板")',
        ':contains("选择模板")'
    ],

    // 模板封面图片（右侧“选择模板/封面设置”面板里的缩略图）
    // 说明：当前页面这些 img 常带 alt="模板封面"
    templateCoverImage: [
        'img[alt="模板封面"]',
        'img[alt*="模板封面"]',
        'img[alt*="模板"]',
        '.template-cover-container img',
        '.images-grid img',
        '[class*="template"] img'
    ],

    // 下一步按钮 - 注意：在写长文模式下，这个按钮通常带有 css- 或特定类
    nextStepButton: [
        'button:has-text("下一步")',
        '.publish-button:has-text("下一步")',
        'button.publish-button',
        '.footer button.red:has-text("下一步")',
        '.publish-footer button:has-text("下一步")',
        '.publish-container .footer button'
    ],

    // 添加话题按钮 - Playwright: getByRole('button', { name: '话题' })
    addTopicButton: [
        'button:has-text("话题")',
        'button:contains("话题")',
        'button:has-text("添加话题")',
        'button:contains("添加话题")'
    ],

    // 话题输入框 - Playwright: getByRole('textbox').filter({ hasText: '#' })
    // 注意：这是一个 contenteditable 元素，包含 # 字符
    topicInput: [
        '[contenteditable][role="textbox"]',  // 优先使用 role 属性
        '[contenteditable]',  // 备用：任何 contenteditable 元素
        '.topic-container [contenteditable]',
        '.topic-input [contenteditable]',
        '[placeholder*="添加话题"]'
    ],

    // 话题下拉列表项 - Playwright: locator('#creator-editor-topic-container').getByText('#话题名')
    topicSuggestionItem: [
        '#creator-editor-topic-container .topic-item',
        '.topic-suggestion-list .item',
        '.topic-item',
        '[class*="topic-container"] [class*="item"]',
        '.suggestion-item'
    ],

    // 原创声明入口 - Playwright: getByText('去声明')
    // 根据实际页面结构: .media-settings > ... > .wrapper.red > span.btn-text.red
    originalityEntry: [
        '.media-settings .wrapper.red span.btn-text.red',  // 最精确的选择器
        '.media-settings span.btn-text.red',  // 稍微宽松一点
        '.wrapper.red span.btn-text',  // 红色按钮文本
        'span.btn-text.red',  // 红色按钮文本（更宽松）
        'span:has-text("去声明")',
        'div:has-text("去声明")',
        ':has-text("去声明")',
        ':contains("去声明")',
        'span:has-text("原创声明") + span',
        '.publish-original-container [class*="link"]'
    ],

    // 原创声明勾选框（弹窗内的“我已阅读并同意…”）
    // 备注：你截图的弹窗里，“声明原创”按钮会先 disabled，必须先勾选这一条同意项。
    originalityConsentCheckbox: [
        // 修复：应该查找整个 checkbox 容器（可点击的）
        '.d-checkbox.d-clickable',
        '.d-checkbox',
        // 注意：不能使用 :has-text() 和 :contains()，这些是 Playwright 特有的选择器，querySelector 不支持
        // 通过 role / input 兜底
        '[role="checkbox"]',
        'input[type="checkbox"]',
        'span.d-checkbox-simulator',
        '.d-checkbox-indicator'
    ],

    // （保留：旧版可能存在的“原创声明复选框”）
    originalityCheckbox: [
        '.originalContainer .footer span.d-checkbox-simulator',
        '.originalContainer span.d-checkbox-simulator',
        'span.d-checkbox-simulator',
        '.d-checkbox-indicator',
        '.d-checkbox-input',
        '.checkbox-indicator',
        '[class*="checkbox"]'
    ],

    // 确认原创按钮：有两种文案“声明原创”/“声明原创”（同）
    // 你的截图中按钮文案是“声明原创”，并且会 disabled。
    declareOriginalButton: [
        '.originalContainer .footer button',
        '.originalContainer button',
        'button:has-text("声明原创")',
        'button:contains("声明原创")',
        'button:has-text("声明原创")',
        'button:contains("声明原创")',
        '.d-modal-footer button',
        '.modal-footer button',
        // 最宽松兜底（仅在弹窗内使用）
        'button'
    ],

    // 话题文本 - Playwright: getByText('#矛盾的对立统一')
    topicText: [
        '[class*="topic"]',
        '[class*="tag"]',
        '.tag-item',
        '.topic-container span'
    ],

    // 添加地点 - Playwright: getByText('添加地点')
    addLocationText: [
        ':has-text("添加地点")',
        ':contains("添加地点")',
        '.location-container'
    ],

    // 内容类型声明 - Playwright: getByText('虚构演绎，仅供娱乐')
    contentTypeEntry: [
        '.declaration-container',
        ':has-text("内容类型声明")',
        ':contains("内容类型声明")',
        '.publish-declaration-container'
    ],

    contentTypeOption: [
        '.d-drawer-content .item',
        '.d-modal-content .item',
        '.declaration-item',
        'div:has-text("虚构演绎，仅供娱乐")'
    ],

    // 发布按钮 - Playwright: getByRole('button', { name: '发布' })
    publishButton: [
        'button:has-text("发布")',
        'button:contains("发布")',
        '[class*="publish-button"]'
    ],

    // 抽屉遮罩层 - Playwright: locator('.d-drawer-mask')
    drawerMask: [
        '.d-drawer-mask',
        '[class*="drawer-mask"]',
        '[class*="mask"]'
    ]
};

// ============================================
// DOM 工具函数 - 使用统一工具类
// ============================================

const findElement = (selectors: string[]): HTMLElement | null => DOMHelper.findElement(selectors);
const isElementVisible = (el: HTMLElement): boolean => DOMHelper.isElementVisible(el);
const simulateClick = (element: HTMLElement) => DOMHelper.simulateClick(element);

/**
 * 通过文本内容查找元素（替代 Playwright 的 :has-text() 和 :contains()）
 * @param root 搜索范围（默认为 document）
 * @param tagName 标签名（如 'button', 'div'）
 * @param text 要查找的文本
 * @param exact 是否精确匹配（默认 false，即包含匹配）
 * @returns 找到的第一个可见元素，如果没找到则返回 null
 */
const findElementByText = (root: ParentNode, tagName: string, text: string, exact: boolean = false): HTMLElement | null => {
    const elements = Array.from(root.querySelectorAll(tagName)) as HTMLElement[];
    for (const el of elements) {
        if (!isElementVisible(el)) continue;
        const elText = el.textContent || '';
        if (exact ? elText.trim() === text : elText.includes(text)) {
            return el;
        }
    }
    return null;
};

// 以下工具函数预留给未来的图片处理功能使用
// const simulateInput = (element: HTMLElement, value: string) => DOMHelper.simulateInput(element, value);
// const isMediaAiEnabled = async (): Promise<boolean> => ImageHandler.isMediaAiEnabled();
// const createThumbnailDataUrl = async (dataUrl: string, maxDim = 512): Promise<string | null> => ImageHandler.createThumbnailDataUrl(dataUrl, maxDim);
// const getImageMetaFromDataUrl = async (dataUrl: string): Promise<{ width: number; height: number; aspect: number } | null> => ImageHandler.getImageMetaFromDataUrl(dataUrl);
// const dataUrlToBlob = (dataUrl: string): { blob: Blob; mimeType: string } => ImageHandler.dataUrlToBlob(dataUrl);
// const getFileExtensionByMime = (mimeType: string): string => ImageHandler.getFileExtensionByMime(mimeType);
// const setInputFiles = (input: HTMLInputElement, files: File[]) => ImageHandler.setInputFiles(input, files);

// ============================================
// Logger UI - 与其他平台保持一致
// ============================================
class XiaohongshuLogger {
    private container: HTMLDivElement;
    private logContent: HTMLDivElement;
    private stopBtn: HTMLButtonElement;
    private onStop?: () => void;

    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'memoraid-xiaohongshu-logger';
        // 悬浮窗样式 - 参考知乎的样式
        this.container.style.cssText = 'position:fixed;top:20px;left:20px;width:380px;max-height:500px;background:rgba(0,0,0,0.9);color:#0af;font-family:Consolas,Monaco,monospace;font-size:12px;border-radius:8px;padding:12px;z-index:20000;display:none;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.6);border:1px solid #0af;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;';

        const title = document.createElement('span');
        title.innerHTML = '📕 <span style="color:#fff;font-weight:bold;">Memoraid</span> 小红书助手';

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
        if (type === 'error') { reportError(message, { type, context: 'XiaohongshuContentScript' }); }
    }
}

const logger = new XiaohongshuLogger();

// ============================================
// 流程控制变量
// ============================================

let isFlowCancelled = false;  // 是否取消流程
let isProcessing = false;     // 是否正在处理中（防止重入）
let pendingSourceUrl: string | undefined;  // 来源URL

// ============================================
// 核心功能函数
// ============================================

/**
 * 点击"新的创作"按钮
 */
const clickNewCreation = async (): Promise<boolean> => {
    logger.log('查找"新的创作"按钮...', 'info');

    const btn = findElement(SELECTORS.newCreationButton);
    if (!btn) {
        logger.log('未找到"新的创作"按钮', 'error');
        return false;
    }

    logger.log('点击"新的创作"按钮', 'action');
    simulateClick(btn);
    await new Promise(r => setTimeout(r, 1500));

    return true;
};

/**
 * 填充标题
 */
const fillTitle = async (title: string): Promise<boolean> => {
    logger.log('查找标题输入框...', 'info');

    // 等待标题输入框出现
    let titleInput: HTMLElement | null = null;
    for (let i = 0; i < 10; i++) {
        titleInput = findElement(SELECTORS.titleInput);
        if (titleInput) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!titleInput) {
        logger.log('未找到标题输入框', 'error');
        return false;
    }

    logger.log(`填充标题: ${title.slice(0, 30)}...`, 'action');
    simulateClick(titleInput);
    await new Promise(r => setTimeout(r, 300));

    // 清空并填充标题
    titleInput.focus();

    // 彻底清空当前内容
    if (titleInput instanceof HTMLInputElement || titleInput instanceof HTMLTextAreaElement) {
        titleInput.value = '';
    } else {
        titleInput.innerText = '';
    }

    // 确保标题输入框获得焦点后再执行清空指令
    titleInput.focus();
    await new Promise(r => setTimeout(r, 100));
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);

    // 输入新标题
    document.execCommand('insertText', false, title);
    await new Promise(r => setTimeout(r, 500));

    // 再次确认标题是否正确（防止某些编辑器清空失败）
    const currentTitle = titleInput instanceof HTMLInputElement || titleInput instanceof HTMLTextAreaElement
        ? titleInput.value
        : titleInput.innerText;

    if (currentTitle !== title) {
        logger.log('标题填充不完整，尝试回退方法', 'warn');
        if (titleInput instanceof HTMLInputElement || titleInput instanceof HTMLTextAreaElement) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            titleInput.innerText = title;
        }
    }

    // 关键：失去焦点，防止后续 execCommand 仍在标题栏运行
    titleInput.blur();
    await new Promise(r => setTimeout(r, 200));

    logger.log('✅ ✅ 标题已填充', 'success');
    return true;
};

/**
 * 填充正文内容
 */
const fillContent = async (content: string): Promise<boolean> => {
    logger.log('查找正文编辑器...', 'info');

    const editor = findElement(SELECTORS.editor);
    if (!editor) {
        logger.log('未找到正文编辑器', 'error');
        return false;
    }

    logger.log(`填充正文内容 (${content.length} 字)...`, 'action');

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 强制滚动到编辑器并点击获取焦点
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    simulateClick(editor);
    editor.focus();
    await sleep(200);

    // 防止误操作标题：若焦点仍在标题栏则强制转移
    const titleInput = findElement(SELECTORS.titleInput);
    if (titleInput && (titleInput === document.activeElement || titleInput.contains(document.activeElement))) {
        logger.log('⚠️ 焦点仍在标题栏，强制转移焦点到正文编辑器', 'warn');
        simulateClick(editor);
        editor.focus();
        await sleep(300);
    }

    // =====================================================
    // 分支1：ProseMirror/tiptap（小红书文章页）
    // =====================================================
    const isProseMirror = editor.classList.contains('ProseMirror') || editor.classList.contains('tiptap');
    if (isProseMirror) {
        logger.log('检测到 ProseMirror 编辑器，使用快捷键式写入策略', 'info');

        // 1) 清空：Ctrl+A + Delete（比 Range 选中更符合 ProseMirror 预期）
        editor.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        await sleep(150);

        // 2) 写入：逐行 insertText + insertParagraph，确保换行保留
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // 允许空行：空行就直接换段
            if (lines[i].length > 0) {
                document.execCommand('insertText', false, lines[i]);
            }
            if (i < lines.length - 1) {
                document.execCommand('insertParagraph', false);
            }
        }

        // 3) 触发 input 通知框架更新
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        const ok = editor.innerText.trim().length > 0;
        if (!ok) {
            logger.log('❌ 正文填充失败：ProseMirror 编辑器内容仍为空', 'error');
            return false;
        }

        logger.log('✅ ✅ 正文已填充（ProseMirror）', 'success');
        await sleep(400);
        return true;
    }

    // =====================================================
    // 分支2：Slate/其他（旧版/不同页面）
    // =====================================================

    // 关键改进：尝试点击编辑器内部段落以激活输入状态
    const innerParagraph = editor.querySelector('p, [data-slate-node="element"], .rich-editor-content p');
    const targetElement = (innerParagraph as HTMLElement) || editor;

    if (innerParagraph) {
        logger.log('点击编辑器内层段落以激活输入状态', 'info');
        simulateClick(targetElement);
        targetElement.focus();
        await sleep(200);
    }

    // 清空：使用 Range 只选中编辑器内容，避免误选页面
    try {
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(targetElement);
            selection.addRange(range);
            targetElement.focus();
            document.execCommand('delete', false);
            selection.removeAllRanges();
        }
    } catch (e) {
        logger.log('Range 清空失败，尝试直接清空', 'warn');
        targetElement.innerHTML = '';
    }

    await sleep(300);

    // 模拟粘贴：部分编辑器会忽略合成 ClipboardEvent，因此作为“尝试”而不是依赖
    let pasteSuccess = false;
    try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', content);
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        });
        targetElement.dispatchEvent(pasteEvent);
        await sleep(200);
        if (editor.innerText.trim().length > 0) {
            pasteSuccess = true;
            logger.log('✅ 正文已通过模拟粘贴填充', 'success');
        } else {
            logger.log('⚠️ 模拟粘贴似乎没有效果，尝试回退', 'warn');
        }
    } catch (e) {
        logger.log('⚠️ 模拟粘贴执行出错，尝试回退', 'warn');
    }

    if (!pasteSuccess || editor.innerText.trim().length === 0) {
        logger.log('正在使用回退模式（逐行插入）...', 'info');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 0) {
                document.execCommand('insertText', false, lines[i]);
            }
            if (i < lines.length - 1) {
                document.execCommand('insertParagraph', false);
            }
        }
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);

    const ok = editor.innerText.trim().length > 0;
    if (!ok) {
        logger.log('❌ 正文填充失败：编辑器内容仍为空', 'error');
        return false;
    }

    logger.log('✅ ✅ 正文已填充', 'success');
    await sleep(400);
    return true;
};

/**
 * 点击"一键排版"按钮
 */
const clickAutoFormat = async (): Promise<boolean> => {
    logger.log('查找"一键排版"按钮...', 'info');

    const btn = findElement(SELECTORS.autoFormatButton);
    if (!btn) {
        logger.log('未找到"一键排版"按钮，跳过', 'warn');
        return false;
    }

    logger.log('点击"一键排版"按钮', 'action');
    // 再次确认是排版按钮
    if (!btn.textContent?.includes('一键排版')) {
        logger.log('检测到按钮文本不符，取消点击"一键排版"', 'warn');
        return false;
    }
    simulateClick(btn);
    await new Promise(r => setTimeout(r, 1500));

    logger.log('✅ 已应用排版', 'success');
    return true;
};

/**
 * 选择模板封面
 */
const selectTemplateCover = async (): Promise<boolean> => {
    logger.log('查找模板封面（模板缩略图）...', 'info');

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 0) 先确保右侧“模板与封面”面板已打开
    const openBtn = findElement(SELECTORS.templateAndCoverButton);
    if (openBtn && isElementVisible(openBtn)) {
        logger.log('打开“模板与封面”面板', 'info');
        simulateClick(openBtn);
        await sleep(600);
    }

    // 1) 等待缩略图加载出来（点击面板后通常需要异步渲染/懒加载）
    const waitForCoverThumbs = async (timeoutMs = 8000): Promise<HTMLElement[]> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const images = Array.from(document.querySelectorAll(SELECTORS.templateCoverImage.join(',')));
            const visibleImages = images.filter(img => isElementVisible(img as HTMLElement)) as HTMLElement[];
            if (visibleImages.length > 0) return visibleImages;
            await sleep(300);
        }
        return [];
    };

    // 先确保在“选择模板”tab（有些时候默认在“封面设置”）
    const tab = findElement(SELECTORS.templateTab);
    if (tab && isElementVisible(tab) && !(tab.textContent || '').includes('封面设置')) {
        // 仅当它可点击且页面没在模板列表时，点一下
        //（这里不做强判断，点一下不影响）
        simulateClick(tab);
        await sleep(300);
    }

    const visibleImages = await waitForCoverThumbs(10000);
    if (visibleImages.length === 0) {
        logger.log('⚠️ 未找到模板封面缩略图：可能需要更长加载时间/面板未真正展开', 'warn');
        return false;
    }

    // 2) 过滤掉明显不是模板缩略图的小图标（根据尺寸）
    const thumbImages = visibleImages.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width >= 60 && r.height >= 80;
    });
    const candidates = thumbImages.length > 0 ? thumbImages : visibleImages;

    // 3) 随机选择一个
    const randomIndex = Math.floor(Math.random() * candidates.length);
    logger.log(`找到 ${candidates.length} 个模板封面，随机选择第 ${randomIndex + 1} 个`, 'info');
    const selected = candidates[randomIndex];

    try {
        selected.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
    await sleep(200);

    simulateClick(selected);
    await sleep(800);

    logger.log('✅ 已选择模板封面', 'success');
    return true;
};

/**
 * 随机选择一个图文模板
 *
 * 说明：小红书的“预览/选择模板”区域经常做 A/B 实验，类名不稳定。
 * 这里采用“先定位右侧模板面板（包含‘选择模板’文本）→再找可点击卡片”的策略。
 */
const selectRandomTemplate = async (): Promise<boolean> => {
    logger.log('查找并随机选择图文模板...', 'info');

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 从一个元素向上找“可点击祖先”
    const findClickableAncestor = (el: Element | null): HTMLElement | null => {
        let cur: Element | null = el;
        for (let i = 0; i < 6 && cur; i++) {
            const h = cur as HTMLElement;
            const role = h.getAttribute?.('role') || '';
            const tag = (h.tagName || '').toLowerCase();
            const isClickable =
                tag === 'button' ||
                tag === 'a' ||
                role === 'button' ||
                typeof (h as any).onclick === 'function' ||
                h.style?.cursor === 'pointer' ||
                h.getAttribute?.('tabindex') !== null;
            if (isClickable && isElementVisible(h)) return h;
            cur = cur.parentElement;
        }
        return null;
    };

    // 1) 优先定位“选择模板”面板
    const allTextNodes = Array.from(document.querySelectorAll('div, span, h1, h2, h3, h4')) as HTMLElement[];
    const templateHeader = allTextNodes.find(el => isElementVisible(el) && (el.textContent || '').trim() === '选择模板');

    let panel: HTMLElement | null = null;
    if (templateHeader) {
        // 向上找一个“看起来像侧边栏/面板”的容器
        let p: HTMLElement | null = templateHeader;
        for (let i = 0; i < 8 && p; i++) {
            // 经验：面板里通常会有很多 img 缩略图
            const imgs = p.querySelectorAll('img');
            if (imgs.length >= 3) {
                panel = p;
                break;
            }
            p = p.parentElement;
        }
    }

    // 2) 如果定位失败，回退到全局找“模板卡片”
    const candidateScopes: HTMLElement[] = [];
    if (panel) candidateScopes.push(panel);
    candidateScopes.push(document.body);

    const collectCards = (scope: HTMLElement): HTMLElement[] => {
        // ✅ 以“模板缩略图 img”为主：更稳定，也更接近真实点击目标
        // 该页面的模板缩略图通常是竖图（约 92x160），而图标/开关很小。
        const imgs = Array.from(scope.querySelectorAll('img'))
            .filter(img => isElementVisible(img as HTMLElement))
            .filter(img => {
                const r = (img as HTMLElement).getBoundingClientRect();
                // 过滤：小图标 / 颜色块等
                return r.width >= 70 && r.height >= 120;
            }) as HTMLImageElement[];

        // 尝试点击 img 本身；如果被遮罩拦截，再回退到可点击祖先
        const cards: HTMLElement[] = imgs.map(img => {
            const clickable = findClickableAncestor(img);
            return (clickable && clickable !== scope) ? clickable : (img as unknown as HTMLElement);
        });

        // 去重 + 过滤可见
        return Array.from(new Set(cards)).filter(el => isElementVisible(el));
    };

    // 收集候选卡片
    let cards: HTMLElement[] = [];
    for (const scope of candidateScopes) {
        cards = collectCards(scope);
        if (cards.length >= 3) break;
    }

    if (cards.length === 0) {
        logger.log('❌ 未找到图文模板列表（可能不在模板预览页/或页面结构变化）', 'warn');
        return false;
    }

    // 尽量只选右侧面板的卡片（避免误点正文区图片）
    if (panel) {
        const panelCards = cards.filter(c => panel!.contains(c));
        if (panelCards.length >= 3) cards = panelCards;
    }

    // 随机选择一个
    const randomIndex = Math.floor(Math.random() * cards.length);
    const target = cards[randomIndex];

    // 尝试提取模板名（如果有）
    const nameEl = target.querySelector('[class*="title"], [class*="name"], h4, h3, span');
    const templateName = (nameEl?.textContent || '').trim() || `第 ${randomIndex + 1} 个模板`;

    logger.log(`找到 ${cards.length} 个模板，随机选择: ${templateName}`, 'action');

    // 点击前确保在视口内
    try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
    await sleep(250);

    simulateClick(target);
    await sleep(1200);

    logger.log('✅ 已随机选择模板', 'success');
    return true;
};

/**
 * 点击"下一步"按钮
 */
const clickNextStep = async (): Promise<boolean> => {
    logger.log('查找"下一步"按钮...', 'info');

    // 增加重试逻辑，因为排版后 DOM 可能需要时间更新
    for (let i = 0; i < 3; i++) {
        const btn = findElement(SELECTORS.nextStepButton);
        if (btn && isElementVisible(btn)) {
            logger.log('▶️ 点击"下一步"按钮', 'action');
            simulateClick(btn);
            // 进入下一步后通常有较大的页面结构变化，等待更久一点
            await new Promise(r => setTimeout(r, 3000));
            return true;
        }
        logger.log(`第 ${i + 1} 次尝试未找到"下一步"按钮，等待中...`, 'info');
        await new Promise(r => setTimeout(r, 1000));
    }

    logger.log('❌ 未找到"下一步"按钮', 'error');
    return false;
};

/**
 * 设置原创声明
 */
const setOriginalityDeclaration = async (): Promise<boolean> => {
    logger.log('准备设置原创声明...', 'info');

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const clickReliable = async (el: HTMLElement, label?: string) => {
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {}
        await sleep(120);

        // 先发 pointer 事件（很多现代 UI 只监听 pointer）
        try {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
        } catch {}

        // 再用原生 click
        try {
            el.click();
        } catch {
            simulateClick(el);
        }

        // 再补 mouse 事件兜底
        try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } catch {}

        if (label) logger.log(label, 'info');
    };

    // 小工具：在指定范围内查找元素
    const findIn = (root: ParentNode, selectors: string[]): HTMLElement | null => {
        for (const sel of selectors) {
            try {
                const el = root.querySelector(sel) as HTMLElement | null;
                if (el && isElementVisible(el)) return el;
            } catch {}
        }
        return null;
    };

    const waitForIn = async (root: ParentNode, selectors: string[], timeoutMs = 8000): Promise<HTMLElement | null> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (isFlowCancelled) return null;
            const el = findIn(root, selectors);
            if (el) return el;
            await sleep(250);
        }
        return null;
    };

    // 注意：不要用“只读 input.checked”判断 UI 是否生效，
    // 小红书这里是受控组件，必须看按钮是否从 disabled 变为可点。
    // （保留注释作为经验）

    // 0) 先点击原创声明开关（如果存在）
    // 根据 Playwright 录制：await page.locator('.d-switch-simulator').first().click();
    // 修复：需要先打开原创声明开关，才能看到"去声明"按钮
    // 关键发现：点击开关后，弹窗可能直接打开，不需要再点击"去声明"按钮
    logger.log('查找原创声明开关...', 'info');
    const switchEl = document.querySelector('.d-switch-simulator') as HTMLElement | null;
    if (switchEl && isElementVisible(switchEl)) {
        // 查找开关的父容器（通常是 .d-switch-top）
        const switchContainer = switchEl.parentElement;
        logger.log('点击原创声明开关', 'action');
        await clickReliable(switchContainer || switchEl);
        await sleep(1000); // 等待开关动画和弹窗/按钮出现
    }

    // 1) 检查弹窗是否已打开（点击开关后可能直接打开弹窗）
    let scope: ParentNode = document;
    await sleep(500);
    const dialogCandidates = Array.from(document.querySelectorAll('.d-modal, .d-drawer, .d-drawer-content, [role="dialog"], .originalContainer'));
    let dialog = dialogCandidates.find(el => isElementVisible(el as HTMLElement)) as HTMLElement | undefined;

    if (dialog) {
        // 弹窗已打开，跳过"去声明"按钮查找
        logger.log('弹窗已打开，跳过"去声明"按钮', 'info');
        scope = dialog;
    } else {
        // 弹窗未打开，查找并点击"去声明"按钮
        logger.log('弹窗未打开，查找"去声明"按钮...', 'info');

        // 先按「原创声明」标题精准定位，再回退到选择器匹配
        const findOriginalityEntry = (): HTMLElement | null => {
            const title = Array.from(document.querySelectorAll('div'))
                .find(el => (el.textContent || '').trim() === '原创声明');
            if (title && title.parentElement) {
                const wrapper = title.parentElement.querySelector('.wrapper.red') as HTMLElement | null;
                const btnText = title.parentElement.querySelector('.btn-text.red') as HTMLElement | null;
                return wrapper || btnText || title.parentElement;
            }
            return findIn(document, SELECTORS.originalityEntry);
        };

        let entry: HTMLElement | null = null;
        const entryStart = Date.now();
        while (Date.now() - entryStart < 8000) {
            entry = findOriginalityEntry();
            if (entry && isElementVisible(entry)) break;
            await sleep(250);
        }

        if (!entry) {
            logger.log('未找到"原创声明"入口（可能已设置/不支持/未进入设置页）', 'warn');
            return false;
        }

        if (isFlowCancelled) return false;

        logger.log('点击"去声明"', 'action');
        await clickReliable(entry);

        // 2) 等待弹窗/抽屉出现
        await sleep(600);
        const dialogStart = Date.now();
        while (Date.now() - dialogStart < 8000) {
            if (isFlowCancelled) return false;
            const dialogCandidates = Array.from(document.querySelectorAll('.d-modal, .d-drawer, .d-drawer-content, [role="dialog"], .originalContainer'));
            dialog = dialogCandidates.find(el => isElementVisible(el as HTMLElement)) as HTMLElement | undefined;
            if (dialog) {
                scope = dialog;
                break;
            }
            await sleep(250);
        }
    }

    // 3) 勾选同意项（“我已阅读并同意《原创声明须知》…”）
    // 这是你截图里缺失的关键一步：不勾选时“声明原创”按钮为 disabled。
    const consentRow = await waitForIn(scope, SELECTORS.originalityConsentCheckbox, 8000);
    if (!consentRow) {
        logger.log('⚠️ 未找到“我已阅读并同意”勾选项（弹窗结构变化），跳过', 'warn');
        return false;
    }

    if (isFlowCancelled) return false;

    // ✅ 关键：必须点到“可交互的包装层/模拟器”，很多 UI 点 input.checked 不会触发框架状态
    logger.log('勾选“我已阅读并同意原创声明须知”', 'action');

    // ✅ 关键修复：小红书这个弹窗的可交互目标是“整行容器”（事件委托/捕获），
    // 点 input/indicator/simulator 往往不会触发状态更新。
    // 我们优先寻找“包含 checkbox 的可点击行”，再点击它。

    const getClickableConsentRow = (): HTMLElement => {
        // 1) 优先：向上寻找 cursor=pointer 的祖先
        let cur: HTMLElement | null = consentRow;
        for (let i = 0; i < 8 && cur; i++) {
            const style = window.getComputedStyle(cur);
            if (style.cursor === 'pointer') return cur;
            cur = cur.parentElement;
        }

        // 2) 其次：找带 onclick / tabindex 的祖先
        cur = consentRow;
        for (let i = 0; i < 8 && cur; i++) {
            const h = cur as any;
            if (typeof h.onclick === 'function' || cur.getAttribute('tabindex') !== null || cur.getAttribute('role') === 'button') {
                return cur;
            }
            cur = cur.parentElement;
        }

        // 3) 兜底：直接点 consentRow
        return consentRow;
    };

    const clickableRow = getClickableConsentRow();
    // 直接使用简单的 click()，不要使用 clickReliable
    // 因为 PointerEvent 等额外事件会干扰小红书框架的状态更新
    clickableRow.click();
    // 增加等待时间，确保 UI 状态更新
    await sleep(500);

    // 找“声明原创”按钮并等待它变为可点击（这是最可靠的成功判据）
    let confirmBtn: HTMLElement | null = null;
    const btnStart = Date.now();
    while (Date.now() - btnStart < 8000) {
        if (isFlowCancelled) return false;
        confirmBtn = findElementByText(scope, 'button', '声明原创');
        if (!confirmBtn) {
            confirmBtn = findIn(scope, SELECTORS.declareOriginalButton);
        }
        if (confirmBtn) break;
        await sleep(250);
    }

    if (!confirmBtn) {
        logger.log('⚠️ 未找到"声明原创"按钮，跳过', 'warn');
        return false;
    }

    // 等待 disabled 解除；若一直 disabled，则说明同意勾选未被 UI 接收
    const enableStart = Date.now();
    while (Date.now() - enableStart < 8000) {
        if (isFlowCancelled) return false;
        const disabled = (confirmBtn as HTMLButtonElement).disabled || confirmBtn.hasAttribute('disabled');
        if (!disabled) break;
        await sleep(200);
    }

    if ((confirmBtn as HTMLButtonElement).disabled || confirmBtn.hasAttribute('disabled')) {
        logger.log('❌ “声明原创”按钮仍为不可点击（同意勾选未生效），中止原创声明流程', 'error');
        return false;
    }

    logger.log('点击"声明原创"确认按钮', 'action');

    // 有些 UI 需要点到 button 内部文字节点才会触发（事件委托/遮罩层）
    const btnInner = (confirmBtn.querySelector('span, div, .d-button-content') as HTMLElement | null);
    await clickReliable(btnInner || confirmBtn);

    // 等待弹窗关闭（给足时间：可能有网络请求/动画）
    const waitDialogClose = async (timeoutMs = 12000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (isFlowCancelled) return false;
            const still = Array.from(document.querySelectorAll('.originalContainer, .d-modal, .d-drawer, [role="dialog"]'))
                .some(el => isElementVisible(el as HTMLElement));
            if (!still) return true;
            await sleep(250);
        }
        return false;
    };

    if (!(await waitDialogClose(12000))) {
        logger.log('❌ 点击“声明原创”后弹窗仍未关闭：可能接口失败/需要额外交互（请看弹窗是否有错误提示）', 'error');
        return false;
    }

    logger.log('✅ 原创声明已成功（按钮启用 + 弹窗关闭）', 'success');
    return true;

    // (removed duplicate block)

};

/**
 * 添加简介和话题
 * @param intro 简介文本(可选)
 * @param topics 话题数组，例如 ['#天气', '#生活']
 */
// 添加简介和话题功能 - 在正文编辑器中先输入简介,再输入话题并选择建议
const addIntroAndTopics = async (intro: string | undefined, topics: string[]): Promise<boolean> => {
    console.log('[addIntroAndTopics] 开始执行 - intro:', intro, 'topics:', topics);
    
    // 如果既没有简介也没有话题,直接返回
    if (!intro && (!topics || topics.length === 0)) {
        logger.log('无简介和话题需要添加，跳过', 'info');
        return true;
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 1. 查找发布设置页的编辑器（不是正文编辑器）
    // 注意：这个函数在点击"下一步"后调用，此时应该在发布设置页
    // 发布设置页的编辑器用于输入简介和话题
    logger.log('查找发布设置页的编辑器...', 'info');
    const editor = findElement(SELECTORS.editor);
    if (!editor) {
        logger.log('未找到编辑器，无法添加简介和话题', 'error');
        console.error('[addIntroAndTopics] 未找到编辑器');
        return false;
    }
    
    console.log('[addIntroAndTopics] 找到编辑器:', editor);
    
    // 检查编辑器是否为空（发布设置页的编辑器初始应该是空的）
    const editorText = editor.innerText?.trim() || '';
    console.log('[addIntroAndTopics] 编辑器当前内容长度:', editorText.length);
    if (editorText.length > 100) {
        logger.log('⚠️ 检测到编辑器中已有大量内容，可能仍在正文编辑页，等待页面切换...', 'warn');
        await sleep(1000);
    }

    // 2. 清空编辑器（发布设置页的编辑器可能有默认内容）
    // 注意：不要清空正文编辑器的内容！
    simulateClick(editor);
    editor.focus();
    await sleep(200);
    
    // 检查是否需要清空
    const currentContent = editor.innerText?.trim() || '';
    if (currentContent.length > 0) {
        logger.log('清空编辑器中的默认内容', 'info');
        try {
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(editor);
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand('delete', false);
                await sleep(200);
            }
        } catch (e) {
            logger.log('清空编辑器失败，继续尝试', 'warn');
        }
    }

    // 3. 先添加简介(如果有)
    if (intro && intro.trim()) {
        logger.log('添加简介内容', 'action');
        logger.log(`简介内容: ${intro.substring(0, 50)}${intro.length > 50 ? '...' : ''}`, 'info');
        // 直接输入简介内容
        const introText = intro.trim();
        document.execCommand('insertText', false, introText);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);
        
        // 验证简介是否填充成功
        const editorContent = editor.innerText?.trim() || '';
        if (editorContent.includes(intro.substring(0, 20))) {
            logger.log('✅ 简介已成功填充到编辑器', 'success');
        } else {
            logger.log('⚠️ 简介填充可能失败，请检查', 'warn');
        }
    }

    // 4. 添加话题(如果有)
    if (!topics || topics.length === 0) {
        logger.log('无话题需要添加', 'info');
        return true;
    }

    logger.log(`准备添加 ${topics.length} 个话题: ${topics.join(', ')}`, 'info');

    for (let i = 0; i < topics.length; i++) {
        if (isFlowCancelled) return false;

        const topic = topics[i];
        const keyword = topic.startsWith('#') ? topic : `#${topic}`;

        logger.log(`添加话题 ${i + 1}/${topics.length}: ${keyword}`, 'action');

        // 5. 重新聚焦编辑器并移动光标到末尾
        simulateClick(editor);
        editor.focus();
        await sleep(200);

        try {
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false); // 移动到末尾
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (e) {
            logger.log('移动光标失败，继续尝试', 'warn');
        }

        // 6. 输入话题（在新行输入）
        // 如果是第一个话题且没有简介,需要添加两个换行
        // 如果有简介或不是第一个话题,只需要一个换行
        const textToInsert = (i === 0 && !intro) ? `\n\n${keyword}` : `\n${keyword}`;
        document.execCommand('insertText', false, textToInsert);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(800); // 等待话题菜单出现

        // 7. 查找话题下拉菜单
        let menu: HTMLElement | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            if (isFlowCancelled) return false;

            // 优先使用 ID 选择器
            const menuById = document.querySelector('#creator-editor-topic-container') as HTMLElement;
            if (menuById && isElementVisible(menuById)) {
                menu = menuById;
                break;
            }

            // 兜底：查找其他可能的菜单
            const menuSelectors = [
                '.topic-suggestion-list',
                '[class*="topic-container"]',
                '[class*="suggestion"]',
                '.d-dropdown-menu'
            ];

            for (const sel of menuSelectors) {
                const el = document.querySelector(sel) as HTMLElement;
                if (el && isElementVisible(el) && el.textContent?.includes('#')) {
                    menu = el;
                    break;
                }
            }

            if (menu) break;
            await sleep(200);
        }

        if (!menu) {
            logger.log('未找到话题下拉菜单，话题可能已直接插入', 'warn');
            continue;
        }

        logger.log('找到话题下拉菜单，准备选择第一个建议', 'info');

        // 8. 查找菜单项并点击第一个
        const itemSelectors = [
            '[class*="item"]',
            '.topic-item',
            '.suggestion-item',
            '[role="menuitem"]',
            '[role="option"]',
            'li',
            'div'
        ];

        let items: HTMLElement[] = [];
        for (const sel of itemSelectors) {
            const elements = Array.from(menu.querySelectorAll(sel)) as HTMLElement[];
            const visibleItems = elements.filter(el =>
                isElementVisible(el) &&
                el.textContent?.includes('#') &&
                el !== menu // 排除菜单容器本身
            );
            if (visibleItems.length > 0) {
                items = visibleItems;
                logger.log(`找到 ${items.length} 个话题建议项`, 'info');
                break;
            }
        }

        if (items.length === 0) {
            logger.log('未找到话题建议项，话题可能已直接插入', 'warn');
            continue;
        }

        // 9. 点击第一个菜单项
        const firstItem = items[0];
        logger.log(`选择第一个建议: ${firstItem.textContent?.trim().substring(0, 50)}`, 'action');

        simulateClick(firstItem);
        await sleep(500);

        logger.log(`✅ 话题 ${keyword} 已添加`, 'success');
    }

    logger.log('✅ ✅ 简介和话题添加完成', 'success');
    return true;
};

/**
 * 添加话题（保留旧函数以兼容）
 * @param topics 话题数组，例如 ['#天气', '#生活']
 */
// 添加话题功能 - 在正文编辑器中直接输入话题并选择建议
const addTopics = async (topics: string[]): Promise<boolean> => {
    // 调用新函数,不传入简介
    return addIntroAndTopics(undefined, topics);
};

/**
 * 设置内容类型声明
 * @param declarationType 声明类型，例如 '虚构演绎，仅供娱乐'
 */
const setContentTypeDeclaration = async (declarationType: string): Promise<boolean> => {
    logger.log(`准备设置内容类型声明: ${declarationType}`, 'info');

    // 1. 找到并点击"内容类型声明"入口
    const entry = findElement(SELECTORS.contentTypeEntry);
    if (!entry) {
        logger.log('未找到"内容类型声明"入口', 'warn');
        return false;
    }

    logger.log('点击"内容类型声明"入口', 'action');
    simulateClick(entry);
    await new Promise(r => setTimeout(r, 1500));

    // 2. 在弹出的选项中查找目标声明
    // 优先尝试精确匹配文本的选项
    const options = Array.from(document.querySelectorAll('.d-drawer-content *, .d-modal-content *, .declaration-item, body *'));
    for (const el of options) {
        if (el.textContent?.trim() === declarationType && isElementVisible(el as HTMLElement)) {
            logger.log(`点击声明选项: ${declarationType}`, 'action');
            simulateClick(el as HTMLElement);
            await new Promise(r => setTimeout(r, 800));
            logger.log(`✅ 已设置内容类型声明: ${declarationType}`, 'success');
            return true;
        }
    }

    // 如果没找到，尝试模糊匹配
    const fallbackOptions = options.filter(el => el.textContent?.includes(declarationType) && isElementVisible(el as HTMLElement));
    if (fallbackOptions.length > 0) {
        logger.log(`模糊匹配到声明选项: ${fallbackOptions[0].textContent?.trim()}`, 'action');
        simulateClick(fallbackOptions[0] as HTMLElement);
        await new Promise(r => setTimeout(r, 800));
        return true;
    }

    logger.log(`未找到声明选项: ${declarationType}`, 'warn');
    return false;
};

/**
 * 点击"发布"按钮
 */
const clickPublish = async (): Promise<boolean> => {
    logger.log('查找"发布"按钮...', 'info');

    const btn = findElement(SELECTORS.publishButton);
    if (!btn) {
        logger.log('未找到"发布"按钮', 'error');
        return false;
    }

    logger.log('点击"发布"按钮', 'action');
    simulateClick(btn);
    await new Promise(r => setTimeout(r, 2000));

    logger.log('✅ 文章已发布！', 'success');

    // 立即上报发布状态（让用户看到状态更新）
    // 注意：不清除 sessionStorage 数据，让 URL 监听器在最终上报后再清除
    try {
        const pendingTitle = sessionStorage.getItem('memoraid_pending_title');
        const finalTitle = pendingTitle || '小红书文章';
        
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
        
        console.log('[Xiaohongshu] 准备上报文章:', {
            title: finalTitle,
            url: window.location.href,
            generatedId,
            hasTokenUsage: !!tokenUsage
        });
        
        // 关键：不在这里清除数据，让 URL 监听器在检测到 published=true 后再清除
        // 这样可以确保标题和 token 数据在最终上报时仍然可用
        
        await reportArticlePublish({
            platform: 'xiaohongshu',
            title: finalTitle,
            url: window.location.href,
            status: 'published',  // 添加status字段,标记为已发布
            extra: {
                sourceUrl: pendingSourceUrl,
                // 记录 token 消耗数据
                promptTokens: tokenUsage?.promptTokens,
                completionTokens: tokenUsage?.completionTokens,
                totalTokens: tokenUsage?.totalTokens,
            },
            generatedId // 使用读取的 generatedId
        });
        
        console.log('[Xiaohongshu] 文章上报成功');
    } catch (err) {
        console.error('上报发布失败:', err);
    }

    return true;
};

// ============================================
// 自动填充流程 - 页面加载时自动执行
// ============================================

/**
 * 自动填充流程入口
 */
const autoFillContent = async (): Promise<void> => {
    if (isProcessing) {
        console.log('[Memoraid] 正在处理中，跳过重入');
        return;
    }

    try {
        // 检查是否有待发布的数据
        const result = await chrome.storage.local.get('pending_xiaohongshu_publish');
        const pending = result.pending_xiaohongshu_publish as PublishData | undefined;

        if (!pending) {
            console.log('[Memoraid] 无待发布数据');
            return;
        }

        isProcessing = true;
        isFlowCancelled = false;

        logger.log('🚀 开始自动填充...', 'info');
        logger.log(`标题: ${pending.title}`, 'info');
        logger.log(`内容长度: ${pending.content.length} 字`, 'info');
        
        // 调试信息：显示简介和正文状态
        if (pending.intro) {
            logger.log(`📝 简介: ${pending.intro.substring(0, 50)}${pending.intro.length > 50 ? '...' : ''}`, 'info');
        } else {
            logger.log('⚠️ 未检测到简介', 'warn');
        }
        
        // 检查正文是否包含简介内容
        if (pending.intro && pending.content.includes(pending.intro.substring(0, 30))) {
            logger.log('❌ 警告：正文中仍包含简介内容！', 'error');
        } else if (pending.intro) {
            logger.log('✅ 正文已正确移除简介', 'success');
        }
        
        // 检查正文是否包含[简介]标记
        if (pending.content.includes('[简介]')) {
            logger.log('❌ 警告：正文中仍包含[简介]标记！', 'error');
        }
        
        // 检查正文是否包含"正文:"等标记
        if (pending.content.match(/^正文[:：开始]/m)) {
            logger.log('❌ 警告：正文中仍包含"正文:"等标记！', 'error');
        }

        // 保存数据供后续使用
        pendingSourceUrl = pending.sourceUrl;

        // 保存 generatedId 供发布上报使用
        if (pending.generatedId) {
            sessionStorage.setItem('memoraid_generated_id', pending.generatedId);
        } else {
            sessionStorage.removeItem('memoraid_generated_id');
        }

        // 保存 token 数据供发布上报使用
        if (pending.tokenUsage) {
            sessionStorage.setItem('memoraid_token_usage', JSON.stringify(pending.tokenUsage));
        } else {
            sessionStorage.removeItem('memoraid_token_usage');
        }

        // 保存标题
        if (pending.title) {
            sessionStorage.setItem('memoraid_pending_title', pending.title);
        }

        // 设置停止回调
        logger.setStopCallback(() => {
            isFlowCancelled = true;
        });

        // 等待页面完全加载
        await new Promise(r => setTimeout(r, 2000));

        // 检查是否在发布页面
        const currentUrl = window.location.href;
        if (!currentUrl.includes('creator.xiaohongshu.com/publish')) {
            logger.log('❌ 不在小红书创作者发布页面', 'error');
            logger.hideStopButton();
            return;
        }

        // 步骤1: 点击"新的创作"（如果需要）
        // 注意：如果已经在编辑页面，则跳过此步骤
        const titleInput = findElement(SELECTORS.titleInput);
        if (!titleInput) {
            logger.log('未检测到标题输入框，尝试点击"新的创作"', 'info');
            const success = await clickNewCreation();
            if (!success && !isFlowCancelled) {
                logger.log('❌ 无法开始创作', 'error');
                logger.hideStopButton();
                return;
            }
        }

        if (isFlowCancelled) return;

        // 步骤2: 填充标题
        const titleSuccess = await fillTitle(pending.title);
        if (!titleSuccess && !isFlowCancelled) {
            logger.log('❌ 标题填充失败', 'error');
            logger.hideStopButton();
            return;
        }

        if (isFlowCancelled) return;

        // 步骤3: 填充正文
        const contentSuccess = await fillContent(pending.content);
        if (!contentSuccess && !isFlowCancelled) {
            logger.log('❌ 正文填充失败', 'error');
            logger.hideStopButton();
            return;
        }

        if (isFlowCancelled) return;

        // 关键增强：标题保护 - 检查正文填充后标题是否被意外清空
        const currentTitleInput = findElement(SELECTORS.titleInput);
        const actualTitle = currentTitleInput instanceof HTMLInputElement || currentTitleInput instanceof HTMLTextAreaElement
            ? currentTitleInput.value
            : currentTitleInput?.innerText;

        if (!actualTitle || actualTitle.trim().length === 0) {
            logger.log('⚠️ 检测到标题被意外清空，正在修复...', 'warn');
            await fillTitle(pending.title);
        }

        // 步骤4: 一键排版（可选）
        await clickAutoFormat();

        if (isFlowCancelled) return;

        // 步骤5: 随机选择图文模板（可选）
        // ⚠️ 默认不自动执行：避免影响你手动选模板/排查问题。
        // 如需启用，请在控制台手动调用：memoraidXiaohongshuSelectTemplate()
        // await selectRandomTemplate();

        // if (isFlowCancelled) return;

        // 步骤6: 选择模板封面（可选）
        await selectTemplateCover();

        if (isFlowCancelled) return;

        // 步骤6: 点击"下一步"进入发布设置
        const nextSuccess = await clickNextStep();
        if (!nextSuccess && !isFlowCancelled) {
            logger.log('❌ 无法进入发布设置页面', 'error');
            logger.hideStopButton();
            return;
        }

        if (isFlowCancelled) return;

        // 等待页面完全加载
        logger.log('等待发布设置页面加载...', 'info');
        await new Promise(r => setTimeout(r, 2000));

        // 步骤7: 设置原创声明
        logger.log('开始设置原创声明...', 'info');
        await setOriginalityDeclaration();

        if (isFlowCancelled) return;

        // 步骤8: 添加简介和话题
        // 注意: 简介和话题在同一个输入框中,先输入简介,再输入话题
        logger.log(`准备添加简介和话题 - 简介: ${pending.intro ? '有' : '无'}, 话题数: ${pending.topics?.length || 0}`, 'info');
        await addIntroAndTopics(pending.intro, pending.topics || []);

        if (isFlowCancelled) return;

        // 步骤9: 设置内容类型声明
        if (pending.declaration) {
            await setContentTypeDeclaration(pending.declaration);
        }

        if (isFlowCancelled) return;

        // 步骤10: 检查是否开启自动发布
        // 优先使用 pending 对象中的 autoPublish 标识（定时任务会强制设置为 true）
        const autoPublish = pending.autoPublish !== undefined 
            ? pending.autoPublish  // 使用 pending 对象中的标识（定时任务强制为 true）
            : true;  // 默认开启自动发布

        if (autoPublish) {
            logger.log('🔔 自动发布已开启，准备发布...', 'info');
            await new Promise(r => setTimeout(r, 1000)); // 等待1秒确保页面稳定
            
            const publishSuccess = await clickPublish();
            if (publishSuccess) {
                logger.log('✅ 文章已自动发布！', 'success');
            } else {
                logger.log('❌ 自动发布失败，请手动点击发布按钮', 'error');
            }
        } else {
            logger.log('✅ 自动填充完成！请手动检查并点击发布', 'success');
            logger.log('💡 提示：你可以手动添加话题、地点、合集等信息', 'info');
        }

        logger.hideStopButton();

        // 清除待发布数据
        await chrome.storage.local.remove('pending_xiaohongshu_publish');

    } catch (error) {
        console.error('[Memoraid] 小红书自动填充错误:', error);
        logger.log(`❌ 填充错误: ${error}`, 'error');
        logger.hideStopButton();
    } finally {
        isProcessing = false;
    }
};

// ============================================
// 上报发布成功
// ============================================

/**
 * 安装发布上报监听器
 */
const installPublishReporting = () => {
    // 监听 URL 变化，检测是否发布成功
    let lastUrl = window.location.href;
    let hasReported = false; // 防止重复上报

    const checkUrlChange = () => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;

            // 检查是否跳转到发布成功页面
            // 小红书发布成功后会跳转到 ?published=true
            if (currentUrl.includes('published=true') && !hasReported) {
                hasReported = true;
                logger.log('🎉 检测到发布成功！', 'success');

                // 读取保存的数据
                const pendingTitle = sessionStorage.getItem('memoraid_pending_title');
                const finalTitle = pendingTitle || '小红书文章';
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

                console.log('[Xiaohongshu URL Monitor] 准备上报文章:', {
                    title: finalTitle,
                    url: currentUrl,
                    generatedId,
                    hasTokenUsage: !!tokenUsage
                });

                // 清除保存的数据
                if (pendingTitle) {
                    sessionStorage.removeItem('memoraid_pending_title');
                }
                if (tokenUsageStr) {
                    sessionStorage.removeItem('memoraid_token_usage');
                }

                // 上报发布成功
                reportArticlePublish({
                    platform: 'xiaohongshu',
                    title: finalTitle,
                    url: currentUrl,
                    status: 'published',
                    extra: {
                        sourceUrl: pendingSourceUrl,
                        // 记录 token 消耗数据
                        promptTokens: tokenUsage?.promptTokens,
                        completionTokens: tokenUsage?.completionTokens,
                        totalTokens: tokenUsage?.totalTokens,
                    },
                    generatedId
                }).then(() => {
                    console.log('[Xiaohongshu URL Monitor] 文章上报成功');
                }).catch(err => {
                    console.error('[Xiaohongshu URL Monitor] 上报发布失败:', err);
                });
            }
        }
    };

    // 每秒检查一次 URL 变化
    setInterval(checkUrlChange, 1000);
};

// ============================================
// 初始化
// ============================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoFillContent());
} else {
    autoFillContent();
}

installPublishReporting();

// 导出供外部调用
(window as any).memoraidXiaohongshuFillTitle = fillTitle;
(window as any).memoraidXiaohongshuFillContent = fillContent;
(window as any).memoraidXiaohongshuAutoFormat = clickAutoFormat;
(window as any).memoraidXiaohongshuSelectCover = selectTemplateCover;
(window as any).memoraidXiaohongshuSelectTemplate = selectRandomTemplate;
(window as any).memoraidXiaohongshuNextStep = clickNextStep;
(window as any).memoraidXiaohongshuAddTopics = addTopics;
(window as any).memoraidXiaohongshuSetDeclaration = setContentTypeDeclaration;
(window as any).memoraidXiaohongshuPublish = clickPublish;

// 消息监听
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'XIAOHONGSHU_FILL_TITLE') {
        fillTitle(message.title);
        sendResponse({ success: true });
        return true;
    }

    if (message.type === 'XIAOHONGSHU_FILL_CONTENT') {
        fillContent(message.content);
        sendResponse({ success: true });
        return true;
    }

    if (message.type === 'XIAOHONGSHU_ADD_TOPICS') {
        addTopics(message.topics);
        sendResponse({ success: true });
        return true;
    }

    if (message.type === 'XIAOHONGSHU_PUBLISH') {
        clickPublish();
        sendResponse({ success: true });
        return true;
    }
});

console.log(`
📕 Memoraid 小红书助手已加载

可用命令：
  memoraidXiaohongshuFillTitle("标题")       - 填充标题
  memoraidXiaohongshuFillContent("内容")    - 填充正文
  memoraidXiaohongshuAutoFormat()           - 一键排版
  memoraidXiaohongshuSelectCover()          - 选择模板封面
  memoraidXiaohongshuSelectTemplate()       - 随机选择图文模板
  memoraidXiaohongshuNextStep()             - 进入发布设置
  memoraidXiaohongshuAddTopics(["#话题1"])  - 添加话题
  memoraidXiaohongshuPublish()              - 发布文章
`);
