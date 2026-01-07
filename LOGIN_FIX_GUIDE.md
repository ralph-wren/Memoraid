# 登录问题修复指南

## 问题描述
Google/GitHub 登录失败，显示错误："Login Error: Authorization page could not be loaded"

## 已完成的修复

### 1. 移除了有问题的网络预检查
**文件**: `src/background/index.ts`

之前的代码在登录前会进行网络预检查，使用 `fetch` 的 `HEAD` 请求和 `no-cors` 模式，这可能导致：
- 跨域问题
- 超时错误
- 阻止正常的登录流程

**修复**: 移除了预检查，直接启动 OAuth 流程，并改进了错误处理。

### 2. 添加了后端健康检查端点
**文件**: `backend/src/index.ts`

新增 `/health` 端点，返回：
```json
{
  "status": "ok",
  "timestamp": "2026-01-07T...",
  "googleConfigured": true,
  "githubConfigured": true,
  "dbConnected": true
}
```

这可以帮助快速诊断后端配置问题。

### 3. 改进了前端错误处理
**文件**: `src/components/Settings.tsx`

- 添加了后端连接测试（在登录前）
- 提供更友好的中文错误信息
- 增加了详细的控制台日志
- 延长了错误消息显示时间（8秒）

### 4. 增强了后端日志
**文件**: `backend/src/index.ts`

- 添加了详细的 console.log
- 检查环境变量是否配置
- 返回更明确的错误信息

### 5. 创建了诊断工具
**文件**: `diagnose-login.html`

一个独立的 HTML 页面，可以测试：
- 后端服务可访问性
- OAuth 配置状态
- Google/GitHub OAuth 重定向
- 网络连接

## 如何使用

### 步骤 1: 重新加载扩展
1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 找到 Memoraid 扩展
3. 点击"重新加载"按钮
4. 或者删除后重新加载 `dist` 文件夹

### 步骤 2: 运行诊断工具
1. 在浏览器中打开 `diagnose-login.html`
2. 确认后端地址：`https://memoraid-backend.iuyuger.workers.dev`
3. 点击"开始诊断"
4. 查看所有测试结果

### 步骤 3: 根据诊断结果修复

#### 如果测试 1 失败（后端不可访问）
- 检查网络连接
- 确认后端是否部署：`wrangler deploy`
- 检查防火墙/代理设置

#### 如果测试 2 失败（OAuth 未配置）
后端环境变量缺失，需要配置：

```bash
cd backend

# 设置 Google OAuth
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# 设置 GitHub OAuth
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# 重新部署
wrangler deploy
```

**获取 OAuth 凭据**:
- Google: https://console.cloud.google.com/apis/credentials
- GitHub: https://github.com/settings/developers

**重要**: 确保回调 URL 配置正确：
- Google: `https://memoraid-backend.iuyuger.workers.dev/auth/callback/google`
- GitHub: `https://memoraid-backend.iuyuger.workers.dev/auth/callback/github`

#### 如果测试 3/4 失败（OAuth 重定向失败）
- 检查 OAuth 应用的回调 URL 配置
- 确认 Client ID 和 Secret 正确
- 查看后端日志：`wrangler tail`

#### 如果测试 5 失败（网络连接问题）
- 检查是否能访问 Google 和 GitHub
- 可能是防火墙、代理或 VPN 问题
- 尝试关闭代理或更换网络

### 步骤 4: 查看详细日志

**浏览器控制台**（F12）:
```javascript
// 查看扩展后台日志
chrome.runtime.getBackgroundPage(console.log)
```

**后端日志**:
```bash
cd backend
wrangler tail
```

### 步骤 5: 重试登录
1. 打开 Memoraid 扩展
2. 进入设置页面
3. 点击"Google Login"或"GitHub Login"
4. 查看控制台输出

## 常见问题排查

### Q1: 之前能登录，现在突然不行了

**可能原因**:
1. **OAuth 令牌过期**: Google/GitHub 的 OAuth 应用可能被暂停或令牌过期
2. **后端环境变量丢失**: Cloudflare Workers 的 secrets 可能被清除
3. **回调 URL 变更**: OAuth 应用配置被修改
4. **网络环境变化**: 新的防火墙规则或代理设置

**解决方法**:
```bash
# 1. 检查后端配置
curl https://memoraid-backend.iuyuger.workers.dev/health

# 2. 重新设置环境变量
cd backend
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# 3. 重新部署
wrangler deploy

# 4. 查看实时日志
wrangler tail
```

### Q2: 显示 "无法加载授权页面"

这通常意味着 `chrome.identity.launchWebAuthFlow` 无法打开 OAuth 页面。

**检查清单**:
- [ ] 后端 `/health` 返回所有配置为 `true`
- [ ] 可以在浏览器中访问后端 URL
- [ ] OAuth 应用的回调 URL 正确
- [ ] 扩展的 `manifest.json` 包含 `identity` 权限
- [ ] 没有浏览器扩展冲突（如广告拦截器）

### Q3: 如何验证 OAuth 配置是否正确？

**手动测试 Google OAuth**:
```
https://memoraid-backend.iuyuger.workers.dev/auth/login/google?redirect_uri=https://test.com
```
应该重定向到 Google 登录页面。

**手动测试 GitHub OAuth**:
```
https://memoraid-backend.iuyuger.workers.dev/auth/login/github?redirect_uri=https://test.com
```
应该重定向到 GitHub 授权页面。

如果返回 500 错误或"not configured"，说明环境变量未设置。

## 调试技巧

### 1. 启用详细日志
打开扩展的设置页面，启用"Debug Mode"，这会自动上传错误日志到服务器。

### 2. 监控网络请求
1. 打开 Chrome DevTools (F12)
2. 切换到 Network 标签
3. 尝试登录
4. 查看所有请求，特别是到后端的请求

### 3. 检查扩展后台页面
1. 访问 `chrome://extensions/`
2. 找到 Memoraid，点击"service worker"
3. 查看控制台输出

### 4. 测试后端 API
```bash
# 测试健康检查
curl https://memoraid-backend.iuyuger.workers.dev/health

# 测试隐私政策页面
curl https://memoraid-backend.iuyuger.workers.dev/privacy

# 测试 OAuth 初始化（会返回重定向）
curl -I "https://memoraid-backend.iuyuger.workers.dev/auth/login/google?redirect_uri=test"
```

## 需要帮助？

如果以上步骤都无法解决问题，请提供以下信息：

1. 诊断工具的完整输出
2. 浏览器控制台的错误信息
3. 后端日志（`wrangler tail` 的输出）
4. `/health` 端点的返回结果
5. 使用的浏览器版本和操作系统

## 文件清单

修改的文件：
- ✅ `src/background/index.ts` - 移除预检查，改进错误处理
- ✅ `src/components/Settings.tsx` - 添加连接测试和更好的错误提示
- ✅ `backend/src/index.ts` - 添加 /health 端点和详细日志

新增的文件：
- ✅ `diagnose-login.html` - 登录诊断工具
- ✅ `backend/.dev.vars.example` - 环境变量示例
- ✅ `backend/README.md` - 后端配置指南
- ✅ `LOGIN_FIX_GUIDE.md` - 本文档

## 下一步

1. 重新构建并加载扩展
2. 运行诊断工具
3. 根据结果修复配置问题
4. 重试登录

祝您顺利解决问题！🎉
