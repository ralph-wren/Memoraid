
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgBuffer = fs.readFileSync(path.join(process.cwd(), 'public/logo.svg'));

async function generateIcons() {
  await sharp(svgBuffer).resize(16, 16).png().toFile('public/icon-16.png');
  await sharp(svgBuffer).resize(48, 48).png().toFile('public/icon-48.png');
  await sharp(svgBuffer).resize(128, 128).png().toFile('public/icon-128.png');
  console.log('Icons generated successfully');
}

generateIcons().catch(console.error);

