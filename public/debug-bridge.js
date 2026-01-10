/**
 * Memoraid 远程调试桥接脚本
 * 此脚本运行在页面上下文中，提供 memoraidDebug 全局对象
 */
(function() {
  // 防止重复初始化
  if (window.memoraidDebug) {
    console.log('[memoraidDebug] 已初始化，跳过');
    return;
  }

  // 请求计数器
  let requestCounter = 0;
  const pendingRequests = new Map();
  
  // 监听来自 content script 的响应
  window.addEventListener('memoraid-debug-response', function(event) {
    const { requestId, ...result } = event.detail || {};
    const resolver = pendingRequests.get(requestId);
    if (resolver) {
      resolver(result);
      pendingRequests.delete(requestId);
    }
  });
  
  // 发送请求到 content script
  function sendRequest(action, data) {
    return new Promise(function(resolve) {
      const requestId = ++requestCounter;
      pendingRequests.set(requestId, resolve);
      
      window.dispatchEvent(new CustomEvent('memoraid-debug-request', {
        detail: { action: action, requestId: requestId, data: data }
      }));
      
      // 超时处理
      setTimeout(function() {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          resolve({ success: false, error: 'Request timeout' });
        }
      }, 10000);
    });
  }
  
  // 暴露全局对象
  window.memoraidDebug = {
    showPanel: function() {
      sendRequest('showPanel');
      console.log('[memoraidDebug] 正在打开调试面板...');
    },
    start: function() {
      return sendRequest('start').then(function(result) {
        if (result.success) {
          console.log('[memoraidDebug] 调试会话已启动，验证码:', result.verificationCode);
        } else {
          console.error('[memoraidDebug] 启动失败:', result.error);
        }
        return result;
      });
    },
    stop: function() {
      return sendRequest('stop').then(function(result) {
        if (result.success) {
          console.log('[memoraidDebug] 调试会话已停止');
        }
        return result;
      });
    },
    status: function() {
      return sendRequest('status');
    },
    help: function() {
      console.log('%c Memoraid 远程调试帮助 ', 'background: #1a1a2e; color: #00d9ff; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
      console.log('可用命令:');
      console.log('  memoraidDebug.showPanel()  - 显示调试面板');
      console.log('  memoraidDebug.start()      - 启动调试会话');
      console.log('  memoraidDebug.stop()       - 停止调试会话');
      console.log('  memoraidDebug.status()     - 查看会话状态');
      console.log('  memoraidDebug.help()       - 显示此帮助');
    }
  };
  
  console.log('%c🔧 Memoraid 远程调试已就绪 %c 输入 memoraidDebug.help() 查看帮助', 
    'background: linear-gradient(135deg, #1a1a2e, #16213e); color: #00d9ff; font-size: 12px; padding: 4px 8px; border-radius: 4px 0 0 4px;',
    'background: #16213e; color: #00ff88; font-size: 12px; padding: 4px 8px; border-radius: 0 4px 4px 0;'
  );
})();
