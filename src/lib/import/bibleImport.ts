// Client-side import of a lostark.bible (global) or lopec.kr (KR) loadout.
//
// lostark.bible IP-blocks server-side fetchers and sends no CORS header, so a static app
// can't fetch a character itself. But the gem data sits in the page's own SOURCE — an
// `arkGridCores:[{...}]` JS object literal (lostark.bible) or a Next.js RSC payload
// (lopec.kr). So the USER brings the source over (paste, a dropped .html, or a one-click
// bookmarklet that redirects with the data in the URL hash) and we parse it right here —
// no server, no network.
//
// The site-format decoding (effect-id map, gem-id digit rules, the arkGridCores bracket
// scan, the lopec regex) is re-implemented in TypeScript from shizukaziye's
// astrogem-calculator (worker/astrogem-bible.js + bible-import.js, MIT). Attribution is in
// the app footer. We map each gem straight onto our canonical ArkGridGem shape.
import type { ArkGridAttr } from '../constants/enums';
import type { ArkGridGem, ArkGridGemOption } from '../models/arkGridGems';
import { type ArkGridGemName, type ArkGridGemOptionName, ArkGridGemSpecs } from '../models/arkGridGemSpecs';

export interface ImportResult {
  source: 'lostark.bible' | 'lopec.kr';
  region: string | null;
  name: string | null;
  itemLevel: number | null;
  className: string | null;
  gems: ArkGridGem[];
  warnings: string[];
}

// lostark.bible effect id -> our option enum.
const EFFECT_ID_TO_OPTION: Record<number, ArkGridGemOptionName> = {
  2001: 'AtkPower',
  2002: 'AddDamage',
  2003: 'BossDamage',
  2011: 'AllyDamageEnh',
  2012: 'BrandPower',
  2013: 'AllyAttackEnh',
};

// lopec.kr (Korean) effect name -> our option enum.
const KR_EFFECT_TO_OPTION: Record<string, ArkGridGemOptionName> = {
  '추가 피해': 'AddDamage',
  공격력: 'AtkPower',
  '보스 피해': 'BossDamage',
  '아군 공격 강화': 'AllyAttackEnh',
  '아군 피해 강화': 'AllyDamageEnh',
  낙인력: 'BrandPower',
};

// (attr, baseCost) -> spec name, so an imported gem carries a name (drives its image + grade).
const SPEC_BY_ATTR_COST = new Map<string, ArkGridGemName>();
for (const [name, spec] of Object.entries(ArkGridGemSpecs)) {
  SPEC_BY_ATTR_COST.set(`${spec.attr}_${spec.req}`, name as ArkGridGemName);
}
function specName(attr: ArkGridAttr, baseCost: number): ArkGridGemName | undefined {
  return SPEC_BY_ATTR_COST.get(`${attr}_${baseCost}`);
}

// Gem id digits: id[5] (shape) -> base cost 8/9/10; id[3] === '0' -> Order, else Chaos.
function costFromGemId(idStr: string): number | null {
  const shape = parseInt(idStr[5], 10);
  if (!Number.isFinite(shape)) return null;
  return 8 + (shape % 3);
}
function attrFromGemId(idStr: string): ArkGridAttr {
  return idStr[3] === '0' ? 'Order' : 'Chaos';
}

interface RawCore {
  base?: number;
  gems?: unknown;
}

