/**
 * Main application — ties everything together.
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

  let isRecording = false;
  let animFrameId = null;
  let poseReady = false;

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
      statusText.textContent = 'Loading AI model...';
      UIModule.showScreen('screen-camera');
      await PoseModule.init(overlayCanvas);
      poseReady = true;
      statusText.textContent = 'Ready — position yourself and press record';

      // Start pose detection loop
      startPoseLoop();

    } catch (err) {
      alert(err.message);
      btnStart.disabled = false;
      btnStart.textContent = 'Start Analysis';
    }
  });

  // ===== Record toggle =====
  btnRecord.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  function startRecording() {
    isRecording = true;
    btnRecord.classList.add('recording');
    recordLabel.textContent = 'Stop Recording';
    recordingTimer.classList.remove('hidden');
    bodyGuide.classList.add('hidden');
    statusText.textContent = 'Recording...';

    // Start collecting pose data
    PoseModule.startCollecting();

    // Start media recording
    CameraModule.startRecording((time) => {
      recordingTimer.textContent = time;
    });
  }

  async function stopRecording() {
    isRecording = false;
    btnRecord.classList.remove('recording');
    recordLabel.textContent = 'Start Recording';
    recordingTimer.classList.add('hidden');
    statusText.textContent = 'Ready';

    // Stop collecting and get frame data
    const frameData = PoseModule.stopCollecting();

    // Stop media recording
    await CameraModule.stopRecording();

    // Stop pose loop during analysis
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
    UIModule.showScreen('screen-landing');
    btnStart.disabled = false;
    btnStart.textContent = 'Start Analysis';
  });

  // ===== Retry button =====
  btnRetry.addEventListener('click', async () => {
    UIModule.showScreen('screen-camera');
    bodyGuide.classList.remove('hidden');
    statusText.textContent = 'Ready — position yourself and press record';
    startPoseLoop();
  });

  // ===== Pose detection loop =====
  function startPoseLoop() {
    async function loop() {
      if (poseReady && videoEl.readyState >= 2) {
        try {
          await PoseModule.sendFrame(videoEl);
        } catch (e) {
          // Pose detection error — skip frame
        }
      }
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
