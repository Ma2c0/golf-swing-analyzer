/**
 * Validation module — framing checks, anti-cheat, and clip validation.
 *
 * Provides two main capabilities:
 *   1. Pre-recording framing validation (is the user properly positioned?)
 *   2. Post-recording clip validation (is this a real golf swing?)
 *
 * All thresholds are exposed as CONFIG constants for easy tuning.
 */
const ValidationModule = (() => {
  'use strict';

  // ══════════════════════════════════════════════
  // CONFIG — all tunable thresholds in one place
  // ══════════════════════════════════════════════
  const CONFIG = {
    // --- Framing check ---
    // Minimum visibility score for a landmark to count as "detected"
    LANDMARK_VIS_THRESHOLD: 0.5,

    // Required landmarks for "full body" (indices into MediaPipe Pose 33-point model)
    // Nose(0), L/R Shoulder(11,12), L/R Hip(23,24), L/R Knee(25,26), L/R Ankle(27,28)
    REQUIRED_LANDMARKS: [0, 11, 12, 23, 24, 25, 26, 27, 28],

    // Ankle landmarks — must be visible to prove full body (anti face-close)
    ANKLE_LANDMARKS: [27, 28],

    // Shoulder landmarks — used for face-size ratio
    SHOULDER_LANDMARKS: [11, 12],

    // Face landmarks for proximity detection
    FACE_LANDMARKS: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // nose, eyes, ears, mouth

    // Body bounding box height as fraction of screen
    BODY_HEIGHT_MIN: 0.30,   // too far if body < 30% of screen
    BODY_HEIGHT_MAX: 0.90,   // too close if body > 90% of screen

    // Face area as fraction of screen area (anti face-close)
    FACE_AREA_MAX: 0.12,     // if face bbox > 12% of screen, too close

    // Face-to-body ratio: if face height > this fraction of body height, likely too close
    FACE_BODY_RATIO_MAX: 0.45,

    // How many consecutive "pass" frames needed to auto-start recording (~1s at 30fps)
    STABLE_FRAMES_REQUIRED: 30,

    // Framing guide box (normalized 0-1, relative to video dimensions)
    // This defines the "target zone" the body should mostly be within
    GUIDE_BOX: { x: 0.15, y: 0.05, w: 0.70, h: 0.90 },

    // What fraction of required landmarks must be inside the guide box
    LANDMARKS_IN_BOX_RATIO: 0.7,

    // --- Clip validation ---
    // Minimum / maximum recording duration in seconds
    CLIP_DURATION_MIN: 1.0,
    CLIP_DURATION_MAX: 15.0,

    // Minimum fraction of frames with valid full-body pose
    CLIP_VALID_FRAME_RATIO: 0.50,

    // Minimum number of usable frames
    CLIP_MIN_FRAMES: 15,

    // Swing detection: minimum hand-height range (normalized) to count as a swing
    // This is the difference between the highest and lowest hand positions
    // At 6-8ft distance, a full swing typically produces 0.05-0.15 range
    SWING_HAND_HEIGHT_RANGE_MIN: 0.04,

    // Swing detection: hand must go UP then DOWN (backswing → downswing)
    // Minimum height the hands must reach above the shoulder midpoint
    SWING_MIN_HAND_ABOVE_SHOULDER: 0.03,

    // Swing detection: minimum speed variance (hands must accelerate at some point)
    // In normalized coords, frame-to-frame displacement is tiny (~0.005-0.02),
    // so variance is on the order of 0.00001. Set very low to avoid false rejects.
    SWING_MIN_SPEED_VARIANCE: 0.000005,

    // Maximum fraction of frames where key landmarks are lost during recording
    CLIP_MAX_DROPOUT_RATIO: 0.50,
  };

  // ══════════════════════════════════════════════
  // FRAMING VALIDATION (pre-recording)
  // ══════════════════════════════════════════════

  /**
   * Validate a single frame for framing readiness.
   * @param {Array} landmarks - MediaPipe 33-point landmarks (normalized 0-1)
   * @returns {{ pass: boolean, reason: string, details: object }}
   */
  function validateFrame(landmarks) {
    if (!landmarks || landmarks.length < 33) {
      return fail('no_pose', 'No person detected. Please step into the frame.');
    }

    const result = {
      hasFullBody: false,
      hasBothAnkles: false,
      bodyHeight: 0,
      faceArea: 0,
      faceTooClose: false,
      bodyTooFar: false,
      bodyTooClose: false,
      landmarksInBox: 0,
      multiplePersons: false, // not detectable with single-person model, placeholder
    };

    // 1. Check all required landmarks are visible
    const visibleRequired = CONFIG.REQUIRED_LANDMARKS.filter(
      i => landmarks[i] && landmarks[i].visibility >= CONFIG.LANDMARK_VIS_THRESHOLD
    );
    result.hasFullBody = visibleRequired.length === CONFIG.REQUIRED_LANDMARKS.length;

    if (!result.hasFullBody) {
      // Determine what's missing for a helpful message
      const missingAnkles = CONFIG.ANKLE_LANDMARKS.some(
        i => !landmarks[i] || landmarks[i].visibility < CONFIG.LANDMARK_VIS_THRESHOLD
      );
      const missingHead = !landmarks[0] || landmarks[0].visibility < CONFIG.LANDMARK_VIS_THRESHOLD;

      if (missingAnkles && !missingHead) {
        return fail('no_ankles', 'Feet not visible. Please step back so your full body is in frame.', result);
      }
      if (missingHead) {
        return fail('no_head', 'Head not detected. Please face the camera.', result);
      }
      return fail('incomplete_body', 'Full body not detected. Make sure head, shoulders, hips, knees, and feet are all visible.', result);
    }

    // 2. Both ankles specifically (anti face-close hard requirement)
    result.hasBothAnkles = CONFIG.ANKLE_LANDMARKS.every(
      i => landmarks[i] && landmarks[i].visibility >= CONFIG.LANDMARK_VIS_THRESHOLD
    );
    if (!result.hasBothAnkles) {
      return fail('no_ankles', 'Both feet must be visible. Please step back.', result);
    }

    // 3. Compute body bounding box height
    const bodyYs = CONFIG.REQUIRED_LANDMARKS
      .map(i => landmarks[i].y)
      .filter(y => y >= 0 && y <= 1);
    const bodyMinY = Math.min(...bodyYs);
    const bodyMaxY = Math.max(...bodyYs);
    result.bodyHeight = bodyMaxY - bodyMinY;

    if (result.bodyHeight > CONFIG.BODY_HEIGHT_MAX) {
      result.bodyTooClose = true;
      return fail('too_close', 'You are too close to the camera. Please step back.', result);
    }
    if (result.bodyHeight < CONFIG.BODY_HEIGHT_MIN) {
      result.bodyTooFar = true;
      return fail('too_far', 'You are too far from the camera. Please step closer.', result);
    }

    // 4. Face area check (anti face-close)
    const faceIndices = CONFIG.FACE_LANDMARKS.filter(
      i => landmarks[i] && landmarks[i].visibility >= 0.3
    );
    if (faceIndices.length >= 3) {
      const faceXs = faceIndices.map(i => landmarks[i].x);
      const faceYs = faceIndices.map(i => landmarks[i].y);
      const faceW = Math.max(...faceXs) - Math.min(...faceXs);
      const faceH = Math.max(...faceYs) - Math.min(...faceYs);
      result.faceArea = faceW * faceH;

      if (result.faceArea > CONFIG.FACE_AREA_MAX) {
        result.faceTooClose = true;
        return fail('face_too_close', 'Face is too close to the camera. Please step back for a full-body shot.', result);
      }

      // Face-to-body ratio check
      if (result.bodyHeight > 0 && faceH / result.bodyHeight > CONFIG.FACE_BODY_RATIO_MAX) {
        result.faceTooClose = true;
        return fail('face_too_close', 'Camera is capturing mostly your face. Please step back to show your full body.', result);
      }
    }

    // 5. Check landmarks are within guide box
    const box = CONFIG.GUIDE_BOX;
    const inBox = CONFIG.REQUIRED_LANDMARKS.filter(i => {
      const lm = landmarks[i];
      return lm.x >= box.x && lm.x <= (box.x + box.w) &&
             lm.y >= box.y && lm.y <= (box.y + box.h);
    });
    result.landmarksInBox = inBox.length / CONFIG.REQUIRED_LANDMARKS.length;

    if (result.landmarksInBox < CONFIG.LANDMARKS_IN_BOX_RATIO) {
      return fail('out_of_box', 'Please center yourself within the guide outline.', result);
    }

    // All checks passed
    return { pass: true, reason: 'ready', message: 'Ready. Hold still...', details: result };
  }

  function fail(reason, message, details) {
    return { pass: false, reason, message, details: details || {} };
  }

  // ══════════════════════════════════════════════
  // STABILITY TRACKER (consecutive passing frames)
  // ══════════════════════════════════════════════

  let stableCount = 0;

  function resetStability() {
    stableCount = 0;
  }

  /**
   * Feed a frame validation result. Returns stability progress (0-1).
   */
  function trackStability(frameResult) {
    if (frameResult.pass) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    return Math.min(stableCount / CONFIG.STABLE_FRAMES_REQUIRED, 1);
  }

  function isStable() {
    return stableCount >= CONFIG.STABLE_FRAMES_REQUIRED;
  }

  // ══════════════════════════════════════════════
  // CLIP VALIDATION (post-recording)
  // ══════════════════════════════════════════════

  /**
   * Validate a recorded clip before allowing analysis.
   * @param {Array} frames - array of { timestamp, landmarks }
   * @returns {{ valid: boolean, reason: string, message: string, details: object }}
   */
  function validateClip(frames) {
    const details = {
      totalFrames: frames ? frames.length : 0,
      validFrames: 0,
      duration: 0,
      handHeightRange: 0,
      hasSwingArc: false,
      hasBackswing: false,
      hasDownswing: false,
      dropoutRatio: 0,
    };

    // Basic checks
    if (!frames || frames.length < CONFIG.CLIP_MIN_FRAMES) {
      return clipFail('too_short', 'Recording too short. Please record a complete swing (at least 1 second).', details);
    }

    // Duration
    const firstTs = frames[0].timestamp;
    const lastTs = frames[frames.length - 1].timestamp;
    details.duration = (lastTs - firstTs) / 1000;

    if (details.duration < CONFIG.CLIP_DURATION_MIN) {
      return clipFail('too_short', 'Recording too short. Please complete a full swing before stopping.', details);
    }
    if (details.duration > CONFIG.CLIP_DURATION_MAX) {
      return clipFail('too_long', 'Recording too long. Please record just one swing (under 15 seconds).', details);
    }

    // Count valid frames (frames with full body visible)
    const BODY_LANDMARKS = [11, 12, 23, 24, 25, 26, 27, 28]; // shoulders, hips, knees, ankles
    const validFrames = frames.filter(f => {
      return BODY_LANDMARKS.every(i =>
        f.landmarks[i] && f.landmarks[i].visibility >= CONFIG.LANDMARK_VIS_THRESHOLD
      );
    });
    details.validFrames = validFrames.length;
    details.dropoutRatio = 1 - (validFrames.length / frames.length);

    if (validFrames.length < CONFIG.CLIP_MIN_FRAMES) {
      return clipFail('no_body', 'Full body not detected in most frames. Please ensure your entire body stays visible during the swing.', details);
    }

    const validRatio = validFrames.length / frames.length;
    if (validRatio < CONFIG.CLIP_VALID_FRAME_RATIO) {
      return clipFail('unstable_tracking', `Body tracking was too unstable (${Math.round(validRatio * 100)}% usable frames). Please ensure good lighting and keep your full body in frame.`, details);
    }

    if (details.dropoutRatio > CONFIG.CLIP_MAX_DROPOUT_RATIO) {
      return clipFail('high_dropout', 'Too many frames lost during recording. Please ensure steady lighting and stay in frame.', details);
    }

    // ── Swing motion detection ──
    // Extract hand positions from valid frames
    const handData = validFrames.map(f => {
      const lw = f.landmarks[15]; // left wrist
      const rw = f.landmarks[16]; // right wrist
      const ls = f.landmarks[11]; // left shoulder
      const rs = f.landmarks[12]; // right shoulder

      const handY = (lw.y + rw.y) / 2;
      const shoulderY = (ls.y + rs.y) / 2;
      const handHeight = shoulderY - handY; // positive = hands above shoulders

      return {
        handY,
        shoulderY,
        handHeight,
        handX: (lw.x + rw.x) / 2,
        timestamp: f.timestamp,
      };
    });

    // Hand height range
    const heights = handData.map(d => d.handHeight);
    const maxHeight = Math.max(...heights);
    const minHeight = Math.min(...heights);
    details.handHeightRange = maxHeight - minHeight;

    if (details.handHeightRange < CONFIG.SWING_HAND_HEIGHT_RANGE_MIN) {
      return clipFail('no_swing', 'No swing motion detected. Please perform a complete golf swing.', details);
    }

    // Check for backswing (hands going up) then downswing (hands coming down)
    // Find the frame where hands are highest
    const peakIdx = heights.indexOf(maxHeight);
    const n = heights.length;

    // Peak should not be at the very start or very end
    // Relaxed: allow peak anywhere from 5% to 90% of clip
    if (peakIdx < n * 0.05 || peakIdx > n * 0.92) {
      return clipFail('no_swing', 'No clear swing arc detected. Make sure to complete a full backswing and follow-through.', details);
    }

    // Before peak: hands should rise (backswing)
    // Use smoothed comparison (compare to 2 frames back) to handle MediaPipe jitter
    const prePeak = heights.slice(0, peakIdx + 1);
    const risingFrames = prePeak.filter((h, i) => i >= 2 && h > prePeak[i - 2]).length;
    details.hasBackswing = prePeak.length < 4 || risingFrames > prePeak.length * 0.15;

    // After peak: hands should fall (downswing)
    const postPeak = heights.slice(peakIdx);
    const fallingFrames = postPeak.filter((h, i) => i >= 2 && h < postPeak[i - 2]).length;
    details.hasDownswing = postPeak.length < 4 || fallingFrames > postPeak.length * 0.15;

    details.hasSwingArc = details.hasBackswing && details.hasDownswing;

    if (!details.hasBackswing) {
      return clipFail('no_backswing', 'No backswing detected. Please raise the club before swinging.', details);
    }

    if (!details.hasDownswing) {
      return clipFail('no_downswing', 'No downswing detected. Please complete the full swing motion.', details);
    }

    if (!details.hasSwingArc) {
      return clipFail('no_swing', 'No valid swing motion detected. The recording should show a complete backswing and downswing.', details);
    }

    // Check hands reached above shoulders at peak
    if (maxHeight < CONFIG.SWING_MIN_HAND_ABOVE_SHOULDER) {
      return clipFail('weak_swing', 'Swing motion too small. Please perform a fuller swing.', details);
    }

    // Speed variance check: compute hand speed and check for acceleration
    // Compare max speed to min speed ratio instead of raw variance
    // This is more robust across different frame rates and distances
    const speeds = [];
    for (let i = 1; i < handData.length; i++) {
      const dx = handData[i].handX - handData[i - 1].handX;
      const dy = handData[i].handY - handData[i - 1].handY;
      speeds.push(Math.sqrt(dx * dx + dy * dy));
    }
    if (speeds.length > 5) {
      // Sort and compare top 10% speeds vs bottom 50%
      const sorted = [...speeds].sort((a, b) => a - b);
      const slowMedian = sorted[Math.floor(sorted.length * 0.3)] || 0.0001;
      const fastTop = sorted[Math.floor(sorted.length * 0.9)] || 0;
      const speedRatio = fastTop / Math.max(slowMedian, 0.0001);
      // A real swing should have at least 2x speed difference between fast and slow phases
      if (speedRatio < 1.5) {
        return clipFail('no_motion_variance', 'Motion appears too uniform. A real swing should have acceleration. Please try again.', details);
      }
    }

    // All checks passed
    return {
      valid: true,
      reason: 'valid_swing',
      message: 'Valid swing detected. Analyzing...',
      details,
    };
  }

  function clipFail(reason, message, details) {
    return { valid: false, reason, message, details: details || {} };
  }

  // ══════════════════════════════════════════════
  // RECORDING MONITOR (during-recording checks)
  // ══════════════════════════════════════════════

  let outOfFrameCount = 0;
  let totalRecordingFrames = 0;
  const OUT_OF_FRAME_WARN_THRESHOLD = 10; // frames before showing warning

  function resetRecordingMonitor() {
    outOfFrameCount = 0;
    totalRecordingFrames = 0;
  }

  /**
   * Check a frame during recording. Returns a warning if user is drifting out of frame.
   * Does NOT stop recording — just provides soft warnings.
   */
  function monitorRecordingFrame(landmarks) {
    totalRecordingFrames++;

    if (!landmarks || landmarks.length < 33) {
      outOfFrameCount++;
      if (outOfFrameCount > OUT_OF_FRAME_WARN_THRESHOLD) {
        return { warn: true, message: 'Body lost — try to stay in frame.' };
      }
      return { warn: false };
    }

    // Check core landmarks (more lenient during recording — only shoulders + hips)
    const coreLandmarks = [11, 12, 23, 24];
    const coreVisible = coreLandmarks.every(
      i => landmarks[i] && landmarks[i].visibility >= 0.4
    );

    if (!coreVisible) {
      outOfFrameCount++;
      if (outOfFrameCount > OUT_OF_FRAME_WARN_THRESHOLD) {
        return { warn: true, message: 'Keep your body in frame during the swing.' };
      }
    } else {
      // Reset counter if back in frame
      outOfFrameCount = Math.max(0, outOfFrameCount - 2);
    }

    return { warn: false };
  }

  // ══════════════════════════════════════════════
  // REAL-TIME SWING DETECTOR (during recording)
  // Watches the live hand trajectory and fires
  // a callback when a complete swing arc is detected.
  //
  // Swing phases tracked:
  //   SETUP  → hands near waist, relatively still
  //   BACKSWING → hands rising (handHeight increasing)
  //   PEAK → hands at highest point, start descending
  //   DOWNSWING → hands falling fast
  //   FOLLOW_THROUGH → hands past impact and rising again / slowing
  //
  // Auto-stop fires after FOLLOW_THROUGH is confirmed.
  // ══════════════════════════════════════════════

  const SWING_DETECT = {
    // Minimum frames before we start looking for a swing (setup period)
    MIN_SETUP_FRAMES: 10,
    // How much handHeight must rise from baseline to count as backswing start
    BACKSWING_RISE_THRESHOLD: 0.02,
    // How much handHeight must drop from peak to count as downswing
    DOWNSWING_DROP_THRESHOLD: 0.03,
    // After impact, how many frames to wait for follow-through before auto-stop
    FOLLOW_THROUGH_FRAMES: 12,
    // Minimum total frames for a valid swing (prevent false triggers from jitter)
    MIN_SWING_FRAMES: 20,
    // Smoothing window size for hand height (reduces jitter)
    SMOOTH_WINDOW: 3,
  };

  let swingState = 'SETUP';   // SETUP | BACKSWING | PEAK | DOWNSWING | FOLLOW_THROUGH | DONE
  let handHeightHistory = [];  // smoothed handHeight values during recording
  let rawHandHeights = [];     // raw values for smoothing
  let baselineHeight = null;   // average hand height during setup
  let peakHeight = -Infinity;  // highest handHeight seen
  let peakFrame = 0;
  let impactFrame = 0;         // frame where hands were lowest after peak
  let lowestAfterPeak = Infinity;
  let followThroughCounter = 0;
  let swingDetectedCallback = null;
  let swingStartFrame = 0;

  function resetSwingDetector() {
    swingState = 'SETUP';
    handHeightHistory = [];
    rawHandHeights = [];
    baselineHeight = null;
    peakHeight = -Infinity;
    peakFrame = 0;
    impactFrame = 0;
    lowestAfterPeak = Infinity;
    followThroughCounter = 0;
    swingStartFrame = 0;
  }

  function onSwingDetected(cb) {
    swingDetectedCallback = cb;
  }

  /**
   * Smooth hand height using a simple moving average.
   */
  function getSmoothedHeight(rawValues) {
    const w = SWING_DETECT.SMOOTH_WINDOW;
    if (rawValues.length < w) {
      return rawValues[rawValues.length - 1] || 0;
    }
    const window = rawValues.slice(-w);
    return window.reduce((a, b) => a + b, 0) / w;
  }

  /**
   * Feed a landmark frame during recording. Call every pose frame.
   * Returns { phase: string, autoStop: boolean }
   */
  function detectSwingLive(landmarks) {
    const result = { phase: swingState, autoStop: false };

    if (!landmarks || landmarks.length < 33) return result;

    const lw = landmarks[15]; // left wrist
    const rw = landmarks[16]; // right wrist
    const ls = landmarks[11]; // left shoulder
    const rs = landmarks[12]; // right shoulder

    // Need wrists and shoulders visible
    if (!lw || !rw || !ls || !rs) return result;
    if (lw.visibility < 0.3 || rw.visibility < 0.3) return result;

    const handY = (lw.y + rw.y) / 2;
    const shoulderY = (ls.y + rs.y) / 2;
    const handHeight = shoulderY - handY; // positive = above shoulders

    rawHandHeights.push(handHeight);
    const smoothed = getSmoothedHeight(rawHandHeights);
    handHeightHistory.push(smoothed);

    const frameIdx = handHeightHistory.length;

    // ── State machine ──
    switch (swingState) {
      case 'SETUP': {
        // Collect baseline for the first N frames
        if (frameIdx <= SWING_DETECT.MIN_SETUP_FRAMES) {
          break;
        }
        // Compute baseline as average of first frames
        if (baselineHeight === null) {
          baselineHeight = handHeightHistory.slice(0, SWING_DETECT.MIN_SETUP_FRAMES)
            .reduce((a, b) => a + b, 0) / SWING_DETECT.MIN_SETUP_FRAMES;
          peakHeight = baselineHeight;
        }
        // Transition to BACKSWING when hands rise above baseline
        if (smoothed > baselineHeight + SWING_DETECT.BACKSWING_RISE_THRESHOLD) {
          swingState = 'BACKSWING';
          swingStartFrame = frameIdx;
          peakHeight = smoothed;
          peakFrame = frameIdx;
        }
        break;
      }

      case 'BACKSWING': {
        // Track peak
        if (smoothed > peakHeight) {
          peakHeight = smoothed;
          peakFrame = frameIdx;
        }
        // Transition to DOWNSWING when hands drop significantly from peak
        if (peakHeight - smoothed > SWING_DETECT.DOWNSWING_DROP_THRESHOLD) {
          swingState = 'DOWNSWING';
          lowestAfterPeak = smoothed;
          impactFrame = frameIdx;
        }
        break;
      }

      case 'DOWNSWING': {
        // Track lowest point (impact)
        if (smoothed < lowestAfterPeak) {
          lowestAfterPeak = smoothed;
          impactFrame = frameIdx;
        }
        // Transition to FOLLOW_THROUGH when hands start rising again
        // or when hands have been below peak for enough frames
        if (smoothed > lowestAfterPeak + 0.01 || (frameIdx - impactFrame > 5)) {
          swingState = 'FOLLOW_THROUGH';
          followThroughCounter = 0;
        }
        break;
      }

      case 'FOLLOW_THROUGH': {
        followThroughCounter++;
        // Wait for follow-through to settle
        if (followThroughCounter >= SWING_DETECT.FOLLOW_THROUGH_FRAMES) {
          // Verify this was a real swing (not just noise)
          const totalSwingFrames = frameIdx - swingStartFrame;
          if (totalSwingFrames >= SWING_DETECT.MIN_SWING_FRAMES) {
            swingState = 'DONE';
            result.autoStop = true;
            if (swingDetectedCallback) swingDetectedCallback();
          } else {
            // Too short — might be jitter. Reset and keep looking.
            swingState = 'SETUP';
            baselineHeight = null;
            peakHeight = -Infinity;
          }
        }
        break;
      }

      case 'DONE': {
        // Already fired. Do nothing.
        result.autoStop = true;
        break;
      }
    }

    result.phase = swingState;
    return result;
  }

  function getSwingPhase() {
    return swingState;
  }

  // ══════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════
  return {
    CONFIG,
    SWING_DETECT,
    validateFrame,
    resetStability,
    trackStability,
    isStable,
    validateClip,
    resetRecordingMonitor,
    monitorRecordingFrame,
    resetSwingDetector,
    detectSwingLive,
    onSwingDetected,
    getSwingPhase,
  };
})();
