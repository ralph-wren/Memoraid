/**
 * 远程调试系统 - 插件端实现
 * 
 * 功能：
 * 1. 注册调试会话，获取验证码
 * 2. 轮询服务器获取待执行命令
 * 3. 执行命令并上报结果
 * 
 * 支持的命令类型：
 * - query_dom: 查询DOM元素
 * - get_html: 获取元素HTML
 * - click: 点击元素
 * - input: 输入文本
 * - eval: 执行JavaScript代码
 * - screenshot: 截取页面截图
 * - get_all_inputs: 获取所有输入框
 * - get_element_info: 获取元素详细信息
 */

import { getSettings } from './storage';

// 调试会话状态
interface DebugSession {
  verificationCode: string;
  isActive: boolean;
  pollInterval: number | null;
}

// 命令类型
interface DebugCommand {
  id: number;
  type: string;
  data: any;
}

// 全局调试会话
let currentSession: DebugSession | null = null;

// 获取后端URL
const getBackendUrl = async (): Promise<string> => {
  try {
    const settings = await getSettings();
    return settings.sync?.backendUrl || 'https://memoraid-backend.iuyuger.workers.dev';
  } catch {
    return 'https://memoraid-backend.iuyuger.workers.dev';
  }
};

/**
 * 启动调试会话
 */
