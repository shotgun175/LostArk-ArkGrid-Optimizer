// Cannot be initialized via window.cv
// Use only inside a worker
import cvModule from '@techstark/opencv-js';
import type { CV } from '@techstark/opencv-js';

let cvInstance: CV | null = null; //singleton

export async function initOpenCv(): Promise<void> {
  if (cvInstance) return;

  // @techstark/opencv-js's default export may ALREADY be initialized by the time we get
  // here (notably inside a worker, where the module finishes loading before the first
  // init message arrives). When that happens, onRuntimeInitialized never fires again, so
  // detect readiness directly instead of waiting on the callback (which would hang).
  if (typeof cvModule.Mat === 'function') {
    cvInstance = cvModule;
    return;
  }
  // Not yet ready: wait for the runtime-initialized callback.
  // NOTE: do NOT `await cvModule` — its default export exposes a non-resolving `then`,
  // so awaiting it hangs forever.
  await new Promise<void>((resolve) => {
    cvModule.onRuntimeInitialized = resolve;
  });
  cvInstance = cvModule;
}

export function getCv(): CV {
  if (!cvInstance) {
    throw new Error('OpenCV not initialized. Call initOpenCv() first.');
  }
  return cvInstance;
}
