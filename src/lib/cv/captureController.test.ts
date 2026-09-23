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

  it('stops the share on Stop even when no further frame ever arrives', async () => {
    const { c, trackStopped, onStopCalled } = makeRecordingController();
    // A static shared window: read() pends until the reader is cancelled.
    let endRead: (r: { value: undefined; done: true }) => void = () => {};
    c.reader = {
      read: () => new Promise((resolve) => (endRead = resolve)),
      cancel: () => (endRead({ value: undefined, done: true }), Promise.resolve()),
    };

    const looping = c.loop();
    await c.stopCapture();

    expect(await settlesWithin(looping)).toBe(true);
    await flushMicrotasks();
    expect(c.state).toBe('idle');
    expect(trackStopped()).toBe(true);
    expect(onStopCalled()).toBe(true);
    expect(c.reader).toBeNull();
  });
});

// True if the promise settles before a short timer fires; false if it is still pending (a hang).
async function settlesWithin(p: Promise<unknown>, ms = 50): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  const settled = p.then(
    () => true as const,
    () => true as const
  );
  const result = await Promise.race([settled, timedOut]);
  clearTimeout(timer);
  return result;
}

// A fake worker that answers image requests with an empty result.
function fakeCaptureWorker(c: any) {
  const w = {
    terminated: false,
    postMessage(msg: { type: string }) {
      if (msg.type === 'image')
        queueMicrotask(() =>
          c.handleWorkerMessage({
            data: { type: 'image:done', result: { gemAttr: 'Order', gems: [], owned: null } },
          })
        );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

describe('capture worker load failure and init sharing', () => {
  it('drops a worker that failed before init so the next call loads a fresh one', async () => {
    const c = new CaptureController() as any;
    const dead = fakeCaptureWorker(c);
    c.worker = dead;
    c.workerInitialized = false;

    // The chunk failed to load: one error event, nothing pending.
    c.handleWorkerError({ message: 'failed to load' });

    expect(c.worker).toBeNull();
    expect(dead.terminated).toBe(true);

    // The retry builds a new worker, which answers init:done.
    c.createWorker = () => {
      const fresh = fakeCaptureWorker(c);
      const post = fresh.postMessage;
      fresh.postMessage = (msg: { type: string }) => {
        post(msg);
        if (msg.type === 'init')
          queueMicrotask(() => c.handleWorkerMessage({ data: { type: 'init:done' } }));
      };
      return fresh;
    };
    const bitmap = { close() {} } as unknown as ImageBitmap;
    const pending = c.recognizeImage(bitmap);

    expect(await settlesWithin(pending)).toBe(true);
    await expect(pending).resolves.toEqual({ gemAttr: 'Order', gems: [], owned: null });
  });

  it('keeps an initialized worker on a later error', () => {
    const c = new CaptureController() as any;
    const live = fakeCaptureWorker(c);
    c.worker = live;
    c.workerInitialized = true;

    c.handleWorkerError({ message: 'transient' });

    expect(c.worker).toBe(live);
    expect(live.terminated).toBe(false);
  });

  it.each([
    ['startCapture first', true],
    ['recognizeImage first', false],
  ])(
    'settles both startCapture and recognizeImage started before init:done (%s)',
    async (_, captureFirst) => {
      const c = new CaptureController() as any;
      c.worker = fakeCaptureWorker(c);
      c.workerInitialized = false;
      let reads = 0;
      c.requestDisplayMedia = async () => {
        c.track = { stop() {} };
        c.reader = {
          // One frame to prove the share is live, then the stream ends so the loop tears down.
          read: () =>
            Promise.resolve(
              reads++ === 0
                ? { value: { close() {} }, done: false }
                : { value: undefined, done: true }
            ),
          cancel: () => Promise.resolve(),
        };
      };
      const bitmap = { close() {} } as unknown as ImageBitmap;

      let capture: Promise<void>;
      let image: Promise<unknown>;
      if (captureFirst) {
        capture = c.startCapture();
        image = c.recognizeImage(bitmap);
      } else {
        image = c.recognizeImage(bitmap);
        capture = c.startCapture();
      }
      c.handleWorkerMessage({ data: { type: 'init:done' } });

      expect(await settlesWithin(capture)).toBe(true);
      expect(await settlesWithin(image)).toBe(true);
      await expect(image).resolves.toEqual({ gemAttr: 'Order', gems: [], owned: null });
    }
  );
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
