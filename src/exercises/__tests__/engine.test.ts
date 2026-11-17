import { HoldTimer, RepCounter, type HoldExercise, type RepExercise } from '../engine';
import { EXERCISES, getExercise } from '../library';
import { LM, type Pose } from '../../pose/landmarks';

const DT = 1000 / 15;

/** A fake pose that just carries the measure in pose[0].x. */
const fake = (v: number): Pose => [{ x: v, y: 0, visibility: 1 }];

const base = {
  name: 'Test',
  category: 'strength' as const,
  emoji: '',
  setup: '',
  howTo: '',
  rules: [{ id: 'bad', cue: 'Fix it' }],
};

const repEx: RepExercise = {
  ...base,
  id: 'test-reps',
  kind: 'reps',
  rest: 0,
  peak: 100,
  countAt: 0.7,
  goodAt: 0.9,
  downCue: 'Down',
  upCue: 'Up',
  shallowCue: 'Deeper',
  minRepMs: 600,
  measure: (p) => (p[0] ? { value: p[0].x, issues: p[0].y > 0 ? ['bad'] : [] } : null),
};

/** Feed a path of measure values through the counter, `framesEach` frames per value. */
function drive(c: RepCounter, values: number[], t0 = 0, framesEach = 3, issue = false) {
  let t = t0;
  const reps = [];
  for (const v of values) {
    for (let i = 0; i < framesEach; i++) {
      const r = c.update([{ x: v, y: issue ? 1 : 0, visibility: 1 }], t);
      if (r) reps.push(r);
      t += DT;
    }
  }
  return { reps, t };
}

const fullRep = [0, 20, 40, 60, 80, 95, 100, 95, 80, 60, 40, 20, 0, 0];

describe('RepCounter', () => {
  it('counts full reps as good', () => {
    const c = new RepCounter(repEx, 3);
    const { reps } = drive(c, [...fullRep, ...fullRep, ...fullRep]);
    expect(reps.map((r) => r.quality)).toEqual(['good', 'good', 'good']);
    const s = c.state(1e9);
    expect(s.reps).toBe(3);
    expect(s.done).toBe(true);
  });

  it('does not count a partial rep', () => {
    const c = new RepCounter(repEx);
    const { reps } = drive(c, [0, 20, 40, 50, 40, 20, 0, 0]);
    expect(reps).toHaveLength(1);
    expect(reps[0].counted).toBe(false);
    expect(c.state(1e9).reps).toBe(0);
  });

  it('counts a slightly shallow rep with a tip', () => {
    const c = new RepCounter(repEx);
    const { reps } = drive(c, [0, 20, 40, 60, 80, 82, 80, 60, 40, 20, 0, 0]);
    expect(reps[0].counted).toBe(true);
    expect(reps[0].issues).toContain('shallow');
    expect(reps[0].quality).toBe('okay');
  });

  it('flags fast reps', () => {
    const c = new RepCounter({ ...repEx, minRepMs: 2000 });
    const { reps } = drive(c, fullRep, 0, 1);
    expect(reps[0].issues).toContain('fast');
  });

  it('records form issues and goodOnly mode skips them', () => {
    const c = new RepCounter(repEx, 15, true);
    drive(c, [0, 0]);
    const { reps } = drive(c, fullRep, 1000, 3, true);
    expect(reps[0].issues).toContain('bad');
    expect(reps[0].counted).toBe(false);
    expect(c.state(reps[0].endMs + 10).cue.text).toBe('Fix it');
  });

  it('waits in setup when the body is lost, then resumes', () => {
    const c = new RepCounter(repEx);
    drive(c, [0, 0]);
    expect(c.state(0).phase).toBe('rest');
    c.update(null, 5000);
    expect(c.state(5000).phase).toBe('setup');
    const { reps } = drive(c, fullRep, 6000);
    expect(reps.filter((r) => r.counted)).toHaveLength(1);
  });
});

const holdEx: HoldExercise = {
  ...base,
  id: 'test-hold',
  kind: 'hold',
  min: 10,
  max: 20,
  getInCue: 'Get in',
  measure: repEx.measure,
};

