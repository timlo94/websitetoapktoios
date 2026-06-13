// Renders an animated image to a downloadable .webm video using Canvas + WebAudio + MediaRecorder.

export type MotionStyle = "kenburns" | "panLeft" | "panRight" | "zoomIn" | "float";
export type ThemeStyle = "none" | "vintage" | "noir" | "vibrant" | "dreamy" | "neon";
export type MusicStyle = "none" | "chill" | "cinematic" | "upbeat" | "ambient" | "dramatic";

export interface ExportOptions {
  imageUrl: string;
  motion: MotionStyle;
  theme: ThemeStyle;
  music: MusicStyle;
  durationSec: number; // 5..15
  fps?: number;        // default 30
  maxSize?: number;    // cap longest edge, default 1080
  onProgress?: (pct: number) => void;
}

const THEME_FILTERS: Record<ThemeStyle, string> = {
  none: "none",
  vintage: "sepia(0.5) contrast(1.1) saturate(0.8) brightness(0.95)",
  noir: "grayscale(1) contrast(1.3) brightness(0.95)",
  vibrant: "saturate(1.6) contrast(1.15)",
  dreamy: "blur(0.6px) brightness(1.08) saturate(1.2) hue-rotate(-10deg)",
  neon: "saturate(1.8) contrast(1.4) hue-rotate(30deg) brightness(1.1)",
};

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/** Draw the image into the canvas with the motion transform applied at progress t∈[0,1]. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  motion: MotionStyle,
  theme: ThemeStyle,
  t: number,
  W: number,
  H: number,
) {
  // Background fill (in case of letterbox)
  ctx.save();
  ctx.filter = "none";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const e = easeInOut(t);

  // base "cover" fit
  const scaleCover = Math.max(W / img.width, H / img.height);

  let extraScale = 1;
  let tx = 0;
  let ty = 0;

  switch (motion) {
    case "kenburns":
      extraScale = 1 + 0.18 * e;
      tx = -0.04 * W * e;
      ty = -0.04 * H * e;
      break;
    case "panLeft":
      extraScale = 1.18;
      tx = (0.06 - 0.12 * e) * W;
      break;
    case "panRight":
      extraScale = 1.18;
      tx = (-0.06 + 0.12 * e) * W;
      break;
    case "zoomIn":
      extraScale = 1 + 0.28 * e;
      break;
    case "float": {
      extraScale = 1.08;
      const f = Math.sin(t * Math.PI * 2);
      ty = f * 0.02 * H;
      tx = Math.cos(t * Math.PI * 2) * 0.015 * W;
      break;
    }
  }

  const s = scaleCover * extraScale;
  const dw = img.width * s;
  const dh = img.height * s;
  const dx = (W - dw) / 2 + tx;
  const dy = (H - dh) / 2 + ty;

  ctx.save();
  ctx.filter = THEME_FILTERS[theme];
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // Subtle cinematic vignette
  ctx.save();
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Build a looping music source for the given mood. Returns the destination node + a stop() fn. */
function buildMusic(audioCtx: AudioContext, music: MusicStyle, durationSec: number) {
  const dest = audioCtx.createMediaStreamDestination();
  const master = audioCtx.createGain();
  master.gain.value = 0.45;
  master.connect(dest);

  if (music === "none") {
    return { stream: dest.stream, stop: () => {} };
  }

  const now = audioCtx.currentTime + 0.05;
  const endAt = now + durationSec + 0.5;
  const sources: AudioScheduledSourceNode[] = [];

  // Helper: schedule a sustained pad note
  const padNote = (freq: number, start: number, dur: number, gain = 0.18, type: OscillatorType = "sine") => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.4);
    g.gain.linearRampToValueAtTime(gain, start + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + dur + 0.05);
    sources.push(o);
  };

  // Helper: arpeggio pluck
  const pluck = (freq: number, start: number, gain = 0.22) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + 0.4);
    sources.push(o);
  };

  // Helper: kick drum
  const kick = (start: number, gain = 0.5) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.setValueAtTime(120, start);
    o.frequency.exponentialRampToValueAtTime(40, start + 0.15);
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + 0.2);
    sources.push(o);
  };

  if (music === "chill") {
    // Cmaj7 pad + soft arp
    const chord = [261.63, 329.63, 392.0, 493.88]; // C E G B
    chord.forEach((f) => padNote(f, now, durationSec + 0.3, 0.12, "sine"));
    chord.forEach((f) => padNote(f / 2, now, durationSec + 0.3, 0.08, "sine"));
    const arp = [523.25, 659.25, 783.99, 659.25];
    let t = now;
    while (t < endAt - 0.4) {
      arp.forEach((f, i) => pluck(f, t + i * 0.25, 0.15));
      t += arp.length * 0.25;
    }
  } else if (music === "cinematic") {
    // Minor swell, low drone
    padNote(110, now, durationSec + 0.3, 0.25, "sawtooth"); // A2
    padNote(220, now, durationSec + 0.3, 0.18, "sine");
    padNote(261.63, now, durationSec + 0.3, 0.14, "sine"); // C
    padNote(329.63, now + 1, durationSec - 0.7, 0.12, "sine"); // E
    // Slow timpani hits
    let t = now + 0.5;
    while (t < endAt - 0.5) {
      kick(t, 0.45);
      t += 2;
    }
  } else if (music === "upbeat") {
    // 4-on-the-floor with bouncy arp
    const bpm = 120;
    const beat = 60 / bpm;
    let t = now;
    while (t < endAt - beat) {
      kick(t, 0.5);
      t += beat;
    }
    const arp = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
    let at = now;
    while (at < endAt - 0.2) {
      arp.forEach((f, i) => pluck(f, at + i * (beat / 2), 0.18));
      at += arp.length * (beat / 2);
    }
    padNote(130.81, now, durationSec + 0.3, 0.12, "triangle");
  } else if (music === "ambient") {
    // Drifting drone + shimmer
    padNote(146.83, now, durationSec + 0.3, 0.2, "sine");   // D3
    padNote(220, now, durationSec + 0.3, 0.14, "sine");     // A3
    padNote(293.66, now + 1, durationSec - 0.7, 0.12, "sine"); // D4
    padNote(440, now + 2, Math.max(0.5, durationSec - 2), 0.1, "sine"); // A4
    // Random shimmer plucks
    let t = now + 0.5;
    while (t < endAt - 0.5) {
      pluck(880 + Math.random() * 220, t, 0.08);
      t += 0.6 + Math.random() * 0.6;
    }
  } else if (music === "dramatic") {
    // Power minor chord stabs
    const root = 110; // A2
    padNote(root, now, durationSec + 0.3, 0.22, "sawtooth");
    padNote(root * 1.5, now, durationSec + 0.3, 0.16, "sawtooth"); // E
    padNote(root * 2, now, durationSec + 0.3, 0.12, "sine");
    let t = now;
    while (t < endAt - 0.6) {
      kick(t, 0.55);
      pluck(220, t + 0.05, 0.3);
      pluck(261.63, t + 0.05, 0.25);
      t += 1.2;
    }
  }

  const stop = () => {
    sources.forEach((s) => {
      try { s.stop(); } catch { /* already stopped */ }
    });
  };

  return { stream: dest.stream, stop };
}

