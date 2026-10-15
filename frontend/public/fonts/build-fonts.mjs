// One-off: extract latin + latin-ext @font-face blocks from the Google Fonts CSS,
// download the woff2 files locally and emit a self-hosted fonts.css
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const css = readFileSync('gf.css', 'utf8');
const blocks = css.split('/*').slice(1).map((b) => '/*' + b);
const out = [];
let downloaded = 0;

for (const block of blocks) {
  const label = block.slice(2, block.indexOf('*/')).trim();
  if (label !== 'latin' && label !== 'latin-ext') continue;
  const body = block.slice(block.indexOf('*/') + 2);
  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
  const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
  const url = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
  if (!family || !url) continue;

  const slug = family.toLowerCase().replace(/\s+/g, '-');
  const file = `${slug}-${weight}-${label}.woff2`;
  if (!existsSync(file)) {
    execSync(`curl -s -o "${file}" "${url}"`);
    downloaded++;
  }
  out.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${file}') format('woff2');unicode-range:${range};}`);
}

writeFileSync('fonts.css', out.join('\n') + '\n');
console.log(`fonts.css written: ${out.length} faces, ${downloaded} files downloaded`);
