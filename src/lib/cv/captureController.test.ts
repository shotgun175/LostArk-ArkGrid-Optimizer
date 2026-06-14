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
