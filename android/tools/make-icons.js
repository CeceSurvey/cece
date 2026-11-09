#!/usr/bin/env node
/**
 * 由 icon.svg 生成 Android 各密度启动图标。
 *
 * 用法：
 *   NODE_PATH=/path/to/node_modules node android/tools/make-icons.js
 * （需要 sharp，仅构建机需要，不进入 APK）
 *
 * 产出：
 *   android/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
 *   android/res/mipmap-{...}/ic_launcher_round.png
 *   android/store/ic_launcher_512.png   （预留上架用）
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const SVG = path.join(ROOT, 'icon.svg');
const RES = path.join(ROOT, 'android', 'res');

const DENSITIES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const src = fs.readFileSync(SVG, 'utf8');
const inner = src
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

// 圆形图标：把原图整幅裁进一个圆里
const roundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
<defs><clipPath id="__round"><circle cx="96" cy="96" r="96"/></clipPath></defs>
<g clip-path="url(#__round)">${inner}</g></svg>`;

async function main() {
  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });

    await sharp(Buffer.from(src))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher.png'));

    await sharp(Buffer.from(roundSvg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    console.log(`  mipmap-${density}  ${size}x${size}  ✓`);
  }

  const storeDir = path.join(ROOT, 'android', 'store');
  fs.mkdirSync(storeDir, { recursive: true });
  await sharp(Buffer.from(src))
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(path.join(storeDir, 'ic_launcher_512.png'));
  console.log('  store/ic_launcher_512.png  512x512  ✓');
}

main().catch((e) => {
  console.error('图标生成失败:', e);
  process.exit(1);
});
