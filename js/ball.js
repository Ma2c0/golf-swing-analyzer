/**
 * Ball-tracking module.
 *
 * Strategy (updated 2026-06-24, per "Path-A + physics fallback" plan):
 *
 *  1. Scan the entire pose-frame sequence for the first frame where we can
 *     spot the ball inside an ROI (club-head projection OR between the
 *     feet). That frame becomes our tracking anchor \u2014 it does NOT have
 *     to be the Setup frame.
 *
 *  2. From the anchor frame forward, attempt to follow the ball blob
 *     across frames (search radius grows with frame index).
 *
 *  3. If we lose the ball but already have at least 2 real points, fit a
 *     velocity vector to the last 2-3 real points and roll forward with
 *     a 2D projectile (gravity only, no drag/spin) until the ball would
 *     leave the frame. Those points are flagged `estimated = true` so
 *     the UI can draw them as dashed/translucent.
 *
 *  4. If we never find the ball at all, fall back to the wrists\u2019
 *     velocity at the impact frame as a *very rough* direction hint,
 *     and project a short estimated arc from a plausible address point
 *     (between the feet). Marked `estimated:true` end-to-end.
 *
 * Output:
 *   {
 *     tracked:      true|false,   // true when at least 1 real ball hit was found
 *     fullyEstimated: bool,       // true when ALL points come from physics only
 *     points: [{x,y,estimated?}], // normalized 0..1; real points lack `estimated`
 *     speedMph:    number|null,   // only present when reasonably confident
 *     speedRough:  bool,          // when speed should be displayed as "~XX mph"
 *     direction:   string|null,
 *     reason?:     string         // present when tracked=false (no usable data at all)
 *   }
 */
