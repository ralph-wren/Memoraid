/**
 * Memoraid 远程调试 - 独立注入脚本
 * 
 * 使用方法：
 * 1. 在浏览器控制台粘贴此脚本
 * 2. 脚本会自动连接后端并显示验证码
 * 3. 开发者使用验证码发送命令，脚本自动执行
 */
(async function() {
  const BACKEND_URL = 'https://memoraid-backend.iuyuger.workers.dev';
  let verificationCode = null;
  let isActive = true;
  let pollTimer = null;

  // 样式
  const panelStyle = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 280px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 2px solid #00d9ff;
    border-radius: 12px;
    padding: 16px;
    z-index: 2147483647;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #e8e8e8;
    box-shadow: 0 8px 32px rgba(0, 217, 255, 0.3);
  `;

  // 创建面板
  const panel = document.createElement('div');
  panel.id = 'memoraid-remote-debug';
  panel.innerHTML = `
    <div style="${panelStyle}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:bold;color:#00d9ff;">🔧 远程调试</span>
        <button id="mrd-close" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;">×</button>
      </div>
      <div id="mrd-status" style="font-size:12px;padding:8px;background:rgba(0,217,255,0.1);border-radius:6px;margin-bottom:10px;">
        正在连接...
      </div>
      <div id="mrd-code" style="font-size:28px;font-weight:bold;color:#00ff88;text-align:center;padding:12px;background:rgba(0,255,136,0.1);border-radius:8px;letter-spacing:6px;font-family:Consolas,monospace;display:none;">
        ------
      </div>
      <div id="mrd-log" style="margin-top:10px;font-size:11px;max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.3);border-radius:6px;padding:8px;">
      </div>
      <button id="mrd-stop" style="width:100%;margin-top:10px;padding:8px;background:linear-gradient(135deg,#ff6b6b,#ff8e53);border:none;border-radius:6px;color:white;font-size:12px;cursor:pointer;display:none;">
        停止调试
      </button>
    </div>
  `;
  document.body.appendChild(panel);

  const statusEl = document.getElementById('mrd-status');
  const codeEl = document.getElementById('mrd-code');
  const logEl = document.getElementById('mrd-log');
  const stopBtn = document.getElementById('mrd-stop');
  const closeBtn = document.getElementById('mrd-close');

  // 日志函数
  const log = (msg, type = 'info') => {
    const colors = { info: '#00d9ff', success: '#00ff88', error: '#ff6b6b', cmd: '#ffcc00' };
    const time = new Date().toLocaleTimeString();
    logEl.innerHTML += `<div style="color:${colors[type]};margin:2px 0;">[${time}] ${msg}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(`[RemoteDebug] ${msg}`);
  };

  // 关闭面板
  closeBtn.onclick = () => {
    isActive = false;
    if (pollTimer) clearInterval(pollTimer);
    panel.remove();
    log('调试已停止');
  };

  stopBtn.onclick = closeBtn.onclick;

  // 创建会话
  try {
    const resp = await fetch(`${BACKEND_URL}/debug/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pluginInfo: {
          url: window.location.href,
          title: document.title,
          userAgent: navigator.userAgent,
          timestamp: Date.now()
        }
      })
    });
    const data = await resp.json();
    
    if (data.success) {
      verificationCode = data.verificationCode;
      statusEl.textContent = '✓ 已连接 - 等待命令...';
      statusEl.style.color = '#00ff88';
      codeEl.textContent = verificationCode;
      codeEl.style.display = 'block';
      stopBtn.style.display = 'block';
      log(`会话已创建: ${verificationCode}`, 'success');
      
      // 开始轮询
      startPolling();
    } else {
      throw new Error(data.error);
    }
  } catch (e) {
    statusEl.textContent = '✗ 连接失败: ' + e.message;
    statusEl.style.color = '#ff6b6b';
    log('连接失败: ' + e.message, 'error');
  }

  // 轮询命令
  function startPolling() {
    pollTimer = setInterval(async () => {
      if (!isActive) return;
      
      try {
        const resp = await fetch(`${BACKEND_URL}/debug/poll/${verificationCode}`);
        const data = await resp.json();
        
        if (data.hasCommand) {
          const cmd = data.command;
          log(`执行: ${cmd.type}`, 'cmd');
          
          const startTime = Date.now();
          let result, resultType = 'success';
          
          try {
            result = await executeCommand(cmd.type, cmd.data);
          } catch (e) {
            resultType = 'error';
            result = { error: e.message, stack: e.stack };
          }
          
          const execTime = Date.now() - startTime;
          
          // 上报结果
          await fetch(`${BACKEND_URL}/debug/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              commandId: cmd.id,
              verificationCode,
              resultType,
              resultData: result,
              executionTime: execTime
            })
          });
          
          log(`完成 (${execTime}ms)`, resultType === 'success' ? 'success' : 'error');
        }
      } catch (e) {
        // 静默处理轮询错误
      }
    }, 2000);
  }

  // 执行命令
  async function executeCommand(type, data) {
    switch (type) {
      case 'query_dom':
        return queryDom(data);
      case 'get_html':
        return getHtml(data);
      case 'click':
        return clickElement(data);
      case 'input':
        return inputText(data);
      case 'eval':
        return evalCode(data);
      case 'get_all_inputs':
        return getAllInputs(data);
      case 'get_element_info':
        return getElementInfo(data);
      case 'scroll':
        return scrollTo(data);
      case 'wait':
        return wait(data);
      case 'get_page_info':
        return getPageInfo();
      case 'find_by_text':
        return findByText(data);
      case 'highlight':
        return highlight(data);
      case 'screenshot_element':
        return screenshotElement(data);
      default:
        throw new Error(`未知命令: ${type}`);
    }
  }

  // === 命令实现 ===

  function queryDom({ selector, multiple }) {
    if (multiple) {
      const els = document.querySelectorAll(selector);
      return {
        count: els.length,
        elements: Array.from(els).slice(0, 30).map((el, i) => ({
          index: i,
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          text: el.textContent?.substring(0, 100)?.trim(),
          selector: genSelector(el)
        }))
      };
    }
    const el = document.querySelector(selector);
    if (!el) return { found: false };
    return {
      found: true,
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      text: el.textContent?.substring(0, 200)?.trim(),
      html: el.innerHTML.substring(0, 1000),
      rect: el.getBoundingClientRect(),
      selector: genSelector(el)
    };
  }

  function getHtml({ selector, outer }) {
    const el = document.querySelector(selector);
    if (!el) return { found: false };
    return { found: true, html: outer ? el.outerHTML : el.innerHTML };
  }

  function clickElement({ selector }) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: '元素未找到' };
    el.click();
    return { success: true };
  }

  function inputText({ selector, value, clear }) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: '元素未找到' };
    if (clear) el.value = '';
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function evalCode({ code }) {
    try {
      const fn = new Function('document', 'window', code);
      const result = fn(document, window);
      return { success: true, result: JSON.stringify(result)?.substring(0, 5000) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function getAllInputs({ visible }) {
    const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    const results = Array.from(inputs).map((el, i) => {
      const rect = el.getBoundingClientRect();
      const isVis = rect.width > 0 && rect.height > 0;
      if (visible && !isVis) return null;
      return {
        index: i,
        tagName: el.tagName,
        type: el.type || 'text',
        id: el.id,
        name: el.name,
        className: el.className?.substring?.(0, 100),
        placeholder: el.placeholder,
        value: el.value?.substring(0, 50),
        isVisible: isVis,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        selector: genSelector(el)
      };
    }).filter(Boolean);
    return { count: results.length, inputs: results };
  }

  function getElementInfo({ selector }) {
    const el = document.querySelector(selector);
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    return {
      found: true,
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      text: el.textContent?.substring(0, 300)?.trim(),
      rect,
      styles: {
        display: styles.display,
        visibility: styles.visibility,
        opacity: styles.opacity,
        position: styles.position
      },
      childrenCount: el.children.length,
      selector: genSelector(el)
    };
  }

  function scrollTo({ selector, x, y }) {
    if (selector) {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      }
      return { success: false, error: '元素未找到' };
    }
    window.scrollTo({ top: y || 0, left: x || 0, behavior: 'smooth' });
    return { success: true };
  }

  async function wait({ ms }) {
    await new Promise(r => setTimeout(r, ms));
    return { success: true, waited: ms };
  }

  function getPageInfo() {
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      bodySize: { width: document.body.scrollWidth, height: document.body.scrollHeight }
    };
  }

  function findByText({ text, tagName }) {
    const selector = tagName || '*';
    const els = document.querySelectorAll(selector);
    const matches = Array.from(els).filter(el => el.textContent?.includes(text)).slice(0, 20);
    return {
      count: matches.length,
      elements: matches.map((el, i) => ({
        index: i,
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        text: el.textContent?.substring(0, 100)?.trim(),
        selector: genSelector(el)
      }))
    };
  }

  function highlight({ selector, color = 'red', duration = 3000 }) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: '元素未找到' };
    const orig = { outline: el.style.outline, bg: el.style.backgroundColor };
    el.style.outline = `3px solid ${color}`;
    el.style.backgroundColor = `${color}22`;
    setTimeout(() => {
      el.style.outline = orig.outline;
      el.style.backgroundColor = orig.bg;
    }, duration);
    return { success: true };
  }

  function screenshotElement({ selector }) {
    // 简化版：返回元素位置信息供外部截图
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: '元素未找到' };
    return { success: true, rect: el.getBoundingClientRect() };
  }

  function genSelector(el) {
    if (el.id) return `#${el.id}`;
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && path.length < 5) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { path.unshift(`#${cur.id}`); break; }
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
      }
      path.unshift(s);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  console.log('%c[Memoraid 远程调试已启动]', 'color: #00ff88; font-size: 14px; font-weight: bold;');
  console.log('%c验证码: ' + verificationCode, 'color: #ffcc00; font-size: 16px;');
})();
