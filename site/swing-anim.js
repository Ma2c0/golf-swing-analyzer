/**
 * Golf swing animation — draws golfer silhouette + green MediaPipe skeleton
 * cycling through Address → Backswing → Top → Downswing → Impact → Follow-through.
 */
(function () {
  'use strict';

  // Joint indices
  const HEAD = 0, NECK = 1, L_SHLDR = 2, R_SHLDR = 3,
        L_ELBOW = 4, R_ELBOW = 5, L_WRIST = 6, R_WRIST = 7,
        L_HIP = 8, R_HIP = 9, L_KNEE = 10, R_KNEE = 11,
        L_ANKLE = 12, R_ANKLE = 13;

  // Keyframe poses [x, y] for each joint — 400×300 coordinate space
  // 0: Address, 1: Backswing-mid, 2: Top, 3: Downswing, 4: Impact, 5: Follow-through, 6: Finish
  const POSES = [
    // Address
    [[200,58],[198,86],[180,104],[218,104],[166,134],[202,134],[160,166],[160,166],[188,186],[220,186],[182,230],[228,230],[178,264],[232,264]],
    // Backswing mid
    [[206,56],[204,84],[184,100],[224,104],[160,108],[232,108],[142,102],[226,94],[190,186],[224,188],[184,230],[230,232],[180,264],[232,264]],
    // Top of backswing
    [[210,54],[208,82],[188,98],[230,104],[164,78],[238,80],[148,58],[228,62],[192,186],[226,190],[186,230],[232,234],[180,264],[234,264]],
    // Downswing
    [[204,56],[202,84],[182,100],[222,104],[162,122],[212,120],[156,150],[170,150],[190,186],[222,188],[184,230],[228,232],[178,264],[232,264]],
    // Impact
    [[198,58],[196,86],[178,104],[216,104],[164,136],[200,136],[158,168],[158,168],[188,186],[220,186],[182,230],[226,230],[178,264],[230,264]],
    // Follow-through
    [[192,52],[192,80],[176,98],[212,100],[186,72],[234,78],[208,48],[248,54],[192,186],[218,184],[188,232],[222,238],[182,264],[226,264]],
    // Finish (high hands)
    [[188,48],[190,76],[174,94],[210,96],[194,64],[236,72],[218,40],[250,46],[194,186],[216,184],[190,234],[220,240],[184,264],[224,264]],
  ];

  // Timing: fraction of total cycle for each pose
  const TIMING = [0, 0.12, 0.22, 0.34, 0.42, 0.58, 0.72];
  const CYCLE_MS = 3200;
  const PAUSE_MS = 800; // pause at address before restart

  // Skeleton connections
  const BONES = [
    [HEAD, NECK], [NECK, L_SHLDR], [NECK, R_SHLDR],
    [L_SHLDR, R_SHLDR], [L_SHLDR, L_ELBOW], [L_ELBOW, L_WRIST],
    [R_SHLDR, R_ELBOW], [R_ELBOW, R_WRIST],
    [NECK, L_HIP], [NECK, R_HIP],
    [L_HIP, R_HIP], [L_HIP, L_KNEE], [L_KNEE, L_ANKLE],
    [R_HIP, R_KNEE], [R_KNEE, R_ANKLE],
  ];

  // Club line: from average of wrists, extended
  function getClubEnd(joints) {
    const wx = (joints[L_WRIST][0] + joints[R_WRIST][0]) / 2;
    const wy = (joints[L_WRIST][1] + joints[R_WRIST][1]) / 2;
    const ex = (joints[L_ELBOW][0] + joints[R_ELBOW][0]) / 2;
    const ey = (joints[L_ELBOW][1] + joints[R_ELBOW][1]) / 2;
    const dx = wx - ex, dy = wy - ey;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const clubLen = 90;
    return [wx + (dx / len) * clubLen, wy + (dy / len) * clubLen];
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpPose(poseA, poseB, t) {
    return poseA.map((jA, i) => [lerp(jA[0], poseB[i][0], t), lerp(jA[1], poseB[i][1], t)]);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function getPoseAtTime(t) {
    // t is 0..1 within the swing portion (not including pause)
    t = Math.max(0, Math.min(1, t));
    // Find which segment we're in
    for (let i = 0; i < TIMING.length - 1; i++) {
      if (t >= TIMING[i] && t <= TIMING[i + 1]) {
        const seg = (t - TIMING[i]) / (TIMING[i + 1] - TIMING[i]);
        return lerpPose(POSES[i], POSES[i + 1], easeInOut(seg));
      }
    }
    // After last timing, lerp back to address
    const seg = (t - TIMING[TIMING.length - 1]) / (1 - TIMING[TIMING.length - 1]);
    return lerpPose(POSES[POSES.length - 1], POSES[0], easeInOut(seg));
  }

  // Draw background
  function drawBg(ctx, W, H) {
    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    skyGrad.addColorStop(0, '#E0D8C6');
    skyGrad.addColorStop(0.6, '#D0C8AE');
    skyGrad.addColorStop(1, '#B8C09E');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.62);

    // Distant trees
    ctx.fillStyle = 'rgba(100,130,80,.4)';
    drawEllipse(ctx, W * 0.2, H * 0.56, W * 0.18, H * 0.08);
    drawEllipse(ctx, W * 0.55, H * 0.58, W * 0.15, H * 0.07);
    drawEllipse(ctx, W * 0.82, H * 0.55, W * 0.2, H * 0.09);

    // Grass
    const grassGrad = ctx.createLinearGradient(0, H * 0.58, 0, H);
    grassGrad.addColorStop(0, '#8BA672');
    grassGrad.addColorStop(0.5, '#7A9860');
    grassGrad.addColorStop(1, '#6A8A50');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, H * 0.58, W, H * 0.42);

    // Subtle grass lines
    ctx.strokeStyle = 'rgba(90,130,60,.18)';
    ctx.lineWidth = 1;
    for (let y = H * 0.68; y < H; y += H * 0.1) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 2); ctx.stroke();
    }

    // Target line (dashed)
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(W / 2, H * 0.04); ctx.lineTo(W / 2, H * 0.96); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawEllipse(ctx, cx, cy, rx, ry) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Draw golfer silhouette body
  function drawBody(ctx, joints, W, H, sx, sy) {
    const j = joints.map(p => [p[0] * sx, p[1] * sy]);
    ctx.fillStyle = '#3A4A3E';

    // Head
    drawEllipse(ctx, j[HEAD][0], j[HEAD][1], 12 * sx, 14 * sy);
    // Cap brim
    ctx.fillStyle = '#2A2A24';
    ctx.beginPath();
    ctx.moveTo(j[HEAD][0] - 16 * sx, j[HEAD][1] - 4 * sy);
    ctx.quadraticCurveTo(j[HEAD][0], j[HEAD][1] - 18 * sy, j[HEAD][0] + 16 * sx, j[HEAD][1] - 4 * sy);
    ctx.quadraticCurveTo(j[HEAD][0] + 20 * sx, j[HEAD][1], j[HEAD][0] + 22 * sx, j[HEAD][1] + 2 * sy);
    ctx.lineTo(j[HEAD][0] - 14 * sx, j[HEAD][1] + 2 * sy);
    ctx.fill();

    // Torso
    ctx.fillStyle = '#3A4A3E';
    ctx.beginPath();
    ctx.moveTo(j[L_SHLDR][0], j[L_SHLDR][1]);
    ctx.quadraticCurveTo(j[L_SHLDR][0] - 8 * sx, (j[L_SHLDR][1] + j[L_HIP][1]) / 2, j[L_HIP][0], j[L_HIP][1]);
    ctx.lineTo(j[R_HIP][0], j[R_HIP][1]);
    ctx.quadraticCurveTo(j[R_SHLDR][0] + 8 * sx, (j[R_SHLDR][1] + j[R_HIP][1]) / 2, j[R_SHLDR][0], j[R_SHLDR][1]);
    ctx.fill();

    // Arms (thick lines)
    ctx.strokeStyle = '#3A4A3E'; ctx.lineCap = 'round';
    ctx.lineWidth = 10 * sx;
    drawLimb(ctx, j[L_SHLDR], j[L_ELBOW], j[L_WRIST]);
    drawLimb(ctx, j[R_SHLDR], j[R_ELBOW], j[R_WRIST]);

    // Hands (white glove)
    const hx = (j[L_WRIST][0] + j[R_WRIST][0]) / 2;
    const hy = (j[L_WRIST][1] + j[R_WRIST][1]) / 2;
    ctx.fillStyle = '#E8E0D4';
    drawEllipse(ctx, hx, hy, 8 * sx, 6 * sy);

    // Legs
    ctx.strokeStyle = '#2E3830'; ctx.lineWidth = 12 * sx;
    drawLimb(ctx, j[L_HIP], j[L_KNEE], j[L_ANKLE]);
    drawLimb(ctx, j[R_HIP], j[R_KNEE], j[R_ANKLE]);

    // Shoes
    ctx.fillStyle = '#E0DCD4';
    drawShoe(ctx, j[L_ANKLE], sx, sy, -1);
    drawShoe(ctx, j[R_ANKLE], sx, sy, 1);

    // Belt
    ctx.fillStyle = '#1E1E1A';
    ctx.fillRect(j[L_HIP][0], j[L_HIP][1] - 2 * sy, j[R_HIP][0] - j[L_HIP][0], 4 * sy);

    // Club
    const clubEnd = getClubEnd(joints);
    ctx.strokeStyle = '#B0B0B0'; ctx.lineWidth = 2.5 * sx;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(clubEnd[0] * sx, clubEnd[1] * sy); ctx.stroke();
    // Club head
    ctx.fillStyle = '#888';
    const cx = clubEnd[0] * sx, cy2 = clubEnd[1] * sy;
    const dx = cx - hx, dy = cy2 - hy;
    const angle = Math.atan2(dy, dx);
    ctx.save(); ctx.translate(cx, cy2); ctx.rotate(angle);
    ctx.fillRect(-2, -8 * sy, 16 * sx, 8 * sy);
    ctx.restore();
  }

  function drawLimb(ctx, a, b, c) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]); ctx.stroke();
  }

  function drawShoe(ctx, ankle, sx, sy, dir) {
    ctx.beginPath();
    ctx.ellipse(ankle[0] + dir * 4 * sx, ankle[1] + 6 * sy, 12 * sx, 5 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw green skeleton overlay
  function drawSkeleton(ctx, joints, W, H, sx, sy) {
    const j = joints.map(p => [p[0] * sx, p[1] * sy]);

    // Bones
    ctx.strokeStyle = '#2ECC71';
    ctx.lineWidth = 3 * sx;
    ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      ctx.beginPath(); ctx.moveTo(j[a][0], j[a][1]); ctx.lineTo(j[b][0], j[b][1]); ctx.stroke();
    }

    // Club line (dashed yellow)
    const hx = (j[L_WRIST][0] + j[R_WRIST][0]) / 2;
    const hy = (j[L_WRIST][1] + j[R_WRIST][1]) / 2;
    const clubEnd = getClubEnd(joints);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#F1C40F';
    ctx.lineWidth = 2.5 * sx;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(clubEnd[0] * sx, clubEnd[1] * sy); ctx.stroke();
    ctx.setLineDash([]);

    // Joint dots
    const importantJoints = [HEAD, L_SHLDR, R_SHLDR, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE];
    for (const idx of importantJoints) {
      ctx.beginPath();
      ctx.arc(j[idx][0], j[idx][1], 5 * sx, 0, Math.PI * 2);
      ctx.fillStyle = '#2ECC71';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.8 * sx;
      ctx.stroke();
    }
  }

  // Animation loop for one canvas
  function animate(canvas) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const W = canvas.width, H = canvas.height;
    const sx = W / 400, sy = H / 300;

    const totalMs = CYCLE_MS + PAUSE_MS;
    let start = null;

    function frame(ts) {
      if (!start) start = ts;
      const elapsed = (ts - start) % totalMs;

      ctx.clearRect(0, 0, W, H);
      drawBg(ctx, W, H);

      let t;
      if (elapsed < CYCLE_MS) {
        t = elapsed / CYCLE_MS;
      } else {
        t = 0; // pause at address
      }

      const joints = getPoseAtTime(t);
      drawBody(ctx, joints, W, H, sx, sy);
      drawSkeleton(ctx, joints, W, H, sx, sy);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Init all swing canvases
  function init() {
    document.querySelectorAll('.swing-canvas').forEach(c => animate(c));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
