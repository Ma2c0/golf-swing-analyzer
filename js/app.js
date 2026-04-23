/**
 * Main application — state machine driven recording flow.
 *
 * States:
 *   IDLE          → User sees camera preview, can press "Start Recording"
 *   FRAMING       → System checks full body + distance + stability
 *   RECORDING     → Auto-started after framing passes; collecting pose data
 *   VALIDATING    → Post-recording clip validation (is it a real swing?)
 *   ANALYZING     → Running swing analysis (only if validation passed)
 *   RESULTS       → Showing results
 *   REJECTED      → Clip failed validation, prompt to retry
 */
(async function () {
  'use strict';

  // ═══════════════════════════════
  // State enum
  // ═══════════════════════════════
  const STATE = {
    IDLE: 'IDLE',
    FRAMING: 'FRAMING',
    RECORDING: 'RECORDING',
    VALIDATING: 'VALIDATING',
    ANALYZING: 'ANALYZING',
    RESULTS: 'RESULTS',
    REJECTED: 'REJECTED',
  };

  let currentState = STATE.IDLE;

  // ═══════════════════════════════
  // DOM elements
  // ═══════════════════════════════
  const btnStart       = document.getElementById('btn-start');
  const btnRecord      = document.getElementById('btn-record');
  const btnStop        = document.getElementById('btn-stop');
  const btnBack        = document.getElementById('btn-back');
  const btnRetry       = document.getElementById('btn-retry');
  const btnRetryReject = document.getElementById('btn-retry-reject');
  const videoEl        = document.getElementById('camera-feed');
  const overlayCanvas  = document.getElementById('pose-overlay');
  const statusText     = document.getElementById('status-text');
  const recordingTimer = document.getElementById('recording-timer');
  const bodyGuide      = document.getElementById('body-guide');
  const guideOutline   = bodyGuide ? bodyGuide.querySelector('.guide-outline') : null;
  const guideText      = bodyGuide ? bodyGuide.querySelector('.guide-text') : null;
  const stabilityBar   = document.getElementById('stability-bar');
  const stabilityFill  = document.getElementById('stability-fill');
  const recordingWarn  = document.getElementById('recording-warn');
  const rejectMessage  = document.getElementById('reject-message');

  let poseAnimId = null;
  let poseReady = false;

  // ═══════════════════════════════
  // State transition
  // ═══════════════════════════════
  function setState(newState) {
    console.log(`State: ${currentState} → ${newState}`);
    currentState = newState;
    updateUI();
  }

  function updateUI() {
    // Hide everything first
    if (stabilityBar) stabilityBar.classList.add('hidden');
    if (recordingWarn) recordingWarn.classList.add('hidden');
    if (recordingTimer) recordingTimer.classList.add('hidden');

    switch (currentState) {
      case STATE.IDLE:
        if (btnRecord) { btnRecord.classList.remove('hidden'); btnRecord.classList.remove('recording'); }
        if (btnStop) btnStop.classList.add('hidden');
        if (bodyGuide) bodyGuide.classList.remove('hidden');
        if (guideOutline) guideOutline.style.borderColor = 'rgba(255,255,255,0.3)';
        if (guideText) { guideText.textContent = 'Position yourself inside the outline'; guideText.style.color = 'rgba(255,255,255,0.6)'; }
        statusText.textContent = 'Ready — tap Start Recording when positioned';
        break;

      case STATE.FRAMING:
        if (btnRecord) btnRecord.classList.add('hidden');
        if (btnStop) btnStop.classList.add('hidden');
        if (bodyGuide) bodyGuide.classList.remove('hidden');
        if (stabilityBar) stabilityBar.classList.remove('hidden');
        statusText.textContent = 'Checking position...';
        break;

      case STATE.RECORDING:
        if (btnRecord) btnRecord.classList.add('hidden');
        if (btnStop) btnStop.classList.remove('hidden');
        if (bodyGuide) bodyGuide.classList.add('hidden');
        if (recordingTimer) recordingTimer.classList.remove('hidden');
        statusText.textContent = 'Recording — swing when ready (auto-stops after swing)';
        break;

      case STATE.VALIDATING:
        UIModule.showScreen('screen-analyzing');
        UIModule.setProgress(0, 'Validating recording...');
        break;

      case STATE.ANALYZING:
        UIModule.showScreen('screen-analyzing');
        break;

      case STATE.RESULTS:
        // handled by UIModule.renderResults
        break;

      case STATE.REJECTED:
        UIModule.showScreen('screen-rejected');
        break;
    }
  }

  // ═══════════════════════════════
  // Landing → Camera
  // ═══════════════════════════════
  btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    btnStart.textContent = 'Initializing...';

    try {
      await CameraModule.init();
      CameraModule.attachToVideo(videoEl);

      await new Promise((resolve) => {
        videoEl.onloadedmetadata = () => { videoEl.play(); resolve(); };
      });

      statusText.textContent = 'Loading AI model...';
      UIModule.showScreen('screen-camera');
      await PoseModule.init(overlayCanvas);
      poseReady = true;
      console.log('Pose model loaded');

      setState(STATE.IDLE);

      // Set up pose callback — drives framing checks and recording monitoring
      PoseModule.setOnPose(onPoseFrame);

      startPoseLoop();

    } catch (err) {
      console.error('Init error:', err);
      alert(err.message);
      btnStart.disabled = false;
      btnStart.textContent = 'Start Analysis';
    }
  });

  // ═══════════════════════════════
  // Pose frame handler (runs every frame)
  // ═══════════════════════════════
  function onPoseFrame(landmarks) {
    if (currentState === STATE.FRAMING) {
      handleFramingCheck(landmarks);
    } else if (currentState === STATE.RECORDING) {
      handleRecordingMonitor(landmarks);
    }
  }

  // ═══════════════════════════════
  // FRAMING CHECK
  // ═══════════════════════════════
  function handleFramingCheck(landmarks) {
    const result = ValidationModule.validateFrame(landmarks);
    const stability = ValidationModule.trackStability(result);

    // Update guide outline color
    if (guideOutline) {
      guideOutline.style.borderColor = result.pass
        ? 'rgba(46, 204, 113, 0.8)'
        : 'rgba(231, 76, 60, 0.7)';
    }

    // Update guide text
    if (guideText) {
      guideText.textContent = result.message;
      guideText.style.color = result.pass
        ? 'rgba(46, 204, 113, 0.8)'
        : 'rgba(231, 76, 60, 0.8)';
    }

    // Update stability bar
    if (stabilityFill) {
      stabilityFill.style.width = (stability * 100) + '%';
      stabilityFill.style.background = result.pass ? 'var(--green)' : 'var(--red)';
    }

    // Update status text
    if (result.pass) {
      const remaining = Math.ceil((1 - stability) * (ValidationModule.CONFIG.STABLE_FRAMES_REQUIRED / 30));
      if (remaining > 0) {
        statusText.textContent = `Position OK — hold still (${remaining}s)...`;
      } else {
        statusText.textContent = 'Starting recording...';
      }
    } else {
      statusText.textContent = result.message;
    }

    // Auto-start recording when stable
    if (ValidationModule.isStable()) {
      beginRecording();
    }
  }

  // ═══════════════════════════════
  // RECORDING MONITOR + LIVE SWING DETECTION
  // ═══════════════════════════════
  let autoStopPending = false;

  function handleRecordingMonitor(landmarks) {
    // 1. Out-of-frame warnings
    const check = ValidationModule.monitorRecordingFrame(landmarks);
    if (check.warn && recordingWarn) {
      recordingWarn.textContent = check.message;
      recordingWarn.classList.remove('hidden');
    } else if (recordingWarn) {
      recordingWarn.classList.add('hidden');
    }

    // 2. Live swing detection
    const swing = ValidationModule.detectSwingLive(landmarks);

    // Update status text with current swing phase
    const phaseLabels = {
      'SETUP': 'Waiting for swing...',
      'BACKSWING': 'Backswing detected...',
      'DOWNSWING': 'Downswing...',
      'FOLLOW_THROUGH': 'Follow-through...',
      'DONE': 'Swing complete!',
    };
    if (phaseLabels[swing.phase]) {
      statusText.textContent = phaseLabels[swing.phase];
    }

    // 3. Auto-stop when swing is complete
    if (swing.autoStop && !autoStopPending) {
      autoStopPending = true;
      statusText.textContent = 'Swing complete — stopping recording...';
      // Short delay so user sees the message
      setTimeout(() => {
        if (currentState === STATE.RECORDING) {
          endRecording();
        }
      }, 500);
    }
  }

  // ═══════════════════════════════
  // Button: Start Recording → enters FRAMING
  // ═══════════════════════════════
  if (btnRecord) {
    btnRecord.addEventListener('click', () => {
      if (currentState === STATE.IDLE) {
        ValidationModule.resetStability();
        setState(STATE.FRAMING);
      }
    });
  }

  // ═══════════════════════════════
  // Button: Stop Recording → enters VALIDATING
  // ═══════════════════════════════
  if (btnStop) {
    btnStop.addEventListener('click', () => {
      if (currentState === STATE.RECORDING) {
        endRecording();
      }
    });
  }

  // ═══════════════════════════════
  // Begin recording (auto-triggered after framing passes)
  // ═══════════════════════════════
  function beginRecording() {
    setState(STATE.RECORDING);
    ValidationModule.resetRecordingMonitor();
    ValidationModule.resetSwingDetector();
    autoStopPending = false;

    PoseModule.startCollecting();
    CameraModule.startRecording((time) => {
      if (recordingTimer) recordingTimer.textContent = time;
    });
  }

  // ═══════════════════════════════
  // End recording → validate → analyze or reject
  // ═══════════════════════════════
  async function endRecording() {
    setState(STATE.VALIDATING);

    const frameData = PoseModule.stopCollecting();
    await CameraModule.stopRecording();

    // Stop pose loop during validation/analysis
    cancelAnimationFrame(poseAnimId);

    await sleep(200);
    UIModule.setProgress(20, 'Checking recording quality...');
    await sleep(300);

    // ── Clip validation ──
    const validation = ValidationModule.validateClip(frameData);

    if (!validation.valid) {
      // REJECTED
      console.log('Clip rejected:', validation.reason, validation.details);
      if (rejectMessage) {
        rejectMessage.textContent = validation.message;
      }
      setState(STATE.REJECTED);
      return;
    }

    // ── Validation passed → analyze ──
    UIModule.setProgress(40, 'Valid swing detected. Analyzing...');
    setState(STATE.ANALYZING);
    await runAnalysis(frameData);
  }

  // ═══════════════════════════════
  // Analysis (unchanged logic, just wrapped)
  // ═══════════════════════════════
  async function runAnalysis(frameData) {
    UIModule.setProgress(50, 'Detecting swing phases...');
    await sleep(300);

    UIModule.setProgress(65, 'Analyzing body mechanics...');
    await sleep(300);

    const result = AnalysisModule.analyze(frameData);

    // Double-check: if analysis itself returns an error, treat as rejection
    if (result.error) {
      if (rejectMessage) rejectMessage.textContent = result.message;
      setState(STATE.REJECTED);
      return;
    }

    UIModule.setProgress(85, 'Estimating impact point...');
    await sleep(300);

    UIModule.setProgress(100, 'Complete!');
    await sleep(400);

    setState(STATE.RESULTS);
    UIModule.renderResults(result);
  }

  // ═══════════════════════════════
  // Back button (camera screen → landing)
  // ═══════════════════════════════
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      cancelAnimationFrame(poseAnimId);
      CameraModule.destroy();
      poseReady = false;
      UIModule.showScreen('screen-landing');
      btnStart.disabled = false;
      btnStart.textContent = 'Start Analysis';
      currentState = STATE.IDLE;
    });
  }

  // ═══════════════════════════════
  // Retry buttons (results or rejected → back to camera idle)
  // ═══════════════════════════════
  function retryFlow() {
    UIModule.showScreen('screen-camera');
    setState(STATE.IDLE);
    ValidationModule.resetStability();
    startPoseLoop();
  }

  if (btnRetry) btnRetry.addEventListener('click', retryFlow);
  if (btnRetryReject) btnRetryReject.addEventListener('click', retryFlow);

  // ═══════════════════════════════
  // Pose detection loop
  // ═══════════════════════════════
  function startPoseLoop() {
    async function loop() {
      if (poseReady && videoEl.readyState >= 2) {
        try {
          await PoseModule.sendFrame(videoEl);
        } catch (e) { /* skip frame */ }
      }
      poseAnimId = requestAnimationFrame(loop);
    }
    loop();
  }

  // ═══════════════════════════════
  // Utility
  // ═══════════════════════════════
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

})();
