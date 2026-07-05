import { describe, expect, it } from 'vitest';

import { CaptureController } from './captureController';

// loop() and the session fields are private; tests reach them via `any` to
// drive the recording state machine without a real screen-capture session.
function makeRecordingController() {
  const c = new CaptureController() as any;
  c.state = 'recording';
  let trackStopped = false;
  c.track = {
    stop: () => {
      trackStopped = true;
    },
  };
  let onStopCalled = false;
  c.onStop = () => {
    onStopCalled = true;
  };
  c.worker = { postMessage() {} };
  return { c, trackStopped: () => trackStopped, onStopCalled: () => onStopCalled };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('capture loop teardown', () => {
  it('tears down normally when the stream reports done', async () => {
    const { c, trackStopped, onStopCalled } = makeRecordingController();
    c.reader = { read: () => Promise.resolve({ value: undefined, done: true }) };

    await c.loop();
    await flushMicrotasks();

    expect(c.state).toBe('idle');
    expect(trackStopped()).toBe(true);
    expect(onStopCalled()).toBe(true);
  });

  it('tears down when reader.read() rejects mid-session', async () => {
    const { c, trackStopped, onStopCalled } = makeRecordingController();
    c.reader = { read: () => Promise.reject(new Error('track failure')) };

    await c.loop(); // must not throw — a rejection here strands the recorder
    await flushMicrotasks();

    expect(c.state).toBe('idle');
    expect(trackStopped()).toBe(true);
    expect(onStopCalled()).toBe(true);
  });

  it('tears down when the reader is missing', async () => {
    const { c, trackStopped, onStopCalled } = makeRecordingController();
    c.reader = null;

    await c.loop();
    await flushMicrotasks();

    expect(c.state).toBe('idle');
    expect(trackStopped()).toBe(true);
    expect(onStopCalled()).toBe(true);
  });
});

describe('capture worker error recovery', () => {
  it('resolves a pending recognizeImage() to null on a worker error instead of hanging', async () => {
    const c = new CaptureController() as any;
    c.worker = { postMessage() {} }; // fake so recognizeImage skips creating a real Worker
    c.workerInitialized = true; // skip re-init so it goes straight to the image request
    const bitmap = { close() {} } as unknown as ImageBitmap;

    const pending = c.recognizeImage(bitmap);
    // Simulate a hard worker crash: no image:done is ever posted.
    c.handleWorkerError({ message: 'worker crashed' });

    await expect(pending).resolves.toBeNull();
  });

  it('settles a pending init reject and frame lock on a worker error', () => {
    const c = new CaptureController() as any;
    let initRejected: string | null = null;
    c.awaitWorkerInitialization = { resolve: () => {}, reject: (r: string) => (initRejected = r) };
    let frameReleased = false;
    c.awaitFrameCompletion = () => (frameReleased = true);

    c.handleWorkerError({ message: 'boom' });

    expect(initRejected).toBe('worker-init-failed');
    expect(frameReleased).toBe(true);
    expect(c.awaitWorkerInitialization).toBeNull();
    expect(c.awaitFrameCompletion).toBeNull();
  });
});

describe('startCapture failure teardown', () => {
  it('stops and releases the screen share when init fails after permission was granted', async () => {
    const c = new CaptureController() as any;
    c.worker = { postMessage() {} }; // fake so startCapture skips creating a real Worker
    let stopped = false;
    let readerCancelled = false;
    // Permission granted: requestDisplayMedia sets a live track + reader before init fails.
    c.requestDisplayMedia = async () => {
      c.track = { stop: () => (stopped = true) };
      c.reader = { cancel: () => ((readerCancelled = true), Promise.resolve()) };
    };

    const p = c.startCapture();
    // The worker's init rejects after the screen share was already granted.
    c.awaitWorkerInitialization.reject('worker-init-failed');
    await p;

    // The granted stream must be stopped (indicator clears) and the fields cleared for a clean retry.
    expect(stopped).toBe(true);
    expect(readerCancelled).toBe(true);
    expect(c.track).toBeNull();
    expect(c.reader).toBeNull();
    expect(c.state).toBe('idle');
  });
});
