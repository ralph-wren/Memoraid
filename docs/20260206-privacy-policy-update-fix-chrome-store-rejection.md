# 隐私政策更新记录 - 解决 Chrome 商店审核拒绝问题

**日期**: 2026-02-06
**功能**: 隐私政策 (Privacy Policy)
**解决问题**: 解决 Chrome 网上应用店因“隐私政策未充分披露网页内容和 Cookie 处理”而导致的审核拒绝。

## 1. 背景分析
Chrome 网上应用店对扩展程序处理用户数据（尤其是网页内容和敏感 Cookie）有严格的政策要求。Memoraid 扩展程序使用了 `activeTab` 读取网页内容进行 AI 总结，并使用了 `cookies` 权限获取自媒体平台登录状态，但在原有的隐私政策中未明确披露这些行为。

## 2. 修改内容

### 2.1 文档更新
- **`PRIVACY_POLICY.md`**: 全面更新为中文，详细披露了网页内容数据 (Web Content) 的收集目的、Cookie 数据 (Cross-platform Login) 的处理方式，以及用户同步数据的加密存储机制。
- **`PRIVACY.md`**: 更新了英文版本的隐私政策，确保与中文版本内容高度一致，并补充了 Chrome 商店要求的详细披露项。

### 2.2 后端更新
- **`backend/src/index.ts`**: 修改了 `/privacy` 路由返回的 HTML 内容。
    - 将内容更新为中文。
    - 增加了响应式设计支持（Viewport meta）。
    - 增加了权限说明表格，明确解释了 `storage`, `activeTab`, `cookies`, `notifications`, `identity` 等权限的必要性。
    - 强调了数据本地存储和客户端加密（AES-256）的安全性。

### 2.3 权限与实现验证
- **`src/manifest.ts`**: 验证了权限声明与隐私政策披露的一致性。
- **`src/components/Settings.tsx`**: 检查了 Cookie 自动获取逻辑，确认其仅在用户主动点击时触发，且数据仅在本地加密存储，符合隐私政策中的“不上传 Cookie 到服务器”的承诺。

## 3. 验证结果
- 执行 `npm run build` 成功，未引入构建错误。
- 隐私政策文档现已符合 Chrome 网上应用店用户数据政策的要求。

## 4. 后续操作建议
- 将更新后的 `PRIVACY_POLICY.md` 或后端 `/privacy` 链接重新提交给 Chrome 网上应用店审核。
- 在 Chrome 开发者后台的“隐私”选项卡中，确保勾选了“网页内容”和“个人身份信息（同步用）”的数据使用说明。
