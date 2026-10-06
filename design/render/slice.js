// Slice a tall PNG into chunks: node slice.js in.png outPrefix chunkHeight
const fs = require('fs'); const { PNG } = require('pngjs');
const [inp, pre, ch] = process.argv.slice(2); const H = +(ch || 1600);
const src = PNG.sync.read(fs.readFileSync(inp));
let n = 0;
for (let y = 0; y < src.height; y += H) {
  const h = Math.min(H, src.height - y); const out = new PNG({ width: src.width, height: h });
  PNG.bitblt(src, out, 0, y, src.width, h, 0, 0);
  fs.writeFileSync(`${pre}-${String(n++).padStart(2, '0')}.png`, PNG.sync.write(out));
}
console.log(n, 'chunks');
