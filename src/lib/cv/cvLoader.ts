let loading: Promise<void> | null = null;

export function loadOpenCV(): Promise<void> {
  // Guarantees window.cv exists and is usable.
  // Tried returning cv directly, but that didn't work well.
  /*
  Takeaway:

  Depending on the build, the cv object may be a Promise or a plain Object.
  In the @techstark/opencv-js package used here, cv itself is a Promise (thenable object).
  So calling resolve(cv) makes the Promise treat it as "another Promise" and try to call cv.then().
  If cv.then() isn't implemented properly, it hangs in the pending state forever.
  */
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('browser only'));
  }

  if (window.cv) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.min.js';
    script.async = true;

    script.onload = () => {
      if (!window.cv) {
        loading = null;
        reject(new Error('Failed to load OpenCV: cv not exist on window'));
        return;
      }
      window.cv.onRuntimeInitialized = () => {
        resolve();
      };
    };

    script.onerror = () => {
      loading = null; // reset on failure
      document.body.removeChild(script); // remove the failed script
      reject(new Error('Failed to load OpenCV'));
    };

    document.body.appendChild(script);
  });

  return loading;
}
