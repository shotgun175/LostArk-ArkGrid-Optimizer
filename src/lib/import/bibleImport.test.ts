import { describe, expect, it } from 'vitest';

import { ArkGridGemSpecs } from '../models/arkGridGemSpecs';
import { buildBookmarklet, parseImportHash, parseLoadout, pickArkGridCoresSlice } from './bibleImport';

// A REAL lostark.bible slice (Valslayer/NA, first 2 cores) captured from the live page — guards
// against the parser drifting from the actual site format.
const VALSLAYER_REAL =
  'arkGridCores:[{id:673005066,base:10001,gems:[{id:67401025,idx:0,costReduc:4,corePoints:5,opts:[{id:2002,level:3},{id:2001,level:4}]},{id:67401124,idx:1,costReduc:5,corePoints:5,opts:[{id:2003,level:3},{id:2011,level:2}]},{id:67401124,idx:2,costReduc:5,corePoints:4,opts:[{id:2003,level:3},{id:2001,level:3}]},{id:67401226,idx:3,costReduc:5,corePoints:4,opts:[{id:2003,level:5},{id:2012,level:5}]}]},{id:673015065,base:10002,gems:[{id:67401024,idx:0,costReduc:5,corePoints:5,opts:[{id:2002,level:3},{id:2001,level:2}]},{id:67401024,idx:1,costReduc:4,corePoints:5,opts:[{id:2011,level:3},{id:2002,level:3}]},{id:67401124,idx:2,costReduc:5,corePoints:5,opts:[{id:2011,level:1},{id:2003,level:2}]},{id:67401024,idx:3,costReduc:4,corePoints:5,opts:[{id:2011,level:2},{id:2001,level:4}]}]}]';

// A minimal lostark.bible page source: bare (unquoted) keys inside an `arkGridCores:[...]`
// literal, exactly as the live page embeds it (the parser must quote keys then JSON.parse).
// Gem ids encode type (id[3]: '0'=order) and cost (id[5]: shape%3 -> 8/9/10). These synthetic ids
// are outside the real 674xxxxx format, so the parser flags them (a note each) rather than trusting them.
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
    expect(r.notes.length).toBe(2); // the synthetic ids sit outside the 674 format, so each is flagged as a guess
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
    expect(r.notes).toEqual([]); // real 674 ids must stay quiet
  });

  it('recognizes a page with an EMPTY Ark Grid as a bible page with no gems (not an unrecognized page)', () => {
    // A character with no Ark Grid, OR a non-refreshed SvelteKit page, embeds `arkGridCores:[]`.
    const r = parseLoadout('<title>Valcroft (NA)</title> arkGridCores:[],type:"ark_passive",engravings:[]');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('lostark.bible');
    expect(r!.gems).toEqual([]);
  });
});

