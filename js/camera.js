/**
 * Camera module — handles camera access, recording, and frame capture.
 *
 * Designed for Down-the-Line (DTL) golf swing recording:
 *  - Uses the rear-facing camera (facingMode: 'environment').
 *  - Tries to pick an ultra-wide lens when the device exposes one,
 *    so the whole body fits without standing impractically far back.
 *  - Supports wide (0.5×) when the lens supports native zoom < 1×,
 *    in addition to 1×–3× tele zoom.
 *  - No mirror flip — DTL footage should be true left/right.
 */
const CameraModule = (() => {
  let stream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingStartTime = 0;
  let timerInterval = null;

  // Zoom
  const ZOOM_STEP = 0.25;
  let ZOOM_MIN = 1.0;        // may drop to 0.5 if ultra-wide is available
  const ZOOM_MAX = 3.0;
  let currentZoom = 1.0;
  let nativeZoomOk = false;
  let nativeMin = 1, nativeMax = 1;
  let vTrack = null;

  // Ultra-wide device handling
  let ultraWideDeviceId = null;     // preferred ultra-wide back camera (if found)
  let usingUltraWide = false;        // true when we have switched to the ultra-wide stream
  let ultraWideAvailable = false;    // true if either a UW device or native zoom <1× exists

  // Front/back facing
  let currentFacing = 'user';        // default to front (per user spec)
  function getFacing() { return currentFacing; }

  /**
   * Request rear-facing camera access (DTL).
   * Tries to use an ultra-wide lens when one is exposed.
   * @returns {Promise<MediaStream>}
   */
  async function init() {
    // Try the preferred facing first, then fall back to the other one.
    // Default preferred = 'user' (front).
    const tryFacing = async (facing) => {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
    };
    try {
      try {
        stream = await tryFacing(currentFacing);
      } catch (err) {
        // Permission errors should not silently retry on the other camera.
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          throw err;
        }
        // OverconstrainedError / NotFoundError / etc — try the opposite camera.
        const alt = currentFacing === 'user' ? 'environment' : 'user';
        stream = await tryFacing(alt);
        currentFacing = alt;
      }

      // After permission is granted, probe for a dedicated ultra-wide lens.
      await probeUltraWide();
      return stream;
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        throw new Error('Camera permission denied. Please allow camera access and try again.');
      }
      throw new Error('Could not access camera: ' + err.message);
    }
  }

  /**
   * Switch between user (front) and environment (back) cameras. Returns the
   * new facing string on success.
   */
  async function toggleFacing(videoEl) {
    const target = currentFacing === 'user' ? 'environment' : 'user';
    return await setFacing(target, videoEl);
  }

  async function setFacing(facing, videoEl) {
    if (facing !== 'user' && facing !== 'environment') return currentFacing;
    if (facing === currentFacing && stream) return currentFacing;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = newStream;
      currentFacing = facing;
      usingUltraWide = false;
      currentZoom = 1.0;
      // Re-probe ultra-wide for the new facing (front normally has none).
      ultraWideDeviceId = null;
      ultraWideAvailable = false;
      await probeUltraWide();
      detectZoom();
      if (videoEl) {
        videoEl.srcObject = stream;
        try { await videoEl.play(); } catch (_) {}
      }
      return currentFacing;
    } catch (err) {
      console.warn('setFacing failed:', err);
      return currentFacing;
    }
  }

  /**
   * Look through enumerated video inputs for an ultra-wide back lens.
   * Sets `ultraWideDeviceId` and `ultraWideAvailable` for later use.
   * Front cameras rarely have ultra-wide — we only probe when on 'environment'.
   */
  async function probeUltraWide() {
    // Skip entirely for the front camera (per user spec: hide UW when no UW lens)
    if (currentFacing !== 'environment') {
      ultraWideDeviceId = null;
      ultraWideAvailable = false;
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      const re = /(ultra[\s-]?wide|0\.?5x|wide angle|wideangle|超广角)/i;
      const front = /front|user|self/i;
      const candidate = cams.find(d => re.test(d.label) && !front.test(d.label));
      if (candidate) {
        ultraWideDeviceId = candidate.deviceId;
        ultraWideAvailable = true;
      }
    } catch (_) {
      // enumerateDevices not available / blocked — ignore.
    }
  }

  /**
   * Attach stream to a video element.
   */
  function attachToVideo(videoEl) {
    if (!stream) throw new Error('Camera not initialized');
    videoEl.srcObject = stream;
  }

  /**
   * Switch to the ultra-wide back lens (if available).
   * Returns true on success.
   */
  async function useUltraWide(videoEl) {
    if (!ultraWideDeviceId || usingUltraWide) return usingUltraWide;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: ultraWideDeviceId },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      // Stop the old stream
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = newStream;
      if (videoEl) {
        videoEl.srcObject = stream;
        try { await videoEl.play(); } catch (_) {}
      }
      usingUltraWide = true;
      currentZoom = 1.0;
      detectZoom();
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Switch back to the default rear-facing camera.
   * Returns true on success.
   */
  async function useDefaultBack(videoEl) {
    if (!usingUltraWide) return true;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = newStream;
      if (videoEl) {
        videoEl.srcObject = stream;
        try { await videoEl.play(); } catch (_) {}
      }
      usingUltraWide = false;
      currentZoom = 1.0;
      detectZoom();
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Toggle between ultra-wide and default back lens.
   * Returns the new state: true if now using ultra-wide.
   */
  async function toggleUltraWide(videoEl) {
    if (usingUltraWide) {
      await useDefaultBack(videoEl);
      return false;
    }
    // Prefer a dedicated UW device when available.
    if (ultraWideDeviceId) {
      return await useUltraWide(videoEl);
    }
    // Otherwise, if the current lens exposes native zoom <1, drop to its min.
    if (nativeZoomOk && nativeMin < 1) {
      currentZoom = Math.max(0.5, +(nativeMin).toFixed(2));
      ZOOM_MIN = currentZoom;
      try {
        await vTrack.applyConstraints({ advanced: [{ zoom: nativeMin }] });
      } catch (_) {}
      return true; // pseudo-wide via native min
    }
    return false;
  }

  function isUltraWide() { return usingUltraWide; }
  function hasUltraWide() { return ultraWideAvailable || (nativeZoomOk && nativeMin < 1); }

  /**
   * Start recording.
   */
  function startRecording(onTimerUpdate) {
    if (!stream) throw new Error('Camera not initialized');
    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();

    let mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start(100);

    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (onTimerUpdate) onTimerUpdate(`${mins}:${secs}`);
    }, 250);
  }

  /**
   * Stop recording.
   * @returns {Promise<Blob>} recorded video blob
   */
  function stopRecording() {
    return new Promise((resolve) => {
      isRecording = false;
      clearInterval(timerInterval);

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
          resolve(blob);
        };
        mediaRecorder.stop();
      } else {
        resolve(null);
      }
    });
  }

  /**
   * Stop all tracks and release camera.
   */
  function destroy() {
    isRecording = false;
    clearInterval(timerInterval);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function getStream() { return stream; }
  function getIsRecording() { return isRecording; }

  /* ── Zoom ── */
  function detectZoom() {
    if (!stream) return;
    vTrack = stream.getVideoTracks()[0];
    if (!vTrack) return;
    nativeZoomOk = false;
    nativeMin = 1; nativeMax = 1;
    try {
      const caps = vTrack.getCapabilities ? vTrack.getCapabilities() : {};
      if (caps.zoom) {
        nativeZoomOk = true;
        nativeMin = caps.zoom.min;
        nativeMax = caps.zoom.max;
        // If the lens supports sub-1× zoom natively, allow it.
        if (nativeMin < 1) ZOOM_MIN = Math.max(0.5, +(nativeMin).toFixed(2));
        else ZOOM_MIN = 1.0;
      }
    } catch (_) {}
  }

  function setZoom(level) {
    currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(level).toFixed(2)));
    if (nativeZoomOk && vTrack) {
      // Map our currentZoom range onto the native zoom range.
      const range = (ZOOM_MAX - ZOOM_MIN) || 1;
      const ratio = (currentZoom - ZOOM_MIN) / range;
      vTrack.applyConstraints({ advanced: [{ zoom: nativeMin + ratio * (nativeMax - nativeMin) }] }).catch(() => {});
    } else {
      // CSS fallback: only scales >1× meaningfully (no real wider FOV from CSS).
      const vid = document.getElementById('camera-feed');
      const cvs = document.getElementById('pose-overlay');
      const scale = Math.max(1, currentZoom);
      if (vid) vid.style.transform = 'scale(' + scale + ')';
      if (cvs) cvs.style.transform = 'scale(' + scale + ')';
    }
    return currentZoom;
  }

  function zoomIn()  { return setZoom(currentZoom + ZOOM_STEP); }
  function zoomOut() { return setZoom(currentZoom - ZOOM_STEP); }
  function getZoom() { return currentZoom; }
  function getZoomMin() { return ZOOM_MIN; }
  function getZoomMax() { return ZOOM_MAX; }

  function resetZoom() {
    currentZoom = ZOOM_MIN;
    if (nativeZoomOk && vTrack)
      vTrack.applyConstraints({ advanced: [{ zoom: nativeMin }] }).catch(() => {});
    const vid = document.getElementById('camera-feed');
    const cvs = document.getElementById('pose-overlay');
    if (vid) vid.style.transform = '';
    if (cvs) cvs.style.transform = '';
  }

  return {
    init,
    toggleFacing,
    setFacing,
    getFacing,
    attachToVideo,
    startRecording,
    stopRecording,
    destroy,
    getStream,
    getIsRecording,
    detectZoom,
    setZoom,
    zoomIn,
    zoomOut,
    getZoom,
    getZoomMin,
    getZoomMax,
    resetZoom,
    useUltraWide,
    useDefaultBack,
    toggleUltraWide,
    isUltraWide,
    hasUltraWide,
    get ZOOM_MIN() { return ZOOM_MIN; },
    ZOOM_MAX
  };
})();
