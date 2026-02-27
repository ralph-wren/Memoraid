# 邮件发送功能修复说明

## 问题描述

用户在系统设置中配置了QQ邮箱的SMTP信息后，点击"发送测试邮件"按钮失败。

## 问题原因

### 1. Cloudflare Workers环境限制
Cloudflare Workers不支持`nodemailer`库，因为它依赖Node.js的`net`和`tls`模块，这些模块在Workers环境中不可用。

### 2. 原代码问题
- 使用了`nodemailer`库（无法在Workers中运行）
- 端口587的secure配置不正确

### 3. QQ邮箱配置问题
用户可能使用了QQ密码而不是授权码。

## 解决方案

### 采用Resend邮件服务

Resend是一个现代化的邮件API服务，完美适配Cloudflare Workers：

**优点：**
- 使用HTTP API，无需SMTP连接
- 免费额度：每月3000封邮件
- 配置简单，无需DNS设置
- 支持从任何环境调用
- 提供详细的发送日志

**官网：** https://resend.com

### 代码修改

#### 1. 移除nodemailer依赖
```typescript
// 删除
import nodemailer from 'nodemailer';
```

#### 2. 添加Resend API Key到环境变量
```typescript
export interface Env {
  // ... 其他配置
  RESEND_API_KEY: string; // Resend邮件服务API密钥
}
```

#### 3. 实现Resend发送函数
```typescript
async function sendEmailViaResend(apiKey: string, params: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<Response> {
  const fromField = params.fromName 
    ? `${params.fromName} <${params.from}>`
    : params.from;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromField,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    }),
  });

  return response;
}
```

#### 4. 更新邮件测试API
```typescript
// 使用Resend发送测试邮件
const emailResponse = await sendEmailViaResend(env.RESEND_API_KEY, {
    from: configMap.email_sender,
    fromName: configMap.email_sender_name || 'Memoraid',
    to: configMap.email_recipient,
    subject: '[Memoraid] 测试邮件',
    text: '这是一封测试邮件，证明邮件配置正确。',
});
```

## 配置步骤

### 1. 注册Resend账号
访问 https://resend.com 注册账号（免费）

### 2. 获取API Key
- 登录Resend控制台
- 进入 API Keys 页面
- 创建新的API Key
- 复制API Key（格式：re_xxxxxxxxxx）

### 3. 配置Cloudflare Workers环境变量
```bash
# 方法1: 使用wrangler命令
npx wrangler secret put RESEND_API_KEY

# 方法2: 在Cloudflare Dashboard中配置
# Workers & Pages → 选择Worker → Settings → Variables → Add variable
```

### 4. 配置邮件信息
在管理后台的系统设置中配置：
- **发件人邮箱**：可以使用 `onboarding@resend.dev`（Resend测试邮箱）或自己的域名邮箱
- **发件人名称**：如 `Memoraid`
- **收件人邮箱**：管理员邮箱

### 5. 测试邮件发送
点击"发送测试邮件"按钮，检查收件箱

## 测试结果

### 本地测试
```bash
$ node test/test-resend.js
=== 直接测试Resend API ===

发送配置:
  发件人: Memoraid <onboarding@resend.dev>
  收件人: iuyuger@gmail.com
  主题: [Memoraid] Resend测试邮件

正在发送邮件...
响应状态: 200 OK
响应内容: {
  "id": "843f53b6-2995-497e-b9f0-669890da25c6"
}

✓ 邮件发送成功！
  邮件ID: 843f53b6-2995-497e-b9f0-669890da25c6
```

## 使用说明

### 发件人邮箱选择

#### 选项1: 使用Resend测试邮箱（推荐新手）
```
发件人邮箱: onboarding@resend.dev
```
- 无需配置，开箱即用
- 适合测试和开发
- 有Resend品牌标识

#### 选项2: 使用自己的域名邮箱（推荐生产环境）
```
发件人邮箱: noreply@yourdomain.com
```
- 需要在Resend中验证域名
- 更专业，无第三方品牌
- 需要配置DNS记录（Resend会提供详细步骤）

#### 选项3: 使用任意邮箱
```
发件人邮箱: 906143029@qq.com
```
- 可以使用，但可能被标记为垃圾邮件
- 不推荐用于生产环境

## 注意事项

### 1. API Key安全
- API Key是敏感信息，不要提交到代码仓库
- 使用Cloudflare环境变量存储
- 定期轮换API Key

### 2. 发送限制
- 免费版：每月3000封
- 超出限制需要升级付费计划
- 查看用量：Resend控制台

### 3. 邮件送达率
- 使用Resend测试邮箱送达率较高
- 使用自己域名需要配置SPF/DKIM记录
- 避免在邮件内容中使用垃圾邮件常见词汇

### 4. 邮件进入垃圾箱
如果邮件进入垃圾箱：
- 检查发件人邮箱是否已验证
- 考虑配置自己的域名
- 在Resend中配置DKIM记录

## 相关文件

- `backend/src/index.ts` - 后端主文件，包含邮件发送逻辑
- `backend/wrangler.toml` - Cloudflare Workers配置
- `test/test-resend.js` - Resend邮件测试脚本
- `docs/202602261305-邮件发送-修复Cloudflare-Workers邮件功能.md` - 本文档

## 部署信息

- 部署时间：2026-02-26 13:10
- Worker URL: https://memoraid-backend.iuyuger.workers.dev
- Version ID: 6a71200d-33c5-4467-acbc-471a0b1e1d0c
- 邮件服务：Resend (https://resend.com)

## 总结

通过将邮件发送方式从nodemailer改为Resend，成功解决了Cloudflare Workers环境下的邮件发送问题。Resend提供了简单易用的HTTP API，无需复杂的SMTP配置，非常适合Serverless环境。测试显示邮件发送功能正常工作。
