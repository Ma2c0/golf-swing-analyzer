/**
 * Pose detection module — wraps MediaPipe Pose.
 * Collects per-frame landmark data during recording.
 */
const PoseModule = (() => {
  let pose = null;
  let frameData = [];   // array of { timestamp, landmarks }
  let collecting = false;
  let overlayCtx = null;
  let videoWidth = 0;
  let videoHeight = 0;
  let onPoseCallback = null;

  // MediaPipe landmark indices (key ones for golf)
  const LANDMARKS = {
    NOSE: 0,
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13,
    RIGHT_ELBOW: 14,
    LEFT_WRIST: 15,
    RIGHT_WRIST: 16,
    LEFT_HIP: 23,
    RIGHT_HIP: 24,
    LEFT_KNEE: 25,
    RIGHT_KNEE: 26,
    LEFT_ANKLE: 27,
    RIGHT_ANKLE: 28,
    LEFT_HEEL: 29,
    RIGHT_HEEL: 30,
    LEFT_FOOT_INDEX: 31,
    RIGHT_FOOT_INDEX: 32
  };

  // Skeleton connections for drawing
  const CONNECTIONS = [
    [11, 12], // shoulders
    [11, 13], [13, 15], // left arm
    [12, 14], [14, 16], // right arm
    [11, 23], [12, 24], // torso
    [23, 24], // hips
    [23, 25], [25, 27], // left leg
    [24, 26], [26, 28], // right leg
  ];

  /**
   * Initialize MediaPipe Pose.
   */
  async function init(canvasEl) {
    overlayCtx = canvasEl.getContext('2d');

    pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
    });

    pose.setOptions({
      modelComplexity: 1,      // 0=lite, 1=full, 2=heavy
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    pose.onResults(onResults);

    // Warm up the model
    return new Promise((resolve) => {
      // Create a tiny canvas to send a dummy frame
      const dummy = document.createElement('canvas');
      dummy.width = 10;
      dummy.height = 10;
      pose.send({ image: dummy }).then(() => resolve());
    });
  }

  function onResults(results) {
    if (!overlayCtx) return;

    // Match overlay canvas to video dimensions
    const canvas = overlayCtx.canvas;
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    overlayCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.poseLandmarks) {
      drawSkeleton(results.poseLandmarks);

      if (collecting) {
        frameData.push({
          timestamp: Date.now(),
          landmarks: results.poseLandmarks.map(l => ({
            x: l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility
          }))
        });
      }

      if (onPoseCallback) onPoseCallback(results.poseLandmarks);
    }
  }

  function drawSkeleton(landmarks) {
    const w = overlayCtx.canvas.width;
    const h = overlayCtx.canvas.height;

    // Draw connections
    overlayCtx.strokeStyle = 'rgba(46, 204, 113, 0.7)';
    overlayCtx.lineWidth = 3;
    for (const [i, j] of CONNECTIONS) {
      const a = landmarks[i];
      const b = landmarks[j];
      if (a.visibility > 0.3 && b.visibility > 0.3) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(a.x * w, a.y * h);
        overlayCtx.lineTo(b.x * w, b.y * h);
        overlayCtx.stroke();
      }
    }

    // Draw joints
    for (const idx of Object.values(LANDMARKS)) {
      const lm = landmarks[idx];
      if (lm.visibility > 0.3) {
        overlayCtx.fillStyle = 'rgba(46, 204, 113, 0.9)';
        overlayCtx.beginPath();
        overlayCtx.arc(lm.x * w, lm.y * h, 5, 0, 2 * Math.PI);
        overlayCtx.fill();
      }
    }

    // Draw estimated club line (extension from wrists)
    const lw = landmarks[LANDMARKS.LEFT_WRIST];
    const rw = landmarks[LANDMARKS.RIGHT_WRIST];
    if (lw.visibility > 0.4 && rw.visibility > 0.4) {
      // Midpoint of wrists
      const mx = (lw.x + rw.x) / 2;
      const my = (lw.y + rw.y) / 2;
      // Direction: from midpoint of elbows to midpoint of wrists, extended
      const le = landmarks[LANDMARKS.LEFT_ELBOW];
      const re = landmarks[LANDMARKS.RIGHT_ELBOW];
      const emx = (le.x + re.x) / 2;
      const emy = (le.y + re.y) / 2;
      const dx = mx - emx;
      const dy = my - emy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.01) {
        const clubLen = 0.35; // estimated club length in normalized coords
        const ex = mx + (dx / len) * clubLen;
        const ey = my + (dy / len) * clubLen;
        overlayCtx.strokeStyle = 'rgba(241, 196, 15, 0.6)';
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([6, 4]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(mx * w, my * h);
        overlayCtx.lineTo(ex * w, ey * h);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
      }
    }
  }

  /**
   * Send a video frame for pose detection.
   */
  async function sendFrame(videoEl) {
    if (!pose) return;
    videoWidth = videoEl.videoWidth;
    videoHeight = videoEl.videoHeight;
    await pose.send({ image: videoEl });
  }

  function startCollecting() {
    frameData = [];
    collecting = true;
  }

  function stopCollecting() {
    collecting = false;
    return frameData;
  }

  function getFrameData() { return frameData; }

  function setOnPose(cb) { onPoseCallback = cb; }

  return {
    init,
    sendFrame,
    startCollecting,
    stopCollecting,
    getFrameData,
    setOnPose,
    LANDMARKS
  };
})();
