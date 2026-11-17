import { Ema, visible } from '../pose/geometry';
import type { Pose } from '../pose/landmarks';

/**
 * Generic exercise engine shared by every exercise.
 *
 * Each exercise turns a pose into one number (its "measure", e.g. the knee
 * angle for a squat) plus any form issues seen in that frame. Rep exercises
 * count full cycles of that number from its rest value to its peak value and
 * back. Hold exercises time how long the pose stays in its target zone.
 */

export type Category = 'warmup' | 'stretch' | 'strength' | 'athletic';
export type CueTone = 'info' | 'good' | 'warn';
export type RepQuality = 'good' | 'okay' | 'bad';

export interface Cue {
  text: string;
  tone: CueTone;
}

export interface FormRule {
  id: string;
  /** Short spoken/on-screen tip, e.g. "Keep your chest up". */
  cue: string;
}

export interface Measurement {
  value: number;
  /** Ids of form rules broken in this frame. */
  issues: string[];
}

interface BaseExercise {
  id: string;
  name: string;
  category: Category;
  emoji: string;
  /** Where to put the phone, shown before the set. */
  setup: string;
  /** Short how-to, one line. */
  howTo: string;
  rules: FormRule[];
  /** Turn a pose into the measure, or null when the needed joints are not visible. */
  measure: (pose: Pose, aspect: number) => Measurement | null;
}

export interface RepExercise extends BaseExercise {
  kind: 'reps';
  /** Measure when resting (start/end of a rep). */
  rest: number;
  /** Measure at full range (bottom of a squat, top of a curl). */
  peak: number;
  /** Fraction of the range (0..1) a rep must reach to count. */
  countAt: number;
  /** Fraction of the range for full depth (no "go further" tip). */
  goodAt: number;
  /** Cue for the "go to the peak" phase, e.g. "Squat down". */
  downCue: string;
  /** Cue for the "come back" phase, e.g. "Stand back up". */
  upCue: string;
  /** Tip when a rep reached countAt but not goodAt. */
  shallowCue: string;
  /** Reps faster than this (ms) get "Slow down". 0 turns it off. */
  minRepMs: number;
}

export interface HoldExercise extends BaseExercise {
  kind: 'hold';
  /** The pose counts as held while the measure is inside [min, max]. */
  min: number;
  max: number;
  /** Tip shown while out of position. */
  getInCue: string;
}

export type Exercise = RepExercise | HoldExercise;

/** Helper for definitions: require these landmarks to be visible. */
export function allVisible(pose: Pose, ids: number[], min = 0.5): boolean {
  return ids.every((i) => visible(pose[i], min));
}

/* ------------------------------------------------------------------ */
/* Rep counter                                                          */
/* ------------------------------------------------------------------ */

export interface RepResult {
  index: number;
  counted: boolean;
  quality: RepQuality;
  issues: string[];
  /** Deepest fraction of the range reached (0..1+). */
  depth: number;
  startMs: number;
  endMs: number;
}

export type RepPhase = 'setup' | 'rest' | 'active';

export interface RepState {
  phase: RepPhase;
  reps: number;
  goodReps: number;
  target: number;
  done: boolean;
  cue: Cue;
  /** Current position in the range, 0 = rest, 1 = peak. */
  progress: number;
  lastRep: RepResult | null;
}

const LOST_BODY_MS = 600;
const SMOOTHING = 0.5;
const START_AT = 0.2;
const END_AT = 0.1;

export class RepCounter {
  private phase: RepPhase = 'setup';
  private reps = 0;
  private goodReps = 0;
  private ema = new Ema(SMOOTHING);
  private progress = 0;
  private lastSeen = -Infinity;
  private repStart = 0;
  private maxDepth = 0;
  private issues = new Set<string>();
  private lastRep: RepResult | null = null;
  private flash: { cue: Cue; until: number } | null = null;
  private index = 0;
  /** Set when a rep should not count (e.g. "Finish the Set" broke the chain). */
  onRep?: (rep: RepResult) => void;

  constructor(
    public readonly exercise: RepExercise,
    public target = 15,
    /** Count only good-form reps (Beat the Clock). */
    private readonly goodOnly = false,
  ) {}

  /** Fraction of the range for a measured value: 0 at rest, 1 at peak. */
  fraction(value: number): number {
    const { rest, peak } = this.exercise;
    return (value - rest) / (peak - rest);
  }

  update(pose: Pose | null | undefined, now: number, aspect = 9 / 16): RepResult | null {
    const ex = this.exercise;
    const m = pose ? ex.measure(pose, aspect) : null;
    if (!m) {
      if (now - this.lastSeen > LOST_BODY_MS) {
        this.phase = 'setup';
        this.ema.reset();
      }
      return null;
    }
    this.lastSeen = now;
    const p = this.fraction(this.ema.next(m.value));
    this.progress = p;

    if (this.phase === 'setup') {
      if (p <= END_AT) this.phase = 'rest';
      return null;
    }
    if (this.phase === 'rest') {
      if (p >= START_AT) {
        this.phase = 'active';
        this.repStart = now;
        this.maxDepth = p;
        this.issues.clear();
      }
      return null;
    }
    // active
    if (p > this.maxDepth) this.maxDepth = p;
    // Form is judged through the working part of the rep.
    if (p >= ex.countAt * 0.85) for (const i of m.issues) this.issues.add(i);
    if (p <= END_AT) {
      this.phase = 'rest';
      return this.finish(now);
    }
    return null;
  }

