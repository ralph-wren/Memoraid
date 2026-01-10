/**
 * 远程调试控制台
 * 
 * 用法：
 *   node scripts/debug-console.js
 * 
 * 然后输入验证码连接到插件实例，发送调试命令
 */

const readline = require('readline');

const BACKEND_URL = 'https://memoraid-backend.iuyuger.workers.dev';

let currentCode = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  result: (data) => console.log(`${colors.magenta}→${colors.reset}`, JSON.stringify(data, null, 2))
};

// 发送命令
async function sendCommand(type, data) {
  if (!currentCode) {
    log.error('请先连接到插件实例 (使用 connect <验证码>)');
    return null;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/debug/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationCode: currentCode,
        commandType: type,
        commandData: data
      })
    });

    const result = await response.json();
    
    if (!result.success) {
      log.error(`发送失败: ${result.error}`);
      return null;
    }

    log.info(`命令已发送，ID: ${result.commandId}`);
    
    // 等待结果
    return await waitForResult(result.commandId);
  } catch (e) {
    log.error(`请求失败: ${e.message}`);
    return null;
  }
}

// 等待命令结果
async function waitForResult(commandId, maxWait = 30000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(`${BACKEND_URL}/debug/result/${commandId}`);
      const data = await response.json();
      
      if (data.command?.status === 'completed' || data.command?.status === 'failed') {
        if (data.result) {
          if (data.result.type === 'success') {
            log.success(`执行成功 (${data.result.executionTime}ms)`);
          } else {
            log.error(`执行失败`);
          }
          log.result(data.result.data);
          return data.result;
        }
      }
      
      // 等待500ms后重试
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      log.error(`获取结果失败: ${e.message}`);
      break;
    }
  }
  
  log.warn('等待结果超时');
  return null;
}

// 获取活跃会话
async function listSessions() {
  try {
    const response = await fetch(`${BACKEND_URL}/debug/sessions`);
    const data = await response.json();
    
    if (data.sessions?.length === 0) {
      log.warn('没有活跃的调试会话');
      return;
    }
    
    console.log('\n活跃的调试会话:');
    console.log('─'.repeat(60));
    
    for (const session of data.sessions) {
      const info = session.pluginInfo;
      const lastHeartbeat = new Date(session.lastHeartbeat * 1000).toLocaleTimeString();
      console.log(`  ${colors.green}${session.code}${colors.reset} - ${info.url?.substring(0, 50) || 'Unknown'}`);
      console.log(`    最后心跳: ${lastHeartbeat}`);
    }
    console.log('─'.repeat(60));
  } catch (e) {
    log.error(`获取会话列表失败: ${e.message}`);
  }
}

