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
  | { type: 'init' } // init worker
  | {
      type: 'frame';
      frame: VideoFrame;
      drawDebug: boolean;
      detectionMargin: number;
      forcedNonStandard: boolean;
    } // send frame
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
  | { type: 'image:progress'; fraction: number } // 0..1 progress of the in-flight upload recognition
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
  | { type: 'debug'; image?: ImageBitmap; message?: string };

export type WorkerError = {
  message: string;
  stack?: string;
  name?: string;
};
