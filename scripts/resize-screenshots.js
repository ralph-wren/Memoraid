/**
 * 调整截图尺寸为 Chrome 应用商店要求的 1280x800
 * 运行: node scripts/resize-screenshots.js
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_ASSETS_DIR = path.join(__dirname, '..', 'store-assets');
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;

async function resizeScreenshots() {
  const files = fs.readdirSync(STORE_ASSETS_DIR);
  const screenshots = files.filter(f => f.startsWith('screenshot-') && f.endsWith('.png'));
  
  console.log(`找到 ${screenshots.length} 张截图\n`);
  
  for (const filename of screenshots) {
    const filepath = path.join(STORE_ASSETS_DIR, filename);
    
    try {
      // 获取原始尺寸
      const metadata = await sharp(filepath).metadata();
      console.log(`处理: ${filename}`);
      console.log(`  原始尺寸: ${metadata.width}x${metadata.height}`);
      
      // 如果尺寸已经正确，跳过
      if (metadata.width === TARGET_WIDTH && metadata.height === TARGET_HEIGHT) {
        console.log(`  ✅ 尺寸正确，跳过\n`);
        continue;
      }
      
      // 创建白色背景的 1280x800 画布，将原图居中放置
      // 如果原图太大，先缩小；如果太小，保持原大小居中
      
      let resizedImage;
      
      if (metadata.width > TARGET_WIDTH || metadata.height > TARGET_HEIGHT) {
        // 原图太大，需要缩小以适应目标尺寸
        resizedImage = await sharp(filepath)
          .resize(TARGET_WIDTH, TARGET_HEIGHT, {
            fit: 'inside',  // 保持比例，确保图片完全在目标尺寸内
            withoutEnlargement: false
          })
          .toBuffer();
      } else {
        // 原图较小，保持原大小
        resizedImage = await sharp(filepath).toBuffer();
      }
      
      // 获取调整后的尺寸
      const resizedMetadata = await sharp(resizedImage).metadata();
      
      // 计算居中位置
      const left = Math.floor((TARGET_WIDTH - resizedMetadata.width) / 2);
      const top = Math.floor((TARGET_HEIGHT - resizedMetadata.height) / 2);
      
      // 创建白色背景画布并合成图片
      await sharp({
        create: {
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }  // 白色背景
        }
      })
        .composite([{
          input: resizedImage,
          left: left,
          top: top
        }])
        .png()
        .toFile(filepath + '.tmp');
      
      // 替换原文件
      fs.unlinkSync(filepath);
      fs.renameSync(filepath + '.tmp', filepath);
      
      console.log(`  ✅ 已调整为: ${TARGET_WIDTH}x${TARGET_HEIGHT}\n`);
      
    } catch (error) {
      console.error(`  ❌ 处理失败: ${error.message}\n`);
    }
  }
  
  console.log('处理完成！');
}

resizeScreenshots().catch(console.error);
