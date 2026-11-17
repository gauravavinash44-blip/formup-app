/**
 * The learning path: units of short lessons, Duolingo style. Each lesson
 * mixes formats so sessions feel different day to day:
 *
 * - Rep Set: do N reps with good form.
 * - Hold It: hold a position (plank, wall sit, stretch) for N seconds.
 * - Beat the Clock: as many good-form reps as you can before time runs out.
 * - Fix the Form: spot the mistake in a pose (a quiz, no camera needed).
 */

export interface QuizQuestion {
  figure: Figure;
  prompt: string;
  options: string[];
  answer: number;
  explain: string;
}

export type Step =
  | { kind: 'reps'; exercise: string; reps: number }
  | { kind: 'hold'; exercise: string; seconds: number }
  | { kind: 'clock'; exercise: string; seconds: number; goal: number }
  | { kind: 'quiz'; questions: QuizQuestion[] };

export type Format = 'Warm-up' | 'Rep Set' | 'Hold It' | 'Beat the Clock' | 'Fix the Form' | 'Stretch';

export interface Lesson {
  id: string;
  title: string;
  format: Format;
  emoji: string;
  xp: number;
  steps: Step[];
}

export interface Unit {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  lessons: Lesson[];
}

/* ---------- stick figures for Fix the Form ---------- */

type P = [number, number];
export interface Figure {
  head: P;
  shoulder: P;
  elbow: P;
  wrist: P;
  hip: P;
  knee: P;
  ankle: P;
  toe: P;
  /** Joint to circle in the explanation. */
  mark: keyof Omit<Figure, 'mark' | 'ground'>;
  ground?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: P, len: number, deg: number): P => [a[0] + len * Math.sin(rad(deg)), a[1] - len * Math.cos(rad(deg))];

/** Side-on squat figure: knee angle and torso lean in degrees. */
function squatFigure(knee: number, lean: number, mark: Figure['mark']): Figure {
  // Faces right. Angles are degrees clockwise from straight up.
  const ankle: P = [62, 110];
  const shinTilt = 180 - knee > 30 ? 20 : 5;
  const kneeP = add(ankle, 30, shinTilt);
  const hip = add(kneeP, 30, 180 + shinTilt + knee);
  const shoulder = add(hip, 34, lean);
  const head = add(shoulder, 11, lean);
  const elbow = add(shoulder, 16, 100);
  const wrist = add(elbow, 16, 90);
  return { head, shoulder, elbow, wrist, hip, knee: kneeP, ankle, toe: [ankle[0] + 12, 110], mark, ground: 112 };
}

function pushupFigure(hipDrop: number, mark: Figure['mark']): Figure {
  const ankle: P = [88, 98];
  const shoulder: P = [24, 82];
  const hip: P = [(ankle[0] + shoulder[0]) / 2, (ankle[1] + shoulder[1]) / 2 + hipDrop];
  const knee: P = [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2 + hipDrop * 0.3];
  return {
    head: [14, 78],
    shoulder,
    elbow: [26, 96],
    wrist: [24, 108],
    hip,
    knee,
    ankle,
    toe: [92, 108],
    mark,
    ground: 110,
  };
}

function curlFigure(elbowOut: number, mark: Figure['mark']): Figure {
  const shoulder: P = [50, 40];
  const elbow = add(shoulder, 22, 180 - elbowOut);
  const wrist = add(elbow, 20, 20 - elbowOut);
  return {
    head: [50, 26],
    shoulder,
    elbow,
    wrist,
    hip: [50, 74],
    knee: [50, 94],
    ankle: [50, 112],
    toe: [60, 112],
    mark,
    ground: 114,
  };
}

function lungeFigure(lean: number, mark: Figure['mark']): Figure {
  const knee: P = [60, 88];
  const hip: P = [44, 66];
  const shoulder = add(hip, 34, lean);
  return {
    head: add(shoulder, 10, lean),
    shoulder,
    elbow: [shoulder[0] + 2, shoulder[1] + 18],
    wrist: [shoulder[0] + 4, shoulder[1] + 34],
    hip,
    knee,
    ankle: [60, 110],
    toe: [70, 110],
    mark,
    ground: 112,
  };
}

