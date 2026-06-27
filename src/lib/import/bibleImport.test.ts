import { describe, expect, it } from 'vitest';

import { buildBookmarklet, parseImportHash, parseLoadout, pickArkGridCoresSlice } from './bibleImport';

// A REAL lostark.bible slice (Valslayer/NA, first 2 cores) captured from the live page — guards
// against the parser drifting from the actual site format.
const VALSLAYER_REAL =
  'arkGridCores:[{id:673005066,base:10001,gems:[{id:67401025,idx:0,costReduc:4,corePoints:5,opts:[{id:2002,level:3},{id:2001,level:4}]},{id:67401124,idx:1,costReduc:5,corePoints:5,opts:[{id:2003,level:3},{id:2011,level:2}]},{id:67401124,idx:2,costReduc:5,corePoints:4,opts:[{id:2003,level:3},{id:2001,level:3}]},{id:67401226,idx:3,costReduc:5,corePoints:4,opts:[{id:2003,level:5},{id:2012,level:5}]}]},{id:673015065,base:10002,gems:[{id:67401024,idx:0,costReduc:5,corePoints:5,opts:[{id:2002,level:3},{id:2001,level:2}]},{id:67401024,idx:1,costReduc:4,corePoints:5,opts:[{id:2011,level:3},{id:2002,level:3}]},{id:67401124,idx:2,costReduc:5,corePoints:5,opts:[{id:2011,level:1},{id:2003,level:2}]},{id:67401024,idx:3,costReduc:4,corePoints:5,opts:[{id:2011,level:2},{id:2001,level:4}]}]}]';

// A minimal lostark.bible page source: bare (unquoted) keys inside an `arkGridCores:[...]`
// literal, exactly as the live page embeds it (the parser must quote keys then JSON.parse).
// Gem ids encode type (id[3]: '0'=order) and cost (id[5]: shape%3 -> 8/9/10).
const BIBLE_SRC =
  'window.__d={foo:1,arkGridCores:[' +
  '{base:10001,gems:[{id:"100000000",idx:0,costReduc:1,corePoints:5,opts:[{id:2001,level:5},{id:2002,level:3}]}]},' +
  '{base:10005,gems:[{id:"100102000",idx:1,costReduc:0,corePoints:3,opts:[{id:2003,level:4},{id:2012,level:2}]}]}' +
  ']};';

// A lopec.kr (KR) RSC slice: use_13_<icon>.png + requiredWillpower + Korean effect names.
const LOPEC_SRC =
  '{"icon":"use_13_202.png","requiredWillpower":7,"orderChaosPoint":5,' +
  '"effects":[{"name":"공격력","level":5},{"name":"추가 피해","level":3}]}';

