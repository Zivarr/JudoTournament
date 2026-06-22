import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'));

// 512x512 PNG for Linux AppImage
await sharp(svg).resize(512, 512).png().toFile(path.join(__dirname, 'icon.png'));
console.log('✓ build/icon.png (512x512)');

// ICO for Windows — embed 16, 32, 48, 256 px layers
const sizes = [16, 32, 48, 256];
const pngBuffers = await Promise.all(
  sizes.map(size => sharp(svg).resize(size, size).png().toBuffer())
);
const icoBuffer = await pngToIco(pngBuffers);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), icoBuffer);
console.log('✓ build/icon.ico (16/32/48/256px)');
