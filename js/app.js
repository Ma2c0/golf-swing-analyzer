/**
 * Main application — ties everything together.
 * Recording is controlled by thumbs-up gesture (no need to touch the screen).
 */
(async function () {
  'use strict';

  // DOM elements
  const btnStart = document.getElementById('btn-start');
  const btnRecord = document.getElementById('btn-record');
  const btnBack = document.getElementById('btn-back');
  const btnRetry = document.getElementById('btn-retry');
  const videoEl = document.getElementById('camera-feed');
  const overlayCanvas = document.getElementById('pose-overlay');
  const statusText = document.getElementById('status-text');
  const recordingTimer = document.getElementById('recording-timer');
  const recordLabel = btnRecord.querySelector('.record-label');
  const bodyGuide = document.getElementById('body-guide');
  const gestureHint = document.getElementById('gesture-hint');
  const thumbIcon = document.getElementById('thumb-icon');

  let isRecording = false;
  let poseAnimId = null;
  let gestureAnimId = null;
  let poseReady = false;
  let gestureReady = false;
  let bodyVisible = false;

  // ===== Landing → Camera =====
  btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    btnStart.textContent = 'Initializing...';

    try {
      // Init camera
      await CameraModule.init();
      CameraModule.attachToVideo(videoEl);

      // Wait for video to be ready
      await new Promise((resolve) => {
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          resolve();
        };
      });

      // Init pose detection
      statusText.textContent = 'Loading AI models...';
      UIModule.showScreen('screen-camera');
      await PoseModule.init(overlayCanvas);
      poseReady = true;
      console.log('✅ Pose model loaded');

      // Init gesture detection
      statusText.textContent = 'Loading gesture recognition...';
      await GestureModule.init();
      gestureReady = true;
      console.log('✅ Gesture model loaded');

      statusText.textContent = 'Ready — position yourself in the outline';

      // Set up body visibility check
      PoseModule.setOnPose((landmarks) => {
        const requiredIndices = [11,12,13,14,15,16,23,24,25,26,27,28];
        const allVisible = requiredIndices.every(i => landmarks[i] && landmarks[i].visibility > 0.5);
        bodyVisible = allVisible;

        if (allVisible) {
          bodyGuide.querySelector('.guide-outline').style.borderColor = 'rgba(46, 204, 113, 0.8)';
          if (!isRecording) {
            bodyGuide.querySelector('.guide-text').textContent = '✅ Full body detected — show 👍 to start';
            bodyGuide.querySelector('.guide-text').style.color = 'rgba(46, 204, 113, 0.8)';
            gestureHint.classList.remove('hidden');
            gestureHint.classList.add('gesture-ready');
          }
        } else {
          bodyGuide.querySelector('.guide-outline').style.borderColor = 'rgba(231, 76, 60, 0.7)';
          bodyGuide.querySelector('.guide-text').textContent = '⚠️ Step back — full body must be visible';
          bodyGuide.querySelector('.guide-text').style.color = 'rgba(231, 76, 60, 0.8)';
          if (!isRecording) {
            gestureHint.classList.add('hidden');
            gestureHint.classList.remove('gesture-ready');
          }
        }
      });

      // Set up gesture state feedback
      GestureModule.onStateChange(({ handDetected, thumbDetected }) => {
        if (thumbDetected) {
          gestureHint.textContent = '👍 Thumbs-up detected! Hold it...';
          gestureHint.style.borderColor = 'var(--green)';
          gestureHint.style.background = 'rgba(46, 204, 113, 0.3)';
        } else if (handDetected) {
          gestureHint.textContent = '🖐 Hand detected — show thumbs up 👍';
          gestureHint.style.borderColor = 'rgba(46, 204, 113, 0.4)';
          gestureHint.style.background = 'rgba(46, 204, 113, 0.15)';
        } else {
          gestureHint.textContent = 'Show 👍 to start recording';
          gestureHint.style.borderColor = 'rgba(46, 204, 113, 0.4)';
          gestureHint.style.background = 'rgba(46, 204, 113, 0.15)';
        }
      });

      // Set up gesture control
      GestureModule.onThumbsUp(() => {
        if (!isRecording && bodyVisible) {
          startRecording();
        } else if (isRecording) {
          stopRecording();
        }
      });

      // Start SEPARATE detection loops so they don't block each other
      startPoseLoop();
      startGestureLoop();

    } catch (err) {
      console.error('Init error:', err);
      alert(err.message);
      btnStart.disabled = false;
      btnStart.textContent = 'Start Analysis';
    }
  });

  // ===== Manual record toggle (still available as fallback) =====
  btnRecord.addEventListener('click', () => {
    if (!isRecording && bodyVisible) {
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  });

  function startRecording() {
    isRecording = true;
    btnRecord.classList.add('recording');
    recordLabel.textContent = 'Stop (or show 👍)';
    recordingTimer.classList.remove('hidden');
    bodyGuide.classList.add('hidden');
    gestureHint.classList.add('hidden');
    statusText.textContent = 'Recording... show 👍 to stop';

    // Show thumb icon as recording indicator
    thumbIcon.classList.remove('hidden');
    thumbIcon.classList.add('recording-pulse');

    // Start collecting pose data
    PoseModule.startCollecting();

    // Start media recording
    CameraModule.startRecording((time) => {
      recordingTimer.textContent = time;
    });

    // Reset gesture cooldown so the next thumbs-up can stop recording
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

    // Stop collecting and get frame data
    const frameData = PoseModule.stopCollecting();

    // Stop media recording
    await CameraModule.stopRecording();

    // Stop detection loops during analysis
    cancelAnimationFrame(poseAnimId);
    cancelAnimationFrame(gestureAnimId);

    // Analyze
    UIModule.showScreen('screen-analyzing');
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

    UIModule.renderResults(result);
  }

  // ===== Back button =====
  btnBack.addEventListener('click', () => {
    cancelAnimationFrame(poseAnimId);
    cancelAnimationFrame(gestureAnimId);
    CameraModule.destroy();
    poseReady = false;
    gestureReady = false;
    UIModule.showScreen('screen-landing');
    btnStart.disabled = false;
    btnStart.textContent = 'Start Analysis';
  });

  // ===== Retry button =====
  btnRetry.addEventListener('click', async () => {
    UIModule.showScreen('screen-camera');
    bodyGuide.classList.remove('hidden');
    gestureHint.classList.remove('hidden');
    thumbIcon.classList.add('hidden');
    statusText.textContent = 'Ready — position yourself in the outline';
    GestureModule.resetCooldown();
    startPoseLoop();
    startGestureLoop();
  });

  // ===== SEPARATE detection loops =====
  // Running Pose and Hands in the same loop causes them to block each other.
  // Separate loops let gesture detection run at its own cadence.

  function startPoseLoop() {
    async function loop() {
      if (poseReady && videoEl.readyState >= 2) {
        try {
          await PoseModule.sendFrame(videoEl);
        } catch (e) {
          // skip frame
        }
      }
      poseAnimId = requestAnimationFrame(loop);
    }
    loop();
  }

  function startGestureLoop() {
    // Run gesture detection at ~15fps using setTimeout instead of rAF
    // This ensures it runs independently of the pose loop
    let running = true;

    async function loop() {
      if (!gestureReady || !running) return;

      if (videoEl.readyState >= 2) {
        try {
          await GestureModule.sendFrame(videoEl);
        } catch (e) {
          // skip frame
        }
      }

      // Use setTimeout for independent timing (~15fps = 66ms)
      gestureAnimId = setTimeout(loop, 66);
    }

    // Override cancelAnimationFrame behavior for this loop
    const origCancel = cancelAnimationFrame;
    gestureAnimId = setTimeout(loop, 100); // start after a small delay

    // Store cleanup
    window._gestureLoopRunning = () => { running = false; clearTimeout(gestureAnimId); };
  }

  // Patch stop functions to also stop gesture loop
  const origStopRecording = stopRecording;

  // ===== Utility =====
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===== PWA install prompt =====
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

})();
