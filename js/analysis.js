/**
 * Swing Analysis module.
 * Takes collected pose frame data and produces a swing report.
 * 
 * Face-on (front) camera view:
 * - X axis = left-right
 * - Y axis = up-down (0 at top, 1 at bottom in normalized coords)
 * - Z axis = depth (towards/away from camera)
 * 
 * For a right-handed golfer facing the camera:
 * - Backswing: hands move to golfer's right (camera's left)
 * - Downswing: hands move to golfer's left (camera's right)
 */
const AnalysisModule = (() => {
  const LM = PoseModule.LANDMARKS;

  /**
   * Main analysis entry point.
   * @param {Array} frames - array of { timestamp, landmarks }
   * @returns {Object} analysis result
   */
  function analyze(frames) {
    if (!frames || frames.length < 10) {
      return {
        error: true,
        message: 'Not enough frames captured. Please record a full swing (at least 1 second).'
      };
    }

    // 1. Extract key metrics per frame
    const metrics = frames.map((f, i) => extractMetrics(f.landmarks, i, frames));

    // 2. Detect swing phases
    const phases = detectPhases(metrics, frames);

    // 3. Score each phase
    const phaseScores = scorePhases(metrics, phases);

    // 4. Estimate impact point
    const impact = estimateImpact(metrics, phases);

    // 5. Identify issues & improvements
    const issues = identifyIssues(metrics, phases, phaseScores);

    // 6. Calculate overall score
    const overall = calculateOverall(phaseScores);

    return {
      error: false,
      score: overall.score,
      grade: overall.grade,
      phases: phaseScores,
      impact,
      issues: issues.problems,
      improvements: issues.suggestions,
      frameCount: frames.length,
      duration: (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000
    };
  }

  /**
   * Extract per-frame metrics from landmarks.
   */
  function extractMetrics(lm, frameIdx, allFrames) {
    const ls = lm[LM.LEFT_SHOULDER];
    const rs = lm[LM.RIGHT_SHOULDER];
    const le = lm[LM.LEFT_ELBOW];
    const re = lm[LM.RIGHT_ELBOW];
    const lw = lm[LM.LEFT_WRIST];
    const rw = lm[LM.RIGHT_WRIST];
    const lh = lm[LM.LEFT_HIP];
    const rh = lm[LM.RIGHT_HIP];
    const lk = lm[LM.LEFT_KNEE];
    const rk = lm[LM.RIGHT_KNEE];
    const la = lm[LM.LEFT_ANKLE];
    const ra = lm[LM.RIGHT_ANKLE];
    const nose = lm[LM.NOSE];

    // Wrist midpoint (proxy for hand/club position)
    const handX = (lw.x + rw.x) / 2;
    const handY = (lw.y + rw.y) / 2;

    // Shoulder midpoint
    const shoulderX = (ls.x + rs.x) / 2;
    const shoulderY = (ls.y + rs.y) / 2;

    // Hip midpoint
    const hipX = (lh.x + rh.x) / 2;
    const hipY = (lh.y + rh.y) / 2;

    // Shoulder width (for normalization)
    const shoulderWidth = Math.abs(ls.x - rs.x);

    // Hip width
    const hipWidth = Math.abs(lh.x - rh.x);

    // Spine angle (from hip midpoint to shoulder midpoint, relative to vertical)
    const spineAngle = angleDeg(
      hipX, hipY,
      shoulderX, shoulderY,
      hipX, hipY - 1 // vertical reference
    );

    // Shoulder tilt (angle of shoulder line relative to horizontal)
    const shoulderTilt = Math.atan2(rs.y - ls.y, rs.x - ls.x) * (180 / Math.PI);

    // Hip tilt
    const hipTilt = Math.atan2(rh.y - lh.y, rh.x - lh.x) * (180 / Math.PI);

    // Shoulder-hip separation (X-factor proxy in face-on view)
    const xFactor = Math.abs(shoulderTilt - hipTilt);

    // Left arm angle (shoulder-elbow-wrist)
    const leftArmAngle = angle3pt(ls, le, lw);

    // Right arm angle
    const rightArmAngle = angle3pt(rs, re, rw);

    // Weight distribution estimate (compare ankle X positions with hip center)
    // Positive = weight toward left foot (target side for right-handed)
    const ankleCenter = (la.x + ra.x) / 2;
    const weightShift = (hipX - ankleCenter) / (shoulderWidth || 0.1);

    // Hand height relative to shoulders
    const handHeight = shoulderY - handY; // positive = hands above shoulders

    // Hand position relative to body center (X)
    const handLateral = handX - shoulderX; // positive = toward right side of frame

    // Estimated club angle (from elbow midpoint through wrist midpoint)
    const elbowMidX = (le.x + re.x) / 2;
    const elbowMidY = (le.y + re.y) / 2;
    const clubAngle = Math.atan2(handY - elbowMidY, handX - elbowMidX) * (180 / Math.PI);

    // Head position stability
    const headX = nose.x;
    const headY = nose.y;

    // Knee flex (hip-knee-ankle angle)
    const leftKneeFlex = angle3pt(lh, lk, la);
    const rightKneeFlex = angle3pt(rh, rk, ra);

    return {
      handX, handY, handHeight, handLateral,
      shoulderX, shoulderY, shoulderWidth,
      hipX, hipY, hipWidth,
      spineAngle, shoulderTilt, hipTilt, xFactor,
      leftArmAngle, rightArmAngle,
      weightShift,
      clubAngle,
      headX, headY,
      leftKneeFlex, rightKneeFlex
    };
  }

  /**
   * Detect swing phases based on hand position trajectory.
   * Phases: setup → backswing → top → downswing → impact → follow-through
   */
  function detectPhases(metrics, frames) {
    const n = metrics.length;
    if (n < 10) return { setup: 0, backswingEnd: 0, top: 0, impactFrame: 0, finish: n - 1 };

    // Find the hand's highest point (top of backswing) — lowest Y value for handY
    // Also track hand lateral movement
    const handYs = metrics.map(m => m.handY);
    const handHeights = metrics.map(m => m.handHeight);

    // Setup: first 10% of frames
    const setupEnd = Math.floor(n * 0.1);

    // Top of backswing: find frame with maximum hand height after setup
    let topFrame = setupEnd;
    let maxHeight = -Infinity;
    const searchEnd = Math.floor(n * 0.75); // top should be before last 25%
    for (let i = setupEnd; i < searchEnd; i++) {
      if (handHeights[i] > maxHeight) {
        maxHeight = handHeights[i];
        topFrame = i;
      }
    }

    // Impact: find the frame after top where hands are lowest (highest Y)
    let impactFrame = topFrame;
    let lowestY = -Infinity;
    for (let i = topFrame; i < n; i++) {
      if (metrics[i].handY > lowestY) {
        lowestY = metrics[i].handY;
        impactFrame = i;
      }
    }

    // Also check for fastest hand speed as impact indicator
    let maxSpeed = 0;
    let speedImpact = impactFrame;
    for (let i = topFrame + 1; i < n - 1; i++) {
      const dx = metrics[i + 1].handX - metrics[i].handX;
      const dy = metrics[i + 1].handY - metrics[i].handY;
      const speed = Math.sqrt(dx * dx + dy * dy);
      if (speed > maxSpeed) {
        maxSpeed = speed;
        speedImpact = i;
      }
    }

    // Use whichever impact indicator is more reasonable
    if (speedImpact > topFrame && speedImpact < n - 2) {
      impactFrame = Math.round((impactFrame + speedImpact) / 2);
    }

    return {
      setup: 0,
      setupEnd,
      backswingStart: setupEnd,
      top: topFrame,
      downswingStart: topFrame,
      impactFrame: Math.min(impactFrame, n - 2),
      followStart: Math.min(impactFrame + 1, n - 1),
      finish: n - 1
    };
  }

  /**
   * Score each swing phase.
   */
  function scorePhases(metrics, phases) {
    const scores = {};

    // 1. Setup/Address (first ~10%)
    scores.setup = scoreSetup(metrics, phases);

    // 2. Backswing
    scores.backswing = scoreBackswing(metrics, phases);

    // 3. Downswing
    scores.downswing = scoreDownswing(metrics, phases);

    // 4. Impact
    scores.impact = scoreImpact(metrics, phases);

    // 5. Follow-through
    scores.followThrough = scoreFollowThrough(metrics, phases);

    return scores;
  }

  function scoreSetup(metrics, phases) {
    const setupFrames = metrics.slice(phases.setup, phases.setupEnd + 1);
    if (setupFrames.length === 0) return { score: 50, notes: [] };

    let score = 100;
    const notes = [];
    const avg = average(setupFrames);

    // Check spine angle (should be ~20-35 degrees forward tilt)
    if (avg.spineAngle < 15) {
      score -= 15;
      notes.push('Standing too upright at address');
    } else if (avg.spineAngle > 40) {
      score -= 15;
      notes.push('Too much forward bend at address');
    }

    // Knee flex (should be moderate, ~140-165 degrees)
    const kneeAvg = (avg.leftKneeFlex + avg.rightKneeFlex) / 2;
    if (kneeAvg > 170) {
      score -= 10;
      notes.push('Legs too straight — add some knee flex');
    } else if (kneeAvg < 130) {
      score -= 10;
      notes.push('Too much knee bend at setup');
    }

    // Weight distribution (should be roughly centered)
    if (Math.abs(avg.weightShift) > 0.3) {
      score -= 10;
      notes.push('Weight not centered at address');
    }

    // Shoulder tilt (should be roughly level at address)
    if (Math.abs(avg.shoulderTilt) > 12) {
      score -= 8;
      notes.push('Shoulders not level at address');
    }

    return { score: Math.max(0, score), notes };
  }

  function scoreBackswing(metrics, phases) {
    const bsFrames = metrics.slice(phases.backswingStart, phases.top + 1);
    if (bsFrames.length < 3) return { score: 50, notes: [] };

    let score = 100;
    const notes = [];
    const topMetrics = metrics[phases.top];

    // Hand height at top (should be well above shoulders)
    if (topMetrics.handHeight < 0.05) {
      score -= 20;
      notes.push('Backswing too short — hands not reaching above shoulders');
    } else if (topMetrics.handHeight < 0.1) {
      score -= 10;
      notes.push('Backswing could be longer for more power');
    }

    // X-factor at top (shoulder-hip separation) — should be 30-50 degrees
    if (topMetrics.xFactor < 15) {
      score -= 15;
      notes.push('Insufficient shoulder turn — body rotating as one unit');
    }

    // Left arm straightness (for right-handed golfer, left arm should stay relatively straight)
    if (topMetrics.leftArmAngle < 140) {
      score -= 10;
      notes.push('Left arm bending too much during backswing');
    }

    // Head stability during backswing
    const setupHead = metrics[phases.setup];
    const headMovement = Math.abs(topMetrics.headX - setupHead.headX);
    if (headMovement > 0.08) {
      score -= 12;
      notes.push('Excessive head movement during backswing — try to keep your head still');
    }

    return { score: Math.max(0, score), notes };
  }

  function scoreDownswing(metrics, phases) {
    const dsFrames = metrics.slice(phases.top, phases.impactFrame + 1);
    if (dsFrames.length < 3) return { score: 50, notes: [] };

    let score = 100;
    const notes = [];

    // Hip lead: hips should start moving before shoulders
    // Check if hip tilt changes before shoulder tilt
    const topM = metrics[phases.top];
    const midIdx = Math.floor((phases.top + phases.impactFrame) / 2);
    const midM = metrics[midIdx];

    const hipChange = Math.abs(midM.hipTilt - topM.hipTilt);
    const shoulderChange = Math.abs(midM.shoulderTilt - topM.shoulderTilt);

    if (hipChange < shoulderChange * 0.5) {
      score -= 15;
      notes.push('Hips not leading the downswing — start the downswing with your lower body');
    }

    // Weight shift toward target
    const impactM = metrics[phases.impactFrame];
    if (impactM.weightShift < -0.1) {
      score -= 15;
      notes.push('Weight staying on back foot through impact — shift toward target');
    }

    // Speed building: hand speed should increase through downswing
    let speedIncreasing = true;
    for (let i = phases.top + 2; i <= phases.impactFrame && i < metrics.length - 1; i++) {
      const prevSpeed = dist(metrics[i - 1].handX, metrics[i - 1].handY, metrics[i].handX, metrics[i].handY);
      const currSpeed = dist(metrics[i].handX, metrics[i].handY, metrics[i + 1]?.handX || metrics[i].handX, metrics[i + 1]?.handY || metrics[i].handY);
      // Allow some tolerance
    }

    // Maintain spine angle
    const spineChange = Math.abs(impactM.spineAngle - topM.spineAngle);
    if (spineChange > 15) {
      score -= 12;
      notes.push('Spine angle changing too much during downswing — maintain your posture');
    }

    return { score: Math.max(0, score), notes };
  }

  function scoreImpact(metrics, phases) {
    const impactM = metrics[phases.impactFrame];
    if (!impactM) return { score: 50, notes: [] };

    let score = 100;
    const notes = [];
    const setupM = metrics[phases.setup];

    // Hands should be ahead of body center at impact
    // (slightly toward target side)

    // Weight should be shifted to front foot
    if (impactM.weightShift < 0) {
      score -= 15;
      notes.push('Weight on back foot at impact — should be shifted forward');
    }

    // Hips should be more open than shoulders at impact
    if (impactM.xFactor < 10) {
      score -= 10;
      notes.push('Hips and shoulders arriving together at impact — hips should be more open');
    }

    // Head position: should not have moved significantly forward
    const headForward = impactM.headX - setupM.headX;
    if (Math.abs(headForward) > 0.1) {
      score -= 10;
      notes.push('Head position shifted too much at impact');
    }

    // Arms should be relatively extended at impact
    const avgArm = (impactM.leftArmAngle + impactM.rightArmAngle) / 2;
    if (avgArm < 140) {
      score -= 10;
      notes.push('Arms too bent at impact — extend through the ball');
    }

    return { score: Math.max(0, score), notes };
  }

  function scoreFollowThrough(metrics, phases) {
    const ftFrames = metrics.slice(phases.followStart, phases.finish + 1);
    if (ftFrames.length < 3) return { score: 50, notes: [] };

    let score = 100;
    const notes = [];
    const finishM = metrics[phases.finish];

    // Hands should finish high
    if (finishM.handHeight < 0) {
      score -= 15;
      notes.push('Follow-through too low — finish with hands high');
    }

    // Weight should be fully on front foot
    if (finishM.weightShift < 0.1) {
      score -= 10;
      notes.push('Not fully transferring weight to front foot in finish');
    }

    // Body should be facing target (chest turned through)
    if (finishM.shoulderWidth > metrics[phases.setup].shoulderWidth * 0.8) {
      // Shoulders still wide to camera = haven't rotated through
      score -= 10;
      notes.push('Incomplete rotation — body should face the target at finish');
    }

    // Balance check: head shouldn't drop or rise dramatically
    const headRange = Math.abs(finishM.headY - metrics[phases.impactFrame].headY);
    if (headRange > 0.1) {
      score -= 8;
      notes.push('Balance issue — head level changing during follow-through');
    }

    return { score: Math.max(0, score), notes };
  }

  /**
   * Estimate where the club face would strike the ball.
   * Returns { x, y } in -1..1 range on a club face diagram.
   * Also returns tendency description.
   */
  function estimateImpact(metrics, phases) {
    const impactM = metrics[phases.impactFrame];
    const setupM = metrics[phases.setup];
    if (!impactM || !setupM) {
      return { x: 0, y: 0, tendency: 'Unknown', description: 'Not enough data to estimate.' };
    }

    // Club path estimate based on hand movement direction at impact
    let handDX = 0, handDY = 0;
    const idx = phases.impactFrame;
    if (idx > 0 && idx < metrics.length - 1) {
      handDX = metrics[idx + 1].handX - metrics[idx - 1].handX;
      handDY = metrics[idx + 1].handY - metrics[idx - 1].handY;
    }

    // Club angle at impact
    const clubAng = impactM.clubAngle;

    // Estimate face strike position
    // Lateral: influenced by weight shift and hand position
    let strikeX = 0; // -1 = toe, 1 = heel
    const handOffset = impactM.handX - setupM.handX;
    strikeX = clamp(handOffset * 5, -1, 1);

    // Vertical: influenced by spine angle change and hand height
    let strikeY = 0; // -1 = low on face, 1 = high on face
    const spineChange = impactM.spineAngle - setupM.spineAngle;
    strikeY = clamp(-spineChange * 0.05, -1, 1);

    // Ball flight tendency
    let tendency = 'Straight';
    let description = '';

    // Weight back + hands behind = likely fat/thin
    if (impactM.weightShift < -0.15) {
      if (strikeY < -0.3) {
        tendency = 'Fat/Heavy';
        description = 'Weight staying back causes the club to bottom out behind the ball, hitting the ground first.';
      } else {
        tendency = 'Thin/Top';
        description = 'Weight back with rising through impact tends to catch the ball thin.';
      }
    } else if (Math.abs(strikeX) > 0.5) {
      if (strikeX > 0.5) {
        tendency = 'Heel Strike → Slice tendency';
        description = 'Hands too far from body at impact, hitting toward the heel. This opens the face and promotes a slice.';
      } else {
        tendency = 'Toe Strike → Hook tendency';
        description = 'Hands too close to body at impact, catching the toe. This closes the face and promotes a hook.';
      }
    } else if (Math.abs(strikeX) < 0.2 && Math.abs(strikeY) < 0.3) {
      tendency = 'Center Strike';
      description = 'Good contact! Strike is near the sweet spot.';
    } else {
      tendency = 'Slightly Off-Center';
      description = 'Contact is acceptable but could be more centered for better distance and control.';
    }

    return { x: strikeX, y: strikeY, tendency, description };
  }

  /**
   * Identify overall issues and generate improvement suggestions.
   */
  function identifyIssues(metrics, phases, phaseScores) {
    const problems = [];
    const suggestions = [];

    // Collect all notes from phase scores
    for (const [phase, data] of Object.entries(phaseScores)) {
      for (const note of data.notes) {
        problems.push(note);
      }
    }

    // Generate targeted suggestions based on worst phases
    const sortedPhases = Object.entries(phaseScores).sort((a, b) => a[1].score - b[1].score);
    const worstPhase = sortedPhases[0];

    if (worstPhase) {
      switch (worstPhase[0]) {
        case 'setup':
          suggestions.push('Practice your address position in a mirror — check spine angle and knee flex before every shot.');
          suggestions.push('Try the "chair drill": imagine sitting on a tall bar stool to find the right knee flex.');
          break;
        case 'backswing':
          suggestions.push('Focus on turning your shoulders 90° while keeping your lower body stable.');
          suggestions.push('Practice slow-motion backswings to feel the proper wrist hinge and shoulder turn.');
          break;
        case 'downswing':
          suggestions.push('Start the downswing by shifting your weight to the front foot BEFORE rotating your shoulders.');
          suggestions.push('Try the "step drill": lift your front foot in backswing, step it down to start the downswing.');
          break;
        case 'impact':
          suggestions.push('Practice hitting punch shots to feel the correct impact position — weight forward, hands ahead.');
          suggestions.push('Use impact bags or a towel drill to train the feel of proper compression.');
          break;
        case 'followThrough':
          suggestions.push('Hold your finish for 3 seconds after every swing — you should be balanced on your front foot.');
          suggestions.push('Your belt buckle should face the target at the finish.');
          break;
      }
    }

    // General suggestions based on common patterns
    if (problems.length === 0) {
      suggestions.push('Solid swing! Focus on consistency — repeat this motion with the same tempo.');
    }

    return { problems: problems.slice(0, 5), suggestions: suggestions.slice(0, 4) };
  }

  /**
   * Calculate overall score and grade.
   */
  function calculateOverall(phaseScores) {
    const weights = {
      setup: 0.15,
      backswing: 0.20,
      downswing: 0.25,
      impact: 0.25,
      followThrough: 0.15
    };

    let totalScore = 0;
    for (const [phase, data] of Object.entries(phaseScores)) {
      totalScore += data.score * (weights[phase] || 0.2);
    }

    const score = Math.round(totalScore);
    let grade;
    if (score >= 90) grade = 'Excellent';
    else if (score >= 75) grade = 'Good';
    else if (score >= 60) grade = 'Fair';
    else if (score >= 45) grade = 'Needs Work';
    else grade = 'Keep Practicing';

    return { score, grade };
  }

  // ===== Utility functions =====

  function angle3pt(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
    const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
    if (magAB === 0 || magCB === 0) return 180;
    const cos = clamp(dot / (magAB * magCB), -1, 1);
    return Math.acos(cos) * (180 / Math.PI);
  }

  function angleDeg(x1, y1, x2, y2, rx, ry) {
    const a1 = Math.atan2(y2 - y1, x2 - x1);
    const a2 = Math.atan2(ry - y1, rx - x1);
    let diff = (a1 - a2) * (180 / Math.PI);
    if (diff < 0) diff += 360;
    if (diff > 180) diff = 360 - diff;
    return diff;
  }

  function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function average(arr) {
    const result = {};
    if (arr.length === 0) return result;
    const keys = Object.keys(arr[0]);
    for (const key of keys) {
      result[key] = arr.reduce((sum, m) => sum + (m[key] || 0), 0) / arr.length;
    }
    return result;
  }

  return { analyze };
})();
