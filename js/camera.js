/**
 * Camera module — handles camera access, recording, and frame capture.
 */
const CameraModule = (() => {
  let stream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingStartTime = 0;
  let timerInterval = null;
  let frameCallback = null; // called each frame during recording

  /**
   * Request front-facing camera access.
   * @returns {Promise<MediaStream>}
   */
  async function init() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      return stream;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Camera permission denied. Please allow camera access and try again.');
      }
      throw new Error('Could not access camera: ' + err.message);
    }
  }

  /**
   * Attach stream to a video element.
   */
  function attachToVideo(videoEl) {
    if (!stream) throw new Error('Camera not initialized');
    videoEl.srcObject = stream;
  }

  /**
   * Start recording.
   */
  function startRecording(onTimerUpdate) {
    if (!stream) throw new Error('Camera not initialized');
    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();

    // Use MediaRecorder for video blob
    const options = { mimeType: 'video/mp4' };
    let mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start(100); // collect in 100ms chunks

    // Timer
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (onTimerUpdate) onTimerUpdate(`${mins}:${secs}`);
    }, 250);
  }

  /**
   * Stop recording.
   * @returns {Promise<Blob>} recorded video blob
   */
  function stopRecording() {
    return new Promise((resolve) => {
      isRecording = false;
      clearInterval(timerInterval);

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
          resolve(blob);
        };
        mediaRecorder.stop();
      } else {
        resolve(null);
      }
    });
  }

  /**
   * Stop all tracks and release camera.
   */
  function destroy() {
    isRecording = false;
    clearInterval(timerInterval);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function getStream() { return stream; }
  function getIsRecording() { return isRecording; }

  return {
    init,
    attachToVideo,
    startRecording,
    stopRecording,
    destroy,
    getStream,
    getIsRecording
  };
})();
