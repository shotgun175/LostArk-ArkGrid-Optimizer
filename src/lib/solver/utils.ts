import type { GemSetPack } from './models';

function stepwiseCorePoint(v: number) {
  if (v >= 17) return 17;
  if (v >= 14) return 14;
  if (v >= 10) return 10;
  return 0;
}

export function gemSetPackKey(gsp: GemSetPack | null): [number, number, number] {
  return gsp
    ? [
        gsp.gs1 ? stepwiseCorePoint(gsp.gs1.point) : 0,
        gsp.gs2 ? stepwiseCorePoint(gsp.gs2.point) : 0,
        gsp.gs3 ? stepwiseCorePoint(gsp.gs3.point) : 0,
      ]
    : [0, 0, 0];
}
