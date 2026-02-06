# Privacy Policy for Memoraid

**Effective Date:** February 6, 2026
**Last Updated:** February 6, 2026

**Memoraid** ("we", "us", or "our") respects your privacy. This Privacy Policy describes how we handle your data when you use our Chrome Extension.

## 1. Single Purpose

Memoraid is an AI-powered content automation tool that helps users summarize web content, generate social media articles, and publish them to platforms like WeChat, Zhihu, Toutiao, and Xiaohongshu with one click. All features and permissions are directly related to this core functionality.

## 2. Data Collection and Usage Disclosure

In compliance with the Chrome Web Store User Data Policy, we fully disclose the types of data this extension handles and their purposes:

### 2.1 Web Content Data
*   **Collection**: When you actively trigger the "Summarize" or "Extract" features, the extension reads the text content of the active tab.
*   **Purpose**: The extracted content is sent to your configured AI service provider (e.g., OpenAI, DeepSeek, etc.) to generate summaries or article drafts.
*   **Storage**: This data is not stored on our servers. It is processed in-memory and may be saved to your local `chrome.storage.local` if you choose to save the history.

### 2.2 Cookie Data (Cross-platform Login)
*   **Collection**: The extension accesses cookies from specific self-media platforms (mp.weixin.qq.com, zhihu.com, toutiao.com, xiaohongshu.com) **only when you click the "Auto Fetch Cookie" button in Settings**.
*   **Purpose**: These cookies are used solely to verify your login status on these platforms, enabling the one-click publishing feature without requiring you to manually re-enter credentials.
*   **Storage**: Cookies are stored **locally** in your browser's encrypted storage. **We never transmit your cookies to our servers.**

### 2.3 User Authentication and Sync Data
*   **Collection**: If you use the "Sync & Backup" feature, we collect your email address and basic profile information via Google or GitHub OAuth.
*   **Purpose**: To provide cross-device synchronization of your settings and history.
*   **Storage**: Your data is stored in our backend (Cloudflare Workers + D1 Database) only if you enable sync. All sensitive data (like API keys) is **encrypted client-side (AES-256)** with your personal passphrase before being uploaded. We cannot decrypt your data.

## 3. Permissions Justification

*   **`storage`**: Used to save your settings, API keys, and local task history.
*   **`activeTab`**: Used to read the content of the page you are currently viewing to provide AI summarization features.
*   **`cookies`**: Used to check your login status on self-media platforms for one-click publishing.
*   **`notifications`**: Used to alert you when AI tasks or publishing tasks are completed.
*   **`identity`**: Used for the optional "Sync & Backup" feature via Google/GitHub login.
*   **`host_permissions` (<all_urls>)**: Required to interact with various AI APIs and self-media platforms you choose to use.

## 4. Data Sharing and Security

*   **No Sale of Data**: We never sell your data to third parties.
*   **No Use for Advertising**: Your data is never used for advertising, credit-worthiness assessment, or any purpose unrelated to the extension's core functionality.
*   **Third-party AI Providers**: When you use AI features, your content is sent to the provider you configured. Please refer to their respective privacy policies.

## 5. Contact Us

If you have any questions about this Privacy Policy, please contact us via the Chrome Web Store support page.
