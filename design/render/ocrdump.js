// Print OCR word boxes for an image in public/mk/img, grouped by line: node ocrdump.js <file> [scale]
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const { PNG } = require('pngjs');
const f = process.argv[2], scale = +(process.argv[3] || 1);
const tmp = path.join(__dirname, '.tmp', 'dump-' + path.basename(f) + '.png');
execSync(`sips -s format png "${path.resolve(__dirname, '../../apps/web/public/mk/img', f)}" --out "${tmp}"`, { stdio: 'ignore' });
const png = PNG.sync.read(fs.readFileSync(tmp));
for (let i = 0; i < png.data.length; i += 4) { const a = png.data[i + 3] / 255; for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(png.data[i + k] * a + 255 * (1 - a)); png.data[i + 3] = 255; }
fs.writeFileSync(tmp, PNG.sync.write(png));
let src = tmp;
if (scale !== 1) { src = tmp.replace('.png', '-up.png'); execSync(`sips --resampleWidth ${Math.round(png.width * scale)} "${tmp}" --out "${src}"`, { stdio: 'ignore' }); }
const out = spawnSync('tesseract', [src, 'stdout', '--psm', '11', 'tsv'], { encoding: 'utf8' }).stdout;
const rows = out.trim().split('\n').slice(1).map((l) => l.split('\t')).filter((r) => r.length >= 12 && r[11].trim() && +r[10] > 10);
console.log(png.width + 'x' + png.height);
for (const r of rows) console.log([r[11], Math.round(r[6] / scale), Math.round(r[7] / scale), Math.round(r[8] / scale), Math.round(r[9] / scale), r[10]].join('\t'));
