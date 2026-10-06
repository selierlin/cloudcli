/**
 * 从 iOS App 图标母版（ios/App/App/Assets.xcassets/AppIcon.appiconset/）派生
 * Web 侧全部图标：浏览器标签 favicon（浅色/深色两份）、apple-touch-icon、
 * PWA manifest 的 any / maskable 两套 PNG。
 *
 * 母版右下角带有生成工具水印（约 y≥970），居中取 880×880 的裁剪窗口
 * （y ∈ [72, 952]）既避开水印，又完整落在圆角矩形内部，裁剪结果无透明边角。
 *
 *   node scripts/gen-app-icons.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const masterDir = path.join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
const outDir = path.join(root, 'public/icons');

const MASTERS = {
  light: path.join(masterDir, 'AppIcon-512@2x.png'),
  dark: path.join(masterDir, 'AppIcon-Dark-512@2x.png'),
};

const CROP = { left: 72, top: 72, size: 880 };
const MANIFEST_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const FAVICON_SIZE = 32;
const APPLE_TOUCH_SIZE = 180;
// iOS 图标圆角比例，用于给 any 图标恢复圆角与透明角。
const CORNER_RADIUS = 0.2237;

/** 居中裁剪窗口，返回 sharp 管道起点。 */
function cropped(master) {
  return sharp(master).extract({
    left: CROP.left,
    top: CROP.top,
    width: CROP.size,
    height: CROP.size,
  });
}

/** 与目标尺寸等比的圆角蒙版（dest-in 用），还原 iOS 图标的圆角外形。 */
function roundedMask(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * CORNER_RADIUS)}"/></svg>`,
  );
}

/** any 用途：圆角 + 透明角。 */
async function writeRounded(master, size, filename) {
  await cropped(master)
    .resize(size, size)
    .composite([{ input: roundedMask(size), blend: 'dest-in' }])
    .png()
    .toFile(path.join(outDir, filename));
}

/** maskable / apple-touch 用途：全出血方形，不挖圆角。 */
async function writeFullBleed(master, size, filename) {
  await cropped(master).resize(size, size).png().toFile(path.join(outDir, filename));
}

await writeFullBleed(MASTERS.light, APPLE_TOUCH_SIZE, `icon-${APPLE_TOUCH_SIZE}x${APPLE_TOUCH_SIZE}.png`);

for (const size of MANIFEST_SIZES) {
  await writeRounded(MASTERS.light, size, `icon-${size}x${size}.png`);
  await writeFullBleed(MASTERS.light, size, `icon-${size}x${size}-maskable.png`);
}

for (const appearance of Object.keys(MASTERS)) {
  await writeRounded(MASTERS[appearance], FAVICON_SIZE, `favicon-${appearance}-${FAVICON_SIZE}.png`);
}

console.log(`icons written to ${outDir}`);
