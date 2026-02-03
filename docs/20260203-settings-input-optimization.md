# 设置面板输入优化说明

## 问题描述
用户反馈在设置面板输入密钥（如 GitHub Token、API Key、加密密钥）时，每输入一个字符都会触发保存操作，导致输入过程卡顿，必须等待保存完毕才能输入下一个字符。

## 根本原因分析
1. **自动保存机制缺陷**：在 `Settings.tsx` 的 `useEffect` 中，虽然使用了 `setTimeout` 进行防抖，但在 `useEffect` 的清理函数（cleanup）中直接调用了 `saveSettings`。由于 React 在每次 `settings` 状态更新时都会执行清理函数，这导致每次按键都会触发一次立即保存，绕过了防抖机制。
2. **状态更新过于频繁**：每次按键都直接更新全局的 `settings` 状态，触发整个 `Settings` 组件的大规模重渲染。
3. **UI 状态阻塞**：在保存开始前立即将状态设为 `saving`，导致 UI 频繁切换状态，增加了视觉上的卡顿感。

## 优化方案
1. **修复防抖保存逻辑**：
   - 移除 `useEffect` 清理函数中的立即保存操作。
   - 将 `setAutoSaveStatus('saving')` 移入 `setTimeout` 内部，只有在真正开始保存时才触发状态更新。
   - 将防抖时间从 500ms 增加到 1000ms，为用户连续输入预留更多时间。

2. **引入本地状态缓存（Local State Buffering）**：
   - 为关键输入项（API Key、GitHub Token、加密密钥）引入本地 state（如 `localApiKey`）。
   - 用户输入时立即更新本地 state（保证输入丝滑），同时通过 `useRef` 管理的防抖定时器在 500ms 后才同步到全局 `settings`。

3. **延迟状态显示**：
   - 只有在输入停止并触发实际保存动作后，才显示“保存中”提示，减少输入过程中的干扰。

## 变更详情
- 修改文件：`src/components/Settings.tsx`
- 优化位置：
  - 自动保存 `useEffect` 逻辑。
  - `handleChange` (API Key)。
  - `handleGithubChange` (GitHub Token)。
  - `handleSyncChange` (加密密钥)。

## 验证结果
- 执行 `npm run build` 通过。
- 密钥输入变得极其流畅，不再受保存操作阻塞。
- 停止输入 1 秒后，设置会自动保存并显示“已自动保存”。

---
日期：2026-02-03
版本：1.1.3
