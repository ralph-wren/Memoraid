# Privacy Policy for Memoraid

**Last Updated: January 9, 2026**

## Overview

Memoraid ("the Extension") is a Chrome browser extension that helps users summarize web content and AI conversations using artificial intelligence. This privacy policy explains how we handle your data.

## Data Collection

### What We DO NOT Collect
- We do not collect any personal identification information
- We do not track your browsing history
- We do not use any analytics or tracking tools
- We do not sell or share any user data with third parties

### What We Store Locally
The following data is stored **only in your local browser** using Chrome's storage API:

| Data Type | Purpose | Storage Location |
|-----------|---------|------------------|
| API Keys | To authenticate with AI service providers | Local browser (chrome.storage.sync) |
| Settings | To remember your preferences | Local browser (chrome.storage.sync) |
| History | To save generated summaries | Local browser (chrome.storage.local) |
| Toutiao Cookie | To enable auto-publishing feature | Local browser (chrome.storage.sync) |

### Optional Cloud Sync
If you choose to enable cloud sync:
- Your settings are **encrypted client-side** using a passphrase you provide
- The encrypted data is stored on our sync server
- **We cannot decrypt your data** - only you have the encryption key
- You can delete your cloud data at any time

## Data Processing

### AI API Calls
When you use the summarization feature:
1. The Extension extracts content from the current webpage
2. Content is sent **directly from your browser** to your chosen AI provider (e.g., OpenAI, DeepSeek)
3. **No data passes through our servers** for AI processing
4. You are subject to the privacy policy of your chosen AI provider

### Toutiao Publishing
When you use the Toutiao publishing feature:
1. The Extension uses your stored cookie to authenticate with Toutiao
2. Content is sent directly to Toutiao's servers
3. **No data passes through our servers**

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `storage` | To save your settings and history locally |
| `activeTab` | To read the current page content when you click "Summarize" |
| `notifications` | To notify you when tasks complete |
| `cookies` | To access Toutiao login status for publishing |
| `scripting` | To automate content filling on Toutiao |
| `identity` | To enable Google/GitHub login for cloud sync |
| `host_permissions` | To access AI chat sites and Toutiao platform |

## Third-Party Services

The Extension may interact with the following third-party services based on your configuration:

- **AI Providers**: OpenAI, DeepSeek, Moonshot, Zhipu, Aliyun, etc.
- **Toutiao**: For article publishing
- **GitHub**: For repository integration and OAuth login
- **Google**: For OAuth login

Each service has its own privacy policy. We recommend reviewing them.

## Data Security

- All sensitive data (API keys) is stored using Chrome's secure storage API
- Cloud sync uses AES-256 encryption with a user-provided key
- We use HTTPS for all network communications
- No data is stored on our servers in unencrypted form

## Children's Privacy

This Extension is not intended for children under 13 years of age. We do not knowingly collect personal information from children.

## Changes to This Policy

We may update this privacy policy from time to time. We will notify users of any material changes by updating the "Last Updated" date.

## Your Rights

You have the right to:
- Access all data stored by the Extension (via Chrome's extension storage viewer)
- Delete all local data (by uninstalling the Extension or clearing extension data)
- Delete cloud sync data (via the Extension's settings)
- Opt out of cloud sync at any time

## Contact Us

If you have any questions about this privacy policy, please contact us:

- **GitHub Issues**: [https://github.com/nichuanfang/memoraid/issues](https://github.com/nichuanfang/memoraid/issues)
- **Email**: nichuanfang@gmail.com

## Consent

By using Memoraid, you consent to this privacy policy.

---

# 隐私政策 - Memoraid

**最后更新：2026年1月9日**

## 概述

Memoraid（"本扩展"）是一款 Chrome 浏览器扩展程序，帮助用户使用人工智能总结网页内容和 AI 对话。本隐私政策说明我们如何处理您的数据。

## 数据收集

### 我们不收集的内容
- 我们不收集任何个人身份信息
- 我们不追踪您的浏览历史
- 我们不使用任何分析或追踪工具
- 我们不向第三方出售或分享任何用户数据

### 本地存储的内容
以下数据**仅存储在您的本地浏览器**中，使用 Chrome 的存储 API：

| 数据类型 | 用途 | 存储位置 |
|---------|------|---------|
| API 密钥 | 用于 AI 服务提供商认证 | 本地浏览器 |
| 设置 | 记住您的偏好设置 | 本地浏览器 |
| 历史记录 | 保存生成的摘要 | 本地浏览器 |
| 头条 Cookie | 启用自动发布功能 | 本地浏览器 |

### 可选的云端同步
如果您选择启用云端同步：
- 您的设置使用您提供的密码进行**客户端加密**
- 加密后的数据存储在我们的同步服务器上
- **我们无法解密您的数据** - 只有您拥有加密密钥
- 您可以随时删除云端数据

## 数据处理

### AI API 调用
当您使用摘要功能时：
1. 扩展程序从当前网页提取内容
2. 内容**直接从您的浏览器**发送到您选择的 AI 提供商
3. **没有数据经过我们的服务器**进行 AI 处理
4. 您需遵守所选 AI 提供商的隐私政策

### 头条发布
当您使用头条发布功能时：
1. 扩展程序使用您存储的 Cookie 与头条进行认证
2. 内容直接发送到头条的服务器
3. **没有数据经过我们的服务器**

## 权限说明

| 权限 | 用途 |
|-----|------|
| `storage` | 在本地保存设置和历史记录 |
| `activeTab` | 点击"摘要"时读取当前页面内容 |
| `notifications` | 任务完成时通知您 |
| `cookies` | 访问头条登录状态以进行发布 |
| `scripting` | 在头条上自动填充内容 |
| `identity` | 启用 Google/GitHub 登录进行云端同步 |
| `host_permissions` | 访问 AI 聊天网站和头条平台 |

## 数据安全

- 所有敏感数据（API 密钥）使用 Chrome 的安全存储 API 存储
- 云端同步使用 AES-256 加密，密钥由用户提供
- 所有网络通信使用 HTTPS
- 我们的服务器上不存储任何未加密的数据

## 联系我们

如果您对本隐私政策有任何疑问，请联系我们：

- **GitHub Issues**: [https://github.com/nichuanfang/memoraid/issues](https://github.com/nichuanfang/memoraid/issues)
- **邮箱**: nichuanfang@gmail.com

## 同意

使用 Memoraid 即表示您同意本隐私政策。
