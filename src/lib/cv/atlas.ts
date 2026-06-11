import { getCv } from './cvRuntime';
import type { CvMat } from './types';

export interface AtlasEntry {
  x: number; // x coordinate within the atlas
  width: number; // width
  height: number; // height
  template: CvMat; // source template
}

export interface MatchingAtlas<K extends string> {
  atlas: CvMat;
  entries: Record<K, AtlasEntry>;
}

export function generateMatchingAtlas<const M extends Record<string, CvMat>>(mats: M) {
  // The input is a Record<string, CvMat>, generalized here as M
  // The returned entries is a Record whose keys we assure the type system are the input's keys
  const cv = getCv();

  const entries = {} as Record<keyof M, AtlasEntry>;

  // Match all heights to the tallest one
  const maxHeight = Math.max(...Object.values(mats).map((mat) => mat.rows));

  let xOffset = 0;
  const paddedMats: CvMat[] = [];
  const matVector = new cv.MatVector();

  for (const key of Object.keys(mats) as (keyof M)[]) {
    const mat = mats[key];
    let padded: CvMat;

    // Add padding if the height differs
    if (mat.rows < maxHeight) {
      const bottom = maxHeight - mat.rows;
      padded = new cv.Mat();
      cv.copyMakeBorder(
        mat,
        padded,
        0,
        bottom,
        0,
        0,
        cv.BORDER_CONSTANT,
        new cv.Scalar(0, 0, 0, 0)
      );
    } else {
      padded = mat;
    }

    paddedMats.push(padded);
    matVector.push_back(padded);

    entries[key] = {
      x: xOffset,
      width: mat.cols,
      height: mat.rows,
      template: mat,
    };

    xOffset += padded.cols;
  }

  // Build the atlas
  const atlas = new cv.Mat();
  cv.hconcat(matVector, atlas);

  // Clean up the Mats newly created for padding
  for (const m of paddedMats) {
    if (!Object.values(mats).includes(m)) {
      m.delete();
    }
  }
  matVector.delete();

  return { atlas, entries };
}