// 获取命令历史
async function getHistory() {
  if (!currentCode) {
    log.error('请先连接到插件实例');
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/debug/history/${currentCode}`);
    const data = await response.json();
    
    if (data.history?.length === 0) {
      log.info('没有命令历史');
      return;
    }
    
    console.log('\n命令历史:');
    console.log('─'.repeat(60));
    
    for (const cmd of data.history.slice(0, 10)) {
      const time = new Date(cmd.createdAt * 1000).toLocaleTimeString();
      const status = cmd.status === 'completed' ? colors.green + '✓' : 
                     cmd.status === 'failed' ? colors.red + '✗' : 
                     colors.yellow + '○';
      console.log(`  ${status}${colors.reset} [${time}] ${cmd.type}: ${JSON.stringify(cmd.data).substring(0, 40)}`);
    }
    console.log('─'.repeat(60));
  } catch (e) {
    log.error(`获取历史失败: ${e.message}`);
  }
}

// 解析命令
function parseCommand(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1).join(' ');
  
  return { cmd, args };
}

// 显示帮助
function showHelp() {
  console.log(`
${colors.bright}远程调试控制台命令:${colors.reset}

${colors.cyan}连接管理:${colors.reset}
  sessions              - 列出所有活跃的调试会话
  connect <验证码>       - 连接到指定的插件实例
  disconnect            - 断开当前连接
  history               - 查看命令历史

${colors.cyan}DOM 查询:${colors.reset}
  query <选择器>         - 查询单个元素
  queryAll <选择器>      - 查询所有匹配元素
  html <选择器>          - 获取元素 HTML
  info <选择器>          - 获取元素详细信息
  inputs                - 获取所有输入框
  find <文本>            - 按文本查找元素

${colors.cyan}交互操作:${colors.reset}
  click <选择器>         - 点击元素
  input <选择器> <文本>   - 输入文本
  scroll <选择器>        - 滚动到元素
  highlight <选择器>     - 高亮元素

${colors.cyan}其他:${colors.reset}
  page                  - 获取页面信息
  eval <代码>            - 执行 JavaScript 代码
  wait <毫秒>            - 等待指定时间
  help                  - 显示此帮助
  exit                  - 退出

${colors.yellow}示例:${colors.reset}
  connect ABC123
  query input[type="text"]
  inputs
  click .submit-btn
  eval return document.title
`);
}

// 主循环
async function main() {
  console.log(`
${colors.bright}╔════════════════════════════════════════════╗
║     Memoraid 远程调试控制台 v1.0           ║
╚════════════════════════════════════════════╝${colors.reset}

输入 ${colors.cyan}help${colors.reset} 查看可用命令
输入 ${colors.cyan}sessions${colors.reset} 查看活跃的调试会话
`);

  const prompt = () => {
    const prefix = currentCode ? `${colors.green}[${currentCode}]${colors.reset}` : `${colors.yellow}[未连接]${colors.reset}`;
    rl.question(`${prefix} > `, async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      const { cmd, args } = parseCommand(input);

      try {
        switch (cmd) {
          case 'help':
          case '?':
            showHelp();
            break;

          case 'exit':
          case 'quit':
          case 'q':
            console.log('再见!');
            process.exit(0);
            break;

          case 'sessions':
          case 'ls':
            await listSessions();
            break;

          case 'connect':
          case 'c':
            if (!args) {
              log.error('请提供验证码');
            } else {
              currentCode = args.toUpperCase();
              log.success(`已连接到 ${currentCode}`);
            }
            break;

          case 'disconnect':
          case 'dc':
            currentCode = null;
            log.info('已断开连接');
            break;

          case 'history':
          case 'h':
            await getHistory();
            break;

          case 'query':
          case 'q':
            await sendCommand('query_dom', { selector: args, multiple: false });
            break;

          case 'queryall':
          case 'qa':
            await sendCommand('query_dom', { selector: args, multiple: true });
            break;

          case 'html':
            await sendCommand('get_html', { selector: args, outer: true });
            break;

          case 'info':
          case 'i':
            await sendCommand('get_element_info', { selector: args });
            break;

          case 'inputs':
            await sendCommand('get_all_inputs', { visible: true });
            break;

          case 'find':
          case 'f':
            await sendCommand('find_by_text', { text: args });
            break;

          case 'click':
            await sendCommand('click', { selector: args });
            break;

          case 'input':
          case 'type': {
            const match = args.match(/^(\S+)\s+(.+)$/);
            if (match) {
              await sendCommand('input', { selector: match[1], value: match[2], clear: true });
            } else {
              log.error('用法: input <选择器> <文本>');
            }
            break;
          }

          case 'scroll':
            await sendCommand('scroll', { selector: args });
            break;

          case 'highlight':
          case 'hl':
            await sendCommand('highlight', { selector: args, color: 'red', duration: 3000 });
            break;

          case 'page':
            await sendCommand('get_page_info', {});
            break;

          case 'eval':
          case 'e':
            await sendCommand('eval', { code: args });
            break;

          case 'wait':
          case 'w':
            await sendCommand('wait', { ms: parseInt(args) || 1000 });
            break;

          default:
            log.warn(`未知命令: ${cmd}，输入 help 查看帮助`);
        }
      } catch (e) {
        log.error(`执行错误: ${e.message}`);
      }

      prompt();
    });
  };

  prompt();
}

main();
