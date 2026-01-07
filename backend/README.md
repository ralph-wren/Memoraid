# Memoraid Backend - 配置指南

## 问题诊断：登录失败

如果您遇到 "Login Error: Authorization page could not be loaded" 错误，请按照以下步骤排查：

### 1. 检查后端是否正常运行

```bash
# 测试后端是否可访问
curl https://memoraid-backend.iuyuger.workers.dev/privacy
```

如果返回 HTML 页面，说明后端正常运行。

### 2. 配置 OAuth 环境变量

后端需要 Google 和 GitHub 的 OAuth 凭据才能工作。

#### 本地开发环境

1. 复制示例配置文件：
```bash
cp .dev.vars.example .dev.vars
```

2. 编辑 `.dev.vars` 文件，填入真实的 OAuth 凭据

#### 生产环境（Cloudflare Workers）

使用 wrangler 设置环境变量：

```bash
# Google OAuth
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# GitHub OAuth
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

### 3. 获取 OAuth 凭据

#### Google OAuth

1. 访问 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. 创建新项目或选择现有项目
3. 启用 "Google+ API"
4. 创建 OAuth 2.0 客户端 ID（Web 应用）
5. 添加授权重定向 URI：
   - 生产环境：`https://memoraid-backend.iuyuger.workers.dev/auth/callback/google`
   - 本地开发：`http://localhost:8787/auth/callback/google`

#### GitHub OAuth

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 "New OAuth App"
3. 填写信息：
   - Application name: `Memoraid`
   - Homepage URL: `https://memoraid-backend.iuyuger.workers.dev`
   - Authorization callback URL: `https://memoraid-backend.iuyuger.workers.dev/auth/callback/github`
4. 创建后获取 Client ID 和 Client Secret

### 4. 初始化数据库

```bash
# 创建数据库表
wrangler d1 execute memoraid-db --file=schema.sql --remote
```

### 5. 部署后端

```bash
# 部署到 Cloudflare Workers
wrangler deploy
```

### 6. 本地测试

```bash
# 启动本地开发服务器
wrangler dev

# 在另一个终端测试
curl http://localhost:8787/privacy
```

## 常见问题

### Q: 登录时显示 "Authorization page could not be loaded"

**可能原因：**
1. 后端环境变量未配置（最常见）
2. OAuth 应用的重定向 URI 配置错误
3. 网络连接问题或防火墙阻止
4. 后端服务未运行或崩溃

**解决方法：**
1. 检查 Cloudflare Workers 日志：`wrangler tail`
2. 验证环境变量是否正确设置
3. 确认 OAuth 应用的回调 URL 与后端 URL 匹配
4. 尝试在浏览器中直接访问：`https://memoraid-backend.iuyuger.workers.dev/auth/login/google?redirect_uri=test`

### Q: 如何查看后端日志？

```bash
wrangler tail
```

### Q: 如何重置数据库？

```bash
# 删除所有数据
wrangler d1 execute memoraid-db --command="DELETE FROM settings; DELETE FROM users;"

# 或重新创建表
wrangler d1 execute memoraid-db --file=schema.sql --remote
```

## 开发命令

```bash
# 本地开发
npm run dev          # 或 wrangler dev

# 部署
npm run deploy       # 或 wrangler deploy

# 查看日志
wrangler tail

# 数据库操作
wrangler d1 execute memoraid-db --command="SELECT * FROM users"
```

## 架构说明

- **认证流程**：使用 OAuth 2.0 授权码流程
- **数据加密**：客户端使用 AES-GCM 加密，服务器只存储加密数据
- **会话管理**：使用简单的 JWT 令牌（生产环境建议使用更安全的实现）

## 安全注意事项

1. **永远不要**将 `.dev.vars` 文件提交到 Git
2. 定期轮换 OAuth 密钥
3. 在生产环境使用 HTTPS
4. 考虑添加速率限制以防止滥用
