# Convert SVG Icons to PNG

PWA 图标以 `../cloud-terminal-mark-flat.svg` 为品牌源图；`icons/` 下的 SVG/PNG 是面向不同平台尺寸的派生资源。更新源图时，需要重新导出对应 PNG，且实际像素尺寸必须与文件名和 `manifest.json` 一致。

## Method 1: Online Converter (Easiest)
1. Go to https://cloudconvert.com/svg-to-png
2. Upload each SVG file from the `/icons/` directory
3. Download the PNG versions
4. Replace the existing PNG files

## Method 2: Using Node.js (if you have it)
```bash
npm install sharp
node -e "
const sharp = require('sharp');
const fs = require('fs');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
sizes.forEach(size => {
  const svgPath = \`./icons/icon-\${size}x\${size}.svg\`;
  const pngPath = \`./icons/icon-\${size}x\${size}.png\`;
  if (fs.existsSync(svgPath)) {
    sharp(svgPath).png().toFile(pngPath);
    console.log(\`Converted \${svgPath} to \${pngPath}\`);
  }
});
"
```

## Method 3: Using ImageMagick (if installed)
```bash
cd public/icons
for size in 72 96 128 144 152 192 384 512; do
  convert "icon-${size}x${size}.svg" "icon-${size}x${size}.png"
done
```

## Method 4: Using Inkscape (if installed)
```bash
cd public/icons
for size in 72 96 128 144 152 192 384 512; do
  inkscape --export-type=png "icon-${size}x${size}.svg"
done
```

## Icon Design

- 浅蓝色圆角底
- 扁平云朵与蓝色 `>_` 标记
- 为 maskable PWA 图标预留安全边距
