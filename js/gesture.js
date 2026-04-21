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
  const COOLDOWN_MS = 1500;

  // Require thumbs-up held briefly
  let thumbsUpStartTime = 0;
  const HOLD_MS = 400;
  let thumbsUpFired = false;

  // State tracking
  let handDetected = false;
  let thumbDetected = false;
  let onStateChangeCallback = null;
  let debugEl = null;

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
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4
    });

    hands.onResults(onResults);

    // Create on-screen debug overlay
    debugEl = document.createElement('div');
    debugEl.id = 'gesture-debug';
    debugEl.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:rgba(0,0,0,0.75);color:#0f0;font:12px monospace;' +
      'padding:8px;max-height:30vh;overflow-y:auto;pointer-events:none;';
    document.body.appendChild(debugEl);

    // Warm up
    return new Promise((resolve) => {
      const dummy = document.createElement('canvas');
      dummy.width = 10;
      dummy.height = 10;
      hands.send({ image: dummy }).then(() => resolve());
    });
  }

  function debugLog(msg) {
    if (debugEl) {
      debugEl.innerHTML = msg;
    }
    console.log(msg.replace(/<br>/g, ' | ').replace(/<[^>]*>/g, ''));
  }

  function onResults(results) {
    latestHandResults = results;

    const prevHand = handDetected;
    const prevThumb = thumbDetected;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      handDetected = false;
      thumbDetected = false;
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
      debugLog('🖐 No hand detected');

      if (prevHand !== handDetected || prevThumb !== thumbDetected) {
        if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
      }
      return;
    }

    handDetected = true;
    const lm = results.multiHandLandmarks[0];

    // === Raw landmark data ===
    const thumbTip = lm[4];
    const thumbIP = lm[3];
    const thumbMCP = lm[2];
    const thumbCMC = lm[1];
    const wrist = lm[0];

    const indexTip = lm[8], indexPIP = lm[6], indexMCP = lm[5];
    const middleTip = lm[12], middlePIP = lm[10];
    const ringTip = lm[16], ringPIP = lm[14];
    const pinkyTip = lm[20], pinkyPIP = lm[18];

    // === Finger analysis ===
    // Thumb: check if extended away from palm in any direction
    // Instead of requiring strict "up", check if thumb tip is far from palm center
    const palmCenterY = (wrist.y + indexMCP.y) / 2;
    const palmCenterX = (wrist.x + lm[9].x) / 2; // wrist to middle MCP

    // Thumb extension: distance from thumb tip to thumb CMC
    const thumbLen = Math.sqrt(
      (thumbTip.x - thumbCMC.x) ** 2 +
      (thumbTip.y - thumbCMC.y) ** 2
    );

    // Thumb is "up-ish": tip is above CMC (lower y = higher on screen)
    const thumbAboveCMC = thumbTip.y < thumbCMC.y;
    // More lenient: thumb tip just needs to be above wrist
    const thumbAboveWrist = thumbTip.y < wrist.y;

    // Finger curl check: tip below MCP (not PIP — more lenient)
    const indexCurled = indexTip.y > indexMCP.y;
    const middleCurled = middleTip.y > lm[9].y;  // middle MCP
    const ringCurled = ringTip.y > lm[13].y;      // ring MCP
    const pinkyCurled = pinkyTip.y > lm[17].y;    // pinky MCP

    // Also check PIP-based curl (stricter)
    const indexCurledPIP = indexTip.y > indexPIP.y;
    const middleCurledPIP = middleTip.y > middlePIP.y;
    const ringCurledPIP = ringTip.y > ringPIP.y;
    const pinkyCurledPIP = pinkyTip.y > pinkyPIP.y;

    const curledMCP = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter(Boolean).length;
    const curledPIP = [indexCurledPIP, middleCurledPIP, ringCurledPIP, pinkyCurledPIP].filter(Boolean).length;

    // === Detection methods (try multiple) ===

    // Method 1: Classic thumbs-up (thumb up, fingers curled)
    const method1 = thumbAboveCMC && thumbLen > 0.06 && curledPIP >= 2;

    // Method 2: Thumb above wrist + fingers curled (more lenient direction)
    const method2 = thumbAboveWrist && thumbLen > 0.05 && curledMCP >= 2;

    // Method 3: Thumb tip is the highest point of all fingertips
    const allTipYs = [indexTip.y, middleTip.y, ringTip.y, pinkyTip.y];
    const thumbIsHighest = allTipYs.every(y => thumbTip.y < y - 0.02);
    const method3 = thumbIsHighest && thumbLen > 0.04 && curledMCP >= 1;

    const isThumbUp = method1 || method2 || method3;
    thumbDetected = isThumbUp;

    // === Debug display ===
    const m1 = method1 ? '✅' : '❌';
    const m2 = method2 ? '✅' : '❌';
    const m3 = method3 ? '✅' : '❌';

    let holdInfo = '';
    if (isThumbUp && thumbsUpStartTime > 0) {
      holdInfo = ` | Hold: ${Date.now() - thumbsUpStartTime}ms/${HOLD_MS}ms`;
    }

    debugLog(
      `👆 Thumb: aboveCMC=${thumbAboveCMC} aboveWrist=${thumbAboveWrist} len=${thumbLen.toFixed(3)}<br>` +
      `🤛 Curled(MCP): ${curledMCP}/4 Curled(PIP): ${curledPIP}/4<br>` +
      `📊 M1(classic):${m1} M2(lenient):${m2} M3(highest):${m3}<br>` +
      `${isThumbUp ? '👍 THUMBS UP!' : '✋ Not thumbs-up'}${holdInfo}`
    );

    if (prevHand !== handDetected || prevThumb !== thumbDetected) {
      if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
    }

    // === Trigger logic ===
    if (isThumbUp) {
      const now = Date.now();
      if (thumbsUpStartTime === 0) {
        thumbsUpStartTime = now;
      }

      if (!thumbsUpFired &&
          (now - thumbsUpStartTime) >= HOLD_MS &&
          (now - lastThumbsUpTime) >= COOLDOWN_MS) {
        thumbsUpFired = true;
        lastThumbsUpTime = now;
        debugLog('<span style="color:#ff0;font-size:16px">🎉 TRIGGERED!</span>');
        if (onThumbsUpCallback) onThumbsUpCallback();
      }
    } else {
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
    }
  }

  async function sendFrame(videoEl) {
    if (!hands) return;
    await hands.send({ image: videoEl });
  }

  function onThumbsUp(cb) {
    onThumbsUpCallback = cb;
  }

  function onStateChange(cb) {
    onStateChangeCallback = cb;
  }

  function getState() {
    return { handDetected, thumbDetected };
  }

  function resetCooldown() {
    lastThumbsUpTime = 0;
    thumbsUpStartTime = 0;
    thumbsUpFired = false;
  }

  /**
   * Remove debug overlay (call after confirmed working).
   */
  function hideDebug() {
    if (debugEl) {
      debugEl.style.display = 'none';
    }
  }

  return {
    init,
    sendFrame,
    onThumbsUp,
    onStateChange,
    getState,
    resetCooldown,
    hideDebug
  };
})();