  private finish(now: number): RepResult {
    const ex = this.exercise;
    const issues = new Set(this.issues);
    const reached = this.maxDepth >= ex.countAt;
    if (reached && this.maxDepth < ex.goodAt) issues.add('shallow');
    if (reached && ex.minRepMs > 0 && now - this.repStart < ex.minRepMs) issues.add('fast');
    const quality: RepQuality = !reached ? 'bad' : issues.size === 0 ? 'good' : 'okay';
    const counted = reached && (!this.goodOnly || quality === 'good');
    if (counted) this.reps += 1;
    if (counted && quality === 'good') this.goodReps += 1;

    const rep: RepResult = {
      index: ++this.index,
      counted,
      quality,
      issues: [...issues],
      depth: Math.round(this.maxDepth * 100) / 100,
      startMs: this.repStart,
      endMs: now,
    };
    this.lastRep = rep;
    const cue: Cue = !reached
      ? { text: `${ex.shallowCue}, that one didn't count`, tone: 'warn' }
      : quality === 'good'
        ? { text: 'Good rep!', tone: 'good' }
        : { text: issueCue(ex, rep.issues[0]), tone: 'warn' };
    this.flash = { cue, until: now + (quality === 'good' ? 900 : 1600) };
    this.onRep?.(rep);
    return rep;
  }

  state(now: number): RepState {
    const ex = this.exercise;
    const done = this.reps >= this.target;
    let cue: Cue;
    if (done) cue = { text: 'Set complete!', tone: 'good' };
    else if (this.phase === 'setup') cue = { text: 'Step back so your whole body is in view', tone: 'warn' };
    else if (this.flash && now < this.flash.until) cue = this.flash.cue;
    else if (this.phase === 'active' && this.progress >= ex.countAt) cue = { text: ex.upCue, tone: 'info' };
    else cue = { text: ex.downCue, tone: 'info' };
    return {
      phase: this.phase,
      reps: this.reps,
      goodReps: this.goodReps,
      target: this.target,
      done,
      cue,
      progress: Math.max(0, Math.min(1.2, this.progress)),
      lastRep: this.lastRep,
    };
  }
}

export function issueCue(ex: Exercise, id: string | undefined): string {
  if (!id) return 'Good rep!';
  if (id === 'shallow') return ex.kind === 'reps' ? ex.shallowCue : 'Go a little further';
  if (id === 'fast') return 'Slow down';
  return ex.rules.find((r) => r.id === id)?.cue ?? 'Watch your form';
}

/* ------------------------------------------------------------------ */
/* Hold timer                                                           */
/* ------------------------------------------------------------------ */

export interface HoldState {
  phase: 'setup' | 'out' | 'holding';
  heldMs: number;
  targetMs: number;
  done: boolean;
  cue: Cue;
  /** Share of held time with good form (0..1). */
  formScore: number;
}

/** A short break in tracking or a wobble does not stop the clock. */
const HOLD_GRACE_MS = 400;

export class HoldTimer {
  private heldMs = 0;
  private goodMs = 0;
  private last: number | null = null;
  private inSince: number | null = null;
  private outSince: number | null = null;
  private seen = false;
  private issues: string[] = [];
  private lastSeen = -Infinity;

  constructor(
    public readonly exercise: HoldExercise,
    public readonly targetMs = 30_000,
  ) {}

  update(pose: Pose | null | undefined, now: number, aspect = 9 / 16): void {
    const ex = this.exercise;
    const m = pose ? ex.measure(pose, aspect) : null;
    const dt = this.last === null ? 0 : Math.min(250, now - this.last);
    this.last = now;
    if (m) {
      this.seen = true;
      this.lastSeen = now;
    }
    const inZone = !!m && m.value >= ex.min && m.value <= ex.max;
    if (inZone) {
      this.outSince = null;
      this.inSince ??= now;
      this.issues = m!.issues;
    } else {
      this.outSince ??= now;
      if (now - this.outSince > HOLD_GRACE_MS) this.inSince = null;
    }
    const counting = this.inSince !== null && this.heldMs < this.targetMs;
    if (counting) {
      this.heldMs = Math.min(this.targetMs, this.heldMs + dt);
      if (this.issues.length === 0) this.goodMs += dt;
    }
  }

  state(now: number): HoldState {
    const ex = this.exercise;
    const done = this.heldMs >= this.targetMs;
    const visibleNow = now - this.lastSeen <= LOST_BODY_MS;
    let phase: HoldState['phase'] = !this.seen || !visibleNow ? 'setup' : this.inSince !== null ? 'holding' : 'out';
    let cue: Cue;
    if (done) cue = { text: 'Done! Nice hold.', tone: 'good' };
    else if (phase === 'setup') cue = { text: 'Step back so your whole body is in view', tone: 'warn' };
    else if (phase === 'out') cue = { text: ex.getInCue, tone: 'info' };
    else if (this.issues.length) cue = { text: issueCue(ex, this.issues[0]), tone: 'warn' };
    else cue = { text: 'Hold it!', tone: 'good' };
    if (done) phase = 'holding';
    return {
      phase,
      heldMs: this.heldMs,
      targetMs: this.targetMs,
      done,
      cue,
      formScore: this.heldMs > 0 ? this.goodMs / this.heldMs : 0,
    };
  }
}
