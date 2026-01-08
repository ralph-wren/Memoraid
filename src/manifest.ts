import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'Memoraid',
  description: 'Memoraid 是一款强大的 AI 内容处理工具，帮助您高效地总结网页内容、生成自媒体文章，并一键发布到头条号。',
  version: '1.1.1',
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
