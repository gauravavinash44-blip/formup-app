import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

import { SKELETON_BONES, SKELETON_JOINTS, type Pose, type PosePoint } from '../../src/pose/landmarks';

/**
 * Camera stage: opens the camera, runs MediaPipe pose detection on each new
 * frame, and draws video + skeleton + a HUD onto one canvas. Recording
 * captures that canvas, so clips include the overlay.
 */

export const COLORS = { brand: '#FF6B2C', good: '#33BF66', warn: '#F28C1A', info: 'rgba(0,0,0,0.55)' };

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') === 'full' ? 'pose_landmarker_full.task' : 'pose_landmarker_lite.task';

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
export function getLandmarker(): Promise<PoseLandmarker> {
  landmarkerPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(new URL('./wasm', location.href).href);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: new URL(`./models/${MODEL}`, location.href).href, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
    });
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  })();
  landmarkerPromise.catch(() => (landmarkerPromise = null));
  return landmarkerPromise;
}

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 1% of the shorter visible side, for sizing HUD elements. */
  u: number;
}

export interface Clip {
  url: string;
  blob: Blob;
  ext: string;
}

export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  facing: 'user' | 'environment' = 'user';
  /** Called once per new camera frame with the raw (unmirrored) landmarks. */
  onFrame: ((pose: Pose | null, now: number, aspect: number) => void) | null = null;
  /** Draws the HUD on top of the video and skeleton. */
  drawHud: ((ctx: CanvasRenderingContext2D, view: View, now: number) => void) | null = null;
  /** Joints to highlight green (good-rep flash). */
  flashUntil = 0;
  onRecordingChange: ((on: boolean) => void) | null = null;
  clip: Clip | null = null;

  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private points: PosePoint[] | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopWaiters: (() => void)[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  get open(): boolean {
    return !!this.stream;
  }

  get recording(): boolean {
    return !!this.recorder;
  }

  /** Opens the camera and loads the model. Throws a friendly Error on failure. */
  async start(facing: 'user' | 'environment', onStatus: (text: string) => void): Promise<void> {
    this.facing = facing;
    this.clip = null;
    onStatus('Starting camera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
      });
    } catch (e) {
      console.warn(e);
      throw new Error('FormUp needs the camera to count your reps. Allow camera access in your browser settings, then try again.');
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    onStatus('Loading the pose model…');
    this.landmarker = await getLandmarker();
    this.lastVideoTime = -1;
    this.loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.points = null;
  }

  private loop = () => {
    if (!this.stream) return;
    this.raf = requestAnimationFrame(this.loop);
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!W || !H || !this.landmarker) return;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const now = Date.now();
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const res = this.landmarker.detectForVideo(this.video, performance.now());
      const lm = res.landmarks[0] ?? null;
      const mirror = this.facing === 'user';
      this.points = lm
        ? lm.map((p) => ({ x: (mirror ? 1 - p.x : p.x) * W, y: p.y * H, visibility: p.visibility ?? 1 }))
        : null;
      this.onFrame?.(lm, now, W / H);
    }
    this.draw(W, H, now);
  };

  /** Part of the canvas actually visible on screen (it is shown with object-fit: cover). */
  private viewRect(W: number, H: number): View {
    const r = this.canvas.getBoundingClientRect();
    const scale = Math.max(r.width / W, r.height / H) || 1;
    const w = r.width / scale || W;
    const h = r.height / scale || H;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, u: Math.min(w, h) / 100 };
  }

  private draw(W: number, H: number, now: number) {
    const ctx = this.ctx;
    ctx.save();
    if (this.facing === 'user') {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, 0, 0, W, H);
    ctx.restore();

    const view = this.viewRect(W, H);
    const pts = this.points;
    if (pts) {
      const ok = (i: number) => (pts[i].visibility ?? 1) >= 0.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(3, view.u * 1.2);
      ctx.beginPath();
      for (const [a, b] of SKELETON_BONES) {
        if (!ok(a) || !ok(b)) continue;
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      ctx.fillStyle = now < this.flashUntil ? COLORS.good : '#fff';
      for (const j of SKELETON_JOINTS) {
        if (!ok(j)) continue;
        ctx.beginPath();
        ctx.arc(pts[j].x, pts[j].y, Math.max(4, view.u * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.drawHud?.(ctx, view, now);
    // Brand mark, so shared clips carry it.
    const size = view.u * 4.2;
    ctx.font = `800 ${size}px Archivo, Inter, sans-serif`;
    const bw = ctx.measureText('🦏 FormUp').width;
    pill(ctx, '🦏 FormUp', view.x + view.w - bw / 2 - view.u * 6, view.y + view.h * 0.68, size, 'rgba(0,0,0,0.35)', view.u * 1.6);
  }

  /* ---------- recording ---------- */

  toggleRecord(): string | null {
    if (this.recorder) {
      this.recorder.stop();
      return null;
    }
    if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) return 'Recording is not supported in this browser.';
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(
      this.canvas.captureStream(30),
      mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined,
    );
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(this.chunks, { type });
      if (this.clip) URL.revokeObjectURL(this.clip.url);
      this.clip = blob.size ? { blob, url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm' } : null;
      this.recorder = null;
      this.onRecordingChange?.(false);
      this.stopWaiters.splice(0).forEach((f) => f());
    };
    rec.start(500);
    this.recorder = rec;
    this.onRecordingChange?.(true);
    return null;
  }

  /** Stops any recording and resolves once the clip is ready. */
  finishRecording(): Promise<void> {
    if (!this.recorder) return Promise.resolve();
    return new Promise((resolve) => {
      this.stopWaiters.push(resolve);
      this.recorder!.stop();
    });
  }
}

/** Text in a rounded pill, centred on (cx, cy). */
export function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  bg: string | null,
  pad: number,
  weight = 800,
): void {
  ctx.font = `${weight} ${size}px Archivo, Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const th = size * 1.15;
  if (bg) {
    ctx.fillStyle = bg;
    const w = tw + pad * 2.8;
    const h = th + pad * 1.2;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy + size * 0.04);
}

/** A progress ring (0..1) centred on (cx, cy). */
export function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, frac: number, color: string, width: number): void {
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (frac <= 0) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
  ctx.stroke();
}
