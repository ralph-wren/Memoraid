# Memoraid

一个强大的 Chrome 扩展程序，使用 AI 来**总结**、**导出**网页内容，并支持**一键发布到头条号、知乎专栏和微信公众号**。

<div align="center">
  <img src="store-assets/icon-128.png" width="128" alt="Memoraid Logo" />
</div>

## 🚀 最近更新 (v1.3.0)

- **定时任务功能**：支持配置定时任务，自动从指定内容源抓取内容并生成文章，支持多平台定时发布
- **充值额度系统**：新增用户额度系统，包含免费额度和付费额度，额度不足时可充值继续使用，支持额度缓存优化
- **用户反馈系统**：支持提交使用体验、优化建议、问题反馈，管理员可查看和回复用户反馈
- **数据统计增强**：新增Token使用量统计，显示每篇文章的AI消耗，管理员页面支持用户排行榜，新增文章数据统计入口
- **多平台稳定提升**：修复知乎文章上报并发冲突问题，提升多平台账号同步稳定性
- **UI/UX 优化**：新增版本更新通知跑马灯，优化额度显示加载体验，提升界面响应速度

## ✨ 核心功能

### 📖 智能内容提取
- **AI 对话提取**：自动提取 ChatGPT、Gemini、DeepSeek 等 AI 平台的对话内容
- **全网页支持**：内置 Mozilla Readability 引擎，智能识别任意网页（博客、新闻、论坛）的核心内容
- **去除干扰**：自动过滤广告、导航栏等无关内容

### 🤖 AI 驱动总结
- **技术文档生成**：将对话/网页内容转化为结构化的技术知识文档
- **自媒体文章生成**：一键生成适合头条、知乎、微信公众号风格的自媒体文章
- **多模型支持**：支持 GPT-4、Claude、DeepSeek、通义千问、智谱 GLM 等多种模型

### ✍️ 文章风格定制
- **6 维度风格调节**：通过滑动条调整文章风格
- 立场倾向：客观中立 ↔ 观点鲜明
- 情感色彩：消极悲观 ↔ 积极乐观
- 评价态度：批评质疑 ↔ 赞美认可
- 表达方式：犀利直接 ↔ 委婉礼貌
- 语言风格：口语随意 ↔ 正式书面
- 趣味程度：严肃认真 ↔ 幽默搞笑

### 📤 一键多平台发布
- **多平台支持**：支持头条号、知乎专栏、微信公众号、小红书、微博
- **自动填充**：标题、正文自动填入创作平台
- **智能配图**：自动识别图片占位符，从热点图库搜索并插入配图
- **封面设置**：自动设置文章封面图片
- **定时发布**：支持配置定时任务，自动抓取内容并发布到指定平台

### 💬 用户反馈
- **反馈提交**：支持使用体验、优化建议、问题反馈三种类型
- **匿名提交**：无需登录即可提交反馈
- **管理员回复**：管理员可查看、筛选、回复和处理反馈

### 👨‍💼 管理员功能（后台系统）
- **用户管理**：搜索、查看和管理用户账号
- **订单审批**：审核用户充值订单，支持邮件通知
- **数据统计**：查看用户文章数量、Token消耗、充值金额统计
- **排行榜**：文章数量榜、Token消耗榜、充值金额榜
- **反馈管理**：查看和处理用户反馈

### 💾 数据管理
- **历史记录**：自动保存所有生成的文档，随时查看
- **云端同步**：支持 Google/GitHub 登录，加密同步设置到云端
- **GitHub 集成**：一键将文档推送到 GitHub 仓库
- **额度管理**：实时显示剩余额度（免费+付费），支持在线充值，智能缓存减少网络请求
- **数据统计**：查看文章生成数据、Token消耗统计、创作趋势分析

### 📝 导出功能
- **Markdown 预览**：实时预览带语法高亮的 Markdown
- **Mermaid 图表**：自动渲染流程图、时序图等
- **多格式导出**：复制、下载 .md 文件

## 🖼️ 截图展示

### 1. 主界面与历史记录
![主界面](store-assets/screenshot-8.png)

### 2. AI 总结结果
![AI总结](store-assets/screenshot-1.png)

### 3. 文章风格设置
![风格设置](store-assets/screenshot-6.png)

### 4. 自动发布到头条
![风格设置](store-assets/screenshot-10.png)

### 5. API 配置
![API配置](store-assets/screenshot-7.png)

### 6. 账号登录同步

![API配置](store-assets/screenshot-5.png)
## 🛠️ 安装指南

### 从 Chrome 应用商店安装（推荐）
1. 访问 [Chrome 应用商店 - Memoraid](https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg?hl=zh-CN&utm_source=ext_sidebar)
2. 点击"添加至 Chrome"

### 从源码安装（开发者模式）

1. **克隆仓库**：
   ```bash
   git clone https://github.com/ralph-wren/memoraid.git
   cd memoraid
   ```

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **构建扩展**：
   ```bash
   npm run build
   ```

4. **生成发布包 (ZIP)**：
   如果你需要生成用于发布的压缩包：
   ```bash
   npm run release
   ```
   生成的 ZIP 文件将保存在 `release` 目录下。

5. **在 Chrome 中加载**：
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用右上角的 **"开发者模式"**
   - 点击 **"加载已解压的扩展程序"**
   - 选择 `dist` 文件夹

## ⚙️ 配置说明

### 基础配置
1. 点击浏览器工具栏中的 **Memoraid** 图标
2. 点击右上角的 **设置 (⚙️)** 图标
3. 选择 **AI 提供商**（推荐 API Yi，支持多种模型）
4. 输入 **API Key**
5. 点击 **"Save Settings"**

### 头条号配置（可选）
1. 登录 [头条号创作平台](https://mp.toutiao.com)
2. 在设置页面点击 **"Auto Fetch"** 自动获取 Cookie
3. 或手动复制 Cookie 粘贴

### 云端同步配置（可选）
1. 点击 **Google Login** 或 **GitHub Login**
2. 设置加密密钥（用于加密敏感数据）
3. 点击 **Sync Up** 上传设置

## 🚀 使用教程

### 总结网页/对话
1. 打开任意网页或 AI 对话页面
2. 点击 Memoraid 图标
3. 点击 **"Summarize & Export"** 生成技术文档
4. 或点击 **"Generate Article"** 生成自媒体文章

### 发布到头条号
1. 生成文章后，点击 **"发布到头条"** 按钮
2. 自动打开头条创作平台并填充内容
3. 等待自动配图完成
4. 检查内容后点击发布

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 本地存储设置和历史记录 |
| `activeTab` | 读取当前标签页内容进行总结 |
| `notifications` | 任务完成或出错时发送通知 |
| `cookies` | 获取发布平台（头条/知乎/微信/小红书）登录状态 |
| `identity` | Google/GitHub OAuth 登录 |
| `host_permissions` | 访问 AI 聊天网站和发布平台 |
| `alarms` | 实现定时任务功能，自动抓取内容和发布文章 |

## 🔒 隐私政策

- **本地优先**：API Key、历史记录默认仅存储在浏览器本地
- **端到端加密**：云端同步的数据使用用户密钥加密，服务器无法解密
- **直接通信**：API 调用直接从浏览器发送到 AI 提供商，不经过中间服务器
- **最小权限**：仅请求实现功能所必需的权限

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

## 📧 联系方式

- GitHub Issues: [提交问题](https://github.com/ralph-wren/memoraid/issues)
- Email: iuyuger@gmail.com
