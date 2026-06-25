/**
 * Ball-tracking module.
 *
 * Strategy for uploaded videos (Algorithm 2, see issue 2026-06-24):
 *  1. Find the impact frame index (handed in by AnalysisModule).
 *  2. Build an ROI in front of the estimated club head (which we approximate
 *     from wrist + elbow landmarks projected forward) ~0.2s before impact.
 *     This dramatically narrows the search vs scanning the whole frame.
 *  3. Find the brightest, roundest small white blob in that ROI \u2014 that's
 *     the static ball at address.
 *  4. From the impact frame forward, scan ~12 frames looking for the same
 *     blob within a growing search radius (the ball accelerates, so the
 *     window expands frame to frame).
 *  5. Output a trajectory polyline (in normalized 0..1 coords), an estimate
 *     of ball speed (mph), and a left/straight/right direction label.
 *
 * Output object shape:
 *   {
 *     tracked: true|false,
 *     points:   [{x,y}, ...]  // normalized 0..1, in chronological order
 *     speedMph: number,        // approximate, may be \u00b120mph
 *     direction: 'Pull'|'Straight'|'Slice'|'Pull-Hook'|'Push-Slice',
 *     reason?:  string         // why tracking failed (when tracked=false)
 *   }
 */
const BallTrackModule = (() => {

  // A regulation golf ball is 42.67mm in diameter \u2014 used to convert pixel
  // distances into real-world metres.
  const BALL_DIAMETER_M = 0.04267;

  // Tunables
  const SEARCH_FRAMES_AFTER = 12;   // how many frames after impact to scan
  const SEARCH_FRAMES_BEFORE = 6;   // how many frames before impact to look for the address ball
  const ROI_PADDING_NORM   = 0.10;  // ROI half-size around predicted club head, in normalized coords
  const BRIGHT_THRESHOLD   = 200;   // 0\u2013255 luminance for "white-ish" pixel
  const MIN_BLOB_PIX       = 6;     // min connected-pixel count to be considered a ball
  const MAX_BLOB_PIX       = 220;   // max so we ignore large white objects (shirts, walls)

  /**
   * Main entry point.
   *
   * @param {HTMLVideoElement} videoEl  \u2014 the (already-loaded) video
   * @param {Array} frames               \u2014 PoseModule frameData (same shape as AnalysisModule expects)
   * @param {Object} phases              \u2014 detectPhases() output
   * @param {function} onProgress        \u2014 optional progress callback (0..1)
   * @returns {Promise<Object>}
   */
  async function track(videoEl, frames, phases, onProgress) {
    if (!videoEl || !videoEl.duration || !frames || frames.length === 0 || !phases) {
      return { tracked: false, reason: 'missing-inputs' };
    }

    const impactIdx = clampIdx(phases.impactFrame, frames);
    const setupTime = frameTime(frames[Math.max(0, impactIdx - SEARCH_FRAMES_BEFORE)]);
    const impactTime = frameTime(frames[impactIdx]);
    if (!isFinite(setupTime) || !isFinite(impactTime)) {
      return { tracked: false, reason: 'no-timestamps' };
    }

    // Set up scratch canvases
    const w = videoEl.videoWidth  || 1280;
    const h = videoEl.videoHeight || 720;
    const sourceCv = document.createElement('canvas');
    sourceCv.width = w; sourceCv.height = h;
    const sourceCx = sourceCv.getContext('2d', { willReadFrequently: true });

    // --- Phase 1: find the address ball -----------------------------------
    // Try multiple ROIs per frame so this works for DTL (club-head forward)
    // AND face-on (between/below the feet). First hit wins.
    let addressBall = null;
    let anyRoiHadFrame = false;
    for (let i = SEARCH_FRAMES_BEFORE; i >= 0 && !addressBall; i--) {
      const fIdx = Math.max(0, impactIdx - i);
      const t = frameTime(frames[fIdx]);
      if (!isFinite(t)) continue;
      const rois = candidateRois(frames[fIdx], w, h);
      if (rois.length === 0) continue;
      anyRoiHadFrame = true;
      await seekVideo(videoEl, t);
      sourceCx.drawImage(videoEl, 0, 0, w, h);
      for (const roi of rois) {
        const blob = findBrightBlob(sourceCx, roi);
        if (blob) {
          addressBall = { x: blob.x / w, y: blob.y / h, t, pixR: blob.radius };
          break;
        }
      }
      if (onProgress) onProgress((SEARCH_FRAMES_BEFORE - i) / (SEARCH_FRAMES_BEFORE * 2 + SEARCH_FRAMES_AFTER));
    }
    if (!addressBall) {
      // Distinguish "we never even built an ROI" from "we built ROIs but
      // found nothing white in them" — the latter usually means the ball
      // is out of frame.
      return {
        tracked: false,
        reason: anyRoiHadFrame ? 'ball-not-in-frame' : 'no-roi'
      };
    }

    // --- Phase 2: track forward through impact + follow-through ----------
    const trajectory = [addressBall];
    let last = addressBall;
    // search radius grows: ball accelerates fast post-impact
    const baseRadius = Math.max(40, last.pixR * 6);
    for (let k = 1; k <= SEARCH_FRAMES_AFTER; k++) {
      const fi = impactIdx + k;
      if (fi >= frames.length) break;
      const t = frameTime(frames[fi]);
      if (!isFinite(t)) continue;
      await seekVideo(videoEl, t);
      sourceCx.drawImage(videoEl, 0, 0, w, h);

      // Search window grows with k. Centered on the last known position +
      // a forward bias along the recent direction of travel.
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
        x: Math.max(0, cx + bias.x - radius),
        y: Math.max(0, cy + bias.y - radius),
        w: radius * 2,
        h: radius * 2
      }, w, h);
      if (!roi) break;

      const blob = findBrightBlob(sourceCx, roi, last);
      if (!blob) {
        // try one more frame before giving up
        if (k > 4 && trajectory.length >= 4) break;
        continue;
      }
      const pt = { x: blob.x / w, y: blob.y / h, t, pixR: blob.radius };
      trajectory.push(pt);
      last = pt;

      if (onProgress) {
        onProgress((SEARCH_FRAMES_BEFORE + k) / (SEARCH_FRAMES_BEFORE * 2 + SEARCH_FRAMES_AFTER));
      }
    }

    // Need at least 3 trajectory points to estimate speed/direction
    if (trajectory.length < 3) {
      return { tracked: false, reason: 'lost-after-impact', points: trajectory.map(p => ({ x: p.x, y: p.y })) };
    }

    // --- Phase 3: estimate speed & direction -----------------------------
    const start = trajectory[0];
    const end   = trajectory[trajectory.length - 1];
    const dt    = end.t - start.t;
    const pixDx = (end.x - start.x) * w;
    const pixDy = (end.y - start.y) * h;
    const pixDist = Math.sqrt(pixDx * pixDx + pixDy * pixDy);

    // Pixels-per-metre from ball diameter (use average pixel radius across trajectory)
    let avgR = 0; let n = 0;
    for (const p of trajectory) { if (p.pixR) { avgR += p.pixR; n++; } }
    avgR = n > 0 ? (avgR / n) : 6;
    const pxPerMetre = (2 * avgR) / BALL_DIAMETER_M;

    const metres = pixDist / pxPerMetre;
    const mps    = dt > 0 ? metres / dt : 0;
    const mph    = mps * 2.23694;

    // Direction: angle of travel in the frame plane.
    // For DTL view (looking down the line), the ball normally travels mostly
    // away from camera (small movement in image plane), but lateral pull/slice
    // shows clearly as horizontal drift.
    const angleDeg = Math.atan2(pixDx, -pixDy) * 180 / Math.PI;
    let direction;
    if (angleDeg < -25)      direction = 'Pull';
    else if (angleDeg < -10) direction = 'Pull-Draw';
    else if (angleDeg > 25)  direction = 'Slice';
    else if (angleDeg > 10)  direction = 'Push-Fade';
    else                     direction = 'Straight';

    // Sanity-check the speed estimate. A wedge can hit ~90 mph ball; a
    // driver ~170 mph. Anything outside 30\u2013220 mph is almost certainly
    // a tracking artefact.
    if (mph < 30 || mph > 220) {
      return {
        tracked: true,
        points: trajectory.map(p => ({ x: p.x, y: p.y })),
        speedMph: null,
        direction,
        reason: 'speed-out-of-range'
      };
    }

    return {
      tracked: true,
      points: trajectory.map(p => ({ x: p.x, y: p.y })),
      speedMph: Math.round(mph),
      direction
    };
  }

  /* -------------------- helpers -------------------- */

  function clampIdx(i, frames) {
    return Math.max(0, Math.min(frames.length - 1, i | 0));
  }
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
   * Return one or more pixel-space ROIs where the ball might be at address.
   *  - ROI 1 (DTL-style): in front of the projected club head
   *  - ROI 2 (face-on / always-on): between the feet at ground level
   * We always include ROI 2 because it costs nothing and dramatically
   * improves face-on coverage.
   */
  function candidateRois(frame, w, h) {
    const out = [];
    const lm = frame && frame.landmarks;
    if (!lm) return out;

    const LW = lm[15], RW = lm[16], LE = lm[13], RE = lm[14];
    const LA = lm[27], RA = lm[28];   // ankles
    const LK = lm[25], RK = lm[26];   // knees
    const pad = ROI_PADDING_NORM * Math.max(w, h);

    // -- ROI 1: club head projection (DTL style) --
    if (LW && RW && LE && RE
        && (LW.visibility ?? 0) >= 0.3 && (RW.visibility ?? 0) >= 0.3) {
      const wristX = (LW.x + RW.x) / 2;
      const wristY = (LW.y + RW.y) / 2;
      const elbowX = (LE.x + RE.x) / 2;
      const elbowY = (LE.y + RE.y) / 2;
      const dx = wristX - elbowX;
      const dy = wristY - elbowY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len >= 0.01) {
        const clubScale = 0.40;
        const headX = wristX + (dx / len) * clubScale;
        const headY = wristY + (dy / len) * clubScale;
        const cx = headX * w;
        const cy = (headY + 0.02) * h;
        const r = clampRect({ x: cx - pad, y: cy - pad, w: pad * 2, h: pad * 2 }, w, h);
        if (r) out.push(r);
      }
    }

    // -- ROI 2: between/below the feet (face-on style; works for DTL too) --
    // Use ankles if visible, else fall back to knees.
    let footL = null, footR = null;
    if (LA && RA && (LA.visibility ?? 0) >= 0.25 && (RA.visibility ?? 0) >= 0.25) {
      footL = LA; footR = RA;
    } else if (LK && RK && (LK.visibility ?? 0) >= 0.25 && (RK.visibility ?? 0) >= 0.25) {
      footL = LK; footR = RK;
    }
    if (footL && footR) {
      const midX = (footL.x + footR.x) / 2;
      const midY = (footL.y + footR.y) / 2;
      // Stance width gives us a width estimate for the ROI — cap it so
      // we don't search the entire image when ankles are misdetected.
      const stance = Math.abs(footL.x - footR.x);
      const halfW = Math.max(pad, Math.min(stance * w * 0.7, w * 0.18));
      // Sweep from feet level slightly upward, since the ball sits in front
      // of the player (between heels) and may project above the ankle line.
      const halfH = Math.max(pad, h * 0.10);
      const cx = midX * w;
      // Bias down ~3% so the ROI includes the ground line, not just feet.
      const cy = (midY + 0.03) * h;
      const r = clampRect({ x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 }, w, h);
      if (r) out.push(r);
    }

    return out;
  }

  function clampRect(r, w, h) {
    const x = Math.max(0, Math.min(w - 2, Math.floor(r.x)));
    const y = Math.max(0, Math.min(h - 2, Math.floor(r.y)));
    const rw = Math.max(2, Math.min(w - x, Math.floor(r.w)));
    const rh = Math.max(2, Math.min(h - y, Math.floor(r.h)));
    if (rw < 4 || rh < 4) return null;
    return { x, y, w: rw, h: rh };
  }

  /**
   * Find the brightest small round blob inside an ROI.
   * Optional `lastBall` lets us prefer blobs of similar size for tracking.
   * Returns { x, y, radius } in *image* coords, or null.
   */
  function findBrightBlob(ctx, roi, lastBall) {
    let imgData;
    try { imgData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h); }
    catch (_) { return null; }
    const d = imgData.data;
    const W = roi.w, H = roi.h;

    // Simple luminance threshold mask
    const mask = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      // Quick luminance approximation
      const lum = (d[p] * 0.299 + d[p+1] * 0.587 + d[p+2] * 0.114) | 0;
      // Also require fairly desaturated (white-ish, not green grass)
      const max = Math.max(d[p], d[p+1], d[p+2]);
      const min = Math.min(d[p], d[p+1], d[p+2]);
      const sat = max > 0 ? (max - min) / max : 0;
      mask[i] = (lum >= BRIGHT_THRESHOLD && sat < 0.25) ? 1 : 0;
    }

    // Connected-component labeling (flood fill) to find blob centroids
    const visited = new Uint8Array(W * H);
    const blobs = [];
    const stack = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!mask[idx] || visited[idx]) continue;
        // BFS over this connected blob
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
          if (count > MAX_BLOB_PIX) break; // bail: too large to be a ball
        }
        if (count < MIN_BLOB_PIX || count > MAX_BLOB_PIX) continue;
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const aspect = bw / Math.max(1, bh);
        if (aspect < 0.5 || aspect > 2.0) continue;
        const cxAvg = sumX / count;
        const cyAvg = sumY / count;
        const radius = Math.sqrt(count / Math.PI);
        blobs.push({
          x: roi.x + cxAvg,
          y: roi.y + cyAvg,
          radius,
          count
        });
      }
    }
    if (blobs.length === 0) return null;

    // Pick the best blob. If we have a previous frame, prefer similar radius.
    blobs.sort((a, b) => {
      if (lastBall) {
        const da = Math.abs(a.radius - lastBall.pixR);
        const db = Math.abs(b.radius - lastBall.pixR);
        return da - db;
      }
      // Otherwise just take the smallest reasonable blob (closer to a ball)
      return Math.abs(a.radius - 6) - Math.abs(b.radius - 6);
    });
    return blobs[0];
  }

  return { track };
})();