const BallTrackModule = (() => {

  const BALL_DIAMETER_M = 0.04267;
  const G_METRES = 9.81;                 // gravity

  // Detection tunables
  const ROI_PADDING_NORM = 0.18;   // was 0.10 鈥?widen club-head ROI
  const BRIGHT_THRESHOLD = 200;
  const MIN_BLOB_PIX     = 4;
  const MAX_BLOB_PIX     = 240;
  // Ball sanity filter: must sit in the lower portion of the frame so white
  // shoes / gloves / caps higher up don't poison the search.
  const MIN_Y_FOR_BALL   = 0.45;   // normalized 鈥?ball must be below this Y

  // Forward tracking
  const MAX_FORWARD_FRAMES = 18;         // how many post-anchor frames to scan
  const MAX_LOSS_TOLERANCE = 3;          // give up after N consecutive misses

  // Physics extrapolation
  const EXTRAP_MAX_FRAMES = 30;          // hard cap on projected points
  const EXTRAP_DT         = 0.020;       // seconds per projected step (~50fps)

  /**
   * Main entry point.
   *
   * @param {HTMLVideoElement} videoEl
   * @param {Array} frames           PoseModule frameData
   * @param {Object} phases          detectPhases() output
   * @param {function} onProgress    0..1
   * @returns {Promise<Object>}
   */
  async function track(videoEl, frames, phases, onProgress, opts) {
    if (!videoEl || !videoEl.duration || !frames || frames.length === 0 || !phases) {
      return { tracked: false, reason: 'missing-inputs' };
    }

    const w = videoEl.videoWidth  || 1280;
    const h = videoEl.videoHeight || 720;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    // ---- Step 1: anchor (manual hint first, else scan frames) ----
    let anchor = null;
    let anyRoiHadFrame = false;
    const N = frames.length;

    if (opts && opts.manualAnchor) {
      // User clicked the ball position. Map to nearest pose frame for timing.
      const m = opts.manualAnchor;
      let bestIdx = phases.setupEnd | 0;
      if (typeof m.t === 'number' && isFinite(m.t)) {
        let bestDt = Infinity;
        for (let i = 0; i < N; i++) {
          const ft = frameTime(frames[i]);
          if (!isFinite(ft)) continue;
          const d = Math.abs(ft - m.t);
          if (d < bestDt) { bestDt = d; bestIdx = i; }
        }
      }
      const t = frameTime(frames[bestIdx]);
      await seekVideo(videoEl, isFinite(t) ? t : (videoEl.currentTime || 0));
      ctx.drawImage(videoEl, 0, 0, w, h);
      const cx = m.x * w, cy = m.y * h;
      const half = Math.max(30, w * 0.05);
      const roi  = clampRect({ x: cx - half, y: cy - half, w: half * 2, h: half * 2 }, w, h);
      let pixR = 5;
      if (roi) {
        const blob = findBrightBlob(ctx, roi);
        if (blob) anchor = { idx: bestIdx, t, x: blob.x / w, y: blob.y / h, pixR: blob.radius };
      }
      if (!anchor) anchor = { idx: bestIdx, t, x: m.x, y: m.y, pixR };
      anyRoiHadFrame = true;
    } else {
      // Auto mode 鈥?try Setup鈫扵op window first (ball stationary), then rest.
      const order = autoScanOrder(N, phases);
      for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const t = frameTime(frames[i]);
        if (!isFinite(t)) continue;
        const rois = candidateRois(frames[i], w, h);
        if (rois.length === 0) continue;
        anyRoiHadFrame = true;
        await seekVideo(videoEl, t);
        ctx.drawImage(videoEl, 0, 0, w, h);
        for (const roi of rois) {
          const blob = findBrightBlob(ctx, roi);
          if (blob) {
            anchor = { idx: i, t, x: blob.x / w, y: blob.y / h, pixR: blob.radius };
            break;
          }
        }
        if (anchor) break;
        if (onProgress && (oi % 4 === 0)) onProgress(oi / (order.length + EXTRAP_MAX_FRAMES));
      }
    }

    // ---- Step 2: forward tracking from anchor ----
    let trajectory = [];      // real-detected ball positions
    if (anchor) {
      trajectory.push({ x: anchor.x, y: anchor.y, t: anchor.t, pixR: anchor.pixR });
      let last = trajectory[0];
      let lost = 0;
      const baseRadius = Math.max(36, anchor.pixR * 6);

      for (let k = 1; k <= MAX_FORWARD_FRAMES; k++) {
        const fi = anchor.idx + k;
        if (fi >= N) break;
        const t = frameTime(frames[fi]);
        if (!isFinite(t)) continue;
        await seekVideo(videoEl, t);
        ctx.drawImage(videoEl, 0, 0, w, h);

        const cx = last.x * w;
        const cy = last.y * h;
        let bias = { x: 0, y: 0 };
        if (trajectory.length >= 2) {
          const prev = trajectory[trajectory.length - 2];
          bias = {
            x: (last.x - prev.x) * w * (1 + k * 0.3),
            y: (last.y - prev.y) * h * (1 + k * 0.3)
          };
        }
        const radius = baseRadius * (1 + k * 0.35);
        const roi = clampRect({
          x: cx + bias.x - radius,
          y: cy + bias.y - radius,
          w: radius * 2,
          h: radius * 2
        }, w, h);
        if (!roi) { lost++; if (lost > MAX_LOSS_TOLERANCE) break; continue; }

        const blob = findBrightBlob(ctx, roi, last);
        if (blob) {
          const pt = { x: blob.x / w, y: blob.y / h, t, pixR: blob.radius };
          trajectory.push(pt);
          last = pt;
          lost = 0;
        } else {
          lost++;
          if (lost > MAX_LOSS_TOLERANCE) break;
        }
      }
    }

    // ---- Step 3: build the final trajectory (real + estimated) ----
    let points = trajectory.map(p => ({ x: p.x, y: p.y }));
    let speedMph = null;
    let speedRough = false;
    let direction = null;
    let fullyEstimated = false;
    let reason;

    if (trajectory.length >= 2) {
      // We have at least two real points \u2014 compute pixel velocity, real
      // speed in mph, then keep projecting until the arc leaves the frame.
      const v = computeVelocity(trajectory, w, h);
      const { mph, pxPerMetre } = estimateSpeed(trajectory, w, h);
      speedMph = mph != null ? Math.round(mph) : null;
      // Out-of-range speeds are flagged "rough" rather than hidden
      if (speedMph != null && (speedMph < 30 || speedMph > 220)) {
        speedRough = true;
      }
      direction = directionFromVelocity(v);

      // Extend with physics if the last real point is still inside the frame
      const lastReal = trajectory[trajectory.length - 1];
      if (insideFrame(lastReal.x, lastReal.y)) {
        const projected = projectile(
          lastReal,
          v,         // {vx, vy} in normalized units per second
          pxPerMetre,
          w, h
        );
        for (const pt of projected) {
          points.push({ x: pt.x, y: pt.y, estimated: true });
        }
      }
    } else if (trajectory.length === 1) {
      // Single real hit \u2014 fall back to wrist-velocity direction (B6)
      const v = wristVelocityAtImpact(frames, phases, w, h);
      if (v) {
        direction = directionFromVelocity(v);
        const projected = projectile(
          trajectory[0],
          v,
          120,   // assume ~120 px/m if no scale info
          w, h
        );
        for (const pt of projected) {
          points.push({ x: pt.x, y: pt.y, estimated: true });
        }
        speedRough = true; // anything we report is rough
      }
    } else {
      // No real detection at all \u2014 try fully-estimated trajectory using
      // wrist velocity + plausible address point between the feet.
      const v = wristVelocityAtImpact(frames, phases, w, h);
      const anchorPt = guessAddressPoint(frames, phases);
      if (v && anchorPt) {
        fullyEstimated = true;
        direction = directionFromVelocity(v);
        speedRough = true;
        // No real speed reference, leave speedMph null.
        const projected = projectile(anchorPt, v, 120, w, h);
        points.push({ x: anchorPt.x, y: anchorPt.y, estimated: true });
        for (const pt of projected) {
          points.push({ x: pt.x, y: pt.y, estimated: true });
        }
      } else {
        return {
          tracked: false,
          reason: anyRoiHadFrame ? 'ball-not-in-frame' : 'no-roi'
        };
      }
    }

    if (points.length < 2) {
      return { tracked: false, reason: 'too-few-points' };
    }

    return {
      tracked: trajectory.length >= 1,
      fullyEstimated,
      points,
      speedMph: speedRough ? null : speedMph,
      speedRough,
      direction,
      reason
    };
  }

  /* ============= helpers ============= */

  function frameTime(f) {
    if (!f) return NaN;
    return (f.videoTime != null) ? f.videoTime : NaN;
  }

  function seekVideo(v, t) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; v.removeEventListener('seeked', finish); resolve(); };
      v.addEventListener('seeked', finish, { once: true });
      try { v.currentTime = Math.min(Math.max(0, t), (v.duration || 0) - 0.001); }
      catch (_) { finish(); }
      setTimeout(finish, 600);
    });
  }

  /**
   * Candidate ROIs per frame:
   *   1. wider club-head projection (DTL / forward)
   *   2. between-the-feet ground area (face-on)
   *   3. full lower half of the frame (catch-all, last resort)
   *
   * All blobs are post-filtered to the lower portion of the frame
   * (y > MIN_Y_FOR_BALL) so white shoes / gloves / caps higher in the
   * image can't pollute results.
   */
  function candidateRois(frame, w, h) {
    const out = [];
    const lm = frame && frame.landmarks;
    const pad = ROI_PADDING_NORM * Math.max(w, h);

    if (lm) {
      const LW = lm[15], RW = lm[16], LE = lm[13], RE = lm[14];
      const LA = lm[27], RA = lm[28];
      const LK = lm[25], RK = lm[26];

      // ROI 1 鈥?club head projection (wider, biased further down the shaft)
      if (LW && RW && LE && RE
          && (LW.visibility ?? 0) >= 0.3 && (RW.visibility ?? 0) >= 0.3) {
        const wristX = (LW.x + RW.x) / 2, wristY = (LW.y + RW.y) / 2;
        const elbowX = (LE.x + RE.x) / 2, elbowY = (LE.y + RE.y) / 2;
        const dx = wristX - elbowX, dy = wristY - elbowY;
        const len = Math.hypot(dx, dy);
        if (len >= 0.01) {
          // 0.55 (was 0.40) 鈥?push ROI further along the shaft toward the ball
          const headX = wristX + (dx / len) * 0.55;
          const headY = wristY + (dy / len) * 0.55;
          const r = clampRect({ x: headX * w - pad, y: (headY + 0.04) * h - pad, w: pad * 2, h: pad * 2 }, w, h);
          if (r) out.push(r);
        }
      }

      // ROI 2 鈥?between/around the feet at ground level
      let footL = null, footR = null;
      if (LA && RA && (LA.visibility ?? 0) >= 0.25 && (RA.visibility ?? 0) >= 0.25) {
        footL = LA; footR = RA;
      } else if (LK && RK && (LK.visibility ?? 0) >= 0.25 && (RK.visibility ?? 0) >= 0.25) {
        footL = LK; footR = RK;
      }
      if (footL && footR) {
        const midX = (footL.x + footR.x) / 2;
        const midY = (footL.y + footR.y) / 2;
        const stance = Math.abs(footL.x - footR.x);
        const halfW = Math.max(pad, Math.min(stance * w * 0.9, w * 0.22));
        const halfH = Math.max(pad, h * 0.12);
        const r = clampRect({ x: midX * w - halfW, y: (midY + 0.03) * h - halfH, w: halfW * 2, h: halfH * 2 }, w, h);
        if (r) out.push(r);
      }
    }

    // ROI 3 鈥?catch-all: lower 55% of the image (ground area).
    {
      const yStart = Math.floor(h * MIN_Y_FOR_BALL);
      const r = clampRect({ x: 0, y: yStart, w: w, h: h - yStart }, w, h);
      if (r) out.push(r);
    }

    return out;
  }

  /**
   * Frame index order for automatic ball search. Stationary window
   * (Setup 鈫?Top) has the highest signal-to-noise for a small ball.
   */
  function autoScanOrder(N, phases) {
    const list = [];
    const seen = new Set();
    const push = (i) => {
      const j = Math.max(0, Math.min(N - 1, i));
      if (!seen.has(j)) { seen.add(j); list.push(j); }
    };
    const sE = phases.setupEnd | 0;
    const top = phases.top | 0;
    const imp = phases.impactFrame | 0;
    for (let i = sE; i >= 0; i--) push(i);
    for (let i = sE + 1; i <= top; i++) push(i);
    for (let i = top + 1; i <= imp; i++) push(i);
    for (let i = imp + 1; i < N; i++) push(i);
    return list;
  }

  function clampRect(r, w, h) {
    const x = Math.max(0, Math.min(w - 2, Math.floor(r.x)));
    const y = Math.max(0, Math.min(h - 2, Math.floor(r.y)));
    const rw = Math.max(2, Math.min(w - x, Math.floor(r.w)));
    const rh = Math.max(2, Math.min(h - y, Math.floor(r.h)));
    if (rw < 4 || rh < 4) return null;
    return { x, y, w: rw, h: rh };
  }

  function findBrightBlob(ctx, roi, lastBall) {
    let imgData;
    try { imgData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h); }
    catch (_) { return null; }
    const d = imgData.data;
    const W = roi.w, H = roi.h;
    const mask = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      const lum = (d[p] * 0.299 + d[p+1] * 0.587 + d[p+2] * 0.114) | 0;
      const max = Math.max(d[p], d[p+1], d[p+2]);
      const min = Math.min(d[p], d[p+1], d[p+2]);
      const sat = max > 0 ? (max - min) / max : 0;
      mask[i] = (lum >= BRIGHT_THRESHOLD && sat < 0.25) ? 1 : 0;
    }
    const visited = new Uint8Array(W * H);
    const blobs = [];
    const stack = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!mask[idx] || visited[idx]) continue;
        let count = 0, sumX = 0, sumY = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        stack.length = 0; stack.push(idx);
        while (stack.length) {
          const ci = stack.pop();
          if (visited[ci]) continue;
          visited[ci] = 1;
          const cx = ci % W;
          const cy = (ci - cx) / W;
          count++;
          sumX += cx; sumY += cy;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          if (cx > 0 && mask[ci - 1] && !visited[ci - 1]) stack.push(ci - 1);
          if (cx < W - 1 && mask[ci + 1] && !visited[ci + 1]) stack.push(ci + 1);
          if (cy > 0 && mask[ci - W] && !visited[ci - W]) stack.push(ci - W);
          if (cy < H - 1 && mask[ci + W] && !visited[ci + W]) stack.push(ci + W);
          if (count > MAX_BLOB_PIX) break;
        }
        if (count < MIN_BLOB_PIX || count > MAX_BLOB_PIX) continue;
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const aspect = bw / Math.max(1, bh);
        if (aspect < 0.4 || aspect > 2.5) continue;
        const centroidY = roi.y + sumY / count;
        // Reject blobs above the ground threshold 鈥?these are almost
        // certainly white clothing (shoes, gloves, hat), not the ball.
        // Only applied during the initial search (no `lastBall` reference);
        // once we are tracking, the previous-position bias is enough.
        const fullH = ctx.canvas.height;
        if (!lastBall && centroidY / fullH < MIN_Y_FOR_BALL) continue;
        blobs.push({
          x: roi.x + sumX / count,
          y: centroidY,
          radius: Math.sqrt(count / Math.PI),
          count
        });
      }
    }
    if (blobs.length === 0) return null;
    const fullH = ctx.canvas.height;
    blobs.sort((a, b) => {
      if (lastBall) {
        return Math.abs(a.radius - lastBall.pixR) - Math.abs(b.radius - lastBall.pixR);
      }
      // Prefer blobs lower in the frame (ball sits on ground), then size
      // close to typical ball radius.
      const ya = a.y / fullH, yb = b.y / fullH;
      if (Math.abs(yb - ya) > 0.05) return yb - ya;
      return Math.abs(a.radius - 6) - Math.abs(b.radius - 6);
    });
    return blobs[0];
  }

  /**
   * Compute normalized velocity (units per second) from the last 2-3 points.
   */
  function computeVelocity(trajectory) {
    const tail = trajectory.slice(-3);
    const a = tail[0];
    const b = tail[tail.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  /**
   * Convert pixel distance + ball-radius scale to a real speed (mph).
   */
  function estimateSpeed(trajectory, w, h) {
    let avgR = 0, n = 0;
    for (const p of trajectory) { if (p.pixR) { avgR += p.pixR; n++; } }
    avgR = n > 0 ? avgR / n : 6;
    const pxPerMetre = (2 * avgR) / BALL_DIAMETER_M;
    const a = trajectory[0];
    const b = trajectory[trajectory.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return { mph: null, pxPerMetre };
    const pixDist = Math.hypot((b.x - a.x) * w, (b.y - a.y) * h);
    const metres = pixDist / pxPerMetre;
    const mph = (metres / dt) * 2.23694;
    return { mph, pxPerMetre };
  }

  /**
   * Direction label from a velocity vector in normalized image coords.
   * Assumes typical DTL/face-on framing: upward motion is target-line forward.
   */
  function directionFromVelocity(v) {
    const angleDeg = Math.atan2(v.vx, -v.vy) * 180 / Math.PI;
    if (angleDeg < -25)      return 'Pull';
    if (angleDeg < -10)      return 'Pull-Draw';
    if (angleDeg >  25)      return 'Slice';
    if (angleDeg >  10)      return 'Push-Fade';
    return 'Straight';
  }

  /**
   * 2D projectile motion in *image space*. Gravity acts downward (+y in
   * image coords). Steps until the projected point leaves the frame.
   */
  function projectile(start, v0, pxPerMetre, w, h) {
    const out = [];
    // Convert image-Y velocity to metres/sec to apply gravity, then back.
    const px2m = 1 / pxPerMetre;
    // vy in normalized: 1 unit = full image height. metres-per-second:
    // vy_m = v0.vy * h * px2m
    let x = start.x, y = start.y;
    let vx = v0.vx;        // normalized per second
    let vy = v0.vy;        // normalized per second
    const aY_m = G_METRES; // m/s^2 downward
    // image-Y/s^2 gravity expressed in normalized units:
    // a_norm = aY_m * pxPerMetre / h * dt... but we just integrate per step.
    const dt = EXTRAP_DT;
    for (let i = 0; i < EXTRAP_MAX_FRAMES; i++) {
      // Apply gravity in *image* units (downward).
      vy += (aY_m * pxPerMetre / h) * dt;
      x  += vx * dt;
      y  += vy * dt;
      if (!insideFrame(x, y, 0.06)) {
        // Add one final point just at the edge so the line touches the frame.
        out.push({ x: clamp01(x), y: clamp01(y) });
        break;
      }
      out.push({ x, y });
    }
    return out;
  }

  function insideFrame(x, y, margin = 0) {
    return x > -margin && x < 1 + margin && y > -margin && y < 1 + margin;
  }
  function clamp01(v) { return Math.max(-0.05, Math.min(1.05, v)); }

  /**
   * Estimate wrist velocity around the impact frame in normalized units/sec.
   * Used as a coarse direction proxy when ball detection fails entirely.
   */
  function wristVelocityAtImpact(frames, phases, w, h) {
    const i = Math.max(0, Math.min(frames.length - 2, phases.impactFrame | 0));
    const a = frames[Math.max(0, i - 2)];
    const b = frames[Math.min(frames.length - 1, i + 2)];
    if (!a || !b) return null;
    const ta = frameTime(a), tb = frameTime(b);
    if (!isFinite(ta) || !isFinite(tb) || tb <= ta) return null;
    const wristA = wristMid(a);
    const wristB = wristMid(b);
    if (!wristA || !wristB) return null;
    // Direction the hands are moving. Scale up to make it visually plausible
    // for a ball (the ball goes much faster than the hands at impact \u2014
    // multiply by ~3 so the projected arc isn\u2019t pathetic).
    const dt = tb - ta;
    return {
      vx: ((wristB.x - wristA.x) / dt) * 3,
      vy: ((wristB.y - wristA.y) / dt) * 3
    };
  }
  function wristMid(frame) {
    const lw = frame.landmarks[15], rw = frame.landmarks[16];
    if (!lw || !rw) return null;
    if ((lw.visibility ?? 0) < 0.25 && (rw.visibility ?? 0) < 0.25) return null;
    return { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
  }

  /**
   * Guess where the ball would be at address: between the feet at ground
   * level. Returns normalized {x,y} or null.
   */
  function guessAddressPoint(frames, phases) {
    const i = Math.max(0, Math.min(frames.length - 1, phases.setup | 0));
    const f = frames[i] || frames[0];
    const lm = f.landmarks;
    const LA = lm[27], RA = lm[28];
    const LK = lm[25], RK = lm[26];
    let footL = null, footR = null;
    if (LA && RA && (LA.visibility ?? 0) >= 0.2 && (RA.visibility ?? 0) >= 0.2) {
      footL = LA; footR = RA;
    } else if (LK && RK && (LK.visibility ?? 0) >= 0.2 && (RK.visibility ?? 0) >= 0.2) {
      footL = LK; footR = RK;
    }
    if (!footL || !footR) return null;
    return { x: (footL.x + footR.x) / 2, y: Math.min(0.95, (footL.y + footR.y) / 2 + 0.04) };
  }

  return { track };
})();
