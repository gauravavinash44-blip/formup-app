import { Ema, jointAngle, leanFromVertical, visible } from '../pose/geometry';
import { LM, type Pose, type PosePoint } from '../pose/landmarks';

/**
 * Squat rep counter and form checker.
 *
 * Works from the knee angle (hip-knee-ankle). A rep is: standing, bend the
 * knees deep enough, stand back up. Form rules are checked at the bottom of
 * each rep. All thresholds are in one place so they can be tuned on real
 * phones without touching the logic.
 */
export const SQUAT_THRESHOLDS = {
  /** Knee angle above this counts as standing tall. */
  standing: 160,
  /** Knee angle below this means a squat has started. */
  descentStart: 145,
  /** Bottom knee angle at or below this is full depth. */
  goodDepth: 100,
  /** Bottom knee angle at or below this still counts, with a "deeper" cue. */
  countDepth: 115,
  /** Torso lean from vertical (degrees) above this at the bottom: "chest up". */
  maxTorsoLean: 50,
  /** Knee width / ankle width below this at the bottom (front view): knees caving. */
  minKneeToAnkleWidth: 0.75,
  /** Shoulder width / torso length above this means the person faces the camera. */
  frontViewShoulderRatio: 0.35,
  /** A rep faster than this (ms) gets a "slow down" cue. */
  minRepMs: 700,
  /** How long the body can drop out of view (ms) before we ask them to step back. */
  lostBodyGraceMs: 600,
  /** Minimum landmark visibility to trust a point. */
  minVisibility: 0.5,
  /** Smoothing factor for the knee angle (0..1, higher = less smoothing). */
  smoothing: 0.5,
} as const;

export type SquatPhase = 'setup' | 'up' | 'down';
export type FormIssue = 'shallow' | 'chest' | 'knees' | 'fast';
export type RepQuality = 'good' | 'okay' | 'bad';
export type CueTone = 'info' | 'good' | 'warn';

export interface Cue {
  text: string;
  tone: CueTone;
}

export interface RepResult {
  index: number;
  counted: boolean;
  quality: RepQuality;
  issues: FormIssue[];
  bottomKneeAngle: number;
  startMs: number;
  endMs: number;
}

export interface SquatState {
  phase: SquatPhase;
  reps: number;
  goodReps: number;
  target: number;
  done: boolean;
  cue: Cue;
  kneeAngle: number | null;
  lastRep: RepResult | null;
}

export const ISSUE_CUES: Record<FormIssue, string> = {
  shallow: 'Go a little deeper',
  chest: 'Keep your chest up',
  knees: 'Push your knees out',
  fast: 'Slow down',
};

const PHASE_CUES: Record<SquatPhase, Cue> = {
  setup: { text: 'Step back so your whole body is in view', tone: 'warn' },
  up: { text: 'Squat down', tone: 'info' },
  down: { text: 'Squat down', tone: 'info' },
};

interface Side {
  shoulder: PosePoint;
  hip: PosePoint;
  knee: PosePoint;
  ankle: PosePoint;
}

export class SquatCounter {
  private phase: SquatPhase = 'setup';
  private reps = 0;
  private goodReps = 0;
  private kneeEma = new Ema(SQUAT_THRESHOLDS.smoothing);
  private kneeAngle: number | null = null;
  private lastSeenMs = -Infinity;
  private repStartMs = 0;
  private bottomKnee = 180;
  private bottomIssues = new Set<FormIssue>();
  private reachedDepth = false;
  private lastRep: RepResult | null = null;
  private flash: { cue: Cue; untilMs: number } | null = null;
  private repIndex = 0;

  constructor(
    public readonly target = 15,
    private readonly thresholds = SQUAT_THRESHOLDS,
  ) {}

  /**
   * Feed one pose frame. `aspect` is frame width / height (e.g. 9/16 for a
   * portrait phone). Returns the finished rep when this frame completed one.
   */
  update(pose: Pose | null | undefined, nowMs: number, aspect = 9 / 16): RepResult | null {
    const T = this.thresholds;
    const sides = pose ? usableSides(pose, T.minVisibility) : [];

    if (sides.length === 0) {
      if (nowMs - this.lastSeenMs > T.lostBodyGraceMs) {
        this.phase = 'setup';
        this.kneeEma.reset();
        this.kneeAngle = null;
      }
      return null;
    }
    this.lastSeenMs = nowMs;

    const rawKnee =
      sides.reduce((sum, s) => sum + jointAngle(s.hip, s.knee, s.ankle, aspect), 0) / sides.length;
    const knee = this.kneeEma.next(rawKnee);
    this.kneeAngle = knee;

    if (this.phase === 'setup') {
      if (knee >= T.standing) this.phase = 'up';
      return null;
    }

    if (this.phase === 'up') {
      if (knee < T.descentStart) {
        this.phase = 'down';
        this.repStartMs = nowMs;
        this.bottomKnee = knee;
        this.bottomIssues.clear();
        this.reachedDepth = false;
      }
      return null;
    }

    // phase === 'down'
    if (knee < this.bottomKnee) this.bottomKnee = knee;
    // Check form through the deep part of the rep (not only the single
    // deepest frame, which smoothing shifts slightly in time).
    if (knee <= T.countDepth + 10) {
      for (const issue of formIssuesAtBottom(pose!, sides, aspect, T)) this.bottomIssues.add(issue);
    }
    if (knee <= T.countDepth) this.reachedDepth = true;

    if (knee >= T.standing) {
      this.phase = 'up';
      return this.finishRep(nowMs);
    }
    return null;
  }

