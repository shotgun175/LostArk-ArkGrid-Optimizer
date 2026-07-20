/**
 * Grey-Charge detector for the reroll button (pixel channel on top of the vendored parser).
 *
 * When free rerolls run out the game replaces the reroll pill with a "Charge" (paid reroll) button:
 * GOLD while a charge is available, DIM GREY once all are spent. The vendored structural parser reads
 * the gold "Charge" fine (its OCR lands "Charge" at high confidence) but misses the dim grey one, so it
 * falls back to constraintSnap's "unread rerolls -> full" default and the count wrongly resets to full.
 *
 * This detects the grey Charge from the two signals that separate it from a reroll pill, measured on
 * real 2K / 21:9 frames (reroll pill icon-zone brightness ~0.10-0.17, grey Charge ~0.007; bright Charge
 * gold-fraction ~0.20, everything else ~0):
 *   - a reroll pill always has a bright rotate icon in the LEFT of the button; the Charge button has none;
 *   - the grey Charge is not gold (that would be the bright Charge, which the parser already handles).
 * The button region is derived from the parser's source panel box, so it tracks resolution and window
 * position. Offsets are calibrated on a 2K / 21:9 capture; validate against other resolutions before
 * leaning on it broadly (the Processing modal scales uniformly, so panel-relative offsets should hold).
 */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
}
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The reroll/Charge button and its icon zone, as fractions of the source panel box (_srcPanel).
const BTN = { x: 0.815, y: 0.638, w: 0.129, h: 0.034 };
const ICON_FRAC = 0.27; // left share of the button that holds the reroll rotate-icon
const GOLD_FRAC_MIN = 0.1; // >= this share of gold pixels => it's the BRIGHT Charge (parser handles it)
const ICON_BRIGHT_MAX = 0.04; // < this share of bright icon-zone pixels => no reroll icon present

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const isGold = (r: number, g: number, b: number) => r > 140 && g > 100 && b < 110 && r - b > 45;

/**
 * True when the reroll button is the DIM GREY "Charge" (all rerolls spent) that the parser misreads,
 * i.e. a dark button with no reroll icon and no gold fill. False for reroll pills and the bright Charge.
 */
export function isGreyCharge(raster: Raster, panel: PanelRect): boolean {
  const W = raster.width;
  const H = raster.height;
  const d = raster.data;
  const bx = Math.round(panel.x + BTN.x * panel.w);
  const by = Math.round(panel.y + BTN.y * panel.h);
  const bw = Math.round(BTN.w * panel.w);
  const bh = Math.round(BTN.h * panel.h);
  if (bw < 6 || bh < 4 || bx < 0 || by < 0 || bx + bw > W || by + bh > H) return false;
  const iconW = Math.max(2, Math.round(bw * ICON_FRAC));
  let tot = 0;
  let gold = 0;
  let iconTot = 0;
  let iconBright = 0;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const s = ((by + j) * W + (bx + i)) * 4;
      const r = d[s];
      const g = d[s + 1];
      const b = d[s + 2];
      tot++;
      if (isGold(r, g, b)) gold++;
      if (i < iconW) {
        iconTot++;
        if (luma(r, g, b) > 75) iconBright++;
      }
    }
  }
  if (tot === 0 || iconTot === 0) return false;
  return gold / tot < GOLD_FRAC_MIN && iconBright / iconTot < ICON_BRIGHT_MAX;
}
