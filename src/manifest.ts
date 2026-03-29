import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'Memoraid - AI自动化发文到小红书、公众号、知乎、头条等自媒体平台',
  description: 'Memoraid 是一款强大的 AI 内容处理工具，帮助您高效地总结网页内容、生成自媒体文章，并一键发布到头条号、知乎专栏和微信公众号。',
  version: '1.3.3',
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
  permissions: ['storage', 'activeTab', 'cookies', 'identity', 'alarms', 'scripting', 'tabs', 'notifications'],
  host_permissions: ['<all_urls>'],
  web_accessible_resources: [
    {
      resources: ['debug-bridge.js'],
      matches: ['<all_urls>'],
    },
  ],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
    },
    {
      matches: ['*://mp.toutiao.com/*'],
      js: ['src/content/toutiao.ts'],
      run_at: 'document_end', // 确保在 DOM 加载完成后执行
    },
    {
      matches: ['*://zhuanlan.zhihu.com/*'],
      js: ['src/content/zhihu.ts'],
    },
    {
      // 微信公众号编辑页面
      matches: ['*://mp.weixin.qq.com/*'],
      js: ['src/content/weixin.ts'],
    },
    {
      // 小红书创作者平台发布页面
      matches: ['*://creator.xiaohongshu.com/*'],
      js: ['src/content/xiaohongshu.ts'],
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
})
