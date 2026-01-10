# Memoraid 远程调试系统

远程调试系统允许开发者通过后端 API 远程控制浏览器中的页面，执行 DOM 查询、元素点击、文本输入等操作，并获取执行结果。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      远程调试系统架构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   浏览器端                  D1 数据库                   开发端    │
│  ┌──────────┐            ┌──────────┐             ┌──────────┐ │
│  │ 注入脚本  │──轮询命令──▶│ commands │◀──发送命令──│  curl/   │ │
│  │ (验证码) │            │ results  │             │ console  │ │
│  │          │◀──上报结果──│ sessions │──获取结果──▶│          │ │
│  └──────────┘            └──────────┘             └──────────┘ │
│                                                                 │
│  工作流程:                                                       │
│  1. 浏览器注入脚本 → 创建会话 → 获得验证码                         │
│  2. 开发端使用验证码发送命令                                       │
│  3. 浏览器轮询获取命令并执行                                       │
│  4. 执行结果上报到数据库                                          │
│  5. 开发端获取结果进行分析                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 实现原理

### 核心挑战：绕过 CSP (Content Security Policy)

现代网站（如微信公众号）通常有严格的 CSP 策略，禁止：
- 内联脚本 (`script-src 'self'`)
- 外部脚本加载 (`script-src` 白名单)
- `eval()` 执行

这导致传统的脚本注入方式无法工作。

### 解决方案：Chrome Scripting API + MAIN World

我们使用 Chrome 扩展的 `chrome.scripting.executeScript` API，配合 `world: 'MAIN'` 参数，直接在页面的主执行上下文中运行代码。这是 Chrome 官方提供的方法，**不受页面 CSP 限制**。

```
┌─────────────────────────────────────────────────────────────────┐
│                    脚本注入流程                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Content Script (ISOLATED world)                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. 页面加载时，content script 自动注入                      │  │
│  │ 2. 发送消息给 background: INJECT_DEBUG_BRIDGE              │  │
│  │ 3. 监听 CustomEvent 与页面通信                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  Background Service Worker                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 4. 收到 INJECT_DEBUG_BRIDGE 消息                          │  │
│  │ 5. 调用 chrome.scripting.executeScript({                  │  │
│  │      target: { tabId },                                   │  │
│  │      world: 'MAIN',  // 关键！在页面主上下文执行            │  │
│  │      func: () => { ... }                                  │  │
│  │    })                                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  Page Context (MAIN world)                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 6. window.memoraidDebug 对象被创建                         │  │
│  │ 7. 用户可在控制台调用 memoraidDebug.showPanel() 等方法      │  │
│  │ 8. 通过 CustomEvent 与 content script 双向通信             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 通信机制

由于 Content Script 和 Page Context 是隔离的，我们使用 `CustomEvent` 进行通信：

```javascript
// Page Context → Content Script
window.dispatchEvent(new CustomEvent('memoraid-debug-request', {
  detail: { action: 'showPanel', requestId: 1 }
}));

