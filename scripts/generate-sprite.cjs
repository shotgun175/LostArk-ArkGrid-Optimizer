// Packs the hand-made OpenCV template crops in opencv-templates/<lang>/ into one sprite sheet per
// locale (public/opencv_template_<lang>_<timestamp>.png) plus a coordinates module
// (src/lib/cv/template-coords/<lang>.ts). The app only ever crops the sheet at the recorded
// coordinates, so the layout itself does not matter; each crop is copied pixel for pixel.
//
// Layout: a simple shelf packer. Templates are placed tallest first, left to right, in rows no wider
// than the square root of the total area (or the widest template), with 2px of transparent padding
// between neighbours.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const templateFolders = [
  { folder: './opencv-templates/en_us', lang: 'en_us' },
  { folder: './opencv-templates/ko_kr', lang: 'ko_kr' },
  { folder: './opencv-templates/ru_ru', lang: 'ru_ru' },
];

const publicDir = './public';
const tsOutputDir = './src/lib/cv/template-coords';
const padding = 2;
const currentTimestamp = Date.now();

/** Place each image on shelves; returns the sheet size and an {x, y} per image index. */
function packShelves(images) {
  const widest = Math.max(...images.map((im) => im.width));
  const area = images.reduce((sum, im) => sum + (im.width + padding) * (im.height + padding), 0);
  const maxRowWidth = Math.max(widest, Math.ceil(Math.sqrt(area)));
  const order = images
    .map((_, i) => i)
    .sort(
      (a, b) => images[b].height - images[a].height || images[b].width - images[a].width || a - b
    );

  const positions = new Array(images.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let sheetWidth = 0;
  for (const i of order) {
    const { width, height } = images[i];
    if (x > 0 && x + width > maxRowWidth) {
      y += rowHeight + padding;
      x = 0;
      rowHeight = 0;
    }
    positions[i] = { x, y };
    sheetWidth = Math.max(sheetWidth, x + width);
    rowHeight = Math.max(rowHeight, height);
    x += width + padding;
  }
  return { width: sheetWidth, height: y + rowHeight, positions };
}

// Create the TS output folder if it doesn't exist
if (!fs.existsSync(tsOutputDir)) fs.mkdirSync(tsOutputDir, { recursive: true });

// Delete the existing opencv_template_*.png files from the public folder
fs.readdirSync(publicDir)
  .filter((f) => f.startsWith('opencv_template_') && f.endsWith('.png'))
  .forEach((f) => {
    const filePath = path.join(publicDir, f);
    fs.unlinkSync(filePath);
    console.log(`Deleted old sprite: ${filePath}`);
  });

templateFolders.forEach(({ folder, lang }) => {
  const files = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.png'))
    .map((f) => path.join(folder, f));

  if (files.length === 0) {
    console.warn(`No PNG files found in ${folder}, skipping...`);
    process.exitCode = 1;
    return;
  }

  // pngjs decodes every input to 8-bit RGBA, so bitblt copies exact pixels.
  const images = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
  const { width, height, positions } = packShelves(images);
  const sheet = new PNG({ width, height }); // zero-filled: transparent padding
  images.forEach((im, i) =>
    PNG.bitblt(im, sheet, 0, 0, im.width, im.height, positions[i].x, positions[i].y)
  );

  // Save the sprite image
  const fileNameWithTimestamp = `opencv_template_${lang}_${currentTimestamp}.png`;
  const spritePath = path.join(publicDir, fileNameWithTimestamp);
  fs.writeFileSync(spritePath, PNG.sync.write(sheet));
  console.log(`Saved sprite: ${spritePath} (${width}x${height})`);

  // Generate the TS file
  const tsPath = path.join(tsOutputDir, `${lang}.ts`);
  const tsContentLines = ['// THIS FILE IS AUTO-GENERATED. DO NOT MODIFY ITSELF'];

  // Convert ko_kr to koKr / KoKr so it can be used as a variable name
  const [localeLang, localeRegion] = lang.split('_');
  const prefix = localeLang + localeRegion.charAt(0).toUpperCase() + localeRegion.slice(1);
  const upperPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);

  tsContentLines.push(`export const ${prefix}Coords = {`);

  files.forEach((filePath, i) => {
    const fileName = path.basename(filePath);
    const { x, y } = positions[i];
    tsContentLines.push(
      `  '${fileName}': { x: ${x}, y: ${y}, w: ${images[i].width}, h: ${images[i].height} },`
    );
  });

  tsContentLines.push('} as const;\n');

  // Add the TemplateName type
  tsContentLines.push(`export type ${upperPrefix}TemplateName = keyof typeof ${prefix}Coords;\n`);
  tsContentLines.push(`export const ${prefix}FileName = '${fileNameWithTimestamp}';\n`);

  fs.writeFileSync(tsPath, tsContentLines.join('\n'));
  console.log(`Saved TS coords with type: ${tsPath}`);
});
