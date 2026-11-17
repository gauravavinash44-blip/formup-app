import type { CueTone } from '../exercises/squat';

/**
 * Everything the coach clip needs to redraw the overlay on top of the
 * recorded video: per pose frame, the skeleton points and what the HUD said.
 *
 * Points are stored normalized to the on-screen camera view (0..1), i.e.
 * exactly what the user saw on the preview. When the recording finishes we
 * convert them to the video's own normalized coordinates.
 */
export interface TimelineFrame {
  /** Milliseconds since recording started. */
  t: number;
  /** Flattened [x, y, visibility] triples for all 33 landmarks, or [] if no body. */
  pts: number[];
  reps: number;
  target: number;
  cue: string;
  tone: CueTone;
  /** Set on frames shortly after a good rep, so the clip can flash a check mark. */
  goodFlash: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export interface CoachClipSpec {
  frames: TimelineFrame[];
  /** Shown in the corner of every clip. */
  brand: string;
  title: string;
}

export class TimelineRecorder {
  private frames: TimelineFrame[] = [];
  private startMs: number | null = null;

  start(nowMs: number): void {
    this.frames = [];
    this.startMs = nowMs;
  }

  get recording(): boolean {
    return this.startMs !== null;
  }

  push(nowMs: number, frame: Omit<TimelineFrame, 't'>): void {
    if (this.startMs === null) return;
    this.frames.push({ ...frame, t: Math.max(0, Math.round(nowMs - this.startMs)) });
  }

  stop(): TimelineFrame[] {
    this.startMs = null;
    const out = this.frames;
    this.frames = [];
    return out;
  }
}

/** Round to 4 decimals to keep the timeline file small. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Map one point from preview-view normalized coords to video normalized
 * coords. The preview shows the camera image scaled to *cover* the view
 * (cropped on one axis), so we undo that crop.
 */
export function viewToVideo(
  x: number,
  y: number,
  view: Size,
  video: Size,
  mirrorX = false,
): [number, number] {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const shownW = video.width * scale;
  const shownH = video.height * scale;
  const offX = (view.width - shownW) / 2;
  const offY = (view.height - shownH) / 2;
  let vx = (x * view.width - offX) / shownW;
  const vy = (y * view.height - offY) / shownH;
  if (mirrorX) vx = 1 - vx;
  return [vx, vy];
}

/**
 * Video files often report their size in the sensor's landscape orientation
 * even when the clip plays back in portrait. Match the view's orientation.
 */
export function uprightVideoSize(video: Size, view: Size): Size {
  const viewPortrait = view.height >= view.width;
  const videoPortrait = video.height >= video.width;
  return viewPortrait === videoPortrait ? video : { width: video.height, height: video.width };
}

export function toVideoTimeline(
  frames: TimelineFrame[],
  view: Size,
  rawVideo: Size,
  mirrorX = false,
): TimelineFrame[] {
  const video = uprightVideoSize(rawVideo, view);
  return frames.map((f) => {
    const pts: number[] = new Array(f.pts.length);
    for (let i = 0; i + 2 < f.pts.length; i += 3) {
      const [vx, vy] = viewToVideo(f.pts[i], f.pts[i + 1], view, video, mirrorX);
      pts[i] = r4(vx);
      pts[i + 1] = r4(vy);
      pts[i + 2] = f.pts[i + 2];
    }
    return { ...f, pts };
  });
}

/** Flatten view-pixel points into the compact normalized triple format. */
export function packPoints(
  points: ReadonlyArray<{ x: number; y: number; visibility?: number }>,
  view: Size,
): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(r4(p.x / view.width), r4(p.y / view.height), Math.round((p.visibility ?? 1) * 100) / 100);
  }
  return out;
}
