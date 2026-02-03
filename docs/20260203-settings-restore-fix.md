# 设置恢复失败及默认密钥优化说明

## 问题描述
用户在设置页面点击“恢复”并输入密钥后，虽然提示恢复成功，但重新打开设置页面时发现内容为空，且加密密钥被重置为随机数。此外，用户希望将默认加密密钥统一为 `123456`，并增加安全风险提示及密钥功能说明。

## 解决思路
1.  **修复持久化失效问题**：
    *   **原因分析**：在执行恢复逻辑时，`setSettings(restored)` 触发了异步的状态更新。由于原有的 `useEffect` 监听了 `settings` 的变化并自动执行 `saveSettings`，在恢复过程中可能因为状态更新未完成或竞态条件，导致刚恢复的数据被旧的本地状态覆盖，或者在重新挂载时初始化逻辑出现了偏差。
    *   **解决方案**：在 `handleRestore` 过程中，通过 `isInitialMount.current = true` 暂时锁定自动保存逻辑。在设置完恢复的数据并手动调用一次 `saveSettings` 后，延迟 500ms 再解除锁定。这样可以确保恢复的数据被稳定写入存储，且不会被误触发的自动保存逻辑覆盖。

2.  **修复初始化覆盖问题**：
    *   **原因分析**：`loadSettings` 逻辑在处理同步设置（sync）时，直接使用了 `DEFAULT_SETTINGS.sync` 或简单的覆盖。
    *   **解决方案**：改进 `loadSettings` 中的合并逻辑，使用深度合并确保默认值（如 `123456` 密钥）只有在用户没有自定义设置时才生效，同时增加了对 `undefined` 的空值检查，增强了类型安全性。

3.  **默认密钥与安全提示**：
    *   **默认值修改**：将 `src/utils/storage.ts` 中的 `DEFAULT_SETTINGS.sync.encryptionKey` 修改为 `123456`。
    *   **多语言支持**：在 `i18n.ts` 中新增了 `encryptionKeyWarning`（安全警告）和 `encryptionKeyDescription`（功能描述）的翻译条目，覆盖了中、英、日、韩、德、法、西七种语言。
    *   **UI 增强**：在设置页面的密钥输入框下方，增加了醒目的黄色警告文字（仅当使用默认密钥时显示）以及蓝色的功能描述信息框，帮助初学者理解密钥的作用及其安全性。

4.  **解决输入框抖动/回退问题**：
    *   **原因分析**：密钥输入框直接绑定了全局 `settings` 状态。由于设置了 500ms 的自动保存防抖，每次按键都会触发 `settings` 更新，进而可能触发复杂的副作用（如 `useEffect` 监听），导致在输入过程中组件重新渲染，光标位置丢失或字符回退。
    *   **解决方案**：引入 `localEncryptionKey` 本地 state。用户输入时优先更新本地 state，保证响应速度为毫秒级；同时异步同步到全局 `settings`。通过 `useEffect` 确保全局状态的变化（如恢复数据或生成随机密钥）能正确反馈到本地 state，从而实现了输入流畅性与数据一致性的平衡。

## 涉及文件
*   [storage.ts](file:///c:/Users/ralph/IdeaProject/Memoraid/src/utils/storage.ts)：修改默认配置项。
*   [i18n.ts](file:///c:/Users/ralph/IdeaProject/Memoraid/src/utils/i18n.ts)：添加多语言文案。
*   [Settings.tsx](file:///c:/Users/ralph/IdeaProject/Memoraid/src/components/Settings.tsx)：修复恢复逻辑、初始化逻辑并优化 UI 展示。

## 验证结果
执行 `npm run build` 通过，代码无类型错误，逻辑符合预期。