/** Render a figure as an inline SVG string. */
export function figureSvg(f: Figure, showMark = false): string {
  const line = (a: P, b: P) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  const bones = [
    line(f.shoulder, f.elbow),
    line(f.elbow, f.wrist),
    line(f.shoulder, f.hip),
    line(f.hip, f.knee),
    line(f.knee, f.ankle),
    line(f.ankle, f.toe),
  ].join('');
  const joints = (['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const)
    .map((k) => `<circle cx="${f[k][0]}" cy="${f[k][1]}" r="3"/>`)
    .join('');
  const m = f[f.mark];
  const mark = showMark ? `<circle class="mark" cx="${m[0]}" cy="${m[1]}" r="11"/>` : '';
  const ground = f.ground ? `<line class="ground" x1="4" y1="${f.ground}" x2="116" y2="${f.ground}"/>` : '';
  return `<svg viewBox="0 0 120 120" class="figure" role="img" aria-label="Stick figure">${ground}<g class="bones">${bones}</g><circle class="head" cx="${f.head[0]}" cy="${f.head[1]}" r="8"/><g class="joints">${joints}</g>${mark}</svg>`;
}

/* ---------- quizzes ---------- */

const squatQuiz: QuizQuestion[] = [
  {
    figure: squatFigure(95, 62, 'shoulder'),
    prompt: "What's wrong with this squat?",
    options: ['Chest is dropping forward', 'Not deep enough', 'Nothing, it is perfect'],
    answer: 0,
    explain: 'The chest has tipped far forward. Keep your chest up and your weight in your heels.',
  },
  {
    figure: squatFigure(140, 20, 'hip'),
    prompt: 'Does this rep count?',
    options: ['Yes, full squat', 'No, too shallow', 'Only if done fast'],
    answer: 1,
    explain: 'The hips are way above the knees. Aim for thighs about level with the floor.',
  },
  {
    figure: squatFigure(92, 25, 'hip'),
    prompt: 'How is this squat?',
    options: ['Too deep', 'Leaning too much', 'Good depth and chest up'],
    answer: 2,
    explain: 'Thighs near level and the chest is up. That is a good rep.',
  },
];

const upperQuiz: QuizQuestion[] = [
  {
    figure: pushupFigure(14, 'hip'),
    prompt: "What's wrong with this push-up?",
    options: ['Hands too wide', 'Hips are sagging', 'Head too high'],
    answer: 1,
    explain: 'The hips drop below the line. Squeeze your glutes and keep one straight line from head to heels.',
  },
  {
    figure: curlFigure(45, 'elbow'),
    prompt: 'Spot the curl mistake',
    options: ['Elbow swinging forward', 'Wrist bent', 'Standing too straight'],
    answer: 0,
    explain: 'The elbow has drifted forward, so the shoulder is doing the work. Pin your elbows by your sides.',
  },
  {
    figure: pushupFigure(0, 'hip'),
    prompt: 'Is this a good push-up position?',
    options: ['Yes, straight line', 'No, hips too high', 'No, hips too low'],
    answer: 0,
    explain: 'Head, hips and heels are in one line. That is the plank you want.',
  },
];

const athleticQuiz: QuizQuestion[] = [
  {
    figure: lungeFigure(35, 'shoulder'),
    prompt: "What's off in this lunge?",
    options: ['Front knee too far back', 'Leaning forward', 'Step too short'],
    answer: 1,
    explain: 'The body is folding forward. Keep your chest tall over your hips as you drop.',
  },
  {
    figure: lungeFigure(0, 'knee'),
    prompt: 'How is this lunge?',
    options: ['Good, upright and deep', 'Too shallow', 'Knee too far forward'],
    answer: 0,
    explain: 'Upright torso and the front thigh is near level. Nice.',
  },
];

/* ---------- the path ---------- */

export const UNITS: Unit[] = [
  {
    id: 'u1',
    title: 'Unit 1 · Legs basics',
    subtitle: 'Squats, wall sits and leg stretches',
    color: '#FF6B2C',
    lessons: [
      {
        id: 'u1l1',
        title: 'Wake up the legs',
        format: 'Warm-up',
        emoji: '⭐',
        xp: 10,
        steps: [
          { kind: 'reps', exercise: 'jacks', reps: 15 },
          { kind: 'hold', exercise: 'overhead', seconds: 15 },
        ],
      },
      { id: 'u1l2', title: 'First squats', format: 'Rep Set', emoji: '🦵', xp: 15, steps: [{ kind: 'reps', exercise: 'squat', reps: 10 }] },
      { id: 'u1l3', title: 'Spot the squat', format: 'Fix the Form', emoji: '🔍', xp: 10, steps: [{ kind: 'quiz', questions: squatQuiz }] },
      { id: 'u1l4', title: 'Wall sit', format: 'Hold It', emoji: '🧱', xp: 15, steps: [{ kind: 'hold', exercise: 'wallsit', seconds: 30 }] },
      {
        id: 'u1l5',
        title: 'Squat sprint',
        format: 'Beat the Clock',
        emoji: '⏱️',
        xp: 20,
        steps: [{ kind: 'clock', exercise: 'squat', seconds: 45, goal: 15 }],
      },
      {
        id: 'u1l6',
        title: 'Leg stretch',
        format: 'Stretch',
        emoji: '🧘',
        xp: 10,
        steps: [
          { kind: 'hold', exercise: 'quad', seconds: 20 },
          { kind: 'hold', exercise: 'hamstring', seconds: 20 },
          { kind: 'hold', exercise: 'deepsquat', seconds: 20 },
        ],
      },
    ],
  },
  {
    id: 'u2',
    title: 'Unit 2 · Upper body',
    subtitle: 'Push-ups, curls, raises and planks',
    color: '#3B8BFF',
    lessons: [
      {
        id: 'u2l1',
        title: 'Arm warm-up',
        format: 'Warm-up',
        emoji: '🙆',
        xp: 10,
        steps: [
          { kind: 'reps', exercise: 'lateral', reps: 10 },
          { kind: 'hold', exercise: 'overhead', seconds: 15 },
        ],
      },
      { id: 'u2l2', title: 'Push-up start', format: 'Rep Set', emoji: '💪', xp: 15, steps: [{ kind: 'reps', exercise: 'pushup', reps: 8 }] },
      { id: 'u2l3', title: 'Spot the mistake', format: 'Fix the Form', emoji: '🔍', xp: 10, steps: [{ kind: 'quiz', questions: upperQuiz }] },
      {
        id: 'u2l4',
        title: 'Curl and press',
        format: 'Rep Set',
        emoji: '🏋️',
        xp: 20,
        steps: [
          { kind: 'reps', exercise: 'curl', reps: 12 },
          { kind: 'reps', exercise: 'press', reps: 10 },
        ],
      },
      { id: 'u2l5', title: 'Plank', format: 'Hold It', emoji: '🪵', xp: 15, steps: [{ kind: 'hold', exercise: 'plank', seconds: 30 }] },
      {
        id: 'u2l6',
        title: 'Push-up race',
        format: 'Beat the Clock',
        emoji: '⏱️',
        xp: 20,
        steps: [{ kind: 'clock', exercise: 'pushup', seconds: 45, goal: 12 }],
      },
    ],
  },
  {
    id: 'u3',
    title: 'Unit 3 · Athletic',
    subtitle: 'High knees, lunges, bridges',
    color: '#33BF66',
    lessons: [
      { id: 'u3l1', title: 'High knees', format: 'Warm-up', emoji: '🏃', xp: 10, steps: [{ kind: 'reps', exercise: 'highknees', reps: 30 }] },
      { id: 'u3l2', title: 'Lunges', format: 'Rep Set', emoji: '🚶', xp: 15, steps: [{ kind: 'reps', exercise: 'lunge', reps: 10 }] },
      { id: 'u3l3', title: 'Lunge check', format: 'Fix the Form', emoji: '🔍', xp: 10, steps: [{ kind: 'quiz', questions: athleticQuiz }] },
      { id: 'u3l4', title: 'Glute bridges', format: 'Rep Set', emoji: '🌉', xp: 15, steps: [{ kind: 'reps', exercise: 'bridge', reps: 15 }] },
      {
        id: 'u3l5',
        title: 'Jack attack',
        format: 'Beat the Clock',
        emoji: '⏱️',
        xp: 20,
        steps: [{ kind: 'clock', exercise: 'jacks', seconds: 40, goal: 30 }],
      },
      {
        id: 'u3l6',
        title: 'Cool down',
        format: 'Stretch',
        emoji: '🧘',
        xp: 10,
        steps: [
          { kind: 'hold', exercise: 'deepsquat', seconds: 20 },
          { kind: 'hold', exercise: 'hamstring', seconds: 20 },
        ],
      },
    ],
  },
];

export const ALL_LESSONS: Lesson[] = UNITS.flatMap((u) => u.lessons);

export function findLesson(id: string): Lesson | undefined {
  return ALL_LESSONS.find((l) => l.id === id);
}

/** First lesson not yet completed (the "current" node on the path). */
export function currentLesson(completed: string[]): Lesson | undefined {
  return ALL_LESSONS.find((l) => !completed.includes(l.id));
}

export function isUnlocked(lessonId: string, completed: string[]): boolean {
  const i = ALL_LESSONS.findIndex((l) => l.id === lessonId);
  return i === 0 || completed.includes(ALL_LESSONS[i - 1].id) || completed.includes(lessonId);
}

/** Penalty lesson built on the fly: owed squats as one set. */
export function penaltyLesson(reps: number): Lesson {
  return {
    id: 'penalty',
    title: 'Penalty set',
    format: 'Rep Set',
    emoji: '⚖️',
    xp: 0,
    steps: [{ kind: 'reps', exercise: 'squat', reps }],
  };
}
