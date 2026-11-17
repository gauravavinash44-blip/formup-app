import { jointAngle, leanFromVertical, visible } from '../pose/geometry';
import { LM, type Pose, type PosePoint } from '../pose/landmarks';
import type { Exercise, HoldExercise, Measurement, RepExercise } from './engine';

/**
 * Every exercise FormUp can coach. Each one turns a pose into one number
 * (its measure) plus any form issues. The thresholds are first guesses and
 * need tuning with real people, like the squat ones did.
 */

const MIN_VIS = 0.5;

type Side = 'left' | 'right';
interface Limb {
  shoulder: PosePoint;
  elbow: PosePoint;
  wrist: PosePoint;
  hip: PosePoint;
  knee: PosePoint;
  ankle: PosePoint;
}

function limb(pose: Pose, side: Side): Partial<Limb> {
  const g = (i: number) => (visible(pose[i], MIN_VIS) ? pose[i] : undefined);
  return {
    shoulder: g(LM[`${side}Shoulder`]),
    elbow: g(LM[`${side}Elbow`]),
    wrist: g(LM[`${side}Wrist`]),
    hip: g(LM[`${side}Hip`]),
    knee: g(LM[`${side}Knee`]),
    ankle: g(LM[`${side}Ankle`]),
  };
}

function has<K extends keyof Limb>(l: Partial<Limb>, keys: K[]): l is Partial<Limb> & Pick<Limb, K> {
  return keys.every((k) => !!l[k]);
}

/** Sides (left/right) where all the given joints are visible. */
function sides<K extends keyof Limb>(pose: Pose, keys: K[]): (Partial<Limb> & Pick<Limb, K>)[] {
  return (['left', 'right'] as const).map((s) => limb(pose, s)).filter((l) => has(l, keys)) as (Partial<Limb> &
    Pick<Limb, K>)[];
}

const mid = (a: PosePoint, b: PosePoint): PosePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function torsoLength(l: Pick<Limb, 'shoulder' | 'hip'>, aspect: number): number {
  return Math.hypot((l.shoulder.x - l.hip.x) * aspect, l.shoulder.y - l.hip.y) || 1;
}

/** Smallest of one angle measured on each visible side (e.g. the more bent knee). */
function minAngle<K extends keyof Limb>(
  pose: Pose,
  keys: [K, K, K],
  aspect: number,
): { value: number; side: Partial<Limb> & Pick<Limb, K> } | null {
  let best: { value: number; side: Partial<Limb> & Pick<Limb, K> } | null = null;
  for (const s of sides(pose, keys)) {
    const v = jointAngle(s[keys[0]], s[keys[1]], s[keys[2]], aspect);
    if (!best || v < best.value) best = { value: v, side: s };
  }
  return best;
}

