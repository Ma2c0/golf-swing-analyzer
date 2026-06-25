/**
 * Birdie App — Record / Journal / Analysis
 */
(async function () {
  'use strict';

  // ===== NAVIGATION =====
  const tabBar    = document.getElementById('tab-bar');
  const railBtns  = document.querySelectorAll('.rail-btn');
  const railSlider = document.getElementById('rail-slider');
  const fsIds     = new Set(['screen-analyzing', 'screen-upload-preview', 'screen-mark-ball']);

  function showTab(id) {
    document.querySelectorAll('.tab-screen').forEach(s => s.classList.remove('active', 'fs'));
    const el = document.getElementById(id);
    if (!el) return;
    const fs = fsIds.has(id);
    el.classList.add('active');
    if (fs) el.classList.add('fs');
    tabBar.classList.toggle('hidden', fs);

    const map = { 'tab-record': 'record', 'tab-journal': 'journal', 'tab-analysis': 'analysis' };
    const posMap = { 'record': '0', 'journal': '1', 'analysis': '2' };
    const active = map[id];
    if (active) {
      railBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === active));
      railSlider.dataset.pos = posMap[active];
    }
  }

  railBtns.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    if (t === 'record')   { showTab('tab-record'); startCameraPreview(); }
    else if (t === 'journal')  { showTab('tab-journal'); renderJournal(); }
    else if (t === 'analysis') { showTab('tab-analysis'); showLatestAnalysis(); }
  }));

  document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => {
    const g = el.dataset.goto;
    if (g === 'record') { showTab('tab-record'); startCameraPreview(); }
  }));

  // ===== STORAGE =====
  function getSwings() {
    try { return JSON.parse(localStorage.getItem('birdie_swings') || '[]'); } catch { return []; }
  }
  function saveSwing(result, club) {
    const swings = getSwings();
    swings.unshift({
      id: Date.now(),
      date: new Date().toISOString(),
      club: club || '7-Iron',
      score: result.score,
      grade: result.grade,
      phases: result.phases,
      impact: result.impact,
      issues: result.issues,
      improvements: result.improvements,
      frameCount: result.frameCount,
      duration: result.duration,
      ball: result.ball || null
    });
    if (swings.length > 50) swings.length = 50;
    localStorage.setItem('birdie_swings', JSON.stringify(swings));
  }


  // ===== JOURNAL =====
  function renderJournal() {
    const swings = getSwings();
    const emptyEl = document.getElementById('journal-empty');
    const contentEl = document.getElementById('journal-content');

    if (swings.length === 0) {
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const latest = swings[0];
    const total = swings.length;

    // Meta line
    const d = new Date(latest.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('journal-meta').textContent =
      `${dateStr}  /  Session #${total}  /  ${latest.club || '7-Iron'}`;

    // Headline + description
    const headline = generateHeadline(latest);
    document.getElementById('journal-headline').textContent = headline.title;
    document.getElementById('journal-desc').textContent = headline.desc;

    // Score ring
    const score = latest.score;
    const color = UIModule.scoreColor(score);
    document.getElementById('journal-score-num').textContent = score;
    document.getElementById('journal-grade').textContent = latest.grade;
    document.getElementById('journal-grade').style.color = color;

    const ringFill = document.getElementById('journal-ring-fill');
    const circumference = 2 * Math.PI * 34; // r=34
    ringFill.setAttribute('stroke-dasharray', circumference);
    ringFill.setAttribute('stroke-dashoffset', circumference - (score / 100) * circumference);
    ringFill.setAttribute('stroke', color);

    // Trend chart
    renderTrendChart(swings);

    // Recent sessions list
    renderSessionList(swings);
  }

  function generateHeadline(sw) {
    const phases = sw.phases || {};
    const sorted = Object.entries(phases).sort((a, b) => a[1].score - b[1].score);
    const worst = sorted[0];

    if (sw.score >= 80) return { title: 'Solid swing', desc: 'Great consistency. Keep this tempo going.' };
    if (sw.score >= 70) return { title: 'Good progress', desc: 'Your swing is improving. Focus on the small details.' };

    if (!worst) return { title: 'Keep practicing', desc: 'Record more swings to track your improvement.' };

    const headlines = {
      setup:        { title: 'Check your address', desc: 'Your setup position needs adjustment. Good posture is the foundation.' },
      backswing:    { title: 'Turn more fully', desc: 'Your backswing is limiting your power. Focus on a complete shoulder turn.' },
      downswing:    { title: 'Rushing the transition', desc: "You're starting the downswing a bit early. Let's create more space and strike with control." },
      impact:       { title: 'Impact needs work', desc: 'Focus on getting your weight forward and hands ahead at impact.' },
      followThrough:{ title: 'Finish your swing', desc: 'A balanced finish means a balanced swing. Hold your follow-through.' }
    };
    return headlines[worst[0]] || { title: 'Keep practicing', desc: 'Every swing teaches you something.' };
  }

  function renderTrendChart(swings) {
    const svg = document.getElementById('journal-chart');
    const labelsEl = document.getElementById('chart-x-labels');
    const recent = swings.slice(0, 14).reverse();
    if (recent.length < 2) {
      svg.innerHTML = '<text x="150" y="45" text-anchor="middle" fill="#9A9A8E" font-size="11">Need more sessions for trend</text>';
      labelsEl.innerHTML = '';
      return;
    }
    const maxS = 100, minS = 0;
    const pad = 8;
    const w = 300, h = 80;
    const pts = recent.map((s, i) => {
      const x = pad + (i / (recent.length - 1)) * (w - pad * 2);
      const y = (h - pad) - ((s.score - minS) / (maxS - minS)) * (h - pad * 2);
      return { x, y, score: s.score };
    });

    const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
    const lastPt = pts[pts.length - 1];
    const color = UIModule.scoreColor(lastPt.score);
    svg.innerHTML = `
      <polyline points="${polyline}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastPt.x}" cy="${lastPt.y}" r="3.5" fill="${color}"/>
      <text x="${lastPt.x + 8}" y="${lastPt.y + 4}" fill="${color}" font-size="10" font-weight="700">${lastPt.score}</text>
    `;

    // X labels
    const step = Math.max(1, Math.floor(recent.length / 5));
    labelsEl.innerHTML = '';
    for (let i = 0; i < recent.length; i += step) {
      const span = document.createElement('span');
      span.textContent = `#${i + 1 + (swings.length - recent.length)}`;
      labelsEl.appendChild(span);
    }
  }

  function renderSessionList(swings) {
    const list = document.getElementById('journal-list');
    list.innerHTML = '';
    const show = swings.slice(0, 5);
    show.forEach((sw, idx) => {
      const d = new Date(sw.date);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const sessionNum = swings.length - idx;
      const color = UIModule.scoreColor(sw.score);

      // Ball metrics + tooltip
      //   - clean tracked      : show clean speed/direction
      //   - rough/estimated    : prefix "~" + tooltip explaining estimation
      //   - not tracked at all : em-dash + tooltip with reason
      const b = sw.ball;
      let speedHtml, dirHtml;
      const isClean = b && b.tracked && b.speedMph != null && !b.speedRough && !ballHasEstimated(b);
      const isRough = b && (b.points && b.points.length >= 2) && !isClean;
      if (isClean) {
        speedHtml = `<span class="j-ball-speed">${b.speedMph}<span class="j-ball-unit"> mph</span></span>`;
        dirHtml   = `<span class="j-ball-dir tier-${dirTier(b.direction)}" title="Ball direction: ${b.direction}">${b.direction}</span>`;
      } else if (isRough) {
        const tip = b.fullyEstimated
          ? 'Trajectory is a physics-based estimate from your swing motion'
          : 'Partial track + extrapolated; values are approximate';
        const speedTxt = b.speedMph != null
          ? `~${b.speedMph}<span class="j-ball-unit"> mph</span>`
          : '~';
        speedHtml = `<span class="j-ball-speed na" title="${tip}">${speedTxt}</span>`;
        const dirTxt = b.direction ? `~${b.direction}` : '—';
        dirHtml   = `<span class="j-ball-dir na" title="${tip}">${dirTxt}</span>`;
      } else {
        const tip = ballMissingTip(b);
        speedHtml = `<span class="j-ball-speed na" title="${tip}">—</span>`;
        dirHtml   = `<span class="j-ball-dir na"   title="${tip}">—</span>`;
      }

      const row = document.createElement('div');
      row.className = 'j-entry';
      row.innerHTML = `
        <span class="j-date">${dateStr}</span>
        <span class="j-session">Session #${sessionNum}</span>
        <span class="j-club">${sw.club || '7-Iron'}</span>
        ${speedHtml}
        ${dirHtml}
        <span class="j-score" style="color:${color}">${sw.score}</span>
        <span class="j-arrow">&rsaquo;</span>
      `;
      row.addEventListener('click', () => openAnalysisForSwing(sw));
      list.appendChild(row);
    });
  }

  function dirTier(d) {
    if (!d) return 'na';
    if (/straight/i.test(d)) return 'good';
    if (/(pull|hook)/i.test(d)) return 'bad';
    if (/(slice|push|fade)/i.test(d)) return 'mid';
    return 'mid';
  }
  function ballHasEstimated(ball) {
    if (!ball || !ball.points) return false;
    for (const p of ball.points) if (p.estimated) return true;
    return false;
  }
  function ballMissingTip(b) {
    if (!b) return 'Ball not tracked';
    const reasonMap = {
      'no-ball-found-at-address': 'Could not find the ball at address',
      'ball-not-in-frame': 'Ball not in the camera view',
      'lost-after-impact': 'Lost the ball after impact',
      'no-roi': 'Stance not detected; can\u2019t aim ball search',
      'no-phases': 'Swing phases not detected',
      'speed-out-of-range': 'Speed estimate was unreliable',
      'missing-inputs': 'Tracking inputs missing',
      'no-timestamps': 'Frame timestamps unavailable',
      'exception': 'Tracking failed unexpectedly'
    };
    return reasonMap[b.reason] || 'Ball not tracked';
  }

  function openAnalysisForSwing(sw) {
    currentResult = {
      error: false, score: sw.score, grade: sw.grade,
      phases: sw.phases, impact: sw.impact,
      issues: sw.issues || [], improvements: sw.improvements || []
    };
    UIModule.renderAnalysis(currentResult);
    showTab('tab-analysis');
  }

  function showLatestAnalysis() {
    if (currentResult) {
      UIModule.renderAnalysis(currentResult);
    }
    // Otherwise the empty state shows
  }


  // ===== ANALYSIS TAB INTERACTIONS =====
  let currentResult = null;

  // Category tabs (Swing / Club)
  document.querySelector('.cat-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.cat-tab');
    if (!tab) return;
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const cat = tab.dataset.cat;
    const panelSwing = document.getElementById('panel-swing');
    const panelClub = document.getElementById('panel-club');
    if (panelSwing) panelSwing.classList.toggle('hidden', cat !== 'swing');
    if (panelClub) panelClub.classList.toggle('hidden', cat !== 'club');
  });

  // Phase card clicks — includes Full Swing playback
  document.getElementById('phase-cards').addEventListener('click', e => {
    const card = e.target.closest('.p-card');
    if (!card || !currentResult) return;
    const phaseKey = card.dataset.phase;
    UIModule.showPhaseDetail(phaseKey, currentResult.phases, currentResult);
    // Full Swing card: trigger the video play button so the user immediately
    // sees the full motion start.
    if (phaseKey === 'fullSwing') {
      const playBtn = document.getElementById('a-play-btn');
      if (playBtn) playBtn.click();
    }
  });

  // Back button (for journal-to-analysis navigation)
  document.getElementById('btn-analysis-back').addEventListener('click', () => {
    showTab('tab-journal');
    renderJournal();
  });

  // Record another
  document.getElementById('btn-record-another').addEventListener('click', () => {
    showTab('tab-record');
    startCameraPreview();
  });


  // ===== CAMERA / RECORDING =====
  const videoEl       = document.getElementById('camera-feed');
  const overlayCanvas = document.getElementById('pose-overlay');
  const btnRecord     = document.getElementById('btn-record');
  const recOverlay    = document.getElementById('rec-overlay');
  const recTimer      = document.getElementById('rec-timer');
  const btnZoomIn     = document.getElementById('btn-zoom-in');
  const btnZoomOut    = document.getElementById('btn-zoom-out');
  const btnWide       = document.getElementById('btn-wide');
  const zoomLabel     = document.getElementById('zoom-level');

  let isRecording   = false;
  let animFrameId   = null;
  let poseReady     = false;
  let gestureReady  = false;
  let bodyVisible   = false;
  let cameraInited  = false;
  let cameraRunning = false;

  async function startCameraPreview() {
    if (cameraRunning) return;
    try {
      if (!cameraInited) {
        await CameraModule.init();
        CameraModule.attachToVideo(videoEl);
        await new Promise(r => { videoEl.onloadedmetadata = () => { videoEl.play(); r(); }; });

        await PoseModule.init(overlayCanvas);
        poseReady = true;

        await GestureModule.init();
        gestureReady = true;
        cameraInited = true;
      } else {
        // Re-attach if needed
        if (!videoEl.srcObject) {
          CameraModule.attachToVideo(videoEl);
          await videoEl.play();
        }
      }

      CameraModule.detectZoom();
      cameraRunning = true;
      updateZoomUI();
      updateChecklist();

      PoseModule.setOnPose(landmarks => {
        const required = [11,12,13,14,15,16,23,24,25,26,27,28];
        bodyVisible = required.every(i => landmarks[i] && landmarks[i].visibility > 0.5);
        updateChecklist();
      });

      GestureModule.onThumbsUp(() => {
        if (!isRecording && bodyVisible) startRecording();
        else if (isRecording) stopRecording();
      });

      startDetectionLoop();
    } catch (err) {
      console.error('Camera init error:', err);
    }
  }

  function updateChecklist() {
    const bodyRow  = document.getElementById('chk-body');
    const lightRow = document.getElementById('chk-light');
    const stableRow = document.getElementById('chk-stable');

    bodyRow.classList.toggle('pass', bodyVisible);
    // Light and stable are assumed OK when camera is running
    lightRow.classList.toggle('pass', cameraRunning);
    stableRow.classList.toggle('pass', cameraRunning);
  }

  function startDetectionLoop() {
    let fc = 0;
    async function loop() {
      if (videoEl.readyState >= 2) {
        try {
          if (poseReady) await PoseModule.sendFrame(videoEl);
          if (gestureReady && fc % 2 === 0) await GestureModule.sendFrame(videoEl);
        } catch (e) {}
      }
      fc++;
      animFrameId = requestAnimationFrame(loop);
    }
    loop();
  }

  // Zoom buttons
  function updateZoomUI() {
    const z = CameraModule.getZoom();
    zoomLabel.textContent = z.toFixed(1) + '\u00d7';
    btnZoomOut.disabled = z <= CameraModule.getZoomMin();
    btnZoomIn.disabled  = z >= CameraModule.getZoomMax();
    // Wide button visibility + active state
    if (CameraModule.hasUltraWide()) {
      btnWide.classList.remove('hidden');
      btnWide.classList.toggle('active', CameraModule.isUltraWide());
    } else {
      btnWide.classList.add('hidden');
    }
  }
  btnZoomIn.addEventListener('click',  () => { CameraModule.zoomIn();  updateZoomUI(); });
  btnZoomOut.addEventListener('click', () => { CameraModule.zoomOut(); updateZoomUI(); });
  btnWide.addEventListener('click', async () => {
    btnWide.disabled = true;
    try {
      await CameraModule.toggleUltraWide(videoEl);
    } finally {
      btnWide.disabled = false;
      updateZoomUI();
    }
  });

  // Debug: force-show wide button via ?wide=1 (so you can see the UI on desktop).
  if (new URLSearchParams(location.search).get('wide') === '1') {
    btnWide.classList.remove('hidden');
  }

  // ===== IMPORT / UPLOAD VIDEO =====
  const btnImport     = document.getElementById('btn-import');
  const fileInput     = document.getElementById('video-file-input');
  const uploadDrop    = document.getElementById('upload-drop');
  const errBanner     = document.getElementById('upload-error-banner');
  const errTitle      = document.getElementById('upload-error-title');
  const errBody       = document.getElementById('upload-error-body');
  const modeTabs      = document.getElementById('mode-tabs');
  const panelCamera   = document.getElementById('mode-panel-camera');
  const panelUpload   = document.getElementById('mode-panel-upload');

  /** Video constraints */
  const MAX_SIZE_MB    = 100;
  const MAX_DURATION_S = 60;
  const ACCEPTED_TYPES = /^video\/(mp4|quicktime|webm|x-matroska)$/i;
  const ACCEPTED_EXTS  = /\.(mp4|mov|webm|m4v|mkv)$/i;

  // Current pending upload (file + metadata) awaiting preview/analyze.
  let pendingUpload = null;

  /** Switch between camera / upload panels. */
  function setRecordMode(mode) {
    document.querySelectorAll('#mode-tabs .mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    panelCamera.classList.toggle('hidden', mode !== 'camera');
    panelUpload.classList.toggle('hidden', mode !== 'upload');
    if (mode === 'upload') {
      // Pause the live camera — we don't need it on this panel.
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    } else {
      // Coming back to camera: re-init preview lazily.
      startCameraPreview();
    }
  }
  modeTabs.addEventListener('click', e => {
    const tab = e.target.closest('.mode-tab');
    if (!tab) return;
    setRecordMode(tab.dataset.mode);
  });

  /** Reset error banner + drop-zone copy. */
  function clearUploadError() {
    if (errBanner) errBanner.classList.add('hidden');
    const t = document.getElementById('upload-drop-title');
    const s = document.getElementById('upload-drop-sub');
    if (t) t.textContent = 'Choose a video';
    if (s) s.innerHTML = "Pick a swing video from your phone.<br>We'll check it before analyzing.";
  }
  /** Show inline error banner (hard block). */
  function showUploadError(title, body) {
    if (!errBanner) return;
    errTitle.textContent = title;
    errBody.innerHTML = body;
    errBanner.classList.remove('hidden');
    const t = document.getElementById('upload-drop-title');
    const s = document.getElementById('upload-drop-sub');
    if (t) t.textContent = 'Try a different video';
    if (s) s.textContent = 'Pick another swing from your phone.';
  }

  // Drop-zone click → file picker
  uploadDrop?.addEventListener('click', () => {
    clearUploadError();
    fileInput.value = '';
    fileInput.click();
  });

  // Quick-shortcut Import button from the Camera panel → also picks a file
  btnImport.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await handleUploadedFile(file);
  });

  /**
   * Validate a selected file. On hard-block errors, show banner & stay on upload mode.
   * On success (or portrait-only soft warning), open the preview screen.
   */
  async function handleUploadedFile(file) {
    clearUploadError();

    // 1. Type check
    const looksVideo = file.type ? ACCEPTED_TYPES.test(file.type) : ACCEPTED_EXTS.test(file.name);
    if (!looksVideo) {
      setRecordMode('upload');
      showUploadError(
        'Format not supported',
        `<em>${escapeHtml(file.name)}</em> isn't a supported video format. Try an <strong>.mp4</strong> or <strong>.mov</strong> file.`
      );
      return;
    }

    // 2. Size check
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
      setRecordMode('upload');
      showUploadError(
        'This video is too large',
        `<em>${escapeHtml(file.name)}</em> is <strong>${sizeMB.toFixed(0)} MB</strong> — the limit is <strong>${MAX_SIZE_MB} MB</strong>. Try trimming it or exporting at a lower resolution.`
      );
      return;
    }

    // 3. Probe video metadata (duration, orientation)
    const probe = await probeVideo(file).catch(err => ({ error: err.message }));
    if (probe.error) {
      setRecordMode('upload');
      showUploadError(
        "Couldn't read this video",
        `We couldn't open <em>${escapeHtml(file.name)}</em>. The file may be corrupted or use an unsupported codec.`
      );
      return;
    }

    // 4. Duration check
    if (probe.duration > MAX_DURATION_S) {
      setRecordMode('upload');
      showUploadError(
        'This video is too long',
        `<em>${escapeHtml(file.name)}</em> is <strong>${probe.duration.toFixed(0)}s</strong> — the limit is <strong>${MAX_DURATION_S}s</strong>. Trim it to just the swing.`
      );
      return;
    }

    // Passed hard validation → open preview screen
    pendingUpload = {
      file,
      url: URL.createObjectURL(file),
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      isPortrait: probe.height > probe.width,
      sizeMB
    };
    openPreviewScreen(pendingUpload);
  }

  function probeVideo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.src = url;
      v.muted = true; v.playsInline = true; v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const out = {
          duration: v.duration || 0,
          width: v.videoWidth || 0,
          height: v.videoHeight || 0
        };
        URL.revokeObjectURL(url);
        if (!isFinite(out.duration) || out.duration <= 0) reject(new Error('Bad duration'));
        else resolve(out);
      };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video load error')); };
      setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('Probe timeout')); }, 8000);
    });
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  /** Populate & show the upload preview screen. */
  function openPreviewScreen(up) {
    const v        = document.getElementById('preview-video-el');
    const playBtn  = document.getElementById('preview-play-btn');
    const warnBan  = document.getElementById('preview-warn-banner');
    const orient   = document.getElementById('preview-orient');
    const orientIcon = document.getElementById('preview-orient-icon');
    const filePill = document.getElementById('preview-file');
    const durPill  = document.getElementById('preview-duration');
    const sizePill = document.getElementById('preview-size');
    const curEl    = document.getElementById('preview-cur');
    const durEl    = document.getElementById('preview-dur');
    const fillEl   = document.getElementById('preview-scrub-fill');
    const knobEl   = document.getElementById('preview-scrub-knob');
    const barEl    = document.getElementById('preview-scrub-bar');
    const analyzeBtn = document.getElementById('preview-analyze-btn');

    if (v.src) URL.revokeObjectURL(v.src);
    v.src = up.url;
    v.muted = true;
    v.playsInline = true;
    v.load();

    // Metadata chips
    filePill.textContent = up.file.name;
    durPill.textContent  = fmtTime(up.duration);
    sizePill.textContent = up.sizeMB < 1 ? `${(up.sizeMB*1024).toFixed(0)} KB` : `${up.sizeMB.toFixed(1)} MB`;

    if (up.isPortrait) {
      orient.textContent = 'Portrait ⚠';
      orient.className = 'info-val warn-text';
      orientIcon.innerHTML = '<rect x="4" y="1.5" width="8" height="13" rx="1.5" stroke="currentColor" stroke-width="1.4"/>';
      warnBan.classList.remove('hidden');
      analyzeBtn.textContent = 'Analyze Anyway';
    } else {
      orient.textContent = 'Landscape ✓';
      orient.className = 'info-val ok-text';
      orientIcon.innerHTML = '<rect x="1.5" y="4" width="13" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/>';
      warnBan.classList.add('hidden');
      analyzeBtn.textContent = 'Analyze Swing';
    }

    // Reset play UI
    playBtn.classList.remove('hidden');
    fillEl.style.width = '0%';
    knobEl.style.left  = '0%';
    curEl.textContent  = '0:00';
    durEl.textContent  = fmtTime(up.duration);

    // Bind play button (replace handler each open)
    const freshPlay = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(freshPlay, playBtn);
    freshPlay.addEventListener('click', () => {
      freshPlay.classList.add('hidden');
      v.currentTime = 0;
      v.play().catch(() => freshPlay.classList.remove('hidden'));
    });
    v.onended = () => freshPlay.classList.remove('hidden');
    v.ontimeupdate = () => {
      if (!v.duration) return;
      const pct = (v.currentTime / v.duration) * 100;
      fillEl.style.width = pct + '%';
      knobEl.style.left  = pct + '%';
      curEl.textContent  = fmtTime(v.currentTime);
    };

    // Scrubber click-to-seek
    barEl.onclick = (e) => {
      const rect = barEl.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (v.duration) v.currentTime = Math.max(0, Math.min(v.duration, v.duration * x));
    };

    showTab('screen-upload-preview');
  }

  // Preview screen buttons
  // "Mark ball & analyze" — open the mark-ball screen first, then analyze
  // with the user’s anchor. Pre-analysis path.
  document.getElementById('preview-mark-analyze-btn').addEventListener('click', () => {
    if (!pendingUpload) return;
    const pv = document.getElementById('preview-video-el');
    try { pv.pause(); } catch (_) {}
    // Stash pending upload for later analysis after marking
    window.__pendingUploadForMarking = pendingUpload;
    openMarkBallScreen({ origin: 'pre-analysis', videoUrl: pendingUpload.url, duration: pendingUpload.duration });
  });
  // "Analyze without marking" — fully automatic, no manual anchor.
  document.getElementById('preview-quick-analyze-btn').addEventListener('click', async () => {
    if (!pendingUpload) return;
    const file = pendingUpload.file;
    const pv = document.getElementById('preview-video-el');
    try { pv.pause(); } catch (_) {}
    await analyzeImportedVideo(file);
  });
  // Note: blob URL is NOT revoked here — we keep it alive so that the
  // Analysis screen can play the video AND a later "Tap to mark ball"
  // retry can use the same source without re-uploading.
  document.getElementById('preview-choose-btn').addEventListener('click', () => {
    discardPendingUpload();
    showTab('tab-record');
    setRecordMode('upload');
    fileInput.value = '';
    fileInput.click();
  });
  document.getElementById('preview-cancel-btn').addEventListener('click', () => {
    discardPendingUpload();
    showTab('tab-record');
  });
  document.getElementById('upload-preview-back').addEventListener('click', () => {
    discardPendingUpload();
    showTab('tab-record');
    setRecordMode('upload');
  });

  /**
   * Revoke and clear the pendingUpload only when the user is truly
   * abandoning it (cancel / choose another). For successful analyze paths
   * we deliberately keep the blob URL alive in __lastTrackInputs.
   */
  function discardPendingUpload() {
    if (pendingUpload?.url) {
      try { URL.revokeObjectURL(pendingUpload.url); } catch (_) {}
    }
    pendingUpload = null;
    window.__pendingUploadForMarking = null;
  }

  /**
   * Run MediaPipe pose detection on every frame of an imported video,
   * then hand the collected landmarks to AnalysisModule (same as recording).
   */
  async function analyzeImportedVideo(file) {
    // Stop the live preview / camera while we process the imported file.
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (cameraRunning) {
      try { CameraModule.destroy(); } catch (_) {}
      cameraRunning = false;
      cameraInited = false;
    }

    showTab('screen-analyzing');
    UIModule.setLoaderStep('validate');
    UIModule.setProgress(2, 'Loading video…');

    // Make sure Pose is ready (it normally inits on first preview).
    if (!poseReady) {
      try {
        await PoseModule.init(overlayCanvas);
        poseReady = true;
      } catch (err) {
        alert('Pose engine failed to load: ' + err.message);
        showTab('tab-record');
        return;
      }
    }

    // Build an offscreen video element to seek frame-by-frame.
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    // Important so Safari/iOS treats it as same-origin pixels.
    v.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error('Could not load video.'));
    }).catch(err => {
      URL.revokeObjectURL(url);
      alert(err.message);
      showTab('tab-record');
      throw err;
    });

    const duration = v.duration || 0;
    if (!duration || !isFinite(duration)) {
      URL.revokeObjectURL(url);
      alert('Video duration could not be read. Try a different file.');
      showTab('tab-record');
      return;
    }

    // Cap analysis at ~10 seconds (a swing is typically 1.5–3s); take ~30fps.
    const analyzeDur = Math.min(duration, 10);
    const fps = 30;
    const totalFrames = Math.max(10, Math.floor(analyzeDur * fps));

    // Reset frame buffer
    PoseModule.startCollecting();

    // ---- Step 2: detect body across frames
    UIModule.setLoaderStep('detect');
    UIModule.setProgress(8, 'Detecting body…');

    // Seek & process each frame. Pass the in-video time so the pose module
    // tags each landmark snapshot with a real video timestamp — phase
    // detection later turns these into start/end clip times.
    for (let i = 0; i < totalFrames; i++) {
      const t = (i / fps);
      await seekTo(v, t);
      try {
        await PoseModule.sendFrame(v, t);
      } catch (_) {}
      if (i % 5 === 0) {
        const pct = 8 + Math.floor((i / totalFrames) * 60);
        UIModule.setProgress(pct, `Reading frame ${i}/${totalFrames}…`);
      }
    }

    const frameData = PoseModule.stopCollecting();
    // Keep the blob URL alive — the Analysis screen needs it for playback.
    // Stash + clean up the previous one so we don't leak.
    if (window.__lastSwingVideoUrl) {
      try { URL.revokeObjectURL(window.__lastSwingVideoUrl); } catch (_) {}
    }
    window.__lastSwingVideoUrl = url;

    // ---- Step 3: phases
    UIModule.setLoaderStep('phases');
    UIModule.setProgress(72, 'Finding swing phases…');
    await sleep(250);

    const result = AnalysisModule.analyze(frameData);

    // ---- Step 4: real ball tracking via canvas pixel analysis
    UIModule.setLoaderStep('ball');
    UIModule.setProgress(78, 'Tracking ball flight…');
    if (!result.error) {
      try {
        // Re-seek through the post-impact window with the same video element
        const trackVid = document.createElement('video');
        trackVid.src = url;
        trackVid.muted = true;
        trackVid.playsInline = true;
        trackVid.crossOrigin = 'anonymous';
        await new Promise(res => { trackVid.onloadedmetadata = () => res(); trackVid.onerror = () => res(); });
        if (result.rawPhases) {
          const trackOpts = manualAnchor ? { manualAnchor } : undefined;
          const ball = await BallTrackModule.track(
            trackVid,
            frameData,
            result.rawPhases,
            (p) => UIModule.setProgress(78 + Math.floor(p * 10), 'Tracking ball flight…'),
            trackOpts
          );
          result.ball = ball;
        } else {
          result.ball = { tracked: false, reason: 'no-phases' };
        }
      } catch (e) {
        console.warn('Ball tracking failed:', e);
        result.ball = { tracked: false, reason: 'exception' };
      }
    }

    // ---- Step 5: score
    UIModule.setLoaderStep('score');
    UIModule.setProgress(95, 'Scoring impact…');
    await sleep(250);
    UIModule.setProgress(100, 'Done');
    await sleep(200);

    if (result.error) {
      alert(result.message || 'Could not detect a swing in this video. Make sure the full body is visible.');
      showTab('tab-record');
      setRecordMode('upload');
      return;
    }

    // Low-confidence → confirm with the user before showing scores
    if (result.lowConfidence) {
      const proceed = await showLowConfidenceModal(result.confidence);
      if (!proceed) {
        showTab('tab-record');
        setRecordMode('upload');
        // Reopen the file picker so the user can quickly try another
        setTimeout(() => { fileInput.value = ''; fileInput.click(); }, 200);
        return;
      }
    }

    const club = document.getElementById('club-select').value;
    result.videoUrl = url;  // pass to Analysis screen
    saveSwing(result, club);
    currentResult = result;
    UIModule.renderAnalysis(result);
    showTab('tab-analysis');
  }

  /* ===== Manual ball marking ===== */
  let _markBallPoint = null;
  // 'pre-analysis' = opened from Preview screen, before running pose/analysis
  // 'post-analysis' = opened from Analysis screen ball-status banner
  let _markBallOrigin = 'post-analysis';

  /**
   * Open the mark-ball fullscreen UI.
   *
   * @param {Object} [opts]
   * @param {string} [opts.origin]    'pre-analysis' | 'post-analysis'
   * @param {string} [opts.videoUrl]  blob URL to load (defaults to whichever
   *                                  source is available)
   * @param {number} [opts.duration]  optional duration (used by pre-analysis
   *                                  path where __lastTrackInputs isn’t set)
   */
  function openMarkBallScreen(opts) {
    opts = opts || {};
    _markBallOrigin = opts.origin || 'post-analysis';
    let videoUrl = opts.videoUrl;
    if (!videoUrl) {
      const inputs = window.__lastTrackInputs;
      videoUrl = inputs && inputs.videoUrl;
    }
    if (!videoUrl) {
      // Fallback: if we still have the pending upload, use its URL.
      if (pendingUpload && pendingUpload.url) videoUrl = pendingUpload.url;
    }
    if (!videoUrl) {
      alert('Video no longer available. Please re-upload.');
      return;
    }
    const v = document.getElementById('mark-ball-video');
    if (v.src !== videoUrl) {
      v.src = videoUrl;
      v.load();
    }
    _markBallPoint = null;
    document.getElementById('mark-ball-confirm').disabled = true;
    drawMarkBallOverlay();
    showTab('screen-mark-ball');

    // Default to ~20% into the video so users land near the setup pose.
    // For post-analysis we have richer info (rawPhases.setupEnd) and that
    // takes precedence (handled in loadedmetadata listener).
    const wantsDefault = (_markBallOrigin === 'pre-analysis');
    if (wantsDefault) {
      const targetT = (opts.duration || v.duration || 0) * 0.20;
      const setStart = () => {
        try { v.currentTime = targetT; } catch (_) {}
      };
      if (v.readyState >= 1) setStart();
      else v.addEventListener('loadedmetadata', setStart, { once: true });
    }
    setTimeout(drawMarkBallOverlay, 100);
  }
  function closeMarkBallScreen() {
    const v = document.getElementById('mark-ball-video');
    try { v.pause(); } catch (_) {}
  }
  function drawMarkBallOverlay() {
    const c = document.getElementById('mark-ball-overlay');
    const v = document.getElementById('mark-ball-video');
    if (!c || !v) return;
    const rect = v.getBoundingClientRect();
    c.width  = rect.width  * (window.devicePixelRatio || 1);
    c.height = rect.height * (window.devicePixelRatio || 1);
    c.style.width  = rect.width  + 'px';
    c.style.height = rect.height + 'px';
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!_markBallPoint) return;
    const vw = v.videoWidth || rect.width;
    const vh = v.videoHeight || rect.height;
    const s  = Math.min(rect.width / vw, rect.height / vh);
    const rw = vw * s, rh = vh * s;
    const ox = (rect.width - rw) / 2;
    const oy = (rect.height - rh) / 2;
    const dpr = window.devicePixelRatio || 1;
    const px = (ox + _markBallPoint.x * rw) * dpr;
    const py = (oy + _markBallPoint.y * rh) * dpr;
    ctx.save();
    ctx.strokeStyle = '#D56F55';
    ctx.lineWidth = 2 * dpr;
    ctx.shadowColor = 'rgba(213,111,85,0.8)';
    ctx.shadowBlur = 10 * dpr;
    ctx.beginPath();
    ctx.arc(px, py, 18 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#D56F55';
    ctx.fill();
    ctx.restore();
  }

  async function runManualBallTrack(point) {
    if (!point) return;

    // Pre-analysis path: we don’t have pose data yet — run the full
    // pipeline with the manual anchor passed in.
    if (_markBallOrigin === 'pre-analysis') {
      const upload = window.__pendingUploadForMarking;
      if (!upload) {
        alert('Upload was lost. Please re-upload your video.');
        showTab('tab-record');
        return;
      }
      // Run pose extraction + analysis + ball tracking with manualAnchor
      await analyzeImportedVideo(upload.file, { manualAnchor: point });
      return;
    }

    // Post-analysis path: pose data is cached, just re-run ball tracking.
    const inputs = window.__lastTrackInputs;
    if (!inputs) return;
    showTab('screen-analyzing');
    UIModule.setLoaderStep('ball');
    UIModule.setProgress(60, 'Re-tracking with your mark…');
    try {
      const tv = document.createElement('video');
      tv.src = inputs.videoUrl;
      tv.muted = true; tv.playsInline = true; tv.crossOrigin = 'anonymous';
      await new Promise(res => { tv.onloadedmetadata = () => res(); tv.onerror = () => res(); });
      const ball = await BallTrackModule.track(
        tv,
        inputs.frames,
        inputs.rawPhases,
        (p) => UIModule.setProgress(60 + Math.floor(p * 30), 'Tracking ball flight…'),
        { manualAnchor: point }
      );
      UIModule.setProgress(95, 'Scoring impact…');
      if (currentResult) {
        currentResult.ball = ball;
        const swings = getSwings();
        if (swings.length > 0) {
          swings[0].ball = ball;
          localStorage.setItem('birdie_swings', JSON.stringify(swings));
        }
        UIModule.renderAnalysis(currentResult);
      }
      UIModule.setProgress(100, 'Done');
      await sleep(200);
    } catch (e) {
      console.warn('Manual ball track failed:', e);
    }
    showTab('tab-analysis');
  }

  /**
   * Show the low-confidence modal and resolve(true) on Continue, false on Choose Another.
   */
  function showLowConfidenceModal(confidence) {
    const modal = document.getElementById('lowconf-modal');
    const pct   = document.getElementById('lowconf-pct');
    const ok    = document.getElementById('lowconf-continue');
    const no    = document.getElementById('lowconf-cancel');
    if (!modal) return Promise.resolve(true);
    pct.textContent = `${confidence}%`;
    modal.classList.remove('hidden');
    return new Promise(resolve => {
      const cleanup = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        no.removeEventListener('click', onNo);
        resolve(val);
      };
      const onOk = () => cleanup(true);
      const onNo = () => cleanup(false);
      ok.addEventListener('click', onOk);
      no.addEventListener('click', onNo);
    });
  }

  /** Seek a video to time `t` and resolve when the frame is ready. */
  function seekTo(video, t) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; video.removeEventListener('seeked', finish); resolve(); };
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = Math.min(t, video.duration - 0.001); }
      catch (_) { finish(); }
      // Safety timeout in case 'seeked' never fires.
      setTimeout(finish, 800);
    });
  }

  // Record button
  btnRecord.addEventListener('click', () => {
    if (!isRecording && bodyVisible) startRecording();
    else if (isRecording) stopRecording();
    else if (!bodyVisible && cameraRunning) {
      // Flash hint
      btnRecord.style.transform = 'scale(.9)';
      setTimeout(() => { btnRecord.style.transform = ''; }, 200);
    }
  });

  function startRecording() {
    isRecording = true;
    btnRecord.classList.add('recording');
    recOverlay.classList.remove('hidden');
    PoseModule.startCollecting();
    CameraModule.startRecording(time => { recTimer.textContent = time; });
    GestureModule.resetCooldown();
  }

  async function stopRecording() {
    isRecording = false;
    btnRecord.classList.remove('recording');
    recOverlay.classList.add('hidden');

    const frameData = PoseModule.stopCollecting();
    await CameraModule.stopRecording();
    cancelAnimationFrame(animFrameId);
    cameraRunning = false;
    CameraModule.resetZoom();
    updateZoomUI();

    showTab('screen-analyzing');
    await runAnalysis(frameData);
  }

  async function runAnalysis(frameData) {
    UIModule.setLoaderStep('detect');
    UIModule.setProgress(15, 'Reading body landmarks…');
    await sleep(250);
    UIModule.setLoaderStep('phases');
    UIModule.setProgress(45, 'Finding swing phases…');
    await sleep(250);

    const result = AnalysisModule.analyze(frameData);

    UIModule.setLoaderStep('ball');
    UIModule.setProgress(70, 'Tracking ball flight…');
    await sleep(250);
    UIModule.setLoaderStep('score');
    UIModule.setProgress(92, 'Scoring impact…');
    await sleep(250);
    UIModule.setProgress(100, 'Done');
    await sleep(200);

    if (result.error) {
      alert(result.message || 'Analysis failed. Please try again.');
      showTab('tab-record');
      startCameraPreview();
      return;
    }

    if (result.lowConfidence) {
      const proceed = await showLowConfidenceModal(result.confidence);
      if (!proceed) {
        showTab('tab-record');
        startCameraPreview();
        return;
      }
    }

    const club = document.getElementById('club-select').value;
    saveSwing(result, club);
    currentResult = result;
    UIModule.renderAnalysis(result);
    showTab('tab-analysis');
  }


  // ===== UTILITIES =====
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // PWA
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });

  // ===== INIT =====
  // Load last result from storage if available
  const swings = getSwings();
  if (swings.length > 0) {
    const latest = swings[0];
    currentResult = {
      error: false, score: latest.score, grade: latest.grade,
      phases: latest.phases, impact: latest.impact,
      issues: latest.issues || [], improvements: latest.improvements || []
    };
  }
  renderJournal();

  // ===== MANUAL BALL MARKING =====
  // Wire "Tap to mark ball" CTA on Analysis ball-status banner (post-analysis).
  const ballMarkBtn = document.getElementById('ball-mark-btn');
  if (ballMarkBtn) {
    ballMarkBtn.addEventListener('click', () => openMarkBallScreen({ origin: 'post-analysis' }));
  }
  const mbBack = document.getElementById('mark-ball-back');
  if (mbBack) {
    mbBack.addEventListener('click', () => {
      closeMarkBallScreen();
      // Smart back: if we entered from Preview, go back to Preview;
      // otherwise return to Analysis.
      if (_markBallOrigin === 'pre-analysis') {
        showTab('screen-upload-preview');
      } else {
        showTab('tab-analysis');
      }
    });
    document.getElementById('mark-ball-redo').addEventListener('click', () => {
      _markBallPoint = null;
      drawMarkBallOverlay();
      document.getElementById('mark-ball-confirm').disabled = true;
    });
    const mbVideo = document.getElementById('mark-ball-video');
    const mbSlider = document.getElementById('mark-ball-slider');
    const mbPrev   = document.getElementById('mark-ball-prev');
    const mbNext   = document.getElementById('mark-ball-next');
    const mbTime   = document.getElementById('mark-ball-time');
    const mbStage  = document.getElementById('mark-ball-stage');
    const mbConfirm = document.getElementById('mark-ball-confirm');

    const fmtSec = (s) => {
      if (!isFinite(s)) return '0:00';
      const m = Math.floor(s / 60), r = Math.floor(s % 60);
      return m + ':' + String(r).padStart(2, '0');
    };
    const refreshMbTime = () => {
      if (mbTime && mbVideo.duration)
        mbTime.textContent = `${fmtSec(mbVideo.currentTime)} / ${fmtSec(mbVideo.duration)}`;
    };
    mbVideo.addEventListener('loadedmetadata', () => {
      mbSlider.max = mbVideo.duration || 0;
      // Start near setupEnd if we have phase info
      const inputs = window.__lastTrackInputs;
      if (inputs && inputs.rawPhases && inputs.frames) {
        const f = inputs.frames[Math.min(inputs.rawPhases.setupEnd | 0, inputs.frames.length - 1)];
        if (f && f.videoTime != null) mbVideo.currentTime = f.videoTime;
      }
      refreshMbTime();
      drawMarkBallOverlay();
    });
    mbVideo.addEventListener('timeupdate', refreshMbTime);
    mbVideo.addEventListener('seeked', refreshMbTime);
    mbSlider.addEventListener('input', () => {
      try { mbVideo.currentTime = parseFloat(mbSlider.value); } catch (_) {}
    });
    const STEP = 1 / 30;
    mbPrev.addEventListener('click', () => {
      try { mbVideo.currentTime = Math.max(0, mbVideo.currentTime - STEP); } catch (_) {}
    });
    mbNext.addEventListener('click', () => {
      try { mbVideo.currentTime = Math.min(mbVideo.duration || 0, mbVideo.currentTime + STEP); } catch (_) {}
    });
    mbStage.addEventListener('click', (e) => {
      const rect = mbVideo.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const vw = mbVideo.videoWidth  || rect.width;
      const vh = mbVideo.videoHeight || rect.height;
      const s  = Math.min(rect.width / vw, rect.height / vh);
      const rw = vw * s, rh = vh * s;
      const ox = (rect.width - rw) / 2;
      const oy = (rect.height - rh) / 2;
      const px = cx - ox, py = cy - oy;
      if (px < 0 || py < 0 || px > rw || py > rh) return;
      _markBallPoint = { x: px / rw, y: py / rh, t: mbVideo.currentTime };
      drawMarkBallOverlay();
      mbConfirm.disabled = false;
    });
    mbConfirm.addEventListener('click', () => runManualBallTrack(_markBallPoint));

    // Skip button: continue without a manual mark.
    const mbSkip = document.getElementById('mark-ball-skip');
    if (mbSkip) {
      mbSkip.addEventListener('click', async () => {
        closeMarkBallScreen();
        if (_markBallOrigin === 'pre-analysis') {
          // Pre-analysis: kick off automatic analysis with no manual anchor.
          const upload = window.__pendingUploadForMarking;
          if (upload) {
            await analyzeImportedVideo(upload.file);
          } else {
            showTab('tab-record');
          }
        } else {
          // Post-analysis: just return.
          showTab('tab-analysis');
        }
      });
    }

    // Magnifying loupe — follow finger/cursor while pressed over the video.
    const mbLoupe       = document.getElementById('mark-ball-loupe');
    const mbLoupeCanvas = document.getElementById('mark-ball-loupe-canvas');
    const LOUPE_ZOOM    = 3;
    const LOUPE_SIZE    = 120;
    let loupeRaf = null;

    function drawLoupe(clientX, clientY) {
      const v = document.getElementById('mark-ball-video');
      const rect = v.getBoundingClientRect();
      const stageRect = mbStage.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const vw = v.videoWidth  || rect.width;
      const vh = v.videoHeight || rect.height;
      const s  = Math.min(rect.width / vw, rect.height / vh);
      const rw = vw * s, rh = vh * s;
      const ox = (rect.width - rw) / 2;
      const oy = (rect.height - rh) / 2;
      const px = localX - ox, py = localY - oy;
      if (px < 0 || py < 0 || px > rw || py > rh) {
        mbLoupe.classList.add('hidden');
        return;
      }
      // Position the loupe near the finger but not under it
      let lx = clientX - stageRect.left - LOUPE_SIZE - 16;
      let ly = clientY - stageRect.top  - LOUPE_SIZE - 16;
      if (lx < 8) lx = clientX - stageRect.left + 16;
      if (ly < 8) ly = clientY - stageRect.top  + 16;
      mbLoupe.style.left = lx + 'px';
      mbLoupe.style.top  = ly + 'px';
      mbLoupe.classList.remove('hidden');
      // Draw the zoomed slice of the video
      const cx = (px / rw) * vw;
      const cy = (py / rh) * vh;
      const srcSize = LOUPE_SIZE / LOUPE_ZOOM;
      mbLoupeCanvas.width  = LOUPE_SIZE;
      mbLoupeCanvas.height = LOUPE_SIZE;
      const lctx = mbLoupeCanvas.getContext('2d');
      lctx.fillStyle = '#000';
      lctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      try {
        lctx.drawImage(v,
          cx - srcSize / 2, cy - srcSize / 2, srcSize, srcSize,
          0, 0, LOUPE_SIZE, LOUPE_SIZE);
      } catch (_) {}
    }
    function hideLoupe() { mbLoupe.classList.add('hidden'); }

    function onPointerMove(e) {
      if (loupeRaf) cancelAnimationFrame(loupeRaf);
      const x = e.clientX, y = e.clientY;
      loupeRaf = requestAnimationFrame(() => drawLoupe(x, y));
    }
    mbStage.addEventListener('pointerdown', (e) => {
      drawLoupe(e.clientX, e.clientY);
      mbStage.addEventListener('pointermove', onPointerMove);
    });
    const endLoupe = () => {
      mbStage.removeEventListener('pointermove', onPointerMove);
      hideLoupe();
    };
    mbStage.addEventListener('pointerup', endLoupe);
    mbStage.addEventListener('pointercancel', endLoupe);
    mbStage.addEventListener('pointerleave', endLoupe);
  }

  // ===== DEMO MODE =====
  // ?demo=upload     → Upload mode entry
  // ?demo=upload-err → Upload mode with hard-block error pre-filled
  // ?demo=loading    → Just show the rolling-ball loader walking the 5 steps
  // ?demo=lowconf    → Show the low-confidence modal
  const _ds = new URLSearchParams(location.search).get('demo');
  if (_ds === 'upload' || _ds === 'upload-err') {
    showTab('tab-record');
    setRecordMode('upload');
    if (_ds === 'upload-err') {
      showUploadError(
        'This video is too large',
        '<em>swing_practice_4k.mov</em> is <strong>187 MB</strong> — the limit is <strong>100 MB</strong>. Try trimming it or exporting at a lower resolution.'
      );
    }
    return;
  }
  if (_ds === 'loading') {
    showTab('screen-analyzing');
    (async () => {
      const steps = [
        { key: 'validate', pct: 8,  text: 'Loading video…' },
        { key: 'detect',   pct: 35, text: 'Detecting body…' },
        { key: 'phases',   pct: 60, text: 'Finding swing phases…' },
        { key: 'ball',     pct: 80, text: 'Tracking ball flight…' },
        { key: 'score',    pct: 95, text: 'Scoring impact…' }
      ];
      for (const s of steps) {
        UIModule.setLoaderStep(s.key);
        UIModule.setProgress(s.pct, s.text);
        await new Promise(r => setTimeout(r, 1400));
      }
      UIModule.setProgress(100, 'Done');
    })();
    return;
  }
  if (_ds === 'lowconf') {
    showTab('tab-record');
    showLowConfidenceModal(42).then(ok => {
      console.log(ok ? 'User chose Continue' : 'User chose Choose Another');
    });
    return;
  }
  if (_ds === 'phases') {
    // Demo: show Analysis screen with mock phase clips so the
    // tap-to-replay behavior can be tested without a real video.
    const demo = {
      error: false, score: 72, grade: 'Good',
      videoUrl: null,
      clips: {
        setup:         { start: 0,   end: 1.5 },
        backswing:     { start: 1.3, end: 3.0 },
        downswing:     { start: 2.8, end: 3.4 },
        impact:        { start: 3.2, end: 3.6 },
        followThrough: { start: 3.4, end: 5.0 }
      },
      phases: {
        setup:        { score: 88, notes: [] },
        backswing:    { score: 75, notes: ['Backswing slightly long.'] },
        downswing:    { score: 60, notes: ['Hips start too late.'] },
        impact:       { score: 65, notes: ['Hands slightly behind ball.'] },
        followThrough:{ score: 80, notes: [] }
      },
      impact: { x: 0, y: 0, tendency: 'Center', description: 'Demo' },
      issues: ['Demo issue 1', 'Demo issue 2'],
      improvements: ['Demo improvement 1'],
      ball: {
        tracked: true,
        speedMph: 118,
        direction: 'Straight',
        points: [
          {x: 0.48, y: 0.72}, {x: 0.50, y: 0.68}, {x: 0.53, y: 0.60},
          {x: 0.57, y: 0.48}, {x: 0.62, y: 0.34}, {x: 0.68, y: 0.18}
        ]
      }
    };
    currentResult = demo;
    UIModule.renderAnalysis(demo);
    showTab('tab-analysis');
    return;
  }

  // Visit index.html?demo to jump straight into a populated Analysis screen.
  if (location.search.includes('demo')) {
    const demo = {
      error: false, score: 68, grade: 'Needs Work',
      phases: {
        setup:        { score: 92, notes: [] },
        backswing:    { score: 75, notes: ['Left arm bending slightly during backswing.'] },
        downswing:    { score: 48, notes: [
          'Hips initiate the downswing before the upper body — torso lag is missing.',
          'Wrists release too early, costing stored power at impact.',
          'Weight stays ~60% on the trail foot through impact.'
        ]},
        impact:       { score: 55, notes: ['Weight on back foot at impact — should be shifted forward.'] },
        followThrough:{ score: 72, notes: ['Not fully transferring weight to front foot in finish.'] }
      },
      impact: { x: -0.4, y: -0.2, tendency: 'Toe Strike → Hook tendency', description: 'Hands too close to body at impact, catching the toe.' },
      issues: [
        'Hips initiate the downswing before the upper body.',
        'Wrists release too early, costing stored power.',
        'Weight stays on trail foot through impact.'
      ],
      improvements: [
        'Pump-drill: stop at the "P6" position, hold, then complete.',
        'Feel a "K-shape" at impact — left side straight, right side angled.',
        'Practice with feet narrower than shoulder-width to force weight shift.'
      ]
    };
    currentResult = demo;
    UIModule.renderAnalysis(demo);
    showTab('tab-analysis');
  }

})();
