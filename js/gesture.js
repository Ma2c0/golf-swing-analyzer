/**
 * Gesture detection module — wraps MediaPipe Hands for thumbs-up recognition.
 * Used to start/stop recording hands-free.
 */
const GestureModule = (() => {
  let hands = null;
  let latestHandResults = null;
  let onThumbsUpCallback = null;

  // Cooldown to prevent rapid toggling
  let lastThumbsUpTime = 0;
  const COOLDOWN_MS = 2000; // 2 seconds between thumb toggles

  // Require thumbs-up held for a brief moment to avoid false positives
  let thumbsUpStartTime = 0;
  const HOLD_MS = 500; // must hold for 500ms
  let thumbsUpFired = false; // prevent repeated fires during one hold

  /**
   * Initialize MediaPipe Hands.
   */
  async function init() {
    hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,       // lite model — fast on mobile
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });

    hands.onResults(onResults);

    // Warm up
    return new Promise((resolve) => {
      const dummy = document.createElement('canvas');
      dummy.width = 10;
      dummy.height = 10;
      hands.send({ image: dummy }).then(() => resolve());
    });
  }

  function onResults(results) {
    latestHandResults = results;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      // No hand detected — reset hold timer
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    const isThumbUp = detectThumbsUp(landmarks);

    if (isThumbUp) {
      const now = Date.now();
      if (thumbsUpStartTime === 0) {
        thumbsUpStartTime = now;
      }

      // Check if held long enough and cooldown passed
      if (!thumbsUpFired &&
          (now - thumbsUpStartTime) >= HOLD_MS &&
          (now - lastThumbsUpTime) >= COOLDOWN_MS) {
        thumbsUpFired = true;
        lastThumbsUpTime = now;
        if (onThumbsUpCallback) onThumbsUpCallback();
      }
    } else {
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
    }
  }

  /**
   * Detect thumbs-up gesture from hand landmarks.
   * 
   * Thumbs-up: thumb tip is significantly above thumb MCP,
   * and all other fingers are curled (tip below PIP joint).
   *
   * MediaPipe hand landmark indices:
   *  0: WRIST
   *  1: THUMB_CMC, 2: THUMB_MCP, 3: THUMB_IP, 4: THUMB_TIP
   *  5: INDEX_MCP, 6: INDEX_PIP, 7: INDEX_DIP, 8: INDEX_TIP
   *  9: MIDDLE_MCP, 10: MIDDLE_PIP, 11: MIDDLE_DIP, 12: MIDDLE_TIP
   * 13: RING_MCP, 14: RING_PIP, 15: RING_DIP, 16: RING_TIP
   * 17: PINKY_MCP, 18: PINKY_PIP, 19: PINKY_DIP, 20: PINKY_TIP
   */
  function detectThumbsUp(lm) {
    // In normalized coords, y=0 is top of image, y=1 is bottom.
    // "Above" means smaller y value.

    const thumbTip = lm[4];
    const thumbIP = lm[3];
    const thumbMCP = lm[2];

    // Thumb must be extended upward: tip above IP and MCP
    const thumbExtended = thumbTip.y < thumbIP.y && thumbIP.y < thumbMCP.y;
    if (!thumbExtended) return false;

    // The thumb tip should be meaningfully above the MCP
    const thumbExtension = thumbMCP.y - thumbTip.y;
    if (thumbExtension < 0.05) return false;

    // All other fingers should be curled: tip.y > pip.y (tip below PIP)
    const fingers = [
      { tip: lm[8],  pip: lm[6]  }, // index
      { tip: lm[12], pip: lm[10] }, // middle
      { tip: lm[16], pip: lm[14] }, // ring
      { tip: lm[20], pip: lm[18] }, // pinky
    ];

    let curledCount = 0;
    for (const f of fingers) {
      if (f.tip.y > f.pip.y) {
        curledCount++;
      }
    }

    // At least 3 of 4 fingers must be curled (some tolerance)
    return curledCount >= 3;
  }

  /**
   * Send a video frame for hand detection.
   */
  async function sendFrame(videoEl) {
    if (!hands) return;
    await hands.send({ image: videoEl });
  }

  /**
   * Set callback for thumbs-up detection.
   * Called once per thumbs-up gesture (with cooldown).
   */
  function onThumbsUp(cb) {
    onThumbsUpCallback = cb;
  }

  /**
   * Check if a thumbs-up is currently detected (for UI display).
   */
  function isThumbsUpNow() {
    if (!latestHandResults ||
        !latestHandResults.multiHandLandmarks ||
        latestHandResults.multiHandLandmarks.length === 0) {
      return false;
    }
    return detectThumbsUp(latestHandResults.multiHandLandmarks[0]);
  }

  /**
   * Reset cooldown (e.g., after transitioning screens).
   */
  function resetCooldown() {
    lastThumbsUpTime = 0;
    thumbsUpStartTime = 0;
    thumbsUpFired = false;
  }

  return {
    init,
    sendFrame,
    onThumbsUp,
    isThumbsUpNow,
    resetCooldown
  };
})();
