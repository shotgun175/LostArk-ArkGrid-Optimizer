import { describe, expect, it } from 'vitest';

import { parseLevelDigit, snapEffect } from './vocab';

describe('snapEffect (en_us)', () => {
  it('reads a clean effect line', () => {
    expect(snapEffect('Additional Damage Lv. 3', 'en_us')).toEqual({ optionType: 'AddDamage', value: 3 });
    expect(snapEffect('Atk. Power Lv. 4', 'en_us')).toEqual({ optionType: 'AtkPower', value: 4 });
    expect(snapEffect('Ally Damage Enh. Lv. 1', 'en_us')).toEqual({ optionType: 'AllyDamageEnh', value: 1 });
    expect(snapEffect('Ally Attack Enh. Lv. 5', 'en_us')).toEqual({ optionType: 'AllyAttackEnh', value: 5 });
    expect(snapEffect('Boss Damage Lv. 2', 'en_us')).toEqual({ optionType: 'BossDamage', value: 2 });
    expect(snapEffect('Brand Power Lv. 5', 'en_us')).toEqual({ optionType: 'BrandPower', value: 5 });
  });

  it('recovers from OCR slips on the first character / punctuation', () => {
    // The crop sometimes clips the leading glyph (A->\, B->3) — nearest-match must still win.
    expect(snapEffect('\\dditional Damage Lv. 3', 'en_us')).toEqual({ optionType: 'AddDamage', value: 3 });
    expect(snapEffect('3rand Power Lv. 4', 'en_us')).toEqual({ optionType: 'BrandPower', value: 4 });
    expect(snapEffect('ALK. Power Lv. 4', 'en_us')).toEqual({ optionType: 'AtkPower', value: 4 });
    expect(snapEffect('\\lly Damage Enh. Lv. 5', 'en_us')).toEqual({ optionType: 'AllyDamageEnh', value: 5 });
  });

  it('constrains the snap to a gem’s allowed options when provided', () => {
    // "Ally ..." is ambiguous between AllyDamageEnh / AllyAttackEnh; the allowed set disambiguates.
    const allowed = ['AtkPower', 'AddDamage', 'BrandPower', 'AllyDamageEnh'] as const;
    expect(snapEffect('Ally  Enh. Lv. 2', 'en_us', allowed as unknown as string[])?.optionType).toBe('AllyDamageEnh');
  });

  it('returns null when nothing is close enough', () => {
    expect(snapEffect('', 'en_us')).toBeNull();
    expect(snapEffect('xyzzy qux', 'en_us')).toBeNull();
  });
});

describe('parseLevelDigit', () => {
  it('extracts the level from an effect line', () => {
    expect(parseLevelDigit('Additional Damage Lv. 3')).toBe(3);
    expect(parseLevelDigit('Brand Power Lv.5')).toBe(5);
    expect(parseLevelDigit('Atk. Power lv 1')).toBe(1);
  });
  it('rejects out-of-range or missing levels', () => {
    expect(parseLevelDigit('Additional Damage')).toBeNull();
    expect(parseLevelDigit('Additional Damage Lv. 9')).toBeNull();
    expect(parseLevelDigit('Additional Damage Lv. 0')).toBeNull();
  });
});
