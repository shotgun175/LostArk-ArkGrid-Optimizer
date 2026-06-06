import type { OpenCV } from '@opencvjs/types';

declare global {
  interface Window {
    cv?: typeof OpenCV;
    debug: any;
  }
}

export {};
