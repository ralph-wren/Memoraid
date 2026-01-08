/**
 * 调试脚本：检查热点图库右侧图片列表的 HTML 结构
 * 
 * 运行方式: node scripts/debug-image-selector.js
 */

import { chromium } from 'playwright';

const CONFIG = {
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: 'C:\\Users\\ralph\\AppData\\Local\\Google\\Chrome\\Chrome-Automation',
  toutiaoPublishUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish'
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function debugImageSelector() {
  console.log('🚀 启动 Chrome 浏览器...');
  
  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    executablePath: CONFIG.executablePath,
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  let page = context.pages()[0] || await context.newPage();

  console.log('📄 正在访问头条发布页面...');
  await page.goto(CONFIG.toutiaoPublishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);

  try {
    // 点击添加图标
    console.log('\n步骤1: 点击添加图标...');
    await page.locator('.add-icon').click();
    await sleep(1000);

    // 点击热点图库
    console.log('步骤2: 点击热点图库...');
    await page.getByText('热点图库', { exact: true }).click();
    await sleep(1000);

    // 输入搜索关键词
    console.log('步骤3: 搜索 "风景"...');
    await page.getByRole('textbox', { name: '建议输入关键词组合，如：苹果 绿色' }).fill('风景');
    await page.locator('.ui-search > span').click();
    await sleep(2000);

    // 点击第一个图片组
    console.log('步骤4: 点击第一个图片组...');
    await page.locator('.img').first().click();
    await sleep(1500);

    // 现在检查右侧图片列表的 HTML 结构
    console.log('\n========== 检查右侧图片列表结构 ==========\n');

    // 获取页面上所有可能的图片容器
    const selectors = [
      '.detail-panel',
      '.preview-panel', 
      '.image-detail',
      '.pic-list',
      '.img-list',
      '[class*="detail"]',
      '[class*="preview"]',
      '[class*="right"]',
      'ul',
      'li.item'
    ];

    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`${selector}: ${count} 个`);
        
        // 获取第一个元素的 HTML
        if (count <= 5) {
          const html = await page.locator(selector).first().evaluate(el => el.outerHTML.substring(0, 200));
          console.log(`  HTML: ${html}...`);
        }
      }
    }

    // 特别检查 li.item 的结构
    console.log('\n========== li.item 结构分析 ==========\n');
    const liItems = await page.locator('li.item').all();
    console.log(`找到 ${liItems.length} 个 li.item`);
    
    if (liItems.length > 0) {
      // 检查第一个 li.item 的完整 HTML
      const firstLiHtml = await liItems[0].evaluate(el => el.outerHTML);
      console.log('第一个 li.item 的 HTML:');
      console.log(firstLiHtml.substring(0, 500));
      
      // 检查是否有 select 类
      for (let i = 0; i < Math.min(5, liItems.length); i++) {
        const className = await liItems[i].evaluate(el => el.className);
        console.log(`li.item[${i}] class: "${className}"`);
      }
    }

    // 检查右侧区域
    console.log('\n========== 检查右侧区域 ==========\n');
    
    // 获取所有 img 标签的位置
    const allImgs = await page.locator('img').all();
    console.log(`页面上共有 ${allImgs.length} 个 img 标签`);
    
    for (let i = 0; i < Math.min(10, allImgs.length); i++) {
      const box = await allImgs[i].boundingBox();
      const src = await allImgs[i].getAttribute('src');
      if (box) {
        console.log(`img[${i}]: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);
        console.log(`  src: ${src?.substring(0, 80)}...`);
      }
    }

    // 尝试 Playwright 的录制选择器
    console.log('\n========== Playwright 建议的选择器 ==========\n');
    console.log('请手动点击右侧的图片，观察 Playwright 生成的选择器');
    console.log('按 Ctrl+C 退出');

  } catch (error) {
    console.error('❌ 错误:', error.message);
  }

  // 保持运行
  await new Promise(() => {});
}

process.on('SIGINT', () => {
  console.log('\n👋 正在关闭...');
  process.exit(0);
});

debugImageSelector().catch(console.error);
