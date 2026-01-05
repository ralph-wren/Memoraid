# Memoraid Extension

A Chrome extension to export ChatGPT and Gemini conversations to Markdown with AI-powered summarization.

## Features

- **Extract Chat**: Automatically extracts conversation text from ChatGPT and Gemini.
- **AI Summarization**: Uses 01.AI (Yi) or compatible APIs to summarize the content.
- **Customizable**: Configure API Key, Base URL, Model, and System Prompt.
- **Markdown Export**: Download the summary as a `.md` file.

## Installation

1. Clone or download this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run build` to build the extension.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable "Developer mode" in the top right.
6. Click "Load unpacked" and select the `dist` directory from this project.

## Configuration

1. Click the extension icon in Chrome.
2. Click the Settings icon (gear).
3. Enter your API Key (e.g., for 01.AI/Yi).
4. Set Base URL (default: `https://api.lingyiwanwu.com/v1`).
5. Select or type the Model (e.g., `yi-34b-chat-0205`).
6. Save Settings.

## Usage

1. Go to a chat page on [ChatGPT](https://chatgpt.com) or [Gemini](https://gemini.google.com).
2. Open the extension popup.
3. Click "Summarize & Export".
4. Wait for the AI to generate the summary.
5. Click "Download MD" to save the file.

## Development

- `npm run dev`: Start dev server (might need specific HMR setup for extensions).
- `npm run build`: Build for production.