export const startDebugSession = async (): Promise<string> => {
  const backendUrl = await getBackendUrl();
  
  const pluginInfo = {
    userAgent: navigator.userAgent,
    url: window.location.href,
    timestamp: Date.now(),
    platform: navigator.platform
  };

  const response = await fetch(`${backendUrl}/debug/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pluginInfo })
  });

  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || '创建调试会话失败');
  }

  currentSession = {
    verificationCode: result.verificationCode,
    isActive: true,
    pollInterval: null
  };

  // 开始轮询命令
  startPolling();

  console.log(`[RemoteDebug] 调试会话已启动，验证码: ${result.verificationCode}`);
  
  return result.verificationCode;
};

/**
 * 停止调试会话
 */
export const stopDebugSession = async (): Promise<void> => {
  if (!currentSession) return;

  // 停止轮询
  if (currentSession.pollInterval) {
    clearInterval(currentSession.pollInterval);
  }

  // 通知服务器关闭会话
  try {
    const backendUrl = await getBackendUrl();
    await fetch(`${backendUrl}/debug/session/${currentSession.verificationCode}`, {
      method: 'DELETE'
    });
  } catch (e) {
    console.error('[RemoteDebug] 关闭会话失败:', e);
  }

  currentSession.isActive = false;
  currentSession = null;
  
  console.log('[RemoteDebug] 调试会话已关闭');
};

/**
 * 开始轮询命令
 */
const startPolling = (): void => {
  if (!currentSession) return;

  // 每2秒轮询一次
  currentSession.pollInterval = window.setInterval(async () => {
    if (!currentSession?.isActive) return;
    
    try {
      await pollAndExecuteCommand();
    } catch (e) {
      console.error('[RemoteDebug] 轮询错误:', e);
    }
  }, 2000);

  // 立即执行一次
  pollAndExecuteCommand();
};

/**
 * 轮询并执行命令
 */
const pollAndExecuteCommand = async (): Promise<void> => {
  if (!currentSession?.isActive) return;

  const backendUrl = await getBackendUrl();
  
  try {
    const response = await fetch(`${backendUrl}/debug/poll/${currentSession.verificationCode}`);
    const result = await response.json();

    if (!result.hasCommand) return;

    const command = result.command as DebugCommand;
    console.log(`[RemoteDebug] 收到命令:`, command);

    // 执行命令
    const startTime = Date.now();
    let executionResult: any;
    let resultType = 'success';

    try {
      executionResult = await executeCommand(command);
    } catch (e: any) {
      resultType = 'error';
      executionResult = { error: e.message, stack: e.stack };
    }

    const executionTime = Date.now() - startTime;

    // 上报结果
    await reportResult(command.id, resultType, executionResult, executionTime);

  } catch (e) {
    console.error('[RemoteDebug] 轮询失败:', e);
  }
};

/**
 * 执行调试命令
 */
const executeCommand = async (command: DebugCommand): Promise<any> => {
  const { type, data } = command;

  switch (type) {
    case 'query_dom':
      return executeQueryDom(data);
    
    case 'get_html':
      return executeGetHtml(data);
    
    case 'click':
      return executeClick(data);
    
    case 'input':
      return executeInput(data);
    
    case 'eval':
      return executeEval(data);
    
    case 'get_all_inputs':
      return executeGetAllInputs(data);
    
    case 'get_element_info':
      return executeGetElementInfo(data);
    
    case 'scroll':
      return executeScroll(data);
    
    case 'wait':
      return executeWait(data);
    
    case 'get_page_info':
      return executeGetPageInfo();

    case 'find_by_text':
      return executeFindByText(data);

    case 'highlight':
      return executeHighlight(data);

    default:
      throw new Error(`未知命令类型: ${type}`);
  }
};

/**
 * 查询DOM元素
 */
const executeQueryDom = (data: { selector: string; multiple?: boolean }): any => {
  const { selector, multiple } = data;
  
  if (multiple) {
    const elements = document.querySelectorAll(selector);
    return {
      count: elements.length,
      elements: Array.from(elements).slice(0, 20).map((el, index) => ({
        index,
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        textContent: el.textContent?.substring(0, 100),
        attributes: getElementAttributes(el)
      }))
    };
  } else {
    const element = document.querySelector(selector);
    if (!element) {
      return { found: false, selector };
    }
    return {
      found: true,
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      textContent: element.textContent?.substring(0, 200),
      innerHTML: element.innerHTML.substring(0, 500),
      attributes: getElementAttributes(element),
      rect: element.getBoundingClientRect()
    };
  }
};

/**
 * 获取元素HTML
 */
const executeGetHtml = (data: { selector: string; outer?: boolean }): any => {
  const { selector, outer } = data;
  const element = document.querySelector(selector);
  
  if (!element) {
    return { found: false, selector };
  }

  return {
    found: true,
    html: outer ? element.outerHTML : element.innerHTML
  };
};

/**
 * 点击元素
 */
const executeClick = (data: { selector: string }): any => {
  const { selector } = data;
  const element = document.querySelector(selector) as HTMLElement;
  
  if (!element) {
    return { success: false, error: `元素未找到: ${selector}` };
  }

  element.click();
  return { success: true, clicked: selector };
};

/**
 * 输入文本
 */
const executeInput = (data: { selector: string; value: string; clear?: boolean }): any => {
  const { selector, value, clear } = data;
  const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  
  if (!element) {
    return { success: false, error: `元素未找到: ${selector}` };
  }

  if (clear) {
    element.value = '';
  }
  
  element.focus();
  element.value = value;
  
  // 触发输入事件
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true, inputted: value.substring(0, 50) };
};

/**
 * 执行JavaScript代码
 */
const executeEval = (data: { code: string }): any => {
  const { code } = data;
  
  try {
    // 使用Function构造器执行代码，比eval更安全
    const fn = new Function('document', 'window', code);
    const result = fn(document, window);
    return { success: true, result: JSON.stringify(result)?.substring(0, 2000) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

/**
 * 获取所有输入框
 */
const executeGetAllInputs = (data: { visible?: boolean }): any => {
  const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
  
  const results = Array.from(inputs).map((el, index) => {
    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && 
                      rect.top < window.innerHeight && rect.bottom > 0;
    
    if (data.visible && !isVisible) return null;

    return {
      index,
      tagName: el.tagName,
      type: (el as HTMLInputElement).type || 'text',
      id: el.id,
      name: (el as HTMLInputElement).name,
      className: el.className,
      placeholder: (el as HTMLInputElement).placeholder,
      value: (el as HTMLInputElement).value?.substring(0, 50),
      isVisible,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      selector: generateSelector(el)
    };
  }).filter(Boolean);

  return {
    count: results.length,
    inputs: results
  };
};

/**
 * 获取元素详细信息
 */
const executeGetElementInfo = (data: { selector: string }): any => {
  const { selector } = data;
  const element = document.querySelector(selector);
  
  if (!element) {
    return { found: false, selector };
  }

  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);

  return {
    found: true,
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    attributes: getElementAttributes(element),
    textContent: element.textContent?.substring(0, 300),
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right
    },
    styles: {
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      position: styles.position,
      zIndex: styles.zIndex
    },
    parent: element.parentElement ? {
      tagName: element.parentElement.tagName,
      id: element.parentElement.id,
      className: element.parentElement.className
    } : null,
    childrenCount: element.children.length,
    selector: generateSelector(element)
  };
};

/**
 * 滚动页面
 */
const executeScroll = (data: { x?: number; y?: number; selector?: string }): any => {
  if (data.selector) {
    const element = document.querySelector(data.selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true, scrolledTo: data.selector };
    }
    return { success: false, error: `元素未找到: ${data.selector}` };
  }
  
  window.scrollTo({
    top: data.y || 0,
    left: data.x || 0,
    behavior: 'smooth'
  });
  
  return { success: true, scrolledTo: { x: data.x, y: data.y } };
};

/**
 * 等待
 */
const executeWait = async (data: { ms: number }): Promise<any> => {
  await new Promise(resolve => setTimeout(resolve, data.ms));
  return { success: true, waited: data.ms };
};

/**
 * 获取页面信息
 */
const executeGetPageInfo = (): any => {
  return {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    documentElement: {
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth
    },
    body: {
      scrollHeight: document.body.scrollHeight,
      scrollWidth: document.body.scrollWidth
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    }
  };
};

/**
 * 按文本查找元素
 */
const executeFindByText = (data: { text: string; tagName?: string }): any => {
  const { text, tagName } = data;
  const selector = tagName || '*';
  const elements = document.querySelectorAll(selector);
  
  const matches = Array.from(elements).filter(el => 
    el.textContent?.includes(text)
  ).slice(0, 20);

  return {
    count: matches.length,
    elements: matches.map((el, index) => ({
      index,
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      textContent: el.textContent?.substring(0, 100),
      selector: generateSelector(el)
    }))
  };
};

/**
 * 高亮元素（用于调试可视化）
 */
const executeHighlight = (data: { selector: string; color?: string; duration?: number }): any => {
  const { selector, color = 'red', duration = 3000 } = data;
  const element = document.querySelector(selector) as HTMLElement;
  
  if (!element) {
    return { success: false, error: `元素未找到: ${selector}` };
  }

  const originalOutline = element.style.outline;
  const originalBackground = element.style.backgroundColor;
  
  element.style.outline = `3px solid ${color}`;
  element.style.backgroundColor = `${color}22`;
  
  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.backgroundColor = originalBackground;
  }, duration);

  return { success: true, highlighted: selector };
};

/**
 * 上报执行结果
 */
const reportResult = async (
  commandId: number, 
  resultType: string, 
  resultData: any, 
  executionTime: number
): Promise<void> => {
  if (!currentSession) return;

  const backendUrl = await getBackendUrl();
  
  try {
    await fetch(`${backendUrl}/debug/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandId,
        verificationCode: currentSession.verificationCode,
        resultType,
        resultData,
        executionTime
      })
    });
    
    console.log(`[RemoteDebug] 结果已上报, 命令ID: ${commandId}`);
  } catch (e) {
    console.error('[RemoteDebug] 上报结果失败:', e);
  }
};

