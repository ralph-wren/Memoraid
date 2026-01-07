import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'Memoraid',
  description: 'Export AI chat to Markdown with summarization',
  version: '1.0.0',
  manifest_version: 3,
  action: {
    default_popup: 'index.html',
    default_icon: {
      '16': 'icon-16.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
  icons: {
    '16': 'icon-16.png',
    '48': 'icon-48.png',
    '128': 'icon-128.png',
  },
  permissions: ['storage', 'activeTab', 'notifications', 'cookies', 'scripting', 'identity'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
    },
    {
      matches: ['*://mp.toutiao.com/*'],
      js: ['src/content/toutiao.ts'],
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
})
