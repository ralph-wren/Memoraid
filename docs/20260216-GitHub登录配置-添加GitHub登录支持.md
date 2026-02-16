# GitHub 登录配置指南

当前项目代码已经包含了 GitHub 登录的完整支持（前端按钮、后台逻辑、后端 API），您只需要配置 GitHub OAuth 应用并设置环境变量即可启用。

## 1. 创建 GitHub OAuth App

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)。
2. 点击 **"New OAuth App"**。
3. 填写以下信息：
   - **Application Name**: Memoraid (或任意名称)
   - **Homepage URL**: `https://memoraid-backend.iuyuger.workers.dev` (您的后端服务地址)
   - **Authorization callback URL**: `https://memoraid-backend.iuyuger.workers.dev/auth/callback/github`
   
   > **注意**: 如果您在本地开发，可以添加第二个 OAuth App 用于本地测试，Callback URL 填 `http://localhost:8787/auth/callback/github`。或者在同一个 App 中暂填本地地址调试。

4. 创建后，您将获得：
   - **Client ID**
   - **Client Secret** (需要点击 "Generate a new client secret")

## 2. 配置后端环境变量

### 本地开发 (`backend/.dev.vars`)
在 `backend` 目录下创建或编辑 `.dev.vars` 文件，添加：

```env
GITHUB_CLIENT_ID=您的_Client_ID
GITHUB_CLIENT_SECRET=您的_Client_Secret
```

### 生产环境 (Cloudflare Workers)
使用 `wrangler` 命令或 Cloudflare Dashboard 配置 Secrets：

```bash
# 进入 backend 目录
cd backend

# 设置 Client ID
npx wrangler secret put GITHUB_CLIENT_ID
# (输入您的 Client ID)

# 设置 Client Secret
npx wrangler secret put GITHUB_CLIENT_SECRET
# (输入您的 Client Secret)
```

## 3. 验证

1. 重新部署后端服务：`npx wrangler deploy` (如果是生产环境)。
2. 在插件设置页面点击 "GitHub Login"。
3. 应能正常跳转到 GitHub 授权页面并完成登录。