describe('parseLoadout (lostark.bible / global)', () => {
  it('maps an arkGridCores literal to ArkGridGem[]', () => {
    const r = parseLoadout(BIBLE_SRC)!;
    expect(r.source).toBe('lostark.bible');
    expect(r.gems).toEqual([
      {
        name: 'Order Astrogem: Stability',
        gemAttr: 'Order',
        req: 7, // baseCost 8 − costReduc 1
        point: 5,
        option1: { optionType: 'AtkPower', value: 5 },
        option2: { optionType: 'AddDamage', value: 3 },
      },
      {
        name: 'Chaos Astrogem: Destruction',
        gemAttr: 'Chaos',
        req: 10, // baseCost 10 − costReduc 0
        point: 3,
        option1: { optionType: 'BossDamage', value: 4 },
        option2: { optionType: 'BrandPower', value: 2 },
      },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('skips a gem with an unknown effect id and records a warning', () => {
    const src =
      'arkGridCores:[{base:10001,gems:[' +
      '{id:"100000000",idx:0,costReduc:0,corePoints:1,opts:[{id:9999,level:1},{id:2001,level:2}]}' +
      ']}]';
    const r = parseLoadout(src)!;
    expect(r.gems).toEqual([]);
    expect(r.warnings.some((w) => w.includes('9999'))).toBe(true);
  });
});

describe('parseLoadout (real lostark.bible data)', () => {
  it('maps a real 2-core Valslayer slice to 8 gems', () => {
    const r = parseLoadout(VALSLAYER_REAL)!;
    expect(r.source).toBe('lostark.bible');
    expect(r.gems.length).toBe(8); // 2 cores × 4 gems
    // First real gem: id 67401025 → Order, cost 8, costReduc 4 → req 4; AddDamage L3 + AtkPower L4.
    expect(r.gems[0]).toEqual({
      name: 'Order Astrogem: Stability',
      gemAttr: 'Order',
      req: 4,
      point: 5,
      option1: { optionType: 'AddDamage', value: 3 },
      option2: { optionType: 'AtkPower', value: 4 },
    });
    expect(r.warnings).toEqual([]);
  });

  it('recognizes a page with an EMPTY Ark Grid as a bible page with no gems (not an unrecognized page)', () => {
    // A character with no Ark Grid, OR a non-refreshed SvelteKit page, embeds `arkGridCores:[]`.
    const r = parseLoadout('<title>Valcroft (NA)</title> arkGridCores:[],type:"ark_passive",engravings:[]');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('lostark.bible');
    expect(r!.gems).toEqual([]);
  });
});

describe('pickArkGridCoresSlice (bookmarklet helper)', () => {
  it('picks the longest (populated) arkGridCores when an empty one precedes it', () => {
    const html =
      'x arkGridCores:[],type:"ark_passive" y arkGridCores:[{base:10001,gems:[{id:"1"}]}] z';
    expect(pickArkGridCoresSlice(html)).toBe('arkGridCores:[{base:10001,gems:[{id:"1"}]}]');
  });
  it('returns null when only an empty arkGridCores is present', () => {
    expect(pickArkGridCoresSlice('arkGridCores:[],type:"ark_passive"')).toBeNull();
    expect(pickArkGridCoresSlice('no markers here')).toBeNull();
  });
});

describe('parseLoadout (lopec.kr / KR)', () => {
  it('maps a KR loadout slice to ArkGridGem[]', () => {
    const r = parseLoadout(LOPEC_SRC)!;
    expect(r.source).toBe('lopec.kr');
    expect(r.region).toBe('KR');
    expect(r.gems).toEqual([
      {
        name: 'Order Astrogem: Stability',
        gemAttr: 'Order',
        req: 7, // requiredWillpower
        point: 5,
        option1: { optionType: 'AtkPower', value: 5 },
        option2: { optionType: 'AddDamage', value: 3 },
      },
    ]);
  });
});

describe('parseLoadout (rejects)', () => {
  it('returns null for text that is neither a bible nor a lopec page', () => {
    expect(parseLoadout('just some unrelated html')).toBeNull();
    expect(parseLoadout('')).toBeNull();
  });
});

describe('parseImportHash', () => {
  it('decodes a #import= payload to { src, region, name }', () => {
    const payload = { src: 'arkGridCores:[]', region: 'NA', name: 'Foo' };
    const hash = '#import=' + encodeURIComponent(JSON.stringify(payload));
    expect(parseImportHash(hash)).toEqual(payload);
  });
  it('returns null for an unrelated or malformed hash', () => {
    expect(parseImportHash('#section=triage')).toBeNull();
    expect(parseImportHash('#import=%7Bnot-json')).toBeNull();
    expect(parseImportHash('')).toBeNull();
  });
});

describe('buildBookmarklet', () => {
  it('re-fetches the viewed character URL (fresh, per-URL) and targets our origin', () => {
    const bm = buildBookmarklet('https://example.com/app/');
    expect(bm.startsWith('javascript:')).toBe(true);
    // Re-fetch the exact URL the user is viewing so the data can't be stale / a different character.
    expect(bm).toContain('fetch(location.href');
    expect(bm).toContain('arkGridCores:[');
    expect(bm).toContain('https://example.com/app/#import=');
  });
});
