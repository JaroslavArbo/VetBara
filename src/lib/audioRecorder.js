// Examiner outdoor voice recorder with live voice enhancement.
//
// The whole outdoor session is captured. "Cleanup" (voice emphasis + background
// noise suppression) is applied LIVE, as an audio graph on the microphone
// stream, so the recorded file is already the cleaned version and the approach
// scales to a full ~2h exam without huge post-processing buffers:
//
//   mic (getUserMedia: noiseSuppression + echoCancellation + autoGainControl)
//     -> high-pass filter    (removes low-frequency rumble / wind / handling)
//     -> high-shelf presence (lifts speech consonant range for clarity)
//     -> dynamics compressor  (evens out levels, brings quiet speech forward)
//     -> MediaRecorder (Opus, speech-friendly bitrate)

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export function isRecordingSupported() {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    typeof (window.AudioContext || window.webkitAudioContext) !== "undefined"
  );
}

export class OutdoorVoiceRecorder {
  constructor() {
    this.stream = null;
    this.context = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = "";
    this.startedAt = 0;
  }

  async start() {
    if (!isRecordingSupported()) throw new Error("Recording not supported on this device");

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioCtx();
    if (this.context.state === "suspended") await this.context.resume();

    const source = this.context.createMediaStreamSource(this.stream);

    const highpass = this.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 90; // cut rumble / wind / handling noise
    highpass.Q.value = 0.7;

    const presence = this.context.createBiquadFilter();
    presence.type = "highshelf";
    presence.frequency.value = 3000; // lift speech clarity range
    presence.gain.value = 4;

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;

    const destination = this.context.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(presence);
    presence.connect(compressor);
    compressor.connect(destination);

    this.mimeType = pickMimeType();
    const options = this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 32000 } : {};
    this.recorder = new MediaRecorder(destination.stream, options);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    // Flush a chunk every few seconds so a crash loses at most a few seconds.
    this.recorder.start(4000);
    this.startedAt = Date.now();
  }

  isActive() {
    return Boolean(this.recorder && this.recorder.state !== "inactive");
  }

  async stop() {
    if (!this.recorder) return null;
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const recorder = this.recorder;
    const mimeType = this.mimeType || recorder.mimeType || "audio/webm";

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }));
      try {
        recorder.stop();
      } catch {
        resolve(new Blob(this.chunks, { type: mimeType }));
      }
    });

    this.cleanupStream();
    return { blob, mimeType, durationMs };
  }

  cleanupStream() {
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    try {
      this.context?.close();
    } catch {
      /* ignore */
    }
    this.stream = null;
    this.context = null;
    this.recorder = null;
  }
}