/**
 * 获取元素属性
 */
const getElementAttributes = (element: Element): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const attr of element.attributes) {
    attrs[attr.name] = attr.value.substring(0, 100);
  }
  return attrs;
};

/**
 * 生成元素选择器
 */
const generateSelector = (element: Element): string => {
  if (element.id) {
    return `#${element.id}`;
  }
  
  const path: string[] = [];
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }
    
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) {
        selector += `.${classes}`;
      }
    }
    
    // 添加nth-child
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
};

/**
 * 获取当前会话状态
 */
export const getDebugSessionStatus = (): { isActive: boolean; verificationCode?: string } => {
  if (!currentSession) {
    return { isActive: false };
  }
  return {
    isActive: currentSession.isActive,
    verificationCode: currentSession.verificationCode
  };
};

/**
 * 在页面上显示调试面板
 */
export const showDebugPanel = (): void => {
  // 移除已存在的面板
  const existingPanel = document.getElementById('memoraid-debug-panel');
  if (existingPanel) {
    existingPanel.remove();
  }

  const panel = document.createElement('div');
  panel.id = 'memoraid-debug-panel';
  panel.innerHTML = `
    <style>
      #memoraid-debug-panel {
        position: fixed;
        top: 10px;
        right: 10px;
        width: 300px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f3460;
        border-radius: 12px;
        padding: 16px;
        z-index: 999999;
        font-family: 'Segoe UI', system-ui, sans-serif;
        color: #e8e8e8;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      }
      #memoraid-debug-panel h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: #00d9ff;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #memoraid-debug-panel .status {
        font-size: 12px;
        padding: 8px 12px;
        background: rgba(0, 217, 255, 0.1);
        border-radius: 8px;
        margin-bottom: 12px;
      }
      #memoraid-debug-panel .code {
        font-size: 24px;
        font-weight: bold;
        color: #00ff88;
        text-align: center;
        padding: 12px;
        background: rgba(0, 255, 136, 0.1);
        border-radius: 8px;
        letter-spacing: 4px;
        font-family: 'Consolas', monospace;
      }
      #memoraid-debug-panel .btn {
        width: 100%;
        padding: 10px;
        margin-top: 12px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }
      #memoraid-debug-panel .btn-start {
        background: linear-gradient(135deg, #00d9ff 0%, #00ff88 100%);
        color: #1a1a2e;
      }
      #memoraid-debug-panel .btn-stop {
        background: linear-gradient(135deg, #ff6b6b 0%, #ff8e53 100%);
        color: white;
      }
      #memoraid-debug-panel .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 217, 255, 0.3);
      }
      #memoraid-debug-panel .close {
        position: absolute;
        top: 8px;
        right: 12px;
        background: none;
        border: none;
        color: #888;
        font-size: 18px;
        cursor: pointer;
      }
      #memoraid-debug-panel .close:hover {
        color: #ff6b6b;
      }
    </style>
    <button class="close" onclick="document.getElementById('memoraid-debug-panel').remove()">×</button>
    <h3>🔧 Memoraid 远程调试</h3>
    <div class="status" id="debug-status">状态: 未启动</div>
    <div class="code" id="debug-code" style="display:none;">------</div>
    <button class="btn btn-start" id="debug-toggle-btn">启动调试会话</button>
  `;

  document.body.appendChild(panel);

  // 绑定按钮事件
  const toggleBtn = document.getElementById('debug-toggle-btn') as HTMLButtonElement;
  const statusDiv = document.getElementById('debug-status') as HTMLDivElement;
  const codeDiv = document.getElementById('debug-code') as HTMLDivElement;

  toggleBtn.addEventListener('click', async () => {
    const status = getDebugSessionStatus();
    
    if (status.isActive) {
      await stopDebugSession();
      statusDiv.textContent = '状态: 已停止';
      codeDiv.style.display = 'none';
      toggleBtn.textContent = '启动调试会话';
      toggleBtn.className = 'btn btn-start';
    } else {
      try {
        toggleBtn.disabled = true;
        toggleBtn.textContent = '正在连接...';
        
        const code = await startDebugSession();
        
        statusDiv.textContent = '状态: 运行中 (轮询中...)';
        codeDiv.textContent = code;
        codeDiv.style.display = 'block';
        toggleBtn.textContent = '停止调试会话';
        toggleBtn.className = 'btn btn-stop';
      } catch (e: any) {
        statusDiv.textContent = `错误: ${e.message}`;
      } finally {
        toggleBtn.disabled = false;
      }
    }
  });

  // 如果已有活跃会话，更新UI
  const status = getDebugSessionStatus();
  if (status.isActive && status.verificationCode) {
    statusDiv.textContent = '状态: 运行中 (轮询中...)';
    codeDiv.textContent = status.verificationCode;
    codeDiv.style.display = 'block';
    toggleBtn.textContent = '停止调试会话';
    toggleBtn.className = 'btn btn-stop';
  }
};