describe('parseLoadout (lostark.bible gem-id families)', () => {
  // lostark.bible effect ids.
  const ADD = 2002;
  const ATK = 2001;
  const BOSS = 2003;
  const ALLYD = 2011;
  const BRAND = 2012;
  const ALLYA = 2013;
  // Real ids off live lostark.bible character pages (2026-09-16), with the cost and type the site
  // itself draws. The 18 "674" rows are every distinct id in a 1,060-gem sample; the four 4062117x
  // rows are the fixed 5/5/5/5 event gems that appeared on 2026-09-16, which the id-digit rule reads
  // as 9-cost Chaos (they are 8-cost: 173/74 Order, 175/76 Chaos).
  const CASES: [string, number, number, number, 'Order' | 'Chaos'][] = [
    ['67401024', ADD, BRAND, 8, 'Order'],
    ['67401025', ADD, ATK, 8, 'Order'],
    ['67401026', ADD, ALLYD, 8, 'Order'],
    ['67401124', ALLYD, BOSS, 9, 'Order'],
    ['67401125', ATK, BOSS, 9, 'Order'],
    ['67401126', ATK, BOSS, 9, 'Order'],
    ['67401224', ADD, BOSS, 10, 'Order'],
    ['67401225', ALLYA, BRAND, 10, 'Order'],
    ['67401226', ADD, BOSS, 10, 'Order'],
    ['67411324', ADD, BRAND, 8, 'Chaos'],
    ['67411325', ADD, ATK, 8, 'Chaos'],
    ['67411326', ALLYD, BRAND, 8, 'Chaos'],
    ['67411424', ATK, BOSS, 9, 'Chaos'],
    ['67411425', ALLYD, BOSS, 9, 'Chaos'],
    ['67411426', ALLYA, ALLYD, 9, 'Chaos'],
    ['67411524', ALLYA, BRAND, 10, 'Chaos'],
    ['67411525', BOSS, BRAND, 10, 'Chaos'],
    ['67411526', ALLYA, BOSS, 10, 'Chaos'],
    ['40621173', ATK, ADD, 8, 'Order'],
    ['40621174', BRAND, ALLYD, 8, 'Order'],
    ['40621175', ATK, ADD, 8, 'Chaos'],
    ['40621176', BRAND, ALLYD, 8, 'Chaos'],
  ];
  const gemLiteral = (id: string, e1: number, e2: number) =>
    `{id:${id},idx:0,costReduc:0,corePoints:5,opts:[{id:${e1},level:5},{id:${e2},level:5}]}`;
  const page = (gems: string[]) => `arkGridCores:[{id:673001226,base:10002,gems:[${gems.join(',')}]}]`;

  it('reads every known id (674 family + the 2026-09-16 event gems) at the cost and type lostark.bible draws', () => {
    const r = parseLoadout(page(CASES.map(([id, e1, e2]) => gemLiteral(id, e1, e2))))!;
    expect(r.gems.length).toBe(CASES.length);
    CASES.forEach(([id, , , cost, attr], i) => {
      const gem = r.gems[i];
      expect(gem.gemAttr, id).toBe(attr);
      expect(gem.req, id).toBe(cost); // costReduc 0, so req is the base cost
      expect(gem.name, id).toBeDefined();
      expect(ArkGridGemSpecs[gem.name!].req, id).toBe(cost);
      expect(ArkGridGemSpecs[gem.name!].attr, id).toBe(attr);
    });
    expect(r.warnings).toEqual([]);
  });

  it('notes an id-table correction and stays quiet on an ordinary 674 gem', () => {
    const r = parseLoadout(page([gemLiteral('40621173', ATK, ADD), gemLiteral('67401025', ADD, ATK)]))!;
    expect(r.gems.length).toBe(2);
    expect(r.warnings).toEqual([]);
    expect(r.notes.length).toBe(1);
    expect(r.notes[0]).toContain('40621173');
  });

  it('repairs an unknown id from the effect pools when the pair fits exactly one cost, and says so', () => {
    // The digits read 9-cost Chaos; Boss Damage + Additional Damage only sit together in the 10-cost pool.
    const r = parseLoadout(page([gemLiteral('99999199', BOSS, ADD)]))!;
    expect(r.gems.length).toBe(1);
    expect(r.gems[0].req).toBe(10);
    expect(r.gems[0].gemAttr).toBe('Chaos');
    expect(r.gems[0].name).toBe('Chaos Astrogem: Destruction');
    expect(r.notes).toEqual([
      expect.stringContaining('99999199 is not in the known 674xxxxx format'),
      'gem id 99999199 reads as 9-cost, but Boss Damage + Additional Damage only fit the 10-cost pool; read as 10-cost',
    ]);
  });

  it('flags an unknown id format but leaves a cost whose pool already holds the pair alone', () => {
    // Boss Damage + Ally Attack Enh. sit in the 9-cost pool the digits point at, so nothing needs repair.
    const r = parseLoadout(page([gemLiteral('40621171', BOSS, ALLYA)]))!;
    expect(r.gems.length).toBe(1);
    expect(r.gems[0].req).toBe(9);
    expect(r.gems[0].gemAttr).toBe('Chaos');
    expect(r.notes).toEqual([expect.stringContaining('40621171 is not in the known 674xxxxx format')]);
  });

  it('leaves the id-derived cost alone, and says so, when the pair fits two pools but not that one', () => {
    // Digits read 8-cost Order; Boss Damage + Ally Attack Enh. sit in the 9- AND 10-cost pools, never the 8,
    // so there is nothing to repair with and the id keeps the last word.
    const r = parseLoadout(page([gemLiteral('99909000', BOSS, ALLYA)]))!;
    expect(r.gems.length).toBe(1);
    expect(r.gems[0].req).toBe(8);
    expect(r.gems[0].gemAttr).toBe('Order');
    expect(r.gems[0].name).toBe('Order Astrogem: Stability');
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([
      expect.stringContaining('99909000 is not in the known 674xxxxx format'),
      'gem id 99909000 reads as 8-cost, but no single pool holds Boss Damage + Ally Attack Enh.; cost left as derived',
    ]);
  });

  it('skips a gem whose id has no cost digit with a warning, not a note', () => {
    const r = parseLoadout(page([gemLiteral('12', ATK, ADD), gemLiteral('67401025', ADD, ATK)]))!;
    expect(r.gems.length).toBe(1);
    expect(r.warnings).toEqual(['could not derive cost from gem id 12']);
    expect(r.notes).toEqual([]);
  });

  it('applies the same pool check to a lopec.kr gem whose icon disagrees with its effects', () => {
    // Icon 203 draws a 9-cost Order gem, but Additional Damage + Atk. Power only fit an 8-cost.
    const src =
      '{"icon":"use_13_203.png","requiredWillpower":7,"orderChaosPoint":5,' +
      '"effects":[{"name":"추가 피해","level":3},{"name":"공격력","level":5}]}';
    const r = parseLoadout(src)!;
    expect(r.gems.length).toBe(1);
    expect(r.gems[0].name).toBe('Order Astrogem: Stability');
    expect(r.gems[0].req).toBe(7); // requiredWillpower is the actual cost, untouched by the repair
    expect(r.notes).toEqual([
      'gem icon 203 reads as 9-cost, but Additional Damage + Atk. Power only fit the 8-cost pool; read as 8-cost',
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('leaves a lopec.kr cost alone, and says so, when the pair fits two pools but not the icon cost', () => {
    // Icon 202 draws an 8-cost Order gem; Boss Damage + Ally Attack Enh. only sit in the 9- and 10-cost pools.
    const src =
      '{"icon":"use_13_202.png","requiredWillpower":8,"orderChaosPoint":4,' +
      '"effects":[{"name":"보스 피해","level":2},{"name":"아군 공격 강화","level":3}]}';
    const r = parseLoadout(src)!;
    expect(r.gems.length).toBe(1);
    expect(r.gems[0].name).toBe('Order Astrogem: Stability');
    expect(r.gems[0].req).toBe(8);
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([
      'gem icon 202 reads as 8-cost, but no single pool holds Boss Damage + Ally Attack Enh.; cost left as derived',
    ]);
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