/** Same angle on both sides, averaged (for symmetric moves like jumping jacks). */
function avgAngle<K extends keyof Limb>(pose: Pose, keys: [K, K, K], aspect: number): number | null {
  const vals = sides(pose, keys).map((s) => jointAngle(s[keys[0]], s[keys[1]], s[keys[2]], aspect));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const m = (value: number, issues: (string | false)[] = []): Measurement => ({
  value,
  issues: issues.filter((i): i is string => !!i),
});

/* ------------------------------------------------------------------ */
/* Rep exercises                                                        */
/* ------------------------------------------------------------------ */

const squat: RepExercise = {
  id: 'squat',
  name: 'Squats',
  category: 'strength',
  emoji: '🦵',
  kind: 'reps',
  setup: 'Phone on the floor, 2 to 3 m away, side or front on',
  howTo: 'Feet shoulder width, sit back and down, stand tall',
  rules: [
    { id: 'chest', cue: 'Keep your chest up' },
    { id: 'knees', cue: 'Push your knees out' },
  ],
  rest: 170,
  peak: 90,
  countAt: 0.69, // ~115°
  goodAt: 0.87, // ~100°
  downCue: 'Squat down',
  upCue: 'Stand back up',
  shallowCue: 'Go a little deeper',
  minRepMs: 700,
  measure(pose, aspect) {
    const k = minAngle(pose, ['hip', 'knee', 'ankle'], aspect);
    if (!k) return null;
    const s = k.side;
    const lean = s.shoulder ? leanFromVertical(s.shoulder, s.hip, aspect) : 0;
    // Knee cave, front view only: knees much narrower than ankles.
    const L = limb(pose, 'left');
    const R = limb(pose, 'right');
    let knees = false;
    if (has(L, ['knee', 'ankle', 'shoulder', 'hip']) && has(R, ['knee', 'ankle', 'shoulder', 'hip'])) {
      const shoulderW = Math.abs(L.shoulder.x - R.shoulder.x) * aspect;
      const front = shoulderW / torsoLength(L, aspect) > 0.35;
      const kneeW = Math.abs(L.knee.x - R.knee.x);
      const ankleW = Math.abs(L.ankle.x - R.ankle.x);
      knees = front && ankleW > 0 && kneeW / ankleW < 0.75;
    }
    return m(k.value, [lean > 50 && 'chest', knees && 'knees']);
  },
};

const pushUp: RepExercise = {
  id: 'pushup',
  name: 'Push-ups',
  category: 'strength',
  emoji: '💪',
  kind: 'reps',
  setup: 'Phone on the floor, side on, 2 m away',
  howTo: 'Hands under shoulders, lower your chest, push back up',
  rules: [{ id: 'hips', cue: 'Keep your body in a straight line' }],
  rest: 165,
  peak: 85,
  countAt: 0.6,
  goodAt: 0.8,
  downCue: 'Lower your chest',
  upCue: 'Push up',
  shallowCue: 'Go a little lower',
  minRepMs: 600,
  measure(pose, aspect) {
    const e = minAngle(pose, ['shoulder', 'elbow', 'wrist'], aspect);
    if (!e) return null;
    const s = e.side;
    const line = s.hip && s.ankle ? jointAngle(s.shoulder, s.hip, s.ankle, aspect) : 180;
    return m(e.value, [line < 155 && 'hips']);
  },
};

const lunge: RepExercise = {
  id: 'lunge',
  name: 'Lunges',
  category: 'strength',
  emoji: '🚶',
  kind: 'reps',
  setup: 'Phone on the floor, side on, 2 to 3 m away',
  howTo: 'Big step forward, drop the back knee, push back',
  rules: [{ id: 'upright', cue: 'Keep your body upright' }],
  rest: 170,
  peak: 95,
  countAt: 0.6,
  goodAt: 0.85,
  downCue: 'Step and drop down',
  upCue: 'Push back up',
  shallowCue: 'Drop a little lower',
  minRepMs: 700,
  measure(pose, aspect) {
    const k = minAngle(pose, ['hip', 'knee', 'ankle'], aspect);
    if (!k) return null;
    const s = k.side;
    const lean = s.shoulder ? leanFromVertical(s.shoulder, s.hip, aspect) : 0;
    return m(k.value, [lean > 30 && 'upright']);
  },
};

const gluteBridge: RepExercise = {
  id: 'bridge',
  name: 'Glute bridges',
  category: 'strength',
  emoji: '🌉',
  kind: 'reps',
  setup: 'Lie on your back, phone on the floor beside you',
  howTo: 'Knees bent, squeeze and lift your hips, lower slowly',
  rules: [],
  rest: 120,
  peak: 170,
  countAt: 0.65,
  goodAt: 0.85,
  downCue: 'Lift your hips',
  upCue: 'Lower slowly',
  shallowCue: 'Lift a little higher',
  minRepMs: 800,
  measure(pose, aspect) {
    const v = avgAngle(pose, ['shoulder', 'hip', 'knee'], aspect);
    return v === null ? null : m(v);
  },
};

const jumpingJacks: RepExercise = {
  id: 'jacks',
  name: 'Jumping jacks',
  category: 'warmup',
  emoji: '⭐',
  kind: 'reps',
  setup: 'Phone upright, facing you, 2 to 3 m away',
  howTo: 'Jump feet out and clap overhead, jump back in',
  rules: [],
  rest: 25,
  peak: 150,
  countAt: 0.65,
  goodAt: 0.8,
  downCue: 'Arms up',
  upCue: 'Back in',
  shallowCue: 'Arms all the way up',
  minRepMs: 0,
  measure(pose, aspect) {
    const v = avgAngle(pose, ['hip', 'shoulder', 'elbow'], aspect);
    return v === null ? null : m(v);
  },
};

const highKnees: RepExercise = {
  id: 'highknees',
  name: 'High knees',
  category: 'athletic',
  emoji: '🏃',
  kind: 'reps',
  setup: 'Phone upright, side on, 2 to 3 m away',
  howTo: 'Run on the spot, knees to hip height',
  rules: [],
  rest: 170,
  peak: 95,
  countAt: 0.55,
  goodAt: 0.85,
  downCue: 'Knee up',
  upCue: 'Switch',
  shallowCue: 'Knees higher',
  minRepMs: 0,
  measure(pose, aspect) {
    const h = minAngle(pose, ['shoulder', 'hip', 'knee'], aspect);
    return h ? m(h.value) : null;
  },
};

const shoulderPress: RepExercise = {
  id: 'press',
  name: 'Shoulder press',
  category: 'strength',
  emoji: '🏋️',
  kind: 'reps',
  setup: 'Phone upright, facing you, upper body in view',
  howTo: 'Hands at shoulders, press straight up, lower with control',
  rules: [],
  // Wrist height above the shoulder, in torso lengths.
  rest: 0.1,
  peak: 0.9,
  countAt: 0.7,
  goodAt: 0.88,
  downCue: 'Press up',
  upCue: 'Lower to your shoulders',
  shallowCue: 'Lock your arms out',
  minRepMs: 700,
  measure(pose, aspect) {
    const ss = sides(pose, ['shoulder', 'hip', 'wrist']);
    if (!ss.length) return null;
    const v = ss.reduce((a, s) => a + (s.shoulder.y - s.wrist.y) / torsoLength(s, aspect), 0) / ss.length;
    return m(v);
  },
};

const bicepCurl: RepExercise = {
  id: 'curl',
  name: 'Bicep curls',
  category: 'strength',
  emoji: '💪',
  kind: 'reps',
  setup: 'Phone upright, side on, upper body in view',
  howTo: 'Elbows by your sides, curl up, lower all the way',
  rules: [{ id: 'elbow', cue: 'Keep your elbows by your sides' }],
  rest: 160,
  peak: 50,
  countAt: 0.65,
  goodAt: 0.85,
  downCue: 'Curl up',
  upCue: 'Lower all the way',
  shallowCue: 'Curl a little higher',
  minRepMs: 800,
  measure(pose, aspect) {
    const e = minAngle(pose, ['shoulder', 'elbow', 'wrist'], aspect);
    if (!e) return null;
    const s = e.side;
    const drift = s.hip ? jointAngle(s.hip, s.shoulder, s.elbow, aspect) : 0;
    return m(e.value, [drift > 35 && 'elbow']);
  },
};

const lateralRaise: RepExercise = {
  id: 'lateral',
  name: 'Lateral raises',
  category: 'strength',
  emoji: '🙆',
  kind: 'reps',
  setup: 'Phone upright, facing you, upper body in view',
  howTo: 'Raise your arms out to the side to shoulder height',
  rules: [{ id: 'high', cue: 'Stop at shoulder height' }],
  rest: 20,
  peak: 85,
  countAt: 0.7,
  goodAt: 0.88,
  downCue: 'Raise your arms',
  upCue: 'Lower slowly',
  shallowCue: 'Raise to shoulder height',
  minRepMs: 800,
  measure(pose, aspect) {
    const v = avgAngle(pose, ['hip', 'shoulder', 'elbow'], aspect);
    return v === null ? null : m(v, [v > 110 && 'high']);
  },
};

/* ------------------------------------------------------------------ */
/* Holds                                                                */
/* ------------------------------------------------------------------ */

const plank: HoldExercise = {
  id: 'plank',
  name: 'Plank',
  category: 'strength',
  emoji: '🪵',
  kind: 'hold',
  setup: 'Phone on the floor, side on, 2 m away',
  howTo: 'Forearms down, body straight from head to heels',
  rules: [{ id: 'line', cue: 'Straighten your body' }],
  min: 150,
  max: 180,
  getInCue: 'Get into a plank',
  measure(pose, aspect) {
    const ss = sides(pose, ['shoulder', 'hip', 'ankle']);
    if (!ss.length) return null;
    const s = ss[0];
    // Must be roughly horizontal, or standing straight would count.
    if (leanFromVertical(s.shoulder, s.ankle, aspect) < 55) return m(0);
    const line = jointAngle(s.shoulder, s.hip, s.ankle, aspect);
    return m(line, [line < 165 && 'line']);
  },
};

const wallSit: HoldExercise = {
  id: 'wallsit',
  name: 'Wall sit',
  category: 'strength',
  emoji: '🧱',
  kind: 'hold',
  setup: 'Phone on the floor, side on, back against a wall',
  howTo: 'Slide down until your thighs are level, hold',
  rules: [{ id: 'back', cue: 'Keep your back flat on the wall' }],
  min: 70,
  max: 115,
  getInCue: 'Slide down the wall',
  measure(pose, aspect) {
    const k = minAngle(pose, ['hip', 'knee', 'ankle'], aspect);
    if (!k) return null;
    const lean = k.side.shoulder ? leanFromVertical(k.side.shoulder, k.side.hip, aspect) : 0;
    return m(k.value, [lean > 25 && 'back']);
  },
};

const deepSquatHold: HoldExercise = {
  id: 'deepsquat',
  name: 'Deep squat hold',
  category: 'stretch',
  emoji: '🧘',
  kind: 'hold',
  setup: 'Phone on the floor, side or front on',
  howTo: 'Sink into your deepest squat, heels down, chest up',
  rules: [{ id: 'chest', cue: 'Lift your chest' }],
  min: 0,
  max: 95,
  getInCue: 'Sink down low',
  measure(pose, aspect) {
    const k = minAngle(pose, ['hip', 'knee', 'ankle'], aspect);
    if (!k) return null;
    const lean = k.side.shoulder ? leanFromVertical(k.side.shoulder, k.side.hip, aspect) : 0;
    return m(k.value, [lean > 55 && 'chest']);
  },
};

const quadStretch: HoldExercise = {
  id: 'quad',
  name: 'Quad stretch',
  category: 'stretch',
  emoji: '🦩',
  kind: 'hold',
  setup: 'Phone upright, side on, whole body in view',
  howTo: 'Stand tall, pull one heel to your bum',
  rules: [{ id: 'tall', cue: 'Stand tall' }],
  min: 0,
  max: 55,
  getInCue: 'Pull your heel up behind you',
  measure(pose, aspect) {
    const k = minAngle(pose, ['hip', 'knee', 'ankle'], aspect);
    if (!k) return null;
    const lean = k.side.shoulder ? leanFromVertical(k.side.shoulder, k.side.hip, aspect) : 0;
    return m(k.value, [lean > 20 && 'tall']);
  },
};

const hamstringReach: HoldExercise = {
  id: 'hamstring',
  name: 'Forward fold',
  category: 'stretch',
  emoji: '🙇',
  kind: 'hold',
  setup: 'Phone upright, side on, whole body in view',
  howTo: 'Legs straight, fold forward and reach for your toes',
  rules: [{ id: 'legs', cue: 'Keep your legs straight' }],
  min: 0,
  max: 110,
  getInCue: 'Fold forward',
  measure(pose, aspect) {
    const h = minAngle(pose, ['shoulder', 'hip', 'knee'], aspect);
    if (!h) return null;
    const knee = h.side.ankle ? jointAngle(h.side.hip, h.side.knee, h.side.ankle, aspect) : 180;
    return m(h.value, [knee < 145 && 'legs']);
  },
};

const overheadReach: HoldExercise = {
  id: 'overhead',
  name: 'Overhead reach',
  category: 'warmup',
  emoji: '🙌',
  kind: 'hold',
  setup: 'Phone upright, facing you, upper body in view',
  howTo: 'Reach both arms high above your head',
  rules: [],
  // Wrist height above the shoulders, in torso lengths.
  min: 0.8,
  max: 10,
  getInCue: 'Reach up high',
  measure(pose, aspect) {
    const ss = sides(pose, ['shoulder', 'hip', 'wrist']);
    if (ss.length < 2) return null;
    const sh = mid(ss[0].shoulder, ss[1].shoulder);
    const wr = mid(ss[0].wrist, ss[1].wrist);
    return m((sh.y - wr.y) / torsoLength(ss[0], aspect));
  },
};

export const EXERCISES: Exercise[] = [
  jumpingJacks,
  overheadReach,
  squat,
  pushUp,
  lunge,
  gluteBridge,
  highKnees,
  shoulderPress,
  bicepCurl,
  lateralRaise,
  plank,
  wallSit,
  deepSquatHold,
  quadStretch,
  hamstringReach,
];

export const EXERCISE_BY_ID: Record<string, Exercise> = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise {
  const ex = EXERCISE_BY_ID[id];
  if (!ex) throw new Error(`Unknown exercise: ${id}`);
  return ex;
}
