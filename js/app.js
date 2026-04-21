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
  let animFrameId = null;
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

      // Init gesture detection
      statusText.textContent = 'Loading gesture recognition...';
      await GestureModule.init();
      gestureReady = true;

      statusText.textContent = 'Ready — position yourself in the outline';

      // Set up body visibility check
      PoseModule.setOnPose((landmarks) => {
        const requiredIndices = [11,12,13,14,15,16,23,24,25,26,27,28];
        const allVisible = requiredIndices.every(i => landmarks[i] && landmarks[i].visibility > 0.5);
        bodyVisible = allVisible;

        if (allVisible) {
          bodyGuide.querySelector('.guide-outline').style.borderColor = 'rgba(46, 204, 113, 0.8)';
          if (!isRecording) {
            bodyGuide.querySelector('.guide-text').textContent = '✅ Full body detected — show 👍 to start recording';
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

      // Set up gesture control
      GestureModule.onThumbsUp(() => {
        if (!isRecording && bodyVisible) {
          startRecording();
        } else if (isRecording) {
          stopRecording();
        }
      });

      // Start detection loops
      startDetectionLoop();

    } catch (err) {
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

    // Stop detection loop during analysis
    cancelAnimationFrame(animFrameId);

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
    cancelAnimationFrame(animFrameId);
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
    startDetectionLoop();
  });

  // ===== Detection loop (pose + gesture) =====
  function startDetectionLoop() {
    let frameCount = 0;

    async function loop() {
      if (videoEl.readyState >= 2) {
        try {
          // Always run pose detection
          if (poseReady) {
            await PoseModule.sendFrame(videoEl);
          }

          // Run gesture detection every other frame to save CPU
          if (gestureReady && frameCount % 2 === 0) {
            await GestureModule.sendFrame(videoEl);
          }
        } catch (e) {
          // Detection error — skip frame
        }
      }
      frameCount++;
      animFrameId = requestAnimationFrame(loop);
    }
    loop();
  }

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
