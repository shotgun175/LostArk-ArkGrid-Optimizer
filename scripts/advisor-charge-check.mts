/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- dev diagnostic; loads gitignored fixtures + pngjs (untyped)
/*
 * Dev-only check (NOT shipped, NOT a CI gate): validate the grey-Charge detector against the captured
 * reroll-sequence fixtures. Expects TRUE only for the dim all-spent Charge frame.
 *   npx tsx scripts/advisor-charge-check.mts
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { isGreyCharge } from '../src/lib/advisor/chargeDetect';

function raster(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

const rerollPanel = { x: 902, y: 181, w: 759, h: 908 };
const cases = [
  ['reroll-2of2', rerollPanel, false],
  ['reroll-1of2', rerollPanel, false],
  ['reroll-0of2', rerollPanel, false],
  ['reroll-charge', rerollPanel, true],
  ['chaos-corrosion-support-2of9', { x: 903, y: 181, w: 758, h: 907 }, false],
];

let allOk = true;
for (const [name, panel, expected] of cases) {
  const got = isGreyCharge(raster(`Reference Projects/advisor-fixtures/${name}.png`), panel);
  const ok = got === expected;
  if (!ok) allOk = false;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(32)} greyCharge=${got} (expected ${expected})`);
}
console.log(allOk ? '\nALL PASS' : '\nFAILURES');
process.exit(allOk ? 0 : 1);
