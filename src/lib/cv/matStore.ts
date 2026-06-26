/**
 * Fetch the sprite image once, then build cv.Mat objects from it.
 */
import {
  type ArkGridAttr,
  type GemRecognitionLocale,
  supportedGemRecognitionLocales,
} from '../constants/enums';
import { type ArkGridGemName, type ArkGridGemOptionName } from '../models/arkGridGems';
import { type EnUsTemplateName, enUsCoords, enUsFileName } from '../opencv-template-coords/en_us';
import { type KoKrTemplateName, koKrCoords, koKrFileName } from '../opencv-template-coords/ko_kr';
import { type RuRuTemplateName, ruRuCoords, ruRuFileName } from '../opencv-template-coords/ru_ru';
import { type MatchingAtlas, generateMatchingAtlas } from './atlas';
import { getCv } from './cvRuntime';
import type { CvMat } from './types';

export type KeyWillPower = '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type KeyCorePoint = '1' | '2' | '3' | '4' | '5';
export type KeyOptionString = ArkGridGemOptionName;
export type KeyOptionLevel = '1' | '2' | '3' | '4' | '5';
export type KeyGemAttr = ArkGridAttr;
export type KeyGemName = ArkGridGemName;

/**
 * Decode a sprite (by its `public/` file name) into a grayscale Mat. Pluggable so the Node-side
 * accuracy harness can supply a filesystem + PNG decoder in place of the browser fetch path below.
 */
export type SpriteDecoder = (fileName: string) => Promise<CvMat>;

async function fetchSpriteMat(url: string): Promise<CvMat> {
  // Read the image at the url, then convert it to a Mat
  const cv = getCv();
  const img = await createImageBitmap(await fetch(url).then((r) => r.blob()));
  const off = new OffscreenCanvas(img.width, img.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('Canvas context creation failed');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const mat = cv.matFromImageData(data);
  cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY);
  img.close();
  return mat;
}

// Default (browser) sprite decoder: fetch from public/ via Vite's BASE_URL. Referenced lazily so
// `import.meta.env` is never evaluated when the harness injects its own decoder under plain Node.
const browserSpriteDecoder: SpriteDecoder = (fileName) =>
  fetchSpriteMat(`${import.meta.env.BASE_URL}/${fileName}`);

type GemTemplates = {
  ko_kr: Record<KoKrTemplateName, CvMat>;
  en_us: Record<EnUsTemplateName, CvMat>;
  ru_ru: Record<RuRuTemplateName, CvMat>;
};
async function loadGemTemplates(decode: SpriteDecoder): Promise<GemTemplates> {
  const cv = getCv();
  // Crop the images out of each language's sprite.
  const result = {
    ko_kr: {} as any,
    en_us: {} as any,
    ru_ru: {} as any,
  };

  const koSprite = await decode(koKrFileName);
  for (const [name, rect] of Object.entries(koKrCoords)) {
    result.ko_kr[name] = koSprite.roi(new cv.Rect(rect.x, rect.y, rect.w, rect.h));
  }
  koSprite.delete();

  const enSprite = await decode(enUsFileName);
  for (const [name, rect] of Object.entries(enUsCoords)) {
    result.en_us[name] = enSprite.roi(new cv.Rect(rect.x, rect.y, rect.w, rect.h));
  }
  enSprite.delete();

  const ruSprite = await decode(ruRuFileName);
  for (const [name, rect] of Object.entries(ruRuCoords)) {
    result.ru_ru[name] = ruSprite.roi(new cv.Rect(rect.x, rect.y, rect.w, rect.h));
  }
  ruSprite.delete();

  return result;
}

export async function loadGemAsset(decode: SpriteDecoder = browserSpriteDecoder) {
  const gt = await loadGemTemplates(decode);

  const matAnchors = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      acc[locale] = gt[locale]['anchor.png'];
      return acc;
    },
    {} as Record<GemRecognitionLocale, CvMat>
  );
  const atlasAnchor = generateMatchingAtlas(matAnchors);

  const atlasGemAttr = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        Order: mats['order.png'],
        Chaos: mats['chaos.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<ArkGridAttr>>
  );

  const atlasWillPower = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        3: mats['3.png'],
        4: mats['4.png'],
        5: mats['5.png'],
        6: mats['6.png'],
        7: mats['7.png'],
        8: mats['8.png'],
        9: mats['9.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<KeyWillPower>>
  );

  const atlasCorePoint = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        1: mats['1.png'],
        2: mats['2.png'],
        3: mats['3.png'],
        4: mats['4.png'],
        5: mats['5.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<KeyCorePoint>>
  );

  const atlasGemImage = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        'Order Astrogem: Stability': mats['stability.png'],
        'Order Astrogem: Solidity': mats['solidity.png'],
        'Order Astrogem: Immutability': mats['immutability.png'],
        'Chaos Astrogem: Corrosion': mats['corrosion.png'],
        'Chaos Astrogem: Distortion': mats['distortion.png'],
        'Chaos Astrogem: Destruction': mats['destruction.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<KeyGemName>>
  );

  const atlasOptionName = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        AtkPower: mats['atk-power.png'],
        AddDamage: mats['additional-damage.png'],
        BossDamage: mats['boss-damage.png'],
        BrandPower: mats['brand-power.png'],
        AllyAttackEnh: mats['ally-attack-enh.png'],
        AllyDamageEnh: mats['ally-damage-enh.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<KeyOptionString>>
  );

  const atlasOptionLevel = supportedGemRecognitionLocales.reduce(
    (acc, locale) => {
      const mats = gt[locale];
      acc[locale] = generateMatchingAtlas({
        1: mats['lv1.png'],
        2: mats['lv2.png'],
        3: mats['lv3.png'],
        4: mats['lv4.png'],
        5: mats['lv5.png'],
      });
      return acc;
    },
    {} as Record<GemRecognitionLocale, MatchingAtlas<KeyOptionLevel>>
  );

  return {
    atlasAnchor,
    atlasGemAttr,
    atlasGemImage,
    atlasWillPower,
    atlasCorePoint,
    atlasOptionName,
    atlasOptionLevel,
  };
}
