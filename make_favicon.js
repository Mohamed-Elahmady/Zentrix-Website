const sharp = require('sharp');
const path = require('path');

const INPUT  = path.join(__dirname, 'imgs', 'logo.png');
const OUTPUT = path.join(__dirname, 'imgs', 'favicon.png');

async function main() {
  const img = sharp(INPUT);
  const { width, height } = await img.metadata();
  console.log(`Original size: ${width} x ${height}`);

  // The logo sits roughly in the center with whitespace around it.
  // Crop to the content area (remove ~15% padding on all sides).
  const padX = Math.round(width  * 0.08);
  const padY = Math.round(height * 0.08);
  const cropW = width  - padX * 2;
  const cropH = height - padY * 2;

  // Make it square by taking the shorter side.
  const side = Math.min(cropW, cropH);
  const left = Math.round((width  - side) / 2);
  const top  = Math.round((height - side) / 2);

  await sharp(INPUT)
    .extract({ left, top, width: side, height: side })
    .resize(512, 512, { fit: 'contain', background: { r: 13, g: 27, b: 46, alpha: 0 } })
    .png()
    .toFile(OUTPUT);

  console.log(`✅  favicon saved → ${OUTPUT}`);
}

main().catch(console.error);