// Pull every `arkGridCores:[ ... ]` array out of the page (one per loadout preset). Prefer the
// raid loadout (the equipped grid); fall back to whichever preset actually has gems.
function extractArkGridCores(html: string): RawCore[] | null {
  const marker = 'arkGridCores:[';
  const occ: { at: number; cores: RawCore[] }[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    const start = at + 'arkGridCores:'.length; // points at the '['
    let depth = 0;
    let end = -1;
    for (let k = start; k < html.length; k++) {
      const c = html[k];
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          end = k + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    const literal = html.slice(start, end);
    // The page embeds bare (unquoted) keys; quote them so it parses as JSON.
    const jsonish = literal.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    try {
      const parsed = JSON.parse(jsonish);
      if (Array.isArray(parsed)) occ.push({ at, cores: parsed });
    } catch {
      // not valid after quoting — skip this occurrence
    }
    from = end;
  }
  if (!occ.length) return null;

  const gemCount = (cores: RawCore[]) =>
    cores.reduce((n, core) => n + (Array.isArray(core?.gems) ? core.gems.length : 0), 0);
  const afterClass = (cls: string): RawCore[] | null => {
    const at = html.indexOf(`classification:"${cls}"`);
    if (at === -1) return null;
    const o = occ.find((x) => x.at > at);
    return o && gemCount(o.cores) > 0 ? o.cores : null;
  };

  let raid = afterClass('most_recent_raid');
  if (!raid) {
    let best = occ[0];
    for (const o of occ) if (gemCount(o.cores) > gemCount(best.cores)) best = o;
    raid = gemCount(best.cores) > 0 ? best.cores : null;
  }
  return raid;
}

function optionFromBible(
  o: { id?: number; level?: number } | undefined,
  idStr: string,
  warnings: string[]
): ArkGridGemOption | null {
  if (!o || o.id == null) {
    warnings.push(`gem ${idStr}: missing effect`);
    return null;
  }
  const optionType = EFFECT_ID_TO_OPTION[Number(o.id)];
  if (!optionType) {
    warnings.push(`unknown effect id ${o.id} on gem ${idStr}`);
    return null;
  }
  return { optionType, value: Number(o.level) || 0 };
}

interface RawGem {
  id?: string | number;
  costReduc?: number;
  corePoints?: number;
  opts?: { id?: number; level?: number }[];
}

function mapBibleGem(rawGem: RawGem, warnings: string[]): ArkGridGem | null {
  const idStr = String(rawGem?.id ?? '');
  const baseCost = costFromGemId(idStr);
  if (baseCost == null) {
    warnings.push(`could not derive cost from gem id ${idStr}`);
    return null;
  }
  const attr = attrFromGemId(idStr);
  const opts = Array.isArray(rawGem.opts) ? rawGem.opts : [];
  const option1 = optionFromBible(opts[0], idStr, warnings);
  const option2 = optionFromBible(opts[1], idStr, warnings);
  if (!option1 || !option2) return null;
  return {
    name: specName(attr, baseCost),
    gemAttr: attr,
    req: baseCost - (Number(rawGem.costReduc) || 0),
    point: Number(rawGem.corePoints) || 0,
    option1,
    option2,
  };
}

function coresToGems(cores: RawCore[], warnings: string[]): ArkGridGem[] {
  const gems: ArkGridGem[] = [];
  for (const core of cores) {
    const rawGems = Array.isArray(core?.gems) ? (core.gems as RawGem[]) : [];
    for (const rg of rawGems) {
      const g = mapBibleGem(rg, warnings);
      if (g) gems.push(g);
    }
  }
  return gems;
}

// lopec.kr stores gems in a Next.js RSC payload. Icon use_13_(202..207) encodes cost+attr;
// requiredWillpower IS the actual willpower cost; effects carry Korean names + levels.
function parseLopecGems(html: string, warnings: string[]): ArkGridGem[] {
  const u = html.replace(/\\"/g, '"');
  const gemRe =
    /use_13_(\d+)\.png","requiredWillpower":(\d+),"orderChaosPoint":(\d+),"effects":\[(.*?)\]\}/g;
  const gems: ArkGridGem[] = [];
  let m: RegExpExecArray | null;
  while ((m = gemRe.exec(u)) !== null) {
    const icon = parseInt(m[1], 10);
    const rel = icon - 202;
    if (rel < 0 || rel > 5) {
      warnings.push(`unexpected gem icon ${icon}`);
      continue;
    }
    const baseCost = 8 + (rel % 3);
    const attr: ArkGridAttr = rel < 3 ? 'Order' : 'Chaos';
    const opts: ArkGridGemOption[] = [];
    const effRe = /\{"name":"([^"]*)","level":(\d+)/g;
    let e: RegExpExecArray | null;
    while ((e = effRe.exec(m[4])) !== null) {
      const optionType = KR_EFFECT_TO_OPTION[e[1]];
      if (!optionType) {
        warnings.push(`unknown KR effect '${e[1]}'`);
        continue;
      }
      opts.push({ optionType, value: parseInt(e[2], 10) });
    }
    if (opts.length < 2) {
      warnings.push(`gem icon ${icon}: fewer than 2 known effects`);
      continue;
    }
    gems.push({
      name: specName(attr, baseCost),
      gemAttr: attr,
      req: parseInt(m[2], 10),
      point: parseInt(m[3], 10),
      option1: opts[0],
      option2: opts[1],
    });
  }
  return gems;
}

const CLASS_NAMES = [
  'Berserker', 'Destroyer', 'Gunlancer', 'Paladin', 'Slayer', 'Valkyrie', 'Arcanist', 'Summoner',
  'Bard', 'Sorceress', 'Wardancer', 'Scrapper', 'Soulfist', 'Glaivier', 'Striker', 'Breaker',
  'Deathblade', 'Shadowhunter', 'Reaper', 'Souleater', 'Sharpshooter', 'Deadeye', 'Artillerist',
  'Machinist', 'Gunslinger', 'Aeromancer', 'Wildsoul', 'Artist', 'Guardianknight',
];
const KR_CLASS: Record<string, string> = {
  버서커: 'Berserker', 디스트로이어: 'Destroyer', 워로드: 'Gunlancer', 홀리나이트: 'Paladin',
  슬레이어: 'Slayer', 발키리: 'Valkyrie', 아르카나: 'Arcanist', 서머너: 'Summoner', 바드: 'Bard',
  소서리스: 'Sorceress', 배틀마스터: 'Wardancer', 인파이터: 'Scrapper', 기공사: 'Soulfist',
  창술사: 'Glaivier', 스트라이커: 'Striker', 브레이커: 'Breaker', 블레이드: 'Deathblade',
  데모닉: 'Shadowhunter', 리퍼: 'Reaper', 소울이터: 'Souleater', 헌터: 'Sharpshooter',
  데빌헌터: 'Deadeye', 블래스터: 'Artillerist', 스카우터: 'Machinist', 건슬링어: 'Gunslinger',
  도화가: 'Artist', 기상술사: 'Aeromancer', 환수사: 'Wildsoul', 가디언나이트: 'Guardianknight',
};

function parseMeta(html: string, isKR: boolean): { itemLevel: number | null; className: string | null } {
  let itemLevel: number | null = null;
  let className: string | null = null;
  if (isKR) {
    const u = html.replace(/\\"/g, '"');
    const lvls: number[] = [];
    const re = /"itemLevel":\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(u)) !== null) lvls.push(parseInt(m[1], 10));
    if (lvls.length) itemLevel = Math.round(lvls.reduce((a, b) => a + b, 0) / lvls.length);
    const re2 = /"class":"([^"]+)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = re2.exec(u)) !== null) {
      if (KR_CLASS[cm[1]]) {
        className = KR_CLASS[cm[1]];
        break;
      }
    }
  } else {
    const im = html.match(/ilvl:(\d+)/);
    if (im) itemLevel = parseInt(im[1], 10);
    const re = /bg-neutral-900 px-2 py-1 text-sm">([^<]+)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (CLASS_NAMES.indexOf(m[1]) !== -1) {
        className = m[1];
        break;
      }
    }
  }
  return { itemLevel, className };
}

