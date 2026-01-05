import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outputDir = path.join(process.cwd(), 'store-assets');
const logoPath = path.join(process.cwd(), 'public', 'logo.svg');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Helper to create SVG buffer
function createSvgBuffer(width, height, content) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${content}
    </svg>
  `);
}

async function generateAssets() {
  console.log('Generating Store Assets...');
  
  const logoBuffer = fs.readFileSync(logoPath);

  // 1. Store Icon (128x128) - Already exists but let's ensure it's PNG
  // We will generate a new one from SVG to be sure
  await sharp(logoBuffer)
    .resize(128, 128)
    .png()
    .toFile(path.join(outputDir, 'icon-128.png'));
  console.log('Generated icon-128.png');

  // 2. Small Promo Tile (440x280)
  const smallPromoSvg = `
    <rect width="100%" height="100%" fill="#ffffff" />
    <text x="220" y="200" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="48" fill="#1e293b">Memoraid</text>
    <text x="220" y="240" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#64748b">AI Chat Export</text>
  `;
  
  // Composite Logo onto background
  const logoSmall = await sharp(logoBuffer).resize(120, 120).toBuffer();
  
  await sharp(createSvgBuffer(440, 280, smallPromoSvg))
    .composite([{ input: logoSmall, top: 40, left: 160 }])
    .png()
    .toFile(path.join(outputDir, 'promo-small-440x280.png'));
  console.log('Generated promo-small-440x280.png');

  // 3. Marquee Promo Tile (1400x560)
  const marqueePromoSvg = `
    <rect width="100%" height="100%" fill="#f8fafc" />
    <text x="600" y="260" font-family="Arial, sans-serif" font-weight="bold" font-size="100" fill="#1e293b">Memoraid</text>
    <text x="600" y="340" font-family="Arial, sans-serif" font-size="40" fill="#475569">Export AI Chat to Markdown</text>
    <text x="600" y="400" font-family="Arial, sans-serif" font-size="32" fill="#64748b">Support ChatGPT &amp; Gemini</text>
  `;

  const logoMarquee = await sharp(logoBuffer).resize(350, 350).toBuffer();

  await sharp(createSvgBuffer(1400, 560, marqueePromoSvg))
    .composite([{ input: logoMarquee, top: 105, left: 150 }])
    .png()
    .toFile(path.join(outputDir, 'promo-marquee-1400x560.png'));
  console.log('Generated promo-marquee-1400x560.png');

  // 4. Screenshots (1280x800)
  // Screenshot 1: AI Summarization
  const shot1Svg = `
    <rect width="100%" height="100%" fill="#ffffff" />
    <rect x="0" y="0" width="1280" height="80" fill="#f1f5f9" />
    <circle cx="40" cy="40" r="10" fill="#cbd5e1" />
    <circle cx="80" cy="40" r="10" fill="#cbd5e1" />
    <rect x="120" y="20" width="800" height="40" rx="8" fill="#ffffff" stroke="#e2e8f0" />
    
    <text x="640" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="60" fill="#2563eb">AI Summarization</text>
    <text x="640" y="480" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#475569">One-click summary generation for your chats</text>
  `;
  const logoShot1 = await sharp(logoBuffer).resize(150, 150).toBuffer();
  
  await sharp(createSvgBuffer(1280, 800, shot1Svg))
    .composite([{ input: logoShot1, top: 150, left: 565 }])
    .png()
    .toFile(path.join(outputDir, 'screenshot-1.png'));
  console.log('Generated screenshot-1.png');

  // Screenshot 2: Markdown Export
  const shot2Svg = `
    <rect width="100%" height="100%" fill="#ffffff" />
    <rect x="0" y="0" width="1280" height="80" fill="#f1f5f9" />
    <circle cx="40" cy="40" r="10" fill="#cbd5e1" />
    <circle cx="80" cy="40" r="10" fill="#cbd5e1" />
    <rect x="120" y="20" width="800" height="40" rx="8" fill="#ffffff" stroke="#e2e8f0" />

    <text x="640" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="60" fill="#059669">Export to Markdown</text>
    <text x="640" y="480" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#475569">Download clean, formatted Markdown files</text>
  `;
  // Reuse logo for consistency or use a markdown icon if available, but logo is fine
  await sharp(createSvgBuffer(1280, 800, shot2Svg))
    .composite([{ input: logoShot1, top: 150, left: 565 }])
    .png()
    .toFile(path.join(outputDir, 'screenshot-2.png'));
  console.log('Generated screenshot-2.png');

  // Screenshot 3: History
  const shot3Svg = `
    <rect width="100%" height="100%" fill="#ffffff" />
    <rect x="0" y="0" width="1280" height="80" fill="#f1f5f9" />
    <circle cx="40" cy="40" r="10" fill="#cbd5e1" />
    <circle cx="80" cy="40" r="10" fill="#cbd5e1" />
    <rect x="120" y="20" width="800" height="40" rx="8" fill="#ffffff" stroke="#e2e8f0" />

    <text x="640" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="60" fill="#7c3aed">Local History</text>
    <text x="640" y="480" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#475569">Access and manage your generated summaries anytime</text>
  `;
  await sharp(createSvgBuffer(1280, 800, shot3Svg))
    .composite([{ input: logoShot1, top: 150, left: 565 }])
    .png()
    .toFile(path.join(outputDir, 'screenshot-3.png'));
  console.log('Generated screenshot-3.png');

  console.log('All assets generated in store-assets/');
}

generateAssets().catch(err => console.error(err));