export async function exportAnimatedVideo(opts: ExportOptions): Promise<Blob> {
  const fps = opts.fps ?? 30;
  const maxSize = opts.maxSize ?? 1080;
  const duration = Math.max(2, Math.min(20, opts.durationSec));

  if (typeof MediaRecorder === "undefined") {
    throw new Error("Video recording is not supported in this browser");
  }

  const img = await loadImage(opts.imageUrl);

  // Compute canvas size — cap longest edge, keep even dimensions
  let W = img.width;
  let H = img.height;
  const longest = Math.max(W, H);
  if (longest > maxSize) {
    const k = maxSize / longest;
    W = Math.round(W * k);
    H = Math.round(H * k);
  }
  // Encoders prefer even dimensions
  W -= W % 2;
  H -= H % 2;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // Initial frame so capture stream has data
  drawFrame(ctx, img, opts.motion, opts.theme, 0, W, H);

  const videoStream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(fps);

  // Audio
  const AudioCtor: typeof AudioContext = window.AudioContext
    ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtor();
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch { /* ignore */ }
  }
  const { stream: audioStream, stop: stopMusic } = buildMusic(audioCtx, opts.music, duration);

  const tracks: MediaStreamTrack[] = [
    ...videoStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ];
  const combined = new MediaStream(tracks);

  // Pick a supported mime
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

  const recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100);

  // Drive the animation
  const startedAt = performance.now();
  const totalMs = duration * 1000;
  let rafId = 0;
  const tick = () => {
    const elapsed = performance.now() - startedAt;
    const t = Math.min(1, elapsed / totalMs);
    drawFrame(ctx, img, opts.motion, opts.theme, t, W, H);
    opts.onProgress?.(t);
    if (elapsed < totalMs) {
      rafId = requestAnimationFrame(tick);
    }
  };
  rafId = requestAnimationFrame(tick);

  // Wait the duration
  await new Promise((r) => setTimeout(r, totalMs + 150));
  cancelAnimationFrame(rafId);
  stopMusic();

  if (recorder.state !== "inactive") recorder.stop();
  await stopped;

  // Clean up
  tracks.forEach((t) => t.stop());
  try { await audioCtx.close(); } catch { /* ignore */ }

  return new Blob(chunks, { type: mimeType || "video/webm" });
}
