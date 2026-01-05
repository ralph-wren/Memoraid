# Privacy Policy for Memoraid

**Effective Date:** January 5, 2026

**Memoraid** ("we", "us", or "our") respects your privacy. This Privacy Policy describes how we handle your data when you use our Chrome Extension.

## 1. Data Collection and Usage

**We do not collect, store, or transmit any of your personal data to our own servers.**

*   **Chat Content**: The extension extracts chat content from the active tab (ChatGPT or Gemini) **only when you explicitly click the "Summarize & Export" button**. This content is processed locally in your browser and sent directly to the AI Provider you have configured (e.g., OpenAI, DeepSeek, Yi) to generate a summary.
*   **API Keys**: Your API keys are stored **locally** in your browser's storage (`chrome.storage.local`). We do not have access to your API keys.
*   **History**: The summaries generated are stored **locally** in your browser's storage (`chrome.storage.local`) for your convenience. You can clear this history at any time within the extension.

## 2. Third-Party Services

This extension interacts with third-party AI providers (such as OpenAI, DeepSeek, Yi/01.AI) based on your configuration.

*   When you use the summarization feature, the extracted chat text is sent to the API endpoint you configured.
*   Please refer to the privacy policy of the specific AI provider you are using for information on how they handle data sent to their API.

## 3. Permissions

The extension requests the following permissions for specific purposes:

*   `activeTab`: To access the content of the current chat page when you click the extension icon, allowing us to extract the conversation for summarization.
*   `scripting`: To execute the extraction script on the active page.
*   `storage`: To save your settings (API Key, Model, etc.) and summarization history locally.
*   `notifications`: To notify you when a background summarization task is completed or if an error occurs.

## 4. Changes to This Policy

We may update this Privacy Policy from time to time. If we make material changes, we will notify you by updating the date at the top of this policy.

## 5. Contact Us

If you have any questions about this Privacy Policy, please contact us via the Chrome Web Store support page.
