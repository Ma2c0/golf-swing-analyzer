/**
 * Gesture detection module — wraps MediaPipe Hands for thumbs-up recognition.
 * Used to start/stop recording hands-free.
 *
 * v2 — Major rewrite to fix detection reliability:
 *   - Lowered confidence thresholds for far-distance detection (6-8ft)
 *   - Simplified thumbs-up heuristic (fewer false negatives)
 *   - Added robust angle-based detection alongside position-based
 *   - Hold time increased to 2 seconds for intentional triggering
 *   - Visual countdown feedback during hold
 *   - Reduced model complexity for better perf alongside Pose
 */
const GestureModule = (() => {
  let hands = null;
  let latestHandResults = null;
  let onThumbsUpCallback = null;

  // Cooldown to prevent rapid toggling after a trigger
  let lastThumbsUpTime = 0;
  const COOLDOWN_MS = 2500;

  // Require thumbs-up held for 2 seconds
  let thumbsUpStartTime = 0;
  const HOLD_MS = 2000;
  let thumbsUpFired = false;

  // State tracking
  let handDetected = false;
  let thumbDetected = false;
  let holdProgress = 0; // 0-1, exposed for UI
  let onStateChangeCallback = null;
  let onHoldProgressCallback = null;
  let debugEl = null;
  let showDebug = false; // set to true for troubleshooting

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
      modelComplexity: 0,            // <-- lite model: faster, less GPU contention with Pose
      minDetectionConfidence: 0.35,   // <-- lowered: hand is small at 6-8ft
      minTrackingConfidence: 0.3      // <-- lowered: keep tracking even with partial occlusion
    });

    hands.onResults(onResults);

    // Create on-screen debug overlay (hidden by default)
    debugEl = document.createElement('div');
    debugEl.id = 'gesture-debug';
    debugEl.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:rgba(0,0,0,0.75);color:#0f0;font:12px monospace;' +
      'padding:8px;max-height:30vh;overflow-y:auto;pointer-events:none;' +
      'display:' + (showDebug ? 'block' : 'none') + ';';
    document.body.appendChild(debugEl);

    // Warm up with a dummy frame
    return new Promise((resolve) => {
      const dummy = document.createElement('canvas');
      dummy.width = 10;
      dummy.height = 10;
      hands.send({ image: dummy }).then(() => resolve());
    });
  }

  function debugLog(msg) {
    if (debugEl && showDebug) {
      debugEl.innerHTML = msg;
    }
  }

  /**
   * Core thumbs-up detection.
   * Uses multiple methods and requires only ONE to pass.
   *
   * Key insight: at 6-8ft distance, landmark precision drops.
   * We use generous thresholds and rely on the 2-second hold
   * to filter false positives instead of strict geometry.
   */
  function detectThumbsUp(lm) {
    const thumbTip  = lm[4];
    const thumbIP   = lm[3];
    const thumbMCP  = lm[2];
    const thumbCMC  = lm[1];
    const wrist     = lm[0];

    const indexTip   = lm[8];
    const indexMCP   = lm[5];
    const middleTip  = lm[12];
    const middleMCP  = lm[9];
    const ringTip    = lm[16];
    const ringMCP    = lm[13];
    const pinkyTip   = lm[20];
    const pinkyMCP   = lm[17];

    // ── Thumb extension metrics ──
    const thumbLen = Math.hypot(thumbTip.x - thumbCMC.x, thumbTip.y - thumbCMC.y);
    const thumbAboveWrist = thumbTip.y < wrist.y;
    const thumbAboveCMC   = thumbTip.y < thumbCMC.y;

    // Thumb angle relative to vertical (0° = straight up)
    const thumbAngle = Math.abs(
      Math.atan2(thumbTip.x - thumbCMC.x, thumbCMC.y - thumbTip.y) * (180 / Math.PI)
    );
    const thumbPointsUp = thumbAngle < 55; // generous: up to 55° off vertical

    // ── Finger curl: how many non-thumb fingers are curled ──
    // Method A: tip below MCP (lenient)
    const curlMCP = [
      indexTip.y  > indexMCP.y,
      middleTip.y > middleMCP.y,
      ringTip.y   > ringMCP.y,
      pinkyTip.y  > pinkyMCP.y
    ].filter(Boolean).length;

    // Method B: tip-to-wrist distance < MCP-to-wrist distance (works at any orientation)
    const wristRef = { x: wrist.x, y: wrist.y };
    function d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    const curlDist = [
      d(indexTip, wristRef)  < d(indexMCP, wristRef)  * 1.15,
      d(middleTip, wristRef) < d(middleMCP, wristRef) * 1.15,
      d(ringTip, wristRef)   < d(ringMCP, wristRef)   * 1.15,
      d(pinkyTip, wristRef)  < d(pinkyMCP, wristRef)  * 1.15
    ].filter(Boolean).length;

    const curled = Math.max(curlMCP, curlDist);

    // ── Detection methods ──

    // Method 1: Classic — thumb points up + fingers curled
    const m1 = thumbPointsUp && thumbAboveCMC && curled >= 2;

    // Method 2: Lenient position — thumb above wrist + any extension + some curl
    const m2 = thumbAboveWrist && thumbLen > 0.04 && curled >= 2;

    // Method 3: Thumb is the highest fingertip by a margin
    const otherTipYs = [indexTip.y, middleTip.y, ringTip.y, pinkyTip.y];
    const thumbIsHighest = otherTipYs.every(y => thumbTip.y < y - 0.01);
    const m3 = thumbIsHighest && thumbLen > 0.03 && curled >= 1;

    // Method 4: Angle-based only — very lenient for distance
    const m4 = thumbPointsUp && thumbLen > 0.04 && curled >= 3;

    const isThumbUp = m1 || m2 || m3 || m4;

    debugLog(
      `Thumb: up=${thumbPointsUp} aboveCMC=${thumbAboveCMC} len=${thumbLen.toFixed(3)} angle=${thumbAngle.toFixed(0)}<br>` +
      `Curl: MCP=${curlMCP}/4 Dist=${curlDist}/4 best=${curled}/4<br>` +
      `M1:${m1?'Y':'N'} M2:${m2?'Y':'N'} M3:${m3?'Y':'N'} M4:${m4?'Y':'N'}<br>` +
      `${isThumbUp ? '<b style="color:#0f0">THUMBS UP</b>' : 'Not detected'}` +
      (thumbsUpStartTime > 0 ? ` | Hold: ${Date.now() - thumbsUpStartTime}ms / ${HOLD_MS}ms` : '')
    );

    return isThumbUp;
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
      holdProgress = 0;
      if (onHoldProgressCallback) onHoldProgressCallback(0);
      debugLog('No hand detected');

      if (prevHand !== handDetected || prevThumb !== thumbDetected) {
        if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
      }
      return;
    }

    handDetected = true;
    const lm = results.multiHandLandmarks[0];
    const isThumbUp = detectThumbsUp(lm);
    thumbDetected = isThumbUp;

    if (prevHand !== handDetected || prevThumb !== thumbDetected) {
      if (onStateChangeCallback) onStateChangeCallback({ handDetected, thumbDetected });
    }

    // ── Trigger logic with 2-second hold ──
    if (isThumbUp) {
      const now = Date.now();
      if (thumbsUpStartTime === 0) {
        thumbsUpStartTime = now;
      }

      const elapsed = now - thumbsUpStartTime;
      holdProgress = Math.min(elapsed / HOLD_MS, 1);
      if (onHoldProgressCallback) onHoldProgressCallback(holdProgress);

      if (!thumbsUpFired && elapsed >= HOLD_MS && (now - lastThumbsUpTime) >= COOLDOWN_MS) {
        thumbsUpFired = true;
        lastThumbsUpTime = now;
        holdProgress = 0;
        if (onHoldProgressCallback) onHoldProgressCallback(0);
        if (onThumbsUpCallback) onThumbsUpCallback();
      }
    } else {
      thumbsUpStartTime = 0;
      thumbsUpFired = false;
      holdProgress = 0;
      if (onHoldProgressCallback) onHoldProgressCallback(0);
    }
  }

  async function sendFrame(videoEl) {
    if (!hands) return;
    await hands.send({ image: videoEl });
  }

  function onThumbsUp(cb) { onThumbsUpCallback = cb; }
  function onStateChange(cb) { onStateChangeCallback = cb; }
  function onHoldProgress(cb) { onHoldProgressCallback = cb; }

  function getState() { return { handDetected, thumbDetected, holdProgress }; }

  function resetCooldown() {
    lastThumbsUpTime = 0;
    thumbsUpStartTime = 0;
    thumbsUpFired = false;
    holdProgress = 0;
  }

  function hideDebug() {
    if (debugEl) debugEl.style.display = 'none';
  }

  function toggleDebug() {
    showDebug = !showDebug;
    if (debugEl) debugEl.style.display = showDebug ? 'block' : 'none';
  }

  return {
    init,
    sendFrame,
    onThumbsUp,
    onStateChange,
    onHoldProgress,
    getState,
    resetCooldown,
    hideDebug,
    toggleDebug
  };
})();
