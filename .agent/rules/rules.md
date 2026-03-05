---
trigger: always_on
---
## 项目概览
- **代码仓库**: https://github.com/ralph-wren/memoraid
- **类型**: Chrome 扩展 (React/Vite) + Cloudflare Worker 后端。
- **核心技术**: TypeScript, TailwindCSS, Cloudflare D1 (SQL), R2 (对象存储)。

## ⚠️ 关键规则
1.  **语言**: 始终使用 **中文** 与用户进行对话。
2.  **验证**: 修改 *任何* 代码后，**必须** 执行 `npm run build` 以确保没有错误。
3.  **代码风格**:
    - 功能模块化（复用方法，避免重复）。
    - **添加注释**: 所有代码必须加注释，特别是解释修改原因（用户是初学者）。
4.  **提示词**: 更新提示词时，**必须** 同步更新 `src\utils\prompts.ts` 中的 `PROMPT_VERSIONS` 版本号。
5.  **文档**:
    - 统一存放在 `docs/` 目录。
    - 命名格式: `{日期如202601241230}-{功能}-{具体解决的问题}.md`。
    - 每次回答完一个问题都要更新文档，记录下解决的问题和方法。
6.  **临时文件**: 所有测试/临时文件必须放在 `test/` 目录。用完即删。
7.  **发布**: 在运行 `npm run release` 之前，先更新版本信息。

## 常用命令

### 构建与开发
- **构建 (验证)**: `npm run build` (执行 TypeScript 检查和 Vite 构建)
- **启动开发服务器**: `npm run dev`
- **打包发布**: `npm run release`

### 后端 (Cloudflare)
- **部署**: `npx wrangler deploy` (在 `backend/` 目录下执行)。*注意：这不会覆盖远程环境变量。*
- **数据库操作**:
  - **⚠️ 创建表前必须先查看现有表**: `npx wrangler d1 execute memoraid-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`
  - **迁移**: `npx wrangler d1 execute memoraid-db --file=./schema.sql` (在 `backend/` 目录下执行)
  - **查询**: `npx wrangler d1 execute memoraid-db --remote --command "SELECT ..."`
- **上传图片到 R2**:
  ```bash
  bash -lc "CI=1 npx wrangler r2 object put pothos-images/memoraid/<文件名> --file <本地路径> --content-type image/png --remote"
  ```

### 调试与自动化
- **Playwright Codegen** (打开浏览器/查看页面信息):
  ```bash
  npx playwright codegen --channel=chrome --user-data-dir="C:\Users\ralph\AppData\Local\Chrome-Automation" https://mp.weixin.qq.com/
  ```
- **远程调试**: 按照 `docs/REMOTE_DEBUG.md` 中的步骤操作。

## 架构说明
- **扩展前端**:
  - `src/popup`: 用户界面 (React)。
  - `src/content`: 页面交互脚本 (今日头条, 微信公众号, 知乎，以及未来的其他)。
  - `src/background`: 后台服务 Worker。
  - `src/utils`: 通用逻辑 (提示词, 存储, API)。
- **后端**: `backend/` (Cloudflare Worker)。
- **环境**: 关键信息保存在本地环境变量中（如果需要查看，可以使用 `echo` 命令）。
