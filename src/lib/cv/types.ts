import CV from '@techstark/opencv-js';

import type { ArkGridAttr, GemRecognitionLocale } from '../constants/enums';
import type { ArkGridGem } from '../models/arkGridGems';

export type CvMat = CV.Mat;
export type CvRect = CV.Rect;
export type CvPoint = CV.Point;

/** Per-attribute owned counts read from the in-game "Astrogems Owned" footer (count-checksum). */
export interface OwnedCount {
  order: number | null;
  chaos: number | null;
}

// main → worker
export type CaptureWorkerRequest =
  | { type: 'init'; scaleHints?: Record<string, number> } // init worker (optionally seeded with persisted per-resolution UI scales)
  | { type: 'frame'; frame: VideoFrame; drawDebug: boolean; detectionMargin: number } // send frame
  | { type: 'image'; bitmap: ImageBitmap; detectionMargin: number } // recognize a single uploaded/pasted screenshot
  | { type: 'reset' } // clear cached anchor location + scale (force fresh detection)
  | { type: 'stop' };

// worker → main
export type CaptureWorkerResponse =
  | { type: 'init:done' }
  | { type: 'init:error' }
  | {
      type: 'frame:done';
      result:
        | {
            locale: GemRecognitionLocale;
            gemAttr: ArkGridAttr;
            gems: ArkGridGem[];
            owned: OwnedCount | null;
          }
        | undefined;
    }
  | {
      type: 'image:done';
      result:
        | {
            locale: GemRecognitionLocale;
            gemAttr: ArkGridAttr;
            gems: ArkGridGem[];
            owned: OwnedCount | null;
          }
        | undefined;
    }
  | { type: 'error'; error: WorkerError }
  | { type: 'debug'; image?: ImageBitmap; message?: string }
  | { type: 'scale:measured'; key: string; scale: number } // a freshly measured per-resolution UI scale to persist
  | { type: 'scale:drop'; key: string }; // a persisted scale that no longer locates the anchor; forget it

export type WorkerError = {
  message: string;
  stack?: string;
  name?: string;
};
