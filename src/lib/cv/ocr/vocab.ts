// Snap raw OCR text onto the fixed, tiny gem vocabulary — the layer that turns "good-but-imperfect
// OCR" into reliable structured data. There are only 6 effect names and levels 1-5, so a nearest-match
// (normalized Levenshtein) against the canonical labels recovers from the OCR slips template-matching
// can't tolerate (clipped first glyph, A->\, B->3, etc.). When a gem's allowed options are known the
// match is constrained to them, which also disambiguates "Ally Damage Enh." vs "Ally Attack Enh.".
import { type GemRecognitionLocale } from '../../constants/enums';
import {
  ArkGridGemOptionNames,
  ArkGridGemOptionTypes,
  type ArkGridGemOptionName,
} from '../../models/arkGridGemSpecs';

export interface SnappedOption {
  optionType: ArkGridGemOptionName;
  value: number;
}

/** Lowercase + drop everything but a-z0-9 so punctuation/spacing/case never affect the match. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const labelOf = (key: ArkGridGemOptionName, locale: GemRecognitionLocale): string => {
  const name = ArkGridGemOptionTypes[key].name as Partial<Record<GemRecognitionLocale, string>>;
  return name[locale] ?? name.en_us ?? '';
};

/** Pull the option level (1-5) out of an OCR'd effect line ("... Lv. 3"); null if absent/out of range. */
export function parseLevelDigit(text: string): number | null {
  const m = text.match(/lv\.?\s*([0-9]+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 5 ? n : null;
}

/** Largest normalized edit distance still treated as a match (above this, reject as unrecognized). */
const MAX_NORM_DISTANCE = 0.5;

/**
 * Snap one OCR'd effect line to {optionType, level}. `allowed` (a gem's availableOptions) constrains
 * the candidate set when known. Returns null when no candidate is close enough or the level is missing.
 */
export function snapEffect(
  text: string,
  locale: GemRecognitionLocale,
  allowed?: readonly string[]
): SnappedOption | null {
  const level = parseLevelDigit(text);
  if (level == null) return null;
  // Name part = text with the trailing "Lv. N ..." removed.
  const namePart = text.replace(/lv\.?\s*[0-9].*$/i, '');
  const norm = normalize(namePart);
  if (!norm) return null;

  const allowSet = allowed && allowed.length ? new Set(allowed) : null;
  const candidates = ArkGridGemOptionNames.filter((k) => !allowSet || allowSet.has(k));

  let best: ArkGridGemOptionName | null = null;
  let bestDist = Infinity;
  for (const key of candidates) {
    const ln = normalize(labelOf(key, locale));
    const d = levenshtein(norm, ln) / Math.max(norm.length, ln.length);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  if (!best || bestDist > MAX_NORM_DISTANCE) return null;
  return { optionType: best, value: level };
}

/** Parse a bare digit string (willpower/points) into an int within [min,max]; null otherwise. */
export function parseBoundedDigit(text: string, min: number, max: number): number | null {
  const m = text.match(/[0-9]+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= min && n <= max ? n : null;
}
