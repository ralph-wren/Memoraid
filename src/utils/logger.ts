/**
 * 统一的悬浮窗 Logger 工具类
 * 与官网风格保持一致：白色背景、灰色边框、简洁设计
 */

export type LogLevel = 'info' | 'action' | 'error' | 'success' | 'warn';

export interface LoggerOptions {
  title: string;
  icon?: string;
  accentColor?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export class UnifiedLogger {
  private container: HTMLDivElement;
  private logContent: HTMLDivElement;
  private stopBtn: HTMLButtonElement;
  private onStop?: () => void;
  private options: LoggerOptions;
  private logs: Array<{ time: number; level: string; message: string }> = []; // 【新增2026-03-28】存储日志数据

  constructor(options: LoggerOptions) {
    this.options = options;
    this.container = document.createElement('div');
    this.container.id = `memoraid-logger-${Date.now()}`;
    
    // 统一样式：白色背景、灰色边框、简洁设计
    const position = this.getPositionStyle(options.position || 'top-left');
    this.container.style.cssText = `
      position: fixed;
      ${position}
      width: 400px;
      max-height: 500px;
      background: white;
      color: #374151;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      border: 1px solid #e5e7eb;
      z-index: 20000;
      display: none;
      flex-direction: column;
      overflow: hidden;
    `;

    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    `;
    
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; color: #111827;';
    titleEl.innerHTML = `${options.icon || '🤖'} <span>${options.title}</span>`;
    
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 6px; align-items: center;';

    // 停止按钮
    this.stopBtn = document.createElement('button');
    this.stopBtn.innerText = '停止';
    this.stopBtn.style.cssText = `
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: none;
      transition: background 0.2s;
    `;
    this.stopBtn.onmouseover = () => { this.stopBtn.style.background = '#dc2626'; };
    this.stopBtn.onmouseout = () => { this.stopBtn.style.background = '#ef4444'; };
    this.stopBtn.onclick = () => {
      if (this.onStop) this.onStop();
      this.log('🛑 已停止', 'error');
      this.stopBtn.style.display = 'none';
    };

    // 复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.innerText = '复制';
    copyBtn.style.cssText = `
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.2s;
    `;
    copyBtn.onmouseover = () => { copyBtn.style.background = '#2563eb'; };
    copyBtn.onmouseout = () => { copyBtn.style.background = '#3b82f6'; };
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.logContent.innerText);
      copyBtn.innerText = '已复制';
      setTimeout(() => { copyBtn.innerText = '复制'; }, 1500);
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      background: transparent;
      color: #9ca3af;
      border: none;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    `;
    closeBtn.onmouseover = () => { 
      closeBtn.style.background = '#f3f4f6'; 
      closeBtn.style.color = '#111827';
    };
    closeBtn.onmouseout = () => { 
      closeBtn.style.background = 'transparent'; 
      closeBtn.style.color = '#9ca3af';
    };
    closeBtn.onclick = () => {
      if (this.onStop) this.onStop();
      this.container.style.display = 'none';
    };

    controls.appendChild(this.stopBtn);
    controls.appendChild(copyBtn);
    controls.appendChild(closeBtn);
    header.appendChild(titleEl);
    header.appendChild(controls);

    // 日志内容区域
    this.logContent = document.createElement('div');
    this.logContent.style.cssText = `
      overflow-y: auto;
      flex: 1;
      padding: 12px 16px;
      background: white;
      max-height: 400px;
    `;

    this.container.appendChild(header);
    this.container.appendChild(this.logContent);
    document.body.appendChild(this.container);
  }

  private getPositionStyle(position: string): string {
    switch (position) {
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-left':
        return 'bottom: 20px; left: 20px;';
      case 'bottom-right':
        return 'bottom: 20px; right: 20px;';
      default: // top-left
        return 'top: 20px; left: 20px;';
    }
  }

  show() { 
    this.container.style.display = 'flex'; 
  }
  
  hide() { 
    this.container.style.display = 'none'; 
  }
  
  setStopCallback(cb: () => void) { 
    this.onStop = cb; 
    this.stopBtn.style.display = 'block'; 
  }
  
  hideStopButton() { 
    this.stopBtn.style.display = 'none'; 
  }
  
  clear() { 
    this.logContent.innerHTML = ''; 
    this.logs = []; // 【新增2026-03-28】清空日志数据
  }

  log(message: string, type: LogLevel = 'info') {
    // 【新增2026-03-28】保存日志到数组
    this.logs.push({
      time: Date.now(),
      level: type,
      message: message
    });
    this.show();
    const line = document.createElement('div');
    line.style.cssText = `
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.5;
      font-size: 13px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      ${this.getLogStyle(type)}
    `;
    
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const icon = this.getIcon(type);
    
    line.innerHTML = `
      <span style="color: #9ca3af; font-size: 11px; flex-shrink: 0;">${time}</span>
      <span style="flex-shrink: 0;">${icon}</span>
      <span style="flex: 1; word-break: break-word;">${message}</span>
    `;
    
    this.logContent.appendChild(line);
    this.logContent.scrollTop = this.logContent.scrollHeight;
    
    // 错误上报
    if (type === 'error') {
      try {
        chrome.runtime.sendMessage({
          type: 'REPORT_ERROR',
          payload: { message, context: this.options.title }
        }).catch(() => {});
      } catch (e) {
        // Ignore
      }
    }
  }

  private getLogStyle(type: LogLevel): string {
    switch (type) {
      case 'error':
        return 'background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;';
      case 'success':
        return 'background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534;';
      case 'warn':
        return 'background: #fffbeb; border: 1px solid #fde68a; color: #92400e;';
      case 'action':
        return 'background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af;';
      default: // info
        return 'background: #f9fafb; border: 1px solid #e5e7eb; color: #374151;';
    }
  }

  private getIcon(type: LogLevel): string {
    switch (type) {
      case 'error':
        return '❌';
      case 'success':
        return '✅';
      case 'warn':
        return '⚠️';
      case 'action':
        return '▶️';
      default:
        return 'ℹ️';
    }
  }

  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  // 【新增2026-03-28】获取日志数据
  getLogs(): Array<{ time: number; level: string; message: string }> {
    return [...this.logs]; // 返回副本
  }
}
