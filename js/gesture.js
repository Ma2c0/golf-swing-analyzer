/**
 * Gesture detection module — wraps MediaPipe Hands for thumbs-up recognition.
 * Used to start/stop recording hands-free.
 * 
 * Supports both left and right hand thumbs-up, and works with mirrored
 * front-facing camera feeds.
 */
const GestureModule = (() => {
  let hands = null;
  let latestHandResults = null;
  let onThumbsUpCallback = null;
  let debugMode = true; // show debug info in console

  // Cooldown to prevent rapid toggling
  let lastThumbsUpTime = 0;
  const COOLDOWN_MS = 1500; // 1.5 seconds between thumb toggles

  // Require thumbs-up held for a brief moment to avoid false positives
  let thumbsUpStartTime = 0;
  const HOLD_MS = 400; // must hold for 400ms (reduced from 500)
  let thumbsUpFired = false; // prevent repeated fires during one hold

  // Track detection state for UI feedback
  let handDetected = false;
  let thumbDetected = false;
  let onStateChangeCallback = null;

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
      modelComplexity: 1,       // full model for better accuracy
      minDetectionConfidence: 0.5,  // lowered for easier detection
      minTrackingConfidence: 0.4
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

    const prevHandDetected = handDetected;
    const prevThumbDetected = thumbDetected;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      handDetected = false;
      thumbDetected = false;
      thumbsUpStartTime = 0;
      thumbsUpFired = false;

      if (prevHandDetected !== handDetected || prevThumbDetected !== thumbDetected) {
        if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
      }
      return;
    }

    handDetected = true;
    const landmarks = results.multiHandLandmarks[0];
    const handedness = results.multiHandedness && results.multiHandedness[0]
      ? results.multiHandedness[0].label
      : 'Unknown';

    const isThumbUp = detectThumbsUp(landmarks, handedness);
    thumbDetected = isThumbUp;

    if (debugMode) {
      logDebug(landmarks, handedness, isThumbUp);
    }

    if (prevHandDetected !== handDetected || prevThumbDetected !== thumbDetected) {
      if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
    }

    if (isThumbUp) {
      const now = Date.now();
      if (thumbsUpStartTime === 0) {
        thumbsUpStartTime = now;
        if (debugMode) console.log('👍 Thumbs-up hold started');
      }

      const holdDuration = now - thumbsUpStartTime;
      const cooldownOk = (now - lastThumbsUpTime) >= COOLDOWN_MS;

      if (!thumbsUpFired && holdDuration >= HOLD_MS && cooldownOk) {
        thumbsUpFired = true;
        lastThumbsUpTime = now;
        console.log('✅ THUMBS-UP TRIGGERED!');
        if (onThumbsUpCallback) onThumbsUpCallback();
      } else if (debugMode && !thumbsUpFired) {
        if (!cooldownOk) {
          console.log(`⏳ Cooldown: ${Math.round(COOLDOWN_MS - (now - lastThumbsUpTime))}ms remaining`);
        } else {
          console.log(`⏳ Holding: ${holdDuration}/${HOLD_MS}ms`);
        }
      }
    } else {
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
    }
  }

  /**
   * Debug logging for gesture detection.
   */
  function logDebug(lm, handedness, isThumbUp) {
    const thumbTip = lm[4];
    const thumbIP = lm[3];
    const thumbMCP = lm[2];
    const wrist = lm[0];

    const fingers = [
      { name: 'index',  tip: lm[8],  pip: lm[6]  },
      { name: 'middle', tip: lm[12], pip: lm[10] },
      { name: 'ring',   tip: lm[16], pip: lm[14] },
      { name: 'pinky',  tip: lm[20], pip: lm[18] },
    ];

    const curled = fingers.filter(f => f.tip.y > f.pip.y).map(f => f.name);
    const thumbUp = thumbTip.y < thumbMCP.y;

    console.log(
      `🖐 Hand: ${handedness} | Thumb up: ${thumbUp} (tip.y=${thumbTip.y.toFixed(3)} mcp.y=${thumbMCP.y.toFixed(3)}) | ` +
      `Curled: [${curled.join(',')}] (${curled.length}/4) | Result: ${isThumbUp ? '👍' : '✋'}`
    );
  }

  /**
   * Detect thumbs-up gesture from hand landmarks.
   * 
   * Works for both left and right hands, and accounts for the fact that
   * front camera feeds may be mirrored.
   *
   * Detection criteria (relaxed for real-world use):
   * 1. Thumb tip is above thumb MCP (extended upward)
   * 2. At least 2 of 4 other fingers are curled
   */
  function detectThumbsUp(lm, handedness) {
    // In normalized coords, y=0 is top of image, y=1 is bottom.
    // "Above" means smaller y value.

    const thumbTip = lm[4];
    const thumbIP = lm[3];
    const thumbMCP = lm[2];
    const wrist = lm[0];

    // --- Criterion 1: Thumb must be pointing upward ---
    // Thumb tip should be above (lower y) than thumb MCP
    const thumbPointingUp = thumbTip.y < thumbMCP.y;
    if (!thumbPointingUp) return false;

    // Thumb should have meaningful extension (tip well above MCP)
    const thumbExtension = thumbMCP.y - thumbTip.y;
    if (thumbExtension < 0.03) return false; // reduced from 0.05

    // Additional check: thumb tip should be above the wrist
    if (thumbTip.y > wrist.y) return false;

    // --- Criterion 2: Other fingers should be curled ---
    // Curled = fingertip y is below (greater than) the PIP joint y
    const fingers = [
      { tip: lm[8],  pip: lm[6]  }, // index
      { tip: lm[12], pip: lm[10] }, // middle
      { tip: lm[16], pip: lm[14] }, // ring
      { tip: lm[20], pip: lm[18] }, // pinky
    ];

    let curledCount = 0;
    for (const f of fingers) {
      // Finger is curled if tip is below PIP
      if (f.tip.y > f.pip.y) {
        curledCount++;
      }
    }

    // Relaxed: at least 2 of 4 fingers curled (was 3)
    // This handles cases where one or two fingers partially extend
    return curledCount >= 2;
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
   */
  function onThumbsUp(cb) {
    onThumbsUpCallback = cb;
  }

  /**
   * Set callback for state changes (hand detected / thumb detected).
   */
  function onStateChange(cb) {
    onStateChangeCallback = cb;
  }

  /**
   * Get current detection state.
   */
  function getState() {
    return { handDetected, thumbDetected };
  }

  /**
   * Reset cooldown.
   */
  function resetCooldown() {
    lastThumbsUpTime = 0;
    thumbsUpStartTime = 0;
    thumbsUpFired = false;
  }

  /**
   * Enable/disable debug logging.
   */
  function setDebug(enabled) {
    debugMode = enabled;
  }

  return {
    init,
    sendFrame,
    onThumbsUp,
    onStateChange,
    getState,
    resetCooldown,
    setDebug
  };
})();
