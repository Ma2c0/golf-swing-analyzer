/**
 * Birdie App — Record / Journal / Analysis
 */
(async function () {
  'use strict';

  // ===== NAVIGATION =====
  const tabBar  = document.getElementById('tab-bar');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const fsIds   = new Set(['screen-analyzing']);

  function showTab(id) {
    document.querySelectorAll('.tab-screen').forEach(s => s.classList.remove('active', 'fs'));
    const el = document.getElementById(id);
    if (!el) return;
    const fs = fsIds.has(id);
    el.classList.add('active');
    if (fs) el.classList.add('fs');
    tabBar.classList.toggle('hidden', fs);

    const map = { 'tab-record': 'record', 'tab-journal': 'journal', 'tab-analysis': 'analysis' };
    const active = map[id];
    if (active) tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === active));
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
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
      duration: result.duration
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
      const row = document.createElement('div');
      row.className = 'j-entry';
      row.innerHTML = `
        <span class="j-date">${dateStr}</span>
        <span class="j-session">Session #${sessionNum}</span>
        <span class="j-club">${sw.club || '7-Iron'}</span>
        <span class="j-score" style="color:${color}">${sw.score}</span>
        <span class="j-arrow">&rsaquo;</span>
      `;
      row.addEventListener('click', () => openAnalysisForSwing(sw));
      list.appendChild(row);
    });
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

  // Category tabs
  document.querySelector('.cat-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.cat-tab');
    if (!tab) return;
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const cat = tab.dataset.cat;
    document.getElementById('panel-swing').classList.toggle('hidden', cat !== 'swing');
    document.getElementById('panel-body').classList.toggle('hidden', cat !== 'body');
    document.getElementById('panel-club').classList.toggle('hidden', cat !== 'club');
  });

  // Phase card clicks
  document.getElementById('phase-cards').addEventListener('click', e => {
    const card = e.target.closest('.p-card');
    if (!card || !currentResult) return;
    UIModule.showPhaseDetail(card.dataset.phase, currentResult.phases);
  });

  // Phase scroll arrows
  document.getElementById('phase-arrow-l').addEventListener('click', () => {
    document.getElementById('phase-cards').scrollBy({ left: -120, behavior: 'smooth' });
  });
  document.getElementById('phase-arrow-r').addEventListener('click', () => {
    document.getElementById('phase-cards').scrollBy({ left: 120, behavior: 'smooth' });
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

      cameraRunning = true;
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

    showTab('screen-analyzing');
    await runAnalysis(frameData);
  }

  async function runAnalysis(frameData) {
    UIModule.setProgress(10, 'Processing pose data...');
    await sleep(300);
    UIModule.setProgress(30, 'Detecting swing phases...');
    await sleep(300);
    UIModule.setProgress(60, 'Analyzing body mechanics...');
    await sleep(300);

    const result = AnalysisModule.analyze(frameData);

    UIModule.setProgress(85, 'Estimating impact point...');
    await sleep(300);
    UIModule.setProgress(100, 'Complete!');
    await sleep(400);

    const club = document.getElementById('club-select').value;

    if (!result.error) {
      saveSwing(result, club);
      currentResult = result;
      UIModule.renderAnalysis(result);
      showTab('tab-analysis');
    } else {
      alert(result.message || 'Analysis failed. Please try again.');
      showTab('tab-record');
      startCameraPreview();
    }
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

})();
