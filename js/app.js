/**
 * Birdie App — tab-based mobile app experience.
 */
(async function () {
  'use strict';

  // ===== NAVIGATION =====
  const tabBar = document.getElementById('tab-bar');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const fullscreenIds = ['screen-camera', 'screen-analyzing', 'screen-results'];

  function showTab(tabId) {
    // Hide all tab screens
    document.querySelectorAll('.tab-screen').forEach(s => {
      s.classList.remove('active', 'fullscreen');
    });

    const isFullscreen = fullscreenIds.includes(tabId);
    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
      if (isFullscreen) target.classList.add('fullscreen');
    }

    // Show/hide tab bar
    tabBar.classList.toggle('hidden', isFullscreen);

    // Update tab button active state (only for main tabs)
    const tabMap = { 'tab-home': 'home', 'tab-journal': 'journal', 'tab-drills': 'drills', 'screen-camera': 'record' };
    const activeTab = tabMap[tabId];
    if (activeTab) {
      tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    }
  }

  // Tab bar clicks
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'record') {
        initCamera();
      } else if (tab === 'home') {
        showTab('tab-home');
        updateHome();
      } else if (tab === 'journal') {
        showTab('tab-journal');
        renderJournal();
      } else if (tab === 'drills') {
        showTab('tab-drills');
        renderDrills();
      }
    });
  });

  // Action card clicks (data-goto)
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => {
      const goto = el.dataset.goto;
      if (goto === 'record') initCamera();
      else if (goto === 'journal') { showTab('tab-journal'); renderJournal(); }
      else if (goto === 'drills') { showTab('tab-drills'); renderDrills(); }
    });
  });


  // ===== STORAGE =====
  function getSwings() {
    try { return JSON.parse(localStorage.getItem('birdie_swings') || '[]'); }
    catch { return []; }
  }

  function saveSwing(result) {
    const swings = getSwings();
    swings.unshift({
      id: Date.now(),
      date: new Date().toISOString(),
      score: result.score,
      grade: result.grade,
      phases: result.phases,
      impact: result.impact,
      issues: result.issues,
      improvements: result.improvements,
      frameCount: result.frameCount,
      duration: result.duration
    });
    // Keep last 50
    if (swings.length > 50) swings.length = 50;
    localStorage.setItem('birdie_swings', JSON.stringify(swings));
  }


  // ===== HOME =====
  function updateHome() {
    const swings = getSwings();
    const scoreNum = document.getElementById('home-score-num');
    const scoreGrade = document.getElementById('home-score-grade');
    const scoreRing = document.getElementById('home-score-ring');
    const sparkline = document.getElementById('home-sparkline');

    if (swings.length === 0) {
      scoreNum.textContent = '--';
      scoreGrade.textContent = 'No swings yet';
      scoreRing.classList.remove('has-score');
      sparkline.innerHTML = '<text x="60" y="28" text-anchor="middle" fill="#9A9A8E" font-size="10">Record your first swing</text>';
      return;
    }

    const latest = swings[0];
    scoreNum.textContent = latest.score;
    scoreGrade.textContent = latest.grade;
    scoreRing.classList.add('has-score');

    // Color ring by score
    scoreRing.style.borderColor = getScoreColor(latest.score);

    // Sparkline
    const recent = swings.slice(0, 12).reverse();
    if (recent.length >= 2) {
      const maxS = Math.max(...recent.map(s => s.score), 100);
      const minS = Math.min(...recent.map(s => s.score), 0);
      const range = maxS - minS || 1;
      const points = recent.map((s, i) => {
        const x = 8 + (i / (recent.length - 1)) * 104;
        const y = 44 - ((s.score - minS) / range) * 36;
        return `${x},${y}`;
      }).join(' ');
      const lastPt = points.split(' ').pop().split(',');
      sparkline.innerHTML = `
        <polyline points="${points}" stroke="#3F5F45" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="#3F5F45"/>
      `;
    }
  }


  // ===== JOURNAL =====
  function renderJournal() {
    const swings = getSwings();
    const emptyEl = document.getElementById('journal-empty');
    const listEl = document.getElementById('journal-list');

    if (swings.length === 0) {
      emptyEl.classList.remove('hidden');
      listEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    listEl.innerHTML = '';

    swings.forEach((sw, idx) => {
      const d = new Date(sw.date);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const scoreClass = sw.score >= 75 ? 'score-good' : sw.score >= 55 ? 'score-ok' : 'score-poor';

      const entry = document.createElement('div');
      entry.className = 'journal-entry';
      entry.innerHTML = `
        <div class="journal-score-mini ${scoreClass}">${sw.score}</div>
        <div class="journal-info">
          <h4>Session #${swings.length - idx}</h4>
          <p>${dateStr} · ${timeStr} · ${sw.grade}</p>
        </div>
        <span class="journal-arrow">›</span>
      `;
      entry.addEventListener('click', () => {
        showResultsFromSwing(sw);
      });
      listEl.appendChild(entry);
    });
  }

  function showResultsFromSwing(sw) {
    UIModule.renderResults({
      error: false,
      score: sw.score,
      grade: sw.grade,
      phases: sw.phases,
      impact: sw.impact,
      issues: sw.issues || [],
      improvements: sw.improvements || []
    });
    showTab('screen-results');
  }


  // ===== DRILLS =====
  function renderDrills() {
    const swings = getSwings();
    const emptyEl = document.getElementById('drills-empty');
    const contentEl = document.getElementById('drills-content');

    if (swings.length === 0) {
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const latest = swings[0];
    const phases = latest.phases || {};

    // Focus areas (weakest phases)
    const sorted = Object.entries(phases).sort((a, b) => a[1].score - b[1].score);
    const focusEl = document.getElementById('drills-focus');
    focusEl.innerHTML = '';
    sorted.slice(0, 3).forEach(([key, data]) => {
      const name = { setup: 'Setup', backswing: 'Backswing', downswing: 'Downswing', impact: 'Impact', followThrough: 'Follow-through' }[key] || key;
      const dotClass = data.score < 50 ? 'dot-clay' : data.score < 70 ? 'dot-amber' : 'dot-moss';
      const card = document.createElement('div');
      card.className = 'drill-card';
      card.innerHTML = `
        <div class="drill-dot ${dotClass}"></div>
        <div class="drill-card-text">
          <h4>${name} — ${data.score}/100</h4>
          <p>${data.notes && data.notes.length > 0 ? data.notes[0] : 'Keep working on this phase.'}</p>
        </div>
      `;
      focusEl.appendChild(card);
    });

    // Drills based on worst phase
    const drillsEl = document.getElementById('drills-list');
    drillsEl.innerHTML = '';
    const drillBank = {
      setup: [
        { title: 'Mirror Check', desc: 'Practice your address in a mirror. Check spine angle (20-35°) and knee flex.' },
        { title: 'Chair Drill', desc: 'Imagine sitting on a tall bar stool to find the right knee flex and hip hinge.' }
      ],
      backswing: [
        { title: 'Slow Motion Turns', desc: 'Practice backswing at 25% speed. Focus on shoulder turn while keeping lower body stable.' },
        { title: 'Left Arm Straight', desc: 'Swing to the top and pause — check that your lead arm stays extended.' }
      ],
      downswing: [
        { title: 'Step Drill', desc: 'Lift your front foot during backswing, step it down to start the downswing. Builds proper sequence.' },
        { title: 'Hip Bump', desc: 'Start the downswing by bumping hips toward the target before rotating. Lower body leads.' }
      ],
      impact: [
        { title: 'Punch Shots', desc: 'Hit 50-yard punch shots to feel correct impact: weight forward, hands ahead of the ball.' },
        { title: 'Impact Bag', desc: 'Use an impact bag or heavy towel to train the feel of proper compression at impact.' }
      ],
      followThrough: [
        { title: 'Hold Your Finish', desc: 'Hold your finish position for 3 seconds after every swing. You should be balanced on your front foot.' },
        { title: 'Belt Buckle Target', desc: 'At finish, your belt buckle should face the target. Practice full rotation through the ball.' }
      ]
    };

    const worstKey = sorted[0]?.[0];
    const drills = drillBank[worstKey] || drillBank.setup;
    drills.forEach(d => {
      const card = document.createElement('div');
      card.className = 'drill-card';
      card.innerHTML = `
        <div class="drill-dot dot-moss"></div>
        <div class="drill-card-text">
          <h4>${d.title}</h4>
          <p>${d.desc}</p>
        </div>
      `;
      drillsEl.appendChild(card);
    });
  }


  // ===== CAMERA / RECORDING =====
  const videoEl = document.getElementById('camera-feed');
  const overlayCanvas = document.getElementById('pose-overlay');
  const statusText = document.getElementById('status-text');
  const recordingTimer = document.getElementById('recording-timer');
  const btnRecord = document.getElementById('btn-record');
  const recordLabel = btnRecord.querySelector('.record-label');
  const bodyGuide = document.getElementById('body-guide');
  const gestureHint = document.getElementById('gesture-hint');
  const thumbIcon = document.getElementById('thumb-icon');
  const btnCamBack = document.getElementById('btn-cam-back');

  let isRecording = false;
  let animFrameId = null;
  let poseReady = false;
  let gestureReady = false;
  let bodyVisible = false;
  let cameraInited = false;

  async function initCamera() {
    showTab('screen-camera');
    statusText.textContent = 'Initializing camera...';

    try {
      if (!cameraInited) {
        await CameraModule.init();
        CameraModule.attachToVideo(videoEl);
        await new Promise(resolve => {
          videoEl.onloadedmetadata = () => { videoEl.play(); resolve(); };
        });

        statusText.textContent = 'Loading AI models...';
        await PoseModule.init(overlayCanvas);
        poseReady = true;

        statusText.textContent = 'Loading gesture recognition...';
        await GestureModule.init();
        gestureReady = true;
        cameraInited = true;
      }

      statusText.textContent = 'Ready — position yourself in the outline';
      bodyGuide.classList.remove('hidden');
      gestureHint.classList.remove('hidden');
      thumbIcon.classList.add('hidden');

      // Pose callback
      PoseModule.setOnPose((landmarks) => {
        const required = [11,12,13,14,15,16,23,24,25,26,27,28];
        const allVis = required.every(i => landmarks[i] && landmarks[i].visibility > 0.5);
        bodyVisible = allVis;
        const outline = bodyGuide.querySelector('.guide-outline');
        const text = bodyGuide.querySelector('.guide-text');
        if (allVis) {
          outline.style.borderColor = 'rgba(63, 95, 69, 0.8)';
          if (!isRecording) {
            text.textContent = '✅ Full body detected — show 👍 to start';
            text.style.color = 'rgba(63, 95, 69, 0.8)';
            gestureHint.classList.remove('hidden');
            gestureHint.classList.add('gesture-ready');
          }
        } else {
          outline.style.borderColor = 'rgba(213, 111, 85, 0.7)';
          text.textContent = '⚠️ Step back — full body must be visible';
          text.style.color = 'rgba(213, 111, 85, 0.8)';
          if (!isRecording) { gestureHint.classList.add('hidden'); gestureHint.classList.remove('gesture-ready'); }
        }
      });

      GestureModule.onThumbsUp(() => {
        if (!isRecording && bodyVisible) startRecording();
        else if (isRecording) stopRecording();
      });

      startDetectionLoop();

    } catch (err) {
      alert(err.message);
      showTab('tab-home');
    }
  }

  btnRecord.addEventListener('click', () => {
    if (!isRecording && bodyVisible) startRecording();
    else if (isRecording) stopRecording();
  });

  btnCamBack.addEventListener('click', () => {
    cancelAnimationFrame(animFrameId);
    if (isRecording) {
      isRecording = false;
      CameraModule.stopRecording();
      PoseModule.stopCollecting();
    }
    showTab('tab-home');
  });

  function startRecording() {
    isRecording = true;
    btnRecord.classList.add('recording');
    recordLabel.textContent = 'Stop (or show 👍)';
    recordingTimer.classList.remove('hidden');
    bodyGuide.classList.add('hidden');
    gestureHint.classList.add('hidden');
    statusText.textContent = 'Recording...';
    thumbIcon.classList.remove('hidden');
    thumbIcon.classList.add('recording-pulse');
    PoseModule.startCollecting();
    CameraModule.startRecording(time => { recordingTimer.textContent = time; });
    GestureModule.resetCooldown();
  }

  async function stopRecording() {
    isRecording = false;
    btnRecord.classList.remove('recording');
    recordLabel.textContent = 'Start Recording';
    recordingTimer.classList.add('hidden');
    statusText.textContent = 'Ready';
    thumbIcon.classList.add('hidden');
    thumbIcon.classList.remove('recording-pulse');

    const frameData = PoseModule.stopCollecting();
    await CameraModule.stopRecording();
    cancelAnimationFrame(animFrameId);

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

    if (!result.error) {
      saveSwing(result);
    }

    UIModule.renderResults(result);
    showTab('screen-results');
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


  // ===== RESULTS SCREEN =====
  const btnResultsBack = document.getElementById('btn-results-back');
  const btnRetry = document.getElementById('btn-retry');

  btnResultsBack.addEventListener('click', () => {
    showTab('tab-home');
    updateHome();
  });

  btnRetry.addEventListener('click', () => {
    initCamera();
  });

  // Phase tabs
  document.getElementById('phase-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.phase-tab');
    if (!tab) return;
    document.querySelectorAll('.phase-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const phase = tab.dataset.phase;
    const overview = document.getElementById('results-overview');
    const detail = document.getElementById('phase-detail');

    if (phase === 'all') {
      overview.style.display = '';
      detail.classList.remove('visible');
    } else {
      overview.style.display = 'none';
      renderPhaseDetail(phase);
    }
  });

  let lastResult = null;

  // Override UIModule.renderResults to also store + handle phase tabs
  const origRender = UIModule.renderResults;
  UIModule.renderResults = function(result) {
    lastResult = result;
    origRender(result);

    // Reset tabs
    document.querySelectorAll('.phase-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.phase-tab[data-phase="all"]').classList.add('active');
    document.getElementById('results-overview').style.display = '';
    document.getElementById('phase-detail').classList.remove('visible');
  };

  function renderPhaseDetail(phaseKey) {
    if (!lastResult || lastResult.error) return;
    const detail = document.getElementById('phase-detail');
    const data = lastResult.phases[phaseKey];
    if (!data) { detail.classList.remove('visible'); return; }

    const name = { setup: 'Setup', backswing: 'Backswing', downswing: 'Downswing', impact: 'Impact', followThrough: 'Follow-through' }[phaseKey] || phaseKey;

    let notesHtml = '';
    if (data.notes && data.notes.length > 0) {
      notesHtml = data.notes.map(n => `<div class="phase-note">${n}</div>`).join('');
    } else {
      notesHtml = '<div class="phase-note phase-note-good">Looking good! No issues detected.</div>';
    }

    detail.innerHTML = `
      <div class="phase-detail-card">
        <div class="phase-detail-score">
          <span class="phase-detail-num" style="color:${getScoreColor(data.score)}">${data.score}</span>
          <span class="phase-detail-name">${name}</span>
        </div>
        <div class="phase-detail-notes">${notesHtml}</div>
      </div>
    `;
    detail.classList.add('visible');
  }


  // ===== UTILITIES =====
  function getScoreColor(score) {
    if (score >= 75) return '#3F5F45';
    if (score >= 55) return '#E5A400';
    return '#D56F55';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // PWA
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });

  // Init home
  updateHome();

})();