describe('HoldTimer', () => {
  it('times only while in the zone and finishes at the target', () => {
    const h = new HoldTimer(holdEx, 2000);
    let t = 0;
    for (let i = 0; i < 10; i++, t += 100) h.update(fake(0), t);
    expect(h.state(t).phase).toBe('out');
    expect(h.state(t).heldMs).toBe(0);
    for (let i = 0; i < 30; i++, t += 100) h.update(fake(15), t);
    const s = h.state(t);
    expect(s.done).toBe(true);
    expect(s.heldMs).toBe(2000);
    expect(s.formScore).toBeCloseTo(1);
  });

  it('keeps the clock going through a short wobble', () => {
    const h = new HoldTimer(holdEx, 60_000);
    let t = 0;
    for (let i = 0; i < 10; i++, t += 100) h.update(fake(15), t);
    for (let i = 0; i < 2; i++, t += 100) h.update(fake(50), t);
    for (let i = 0; i < 10; i++, t += 100) h.update(fake(15), t);
    expect(h.state(t).heldMs).toBeGreaterThanOrEqual(1900);
  });

  it('stops after a long break and lowers the form score for bad form', () => {
    const h = new HoldTimer(holdEx, 60_000);
    let t = 0;
    for (let i = 0; i < 10; i++, t += 100) h.update([{ x: 15, y: 1, visibility: 1 }], t);
    expect(h.state(t).cue.text).toBe('Fix it');
    for (let i = 0; i < 20; i++, t += 100) h.update(fake(50), t);
    const held = h.state(t).heldMs;
    expect(held).toBeLessThan(1600);
    expect(h.state(t).phase).toBe('out');
    expect(h.state(t).formScore).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Library definitions on synthetic poses                               */
/* ------------------------------------------------------------------ */

const ASPECT = 9 / 16;
type Pt = { x: number; y: number };

/** Build a side-on pose from body-space points (y down, height units). */
function bodyPose(pts: Partial<Record<'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', Pt>>): Pose {
  const p: Pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const toFrame = (q: Pt) => ({ x: 0.5 + q.x / ASPECT, y: q.y, visibility: 0.95 });
  for (const side of ['left', 'right'] as const) {
    for (const [k, v] of Object.entries(pts)) {
      const key = `${side}${k[0].toUpperCase()}${k.slice(1)}` as keyof typeof LM;
      p[LM[key]] = toFrame(v!);
    }
  }
  return p;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Standing side-on figure with a given knee angle (squat-like). */
function squatPose(knee: number, lean = 10): Pose {
  const ankle = { x: 0, y: 0.9 };
  const kn = { x: 0, y: 0.7 };
  const hip = { x: 0.2 * Math.sin(rad(knee)), y: 0.7 + 0.2 * Math.cos(rad(knee)) };
  const shoulder = { x: hip.x - 0.28 * Math.sin(rad(lean)), y: hip.y - 0.28 * Math.cos(rad(lean)) };
  return bodyPose({ ankle, knee: kn, hip, shoulder });
}

/** Upper arm hanging down, forearm at a given elbow angle (curl-like). */
function armPose(elbow: number, upperArmOut = 0): Pose {
  const shoulder = { x: 0, y: 0.3 };
  const hip = { x: 0, y: 0.58 };
  const e = { x: 0.15 * Math.sin(rad(upperArmOut)), y: 0.3 + 0.15 * Math.cos(rad(upperArmOut)) };
  const dir = rad(upperArmOut) + Math.PI - rad(elbow);
  const wrist = { x: e.x + 0.14 * Math.sin(dir), y: e.y + 0.14 * Math.cos(dir) };
  return bodyPose({ shoulder, hip, elbow: e, wrist, knee: { x: 0, y: 0.75 }, ankle: { x: 0, y: 0.92 } });
}

function runReps(id: string, poses: Pose[]) {
  const ex = getExercise(id);
  if (ex.kind !== 'reps') throw new Error('not reps');
  const c = new RepCounter(ex);
  let t = 0;
  for (const p of poses) for (let i = 0; i < 4; i++, t += DT) c.update(p, t, ASPECT);
  return c.state(t);
}

describe('exercise library', () => {
  it('has unique ids and 10+ exercises with both kinds', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    expect(EXERCISES.length).toBeGreaterThanOrEqual(10);
    expect(EXERCISES.some((e) => e.kind === 'hold')).toBe(true);
    for (const cat of ['warmup', 'stretch', 'strength', 'athletic']) {
      expect(EXERCISES.some((e) => e.category === cat)).toBe(true);
    }
  });

  it('squat measures the knee angle and counts a deep rep', () => {
    const ex = getExercise('squat');
    expect(ex.measure(squatPose(120), ASPECT)!.value).toBeCloseTo(120, 0);
    const path = [175, 160, 140, 120, 100, 92, 100, 120, 140, 160, 175, 175];
    const s = runReps('squat', path.map((k) => squatPose(k)));
    expect(s.reps).toBe(1);
    expect(s.goodReps).toBe(1);
  });

  it('squat flags a big forward lean', () => {
    const ex = getExercise('squat');
    expect(ex.measure(squatPose(95, 65), ASPECT)!.issues).toContain('chest');
    expect(ex.measure(squatPose(95, 20), ASPECT)!.issues).toEqual([]);
  });

  it('bicep curl counts and flags elbow drift', () => {
    const path = [165, 150, 120, 90, 60, 48, 60, 90, 120, 150, 165, 165];
    expect(runReps('curl', path.map((e) => armPose(e))).goodReps).toBe(1);
    expect(getExercise('curl').measure(armPose(60, 50), ASPECT)!.issues).toContain('elbow');
  });

  it('plank only holds when horizontal and straight', () => {
    const ex = getExercise('plank');
    const flat = bodyPose({ shoulder: { x: 0, y: 0.7 }, hip: { x: 0.3, y: 0.72 }, ankle: { x: 0.6, y: 0.74 } });
    const v = ex.measure(flat, ASPECT)!;
    expect(v.value).toBeGreaterThan(165);
    expect(v.issues).toEqual([]);
    const sag = bodyPose({ shoulder: { x: 0, y: 0.7 }, hip: { x: 0.3, y: 0.82 }, ankle: { x: 0.6, y: 0.74 } });
    expect(ex.measure(sag, ASPECT)!.issues).toContain('line');
    expect(ex.measure(squatPose(178, 0), ASPECT)!.value).toBe(0); // standing up is not a plank
  });

  it('returns null when the needed joints are hidden', () => {
    const p: Pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    for (const ex of EXERCISES) expect(ex.measure(p, ASPECT)).toBeNull();
  });
});