// Best-effort region/name from a dropped/pasted page that carries no explicit hint.
function regionNameFromHtml(html: string): { region: string | null; name: string | null } {
  let m = html.match(/(?:<title>|og:title"\s+content=")\s*([^()|<]+?)\s*\(([A-Za-z]{2,4})\)/);
  if (m) {
    let region = m[2].toUpperCase();
    if (region === 'CE') region = 'EU';
    return { region, name: m[1].trim() };
  }
  m = html.match(/\/character\/([A-Za-z]{2,4})\/([^"'<>\\\s/?#]+)/);
  if (m) {
    let region = m[1].toUpperCase();
    if (region === 'CE') region = 'EU';
    let name = m[2];
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep raw
    }
    return { region, name };
  }
  m = html.match(/lopec\.kr\/character\/specPoint\/([^"'<>\\\s/?#]+)/);
  if (m) {
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep raw
    }
    return { region: 'KR', name };
  }
  return { region: null, name: null };
}

/**
 * Parse a lostark.bible / lopec.kr page source (or the bookmarklet's arkGridCores slice) into
 * our ArkGridGem list. `hint` is an optional { region, name } the bookmarklet reads from the URL.
 * Returns null only when the text is neither a recognized bible nor lopec page.
 */
export function parseLoadout(
  text: string,
  hint?: { region?: string | null; name?: string | null }
): ImportResult | null {
  if (!text || typeof text !== 'string') return null;
  const isKR = /use_13_\d+\.png/.test(text) && text.indexOf('requiredWillpower') !== -1;
  const isBible = text.indexOf('arkGridCores:[') !== -1;
  if (!isBible && !isKR) return null;

  const warnings: string[] = [];
  let gems: ArkGridGem[] = [];
  let source: ImportResult['source'];
  let isKrPage = false;
  if (isBible) {
    // A recognized bible page with an empty/missing Ark Grid (a character with none, or a
    // not-yet-refreshed SvelteKit page) yields no cores. Return a recognized result with no gems
    // rather than null, so the UI can guide the user (refresh) instead of "not a character page".
    const cores = extractArkGridCores(text);
    gems = cores ? coresToGems(cores, warnings) : [];
    source = 'lostark.bible';
  } else {
    gems = parseLopecGems(text, warnings);
    source = 'lopec.kr';
    isKrPage = true;
  }

  const meta = parseMeta(text, isKrPage);
  const rn = hint?.region ? { region: hint.region, name: hint.name ?? null } : regionNameFromHtml(text);
  return {
    source,
    region: rn.region ?? (isKrPage ? 'KR' : null),
    name: hint?.name ?? rn.name ?? null,
    itemLevel: meta.itemLevel,
    className: meta.className,
    gems,
    warnings,
  };
}

const IMPORT_HASH_PREFIX = '#import=';

/** Decode a `#import=<encoded {src,region,name}>` hash (set by the bookmarklet). */
export function parseImportHash(
  hash: string
): { src: string; region: string | null; name: string | null } | null {
  if (!hash || !hash.startsWith(IMPORT_HASH_PREFIX)) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(hash.slice(IMPORT_HASH_PREFIX.length)));
    if (!obj || typeof obj.src !== 'string') return null;
    return { src: obj.src, region: obj.region ?? null, name: obj.name ?? null };
  } catch {
    return null;
  }
}

/**
 * Pick the LONGEST (i.e. populated) `arkGridCores:[...]` literal out of a page's HTML, returning
 * it with its marker prefix (`arkGridCores:[...]`), or null if only an empty `arkGridCores:[]`
 * (e.g. the unrelated ark-passive block) or none is present. lostark.bible pages can carry several
 * `arkGridCores:[` occurrences — an empty one plus the real loadout — so picking the first is wrong.
 */
export function pickArkGridCoresSlice(html: string): string | null {
  const k = 'arkGridCores:[';
  let best = '';
  let from = 0;
  for (;;) {
    const a = html.indexOf(k, from);
    if (a < 0) break;
    const s = a + k.length - 1; // points at the '['
    let depth = 0;
    let end = -1;
    for (let i = s; i < html.length; i++) {
      const c = html[i];
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    const slice = html.slice(s, end);
    if (slice.length > best.length) best = slice;
    from = end;
  }
  return best.length > 2 ? 'arkGridCores:' + best : null;
}

/**
 * Build the one-click bookmarklet for the given app URL. lostark.bible is a SvelteKit SPA: when you
 * click between characters its URL updates but the OLD character's `arkGridCores` literal stays in
 * the live DOM — so reading the DOM can silently grab the wrong (stale) character. To make it always
 * correct, the bookmarklet instead:
 *   1. reads the character identity from the URL path (/character/REGION/NAME — the source of truth),
 *   2. re-fetches that exact URL (same-origin, fresh SSR for THAT character), and
 *   3. scrapes the populated `arkGridCores` from the fetched HTML, then hands off via our #import= hash.
 * Data and name are both anchored to the same URL, so a mismatch is impossible. No refresh needed.
 * (KR / lopec.kr users use paste or drop instead.)
 */
export function buildBookmarklet(appUrl: string): string {
  const target = JSON.stringify(appUrl + IMPORT_HASH_PREFIX);
  const body =
    '(function(){' +
    "var pp=location.pathname.split('/'),ci=pp.indexOf('character');" +
    "if(ci<0||!pp[ci+2]){alert('Open a lostark.bible character page first (lostark.bible/character/REGION/NAME).');return;}" +
    "var region=pp[ci+1].toUpperCase();if(region=='CE')region='EU';var name=decodeURIComponent(pp[ci+2]);" +
    "fetch(location.href,{credentials:'include'}).then(function(r){return r.text();}).then(function(h){" +
    "var k='arkGridCores:[',f=0,best='';" +
    'for(;;){var a=h.indexOf(k,f);if(a<0)break;' +
    "var s=a+k.length-1,p=0,e=-1;for(var i=s;i<h.length;i++){var c=h[i];if(c=='[')p++;else if(c==']'){p--;if(!p){e=i+1;break;}}}" +
    'if(e<0)break;var sl=h.slice(s,e);if(sl.length>best.length)best=sl;f=e;}' +
    "if(best.length<=2){alert('No Ark Grid is equipped for '+name+' on lostark.bible. Open a character that has one and click again.');return;}" +
    'var u=' +
    target +
    ";location.href=u+encodeURIComponent(JSON.stringify({src:'arkGridCores:'+best,region:region,name:name}));" +
    "}).catch(function(err){alert('Could not read the lostark.bible page: '+err);});" +
    '})();';
  return 'javascript:' + body;
}
