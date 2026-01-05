import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'Memoraid',
  description: 'Export AI chat to Markdown with summarization',
  version: '1.0.0',
  manifest_version: 3,
  action: {
    default_popup: 'index.html',
    default_icon: {
      '16': 'public/icon-16.png',
      '48': 'public/icon-48.png',
      '128': 'public/icon-128.png',
    },
  },
  icons: {
    '16': 'public/icon-16.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
  },
  permissions: ['storage', 'activeTab', 'scripting', 'notifications'],
  host_permissions: ['https://*/*', 'http://*/*'],
  content_scripts: [
    {
      matches: ['https://chatgpt.com/*', 'https://gemini.google.com/*'],
      js: ['src/content/index.ts'],
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
})