// Content Script → Page Context
window.dispatchEvent(new CustomEvent('memoraid-debug-response', {
  detail: { requestId: 1, success: true }
}));
```

### 关键代码位置

| 文件 | 作用 |
|------|------|
| `src/background/index.ts` | 包含 `DEBUG_BRIDGE_CODE` 和 `injectDebugBridge()` 函数 |
| `src/content/index.ts` | 监听 CustomEvent，处理调试请求 |
| `src/utils/remoteDebug.ts` | 远程调试核心逻辑（会话管理、命令执行） |
| `src/manifest.ts` | 声明 `scripting` 权限和 `web_accessible_resources` |

### 为什么这样设计？

1. **绕过 CSP**：`chrome.scripting.executeScript` 是特权 API，不受页面安全策略限制
2. **保持隔离**：敏感操作（如网络请求）在 Content Script 中执行，更安全
3. **用户友好**：在控制台直接输入 `memoraidDebug.xxx()` 即可使用
4. **兼容性好**：适用于任何网页，包括有严格 CSP 的网站

## 快速开始

### 方法一：使用插件内置功能（推荐）

在任意网页的控制台中输入：

```javascript
memoraidDebug.help()        // 显示帮助
memoraidDebug.showPanel()   // 显示调试面板
memoraidDebug.start()       // 启动调试会话（返回验证码）
memoraidDebug.stop()        // 停止调试会话
memoraidDebug.status()      // 获取调试状态
```

### 方法二：使用注入脚本（适用于未安装插件的情况）

1. 打开目标网页
2. 按 `F12` 打开开发者工具 → Console
3. 粘贴以下代码并回车：

```javascript
(async function(){const B='https://memoraid-backend.iuyuger.workers.dev';let V=null,A=true,T=null;const S=`position:fixed;top:10px;right:10px;width:280px;background:linear-gradient(135deg,#1a1a2e,#16213e);border:2px solid #00d9ff;border-radius:12px;padding:16px;z-index:2147483647;font-family:'Segoe UI',system-ui,sans-serif;color:#e8e8e8;box-shadow:0 8px 32px rgba(0,217,255,0.3);`;const P=document.createElement('div');P.id='mrd';P.innerHTML=`<div style="${S}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-size:14px;font-weight:bold;color:#00d9ff;">🔧 远程调试</span><button id="mrd-x" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;">×</button></div><div id="mrd-s" style="font-size:12px;padding:8px;background:rgba(0,217,255,0.1);border-radius:6px;margin-bottom:10px;">正在连接...</div><div id="mrd-c" style="font-size:28px;font-weight:bold;color:#00ff88;text-align:center;padding:12px;background:rgba(0,255,136,0.1);border-radius:8px;letter-spacing:6px;font-family:Consolas,monospace;display:none;">------</div><div id="mrd-l" style="margin-top:10px;font-size:11px;max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.3);border-radius:6px;padding:8px;"></div></div>`;document.body.appendChild(P);const $s=document.getElementById('mrd-s'),$c=document.getElementById('mrd-c'),$l=document.getElementById('mrd-l');document.getElementById('mrd-x').onclick=()=>{A=false;T&&clearInterval(T);P.remove();};const L=(m,t='info')=>{const c={info:'#00d9ff',success:'#00ff88',error:'#ff6b6b',cmd:'#ffcc00'};$l.innerHTML+=`<div style="color:${c[t]}">[${new Date().toLocaleTimeString()}] ${m}</div>`;$l.scrollTop=$l.scrollHeight;console.log('[RD]',m);};try{const r=await fetch(`${B}/debug/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pluginInfo:{url:location.href,title:document.title,ua:navigator.userAgent,t:Date.now()}})});const d=await r.json();if(d.success){V=d.verificationCode;$s.textContent='✓ 已连接';$s.style.color='#00ff88';$c.textContent=V;$c.style.display='block';L('验证码: '+V,'success');T=setInterval(async()=>{if(!A)return;try{const r=await fetch(`${B}/debug/poll/${V}`);const d=await r.json();if(d.hasCommand){const c=d.command;L('执行: '+c.type,'cmd');const st=Date.now();let res,rt='success';try{res=await X(c.type,c.data);}catch(e){rt='error';res={error:e.message};}await fetch(`${B}/debug/result`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:c.id,verificationCode:V,resultType:rt,resultData:res,executionTime:Date.now()-st})});L('完成 ('+(Date.now()-st)+'ms)',rt==='success'?'success':'error');}}catch(e){}},2000);}else throw new Error(d.error);}catch(e){$s.textContent='✗ 失败: '+e.message;$s.style.color='#ff6b6b';}async function X(t,d){const q=s=>document.querySelector(s),qa=s=>document.querySelectorAll(s),gs=e=>{if(e.id)return'#'+e.id;let p=[],c=e;while(c&&c!==document.body&&p.length<4){let s=c.tagName.toLowerCase();if(c.className&&typeof c.className==='string'){const cls=c.className.trim().split(/\s+/).slice(0,2).join('.');if(cls)s+='.'+cls;}p.unshift(s);c=c.parentElement;}return p.join(' > ');};switch(t){case'query_dom':if(d.multiple){const els=qa(d.selector);return{count:els.length,elements:Array.from(els).slice(0,30).map((e,i)=>({i,tag:e.tagName,id:e.id,cls:e.className,txt:e.textContent?.substring(0,100)?.trim(),sel:gs(e)}))};}const el=q(d.selector);return el?{found:true,tag:el.tagName,id:el.id,cls:el.className,txt:el.textContent?.substring(0,200)?.trim(),html:el.innerHTML.substring(0,2000),rect:el.getBoundingClientRect(),sel:gs(el)}:{found:false};case'get_html':const h=q(d.selector);return h?{found:true,html:d.outer?h.outerHTML:h.innerHTML}:{found:false};case'click':const ce=q(d.selector);if(!ce)return{success:false,error:'未找到'};ce.click();return{success:true};case'input':const ie=q(d.selector);if(!ie)return{success:false,error:'未找到'};if(d.clear)ie.value='';ie.focus();ie.value=d.value;ie.dispatchEvent(new Event('input',{bubbles:true}));ie.dispatchEvent(new Event('change',{bubbles:true}));return{success:true};case'eval':try{const fn=new Function('document','window',d.code);return{success:true,result:JSON.stringify(fn(document,window))?.substring(0,5000)};}catch(e){return{success:false,error:e.message};}case'get_all_inputs':const ins=qa('input,textarea,[contenteditable="true"]');return{count:ins.length,inputs:Array.from(ins).map((e,i)=>{const r=e.getBoundingClientRect();const v=r.width>0&&r.height>0;if(d.visible&&!v)return null;return{i,tag:e.tagName,type:e.type||'text',id:e.id,name:e.name,cls:e.className?.substring?.(0,80),ph:e.placeholder,val:e.value?.substring(0,50),vis:v,rect:{t:r.top,l:r.left,w:r.width,h:r.height},sel:gs(e)};}).filter(Boolean)};case'find_by_text':const fels=qa(d.tagName||'*');const m=Array.from(fels).filter(e=>e.textContent?.includes(d.text)).slice(0,20);return{count:m.length,elements:m.map((e,i)=>({i,tag:e.tagName,id:e.id,cls:e.className,txt:e.textContent?.substring(0,100)?.trim(),sel:gs(e)}))};case'highlight':const hl=q(d.selector);if(!hl)return{success:false};const o={ol:hl.style.outline,bg:hl.style.backgroundColor};hl.style.outline=`3px solid ${d.color||'red'}`;hl.style.backgroundColor=(d.color||'red')+'22';setTimeout(()=>{hl.style.outline=o.ol;hl.style.backgroundColor=o.bg;},d.duration||3000);return{success:true};case'get_page_info':return{url:location.href,title:document.title,vp:{w:innerWidth,h:innerHeight}};case'wait':await new Promise(r=>setTimeout(r,d.ms));return{success:true};case'scroll':if(d.selector){const se=q(d.selector);if(se){se.scrollIntoView({behavior:'smooth',block:'center'});return{success:true};}return{success:false};}window.scrollTo({top:d.y||0,left:d.x||0,behavior:'smooth'});return{success:true};default:throw new Error('未知命令: '+t);}}console.log('%c[远程调试已启动] 验证码: '+V,'color:#00ff88;font-size:14px;font-weight:bold;');})();
```

4. 页面右上角会出现调试面板，显示 **6位验证码**
5. 使用验证码发送调试命令

## 发送调试命令

### 使用 curl 发送命令

```bash
# 发送命令
curl -X POST "https://memoraid-backend.iuyuger.workers.dev/debug/command" \
  -H "Content-Type: application/json" \
  -d '{"verificationCode":"ABC123","commandType":"get_page_info","commandData":{}}'

# 获取结果
curl "https://memoraid-backend.iuyuger.workers.dev/debug/result/1"
```

### 使用调试控制台

```bash
node scripts/debug-console.js
```

然后输入命令：

```
> sessions              # 查看活跃会话
> connect ABC123        # 连接到指定会话
> page                  # 获取页面信息
> inputs                # 获取所有输入框
> query .my-class       # 查询元素
> click #my-button      # 点击元素
> highlight .target     # 高亮元素
```

## 支持的命令

| 命令类型 | 参数 | 说明 |
|---------|------|------|
| `get_page_info` | 无 | 获取页面 URL、标题、视口大小 |
| `get_all_inputs` | `{visible: boolean}` | 获取所有输入框 |
| `query_dom` | `{selector: string, multiple?: boolean}` | 查询 DOM 元素 |
| `get_html` | `{selector: string, outer?: boolean}` | 获取元素 HTML |
| `find_by_text` | `{text: string, tagName?: string}` | 按文本查找元素 |
| `click` | `{selector: string}` | 点击元素 |
| `input` | `{selector: string, value: string, clear?: boolean}` | 输入文本 |
| `highlight` | `{selector: string, color?: string, duration?: number}` | 高亮元素 |
| `scroll` | `{selector?: string, x?: number, y?: number}` | 滚动页面 |
| `wait` | `{ms: number}` | 等待指定时间 |
| `eval` | `{code: string}` | 执行 JavaScript 代码 |

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/debug/session` | POST | 创建调试会话 |
| `/debug/sessions` | GET | 获取所有活跃会话 |
| `/debug/command` | POST | 发送调试命令 |
| `/debug/poll/:code` | GET | 轮询待执行命令 |
| `/debug/result` | POST | 上报执行结果 |
| `/debug/result/:id` | GET | 获取命令执行结果 |
| `/debug/history/:code` | GET | 获取命令历史 |
| `/debug/session/:code` | DELETE | 关闭调试会话 |

## 调试示例

### 示例1：查找页面上的所有输入框

```bash
# 1. 发送命令
curl -X POST "https://memoraid-backend.iuyuger.workers.dev/debug/command" \
  -H "Content-Type: application/json" \
  -d '{"verificationCode":"ABC123","commandType":"get_all_inputs","commandData":{"visible":true}}'

# 返回: {"success":true,"commandId":1,"message":"命令已发送，等待插件执行"}

# 2. 等待2秒后获取结果
sleep 2
curl "https://memoraid-backend.iuyuger.workers.dev/debug/result/1"

# 返回: {"command":{...},"result":{"type":"success","data":{"count":5,"inputs":[...]}}}
```

### 示例2：点击按钮并输入文本

```bash
# 点击按钮
curl -X POST "https://memoraid-backend.iuyuger.workers.dev/debug/command" \
  -H "Content-Type: application/json" \
  -d '{"verificationCode":"ABC123","commandType":"click","commandData":{"selector":"#submit-btn"}}'

# 输入文本
curl -X POST "https://memoraid-backend.iuyuger.workers.dev/debug/command" \
  -H "Content-Type: application/json" \
  -d '{"verificationCode":"ABC123","commandType":"input","commandData":{"selector":"#username","value":"test@example.com","clear":true}}'
```

### 示例3：执行自定义 JavaScript

```bash
curl -X POST "https://memoraid-backend.iuyuger.workers.dev/debug/command" \
  -H "Content-Type: application/json" \
  -d '{"verificationCode":"ABC123","commandType":"eval","commandData":{"code":"return document.querySelectorAll(\"button\").length"}}'
```

## 安全说明

- 验证码是 6 位随机字符串，用于唯一标识调试会话
- 会话在 5 分钟无心跳后自动过期
- 命令在 5 分钟内未执行会自动过期
- 建议仅在开发/测试环境使用

## 故障排除

### 问题：`memoraidDebug is not defined`

**原因**：调试桥接脚本未成功注入

**解决方案**：
1. 确保已安装 Memoraid 扩展
2. 刷新页面重试
3. 检查扩展是否有 `scripting` 权限
4. 如果仍然失败，使用方法二（注入脚本）

### 问题：连接失败

**可能原因**：
1. 网络问题 - 检查是否能访问 `https://memoraid-backend.iuyuger.workers.dev`
2. 跨域问题 - 某些页面可能阻止外部请求

### 问题：命令执行超时

**可能原因**：
1. 浏览器标签页不在前台
2. 页面被冻结或休眠
3. 网络延迟

**解决方案**：确保浏览器标签页保持活跃状态

## 文件结构

```
Memoraid/
├── backend/
│   ├── src/index.ts           # 后端 API（包含调试端点）
│   └── migration-debug.sql    # 调试相关数据库表
├── src/
│   ├── background/
│   │   └── index.ts           # Background script（包含注入逻辑）
│   ├── content/
│   │   └── index.ts           # Content script（监听调试请求）
│   └── utils/
│       └── remoteDebug.ts     # 远程调试核心模块
├── public/
│   └── debug-bridge.js        # 调试桥接脚本（备用）
├── scripts/
│   ├── remote-debug-inject.js # 独立注入脚本（完整版）
│   └── debug-console.js       # 命令行调试控制台
└── docs/
    └── REMOTE_DEBUG.md        # 本文档
```

## 技术细节

### Manifest 权限

```typescript
// src/manifest.ts
permissions: ['scripting', ...],  // 需要 scripting 权限
host_permissions: ['<all_urls>'], // 需要访问所有页面
web_accessible_resources: [{
  resources: ['debug-bridge.js'],
  matches: ['<all_urls>'],
}],
```

### Chrome Scripting API

```typescript
// 在 MAIN world 中执行代码
await chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',  // 关键参数
  args: [code],
  func: (code: string) => {
    eval(code);  // 在页面上下文中执行
  }
});
```

### World 类型说明

| World | 说明 |
|-------|------|
| `ISOLATED` | 默认值，Content Script 运行的隔离环境，与页面 JS 隔离 |
| `MAIN` | 页面的主执行上下文，可以访问 `window` 对象 |

使用 `MAIN` world 可以：
- 创建全局变量（如 `window.memoraidDebug`）
- 绕过页面 CSP 限制
- 与页面 JavaScript 交互
