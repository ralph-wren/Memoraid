import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const distDir = path.join(process.cwd(), 'dist');
const outputDir = path.join(process.cwd(), 'release');
const zipPath = path.join(outputDir, 'memoraid-release.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});

output.on('close', function() {
  console.log(archive.pointer() + ' total bytes');
  console.log('Extension release packaged successfully at: ' + zipPath);
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