  private finishRep(nowMs: number): RepResult {
    const T = this.thresholds;
    const issues = new Set(this.bottomIssues);
    const counted = this.reachedDepth;
    if (counted && this.bottomKnee > T.goodDepth) issues.add('shallow');
    if (counted && nowMs - this.repStartMs < T.minRepMs) issues.add('fast');

    let quality: RepQuality;
    if (!counted) quality = 'bad';
    else if (issues.size === 0) quality = 'good';
    else quality = 'okay';

    if (counted) {
      this.reps += 1;
      if (quality === 'good') this.goodReps += 1;
    }

    const rep: RepResult = {
      index: ++this.repIndex,
      counted,
      quality,
      issues: [...issues],
      bottomKneeAngle: Math.round(this.bottomKnee),
      startMs: this.repStartMs,
      endMs: nowMs,
    };
    this.lastRep = rep;

    const cue: Cue = !counted
      ? { text: 'Go deeper, that one didn’t count', tone: 'warn' }
      : quality === 'good'
        ? { text: 'Good rep!', tone: 'good' }
        : { text: ISSUE_CUES[rep.issues[0]], tone: 'warn' };
    this.flash = { cue, untilMs: nowMs + (quality === 'good' ? 900 : 1600) };
    return rep;
  }

  state(nowMs: number): SquatState {
    const done = this.reps >= this.target;
    let cue: Cue;
    if (done) cue = { text: 'Set complete!', tone: 'good' };
    else if (this.flash && nowMs < this.flash.untilMs && this.phase !== 'setup') cue = this.flash.cue;
    else if (this.phase === 'down' && this.kneeAngle !== null && this.kneeAngle <= this.thresholds.countDepth)
      cue = { text: 'Stand back up', tone: 'info' };
    else cue = PHASE_CUES[this.phase];

    return {
      phase: this.phase,
      reps: this.reps,
      goodReps: this.goodReps,
      target: this.target,
      done,
      cue,
      kneeAngle: this.kneeAngle === null ? null : Math.round(this.kneeAngle),
      lastRep: this.lastRep,
    };
  }
}

function usableSides(pose: Pose, minVis: number): Side[] {
  const sides: Side[] = [];
  const left = {
    shoulder: pose[LM.leftShoulder],
    hip: pose[LM.leftHip],
    knee: pose[LM.leftKnee],
    ankle: pose[LM.leftAnkle],
  };
  const right = {
    shoulder: pose[LM.rightShoulder],
    hip: pose[LM.rightHip],
    knee: pose[LM.rightKnee],
    ankle: pose[LM.rightAnkle],
  };
  for (const s of [left, right]) {
    if (
      visible(s.shoulder, minVis) &&
      visible(s.hip, minVis) &&
      visible(s.knee, minVis) &&
      visible(s.ankle, minVis)
    ) {
      sides.push(s as Side);
    }
  }
  return sides;
}

function mid(a: PosePoint, b: PosePoint): PosePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function formIssuesAtBottom(
  pose: Pose,
  sides: Side[],
  aspect: number,
  T: typeof SQUAT_THRESHOLDS,
): Set<FormIssue> {
  const issues = new Set<FormIssue>();

  // Chest up: torso lean from vertical, using whichever sides are visible.
  const shoulder = sides.length === 2 ? mid(sides[0].shoulder, sides[1].shoulder) : sides[0].shoulder;
  const hip = sides.length === 2 ? mid(sides[0].hip, sides[1].hip) : sides[0].hip;
  if (leanFromVertical(shoulder, hip, aspect) > T.maxTorsoLean) issues.add('chest');

  // Knees caving in: only measurable when the person faces the camera.
  if (sides.length === 2) {
    const ls = pose[LM.leftShoulder];
    const rs = pose[LM.rightShoulder];
    const shoulderWidth = Math.abs(ls.x - rs.x) * aspect;
    const torso = Math.hypot((shoulder.x - hip.x) * aspect, shoulder.y - hip.y);
    const facingCamera = torso > 0 && shoulderWidth / torso > T.frontViewShoulderRatio;
    if (facingCamera) {
      const kneeWidth = Math.abs(pose[LM.leftKnee].x - pose[LM.rightKnee].x);
      const ankleWidth = Math.abs(pose[LM.leftAnkle].x - pose[LM.rightAnkle].x);
      if (ankleWidth > 0 && kneeWidth / ankleWidth < T.minKneeToAnkleWidth) issues.add('knees');
    }
  }
  return issues;
}
