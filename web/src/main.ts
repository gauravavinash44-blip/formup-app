import './style.css';

import { HoldTimer, RepCounter, issueCue, type HoldState, type RepResult, type RepState } from '../../src/exercises/engine';
import { getExercise } from '../../src/exercises/library';
import { COLORS, Stage, getLandmarker, pill, ring, type View } from './camera';
import {
  UNITS,
  currentLesson,
  figureSvg,
  findLesson,
  isUnlocked,
  penaltyLesson,
  type Lesson,
  type QuizQuestion,
  type Step,
} from './course';
import { rhino } from './rhino';
import {
  BADGES,
  awardBadges,
  dayKey,
  addDays,
  load,
  payPenalty,
  recordLesson,
  reset,
  save,
  streakBonus,
  streakInfo,
  type Badge,
  type Profile,
} from './store';

/* ---------- helpers ---------- */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

function say(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
function formatTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type ViewId = 'learn' | 'progress' | 'workout' | 'quiz' | 'result';
function show(view: ViewId) {
  for (const v of ['learn', 'progress', 'workout', 'quiz', 'result'] as const) $(v).hidden = v !== view;
  $('tabs').hidden = !(view === 'learn' || view === 'progress');
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === view));
  window.scrollTo(0, 0);
}

function fillRhinos(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-rhino]').forEach((el) => {
    el.innerHTML = rhino(el.dataset.rhino as Parameters<typeof rhino>[0]);
  });
}

/* ---------- profile ---------- */

let profile: Profile = load();
const FACING_KEY = 'formup.facing';
let facing: 'user' | 'environment' = (() => {
  try {
    return localStorage.getItem(FACING_KEY) === 'environment' ? 'environment' : 'user';
  } catch {
    return 'user';
  }
})();

function commit(p: Profile): Badge[] {
  const { profile: next, fresh } = awardBadges(p);
  profile = next;
  save(profile);
  return fresh;
}

/* ---------- Learn: the path ---------- */

const FORMAT_ICON: Record<string, string> = {
  'Warm-up': 'i-bolt',
  'Rep Set': 'i-dumbbell',
  'Hold It': 'i-hold',
  'Beat the Clock': 'i-timer',
  'Fix the Form': 'i-target',
  Stretch: 'i-hold',
};
const XS = [50, 28, 50, 72, 50, 28, 50, 72];

function renderLearn() {
  const info = streakInfo(profile);
  $('streakStat').textContent = String(info.streak);
  $('streakStat').parentElement!.classList.toggle('cold', !info.doneToday);
  $('xpStat').textContent = String(profile.xp);

  const pen = $('penaltyCard');
  pen.hidden = info.penaltyReps === 0;
  if (info.penaltyReps) {
    $('penaltyText').textContent = `You missed ${info.missed === 1 ? 'a day' : `${info.missed} days`}. Do ${info.penaltyReps} squats to keep your ${info.streak}-day streak.`;
  }

  const current = currentLesson(profile.completed);
  const STEP = 92;
  let html = '';
  for (const unit of UNITS) {
    html += `<div class="unit" style="background:${unit.color}"><small>${esc(unit.title.split('·')[0].trim())}</small><b>${esc(unit.title.split('·')[1]?.trim() ?? unit.title)}</b><span>${esc(unit.subtitle)}</span></div>`;
    const n = unit.lessons.length;
    const height = 40 + (n + 1) * STEP;
    html += `<div class="path" style="height:${height}px">`;
    unit.lessons.forEach((lesson, k) => {
      const top = 46 + k * STEP;
      const x = XS[k % XS.length];
      const done = profile.completed.includes(lesson.id);
      const now = current?.id === lesson.id;
      const open = isUnlocked(lesson.id, profile.completed);
      const cls = done ? 'done' : now ? 'now' : 'lock';
      const icon = done ? 'i-check' : open ? FORMAT_ICON[lesson.format] : 'i-lock';
      const state = done ? 'done' : now ? 'start here' : 'locked';
      html += `<button type="button" class="node ${cls}" data-lesson="${lesson.id}" style="left:${x}%;top:${top}px" aria-label="${esc(lesson.format)}: ${esc(lesson.title)}, ${state}" ${open ? '' : 'aria-disabled="true"'}><svg><use href="#${icon}"/></svg></button>`;
      html += `<span class="node-label" style="left:${x}%;top:${top + 66}px">${esc(lesson.title)}</span>`;
      if (now) html += `<div class="startpop" style="left:${x}%;top:${top - 42}px">Start</div>`;
      if (now || (k === 2 && !current)) {
        const side = x <= 50 ? 'right:2%' : 'left:2%';
        html += `<span class="tank" style="${side};top:${top - 18}px">${rhino('ready')}</span>`;
      }
    });
    const chestTop = 46 + n * STEP;
    const allDone = unit.lessons.every((l) => profile.completed.includes(l.id));
    html += `<div class="node chest" style="left:50%;top:${chestTop}px" aria-label="Unit reward${allDone ? ', earned' : ''}"><svg><use href="#i-trophy"/></svg></div>`;
    html += `</div>`;
  }
  $('path').innerHTML = html;
}

$('path').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lesson]');
  if (!btn) return;
  const lesson = findLesson(btn.dataset.lesson!);
  if (!lesson) return;
  if (!isUnlocked(lesson.id, profile.completed)) {
    btn.animate?.([{ transform: 'translateX(-50%)' }, { transform: 'translateX(-46%)' }, { transform: 'translateX(-54%)' }, { transform: 'translateX(-50%)' }], 240);
    return;
  }
  openSheet(lesson);
});

/* ---------- lesson sheet ---------- */

let sheetLesson: Lesson | null = null;

function scaled(step: Step, isPenalty: boolean): Step {
  // Rep targets grow with the streak (not for the penalty set).
  if (step.kind === 'reps' && !isPenalty) return { ...step, reps: step.reps + streakBonus(streakInfo(profile).streak) };
  return step;
}

function stepLine(step: Step): { e: string; b: string; s: string } {
  if (step.kind === 'quiz') return { e: '🔍', b: `${step.questions.length} questions`, s: 'Spot the form mistake. No camera needed.' };
  const ex = getExercise(step.exercise);
  if (step.kind === 'reps') return { e: ex.emoji, b: `${step.reps} ${ex.name.toLowerCase()}`, s: ex.howTo };
  if (step.kind === 'hold') return { e: ex.emoji, b: `${ex.name}, ${step.seconds} s`, s: ex.howTo };
  return { e: '⏱️', b: `${ex.name}: ${step.goal} good reps in ${step.seconds} s`, s: 'Only good-form reps count. Go!' };
}

function openSheet(lesson: Lesson) {
  sheetLesson = lesson;
  const isPenalty = lesson.id === 'penalty';
  const steps = lesson.steps.map((s) => scaled(s, isPenalty));
  $('sheetEmoji').textContent = lesson.emoji;
  $('sheetFormat').textContent = isPenalty ? 'Penalty' : lesson.format;
  $('sheetTitle').textContent = lesson.title;
  $('sheetSteps').innerHTML = steps
    .map((s) => {
      const l = stepLine(s);
      return `<li><span class="e">${l.e}</span><div><b>${esc(l.b)}</b><span>${esc(l.s)}</span></div></li>`;
    })
    .join('');
  const needsCamera = lesson.steps.some((s) => s.kind !== 'quiz');
  $('cameraPick').hidden = !needsCamera;
  const start = $('sheetStart');
  start.textContent = isPenalty ? 'Pay the tax' : `Start · +${lesson.xp} XP`;
  start.classList.toggle('bad', isPenalty);
  document.querySelectorAll<HTMLButtonElement>('#cameras button').forEach((b) => b.classList.toggle('on', b.dataset.facing === facing));
  $('sheet').hidden = false;
  start.focus();
}

function closeSheet() {
  $('sheet').hidden = true;
}

$('cameras').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  facing = btn.dataset.facing as typeof facing;
  try {
    localStorage.setItem(FACING_KEY, facing);
  } catch {
    /* ignore */
  }
  document.querySelectorAll<HTMLButtonElement>('#cameras button').forEach((b) => b.classList.toggle('on', b === btn));
});
$('sheetClose').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet')) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
});
$('sheetStart').addEventListener('click', () => {
  if (!sheetLesson) return;
  const lesson = sheetLesson;
  closeSheet();
  startLesson(lesson);
});
$('penaltyBtn').addEventListener('click', () => {
  const info = streakInfo(profile);
  if (info.penaltyReps) openSheet(penaltyLesson(info.penaltyReps));
});

/* ---------- lesson run ---------- */

interface Tally {
  reps: number;
  goodReps: number;
  holdMs: number;
  goodHoldMs: number;
  dots: ('good' | 'okay' | 'miss')[];
  quizRight: number;
  quizTotal: number;
  clockHit: boolean | null;
}

interface Run {
  lesson: Lesson;
  steps: Step[];
  index: number;
  startMs: number;
  tally: Tally;
  isPenalty: boolean;
}

let run: Run | null = null;

function startLesson(lesson: Lesson) {
  const isPenalty = lesson.id === 'penalty';
  run = {
    lesson,
    steps: lesson.steps.map((s) => scaled(s, isPenalty)),
    index: 0,
    startMs: Date.now(),
    isPenalty,
    tally: { reps: 0, goodReps: 0, holdMs: 0, goodHoldMs: 0, dots: [], quizRight: 0, quizTotal: 0, clockHit: null },
  };
  say(''); // unlock speech on iOS: it must start from a tap
  runStep();
}

function runStep() {
  const r = run;
  if (!r) return;
  if (r.index >= r.steps.length) {
    finishLesson();
    return;
  }
  const step = r.steps[r.index];
  if (step.kind === 'quiz') {
    if (stage.open) stage.stop();
    startQuiz(step.questions);
  } else {
    startCameraStep(step);
  }
}

function nextStep() {
  if (!run) return;
  run.index += 1;
  runStep();
}

function quitLesson() {
  active = null;
  clearInterval(introTimer);
  if (stage.recording) void stage.finishRecording();
  stage.stop();
  say('');
  run = null;
  showHome();
}

/* ---------- camera steps ---------- */

const stage = new Stage($<HTMLVideoElement>('video'), $<HTMLCanvasElement>('stage'));
const recordBtn = $<HTMLButtonElement>('recordBtn');
stage.onRecordingChange = (on) => {
  recordBtn.classList.toggle('on', on);
  recordBtn.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
  if (on) {
    profile = { ...profile, clips: profile.clips + 1 };
    save(profile);
  }
};

type Active =
  | { kind: 'reps'; step: Extract<Step, { kind: 'reps' }>; counter: RepCounter; state: RepState; greeted: boolean }
  | { kind: 'clock'; step: Extract<Step, { kind: 'clock' }>; counter: RepCounter; state: RepState; startedAt: number | null; greeted: boolean }
  | { kind: 'hold'; step: Extract<Step, { kind: 'hold' }>; timer: HoldTimer; state: HoldState; lastSpoken: number; lastCue: string; greeted: boolean };

let active: Active | null = null;
let ending = false;
let introTimer = 0;
let lastSetupSpoken = 0;

async function startCameraStep(step: Exclude<Step, { kind: 'quiz' }>) {
  show('workout');
  active = null;
  ending = false;
  $('setup').hidden = true;
  if (!stage.open) {
    $('intro').hidden = true;
    $('loading').hidden = false;
    try {
      await stage.start(facing, (t) => ($('loadingText').textContent = t));
    } catch (e) {
      $('loadingText').textContent = (e as Error).message;
      return;
    }
    $('loading').hidden = true;
  }
  showIntro(step);
}

function showIntro(step: Exclude<Step, { kind: 'quiz' }>) {
  const r = run!;
  const ex = getExercise(step.exercise);
  const l = stepLine(step);
  $('introStep').textContent = r.steps.length > 1 ? `Exercise ${r.index + 1} of ${r.steps.length}` : r.isPenalty ? 'Penalty set' : r.lesson.format;
  $('introEmoji').textContent = l.e;
  $('introName').textContent = l.b;
  $('introHow').textContent = ex.howTo;
  $('introSetup').textContent = `📱 ${ex.setup}`;
  $('intro').hidden = false;
  say(`Next: ${l.b}.`);
  let n = 6;
  const tick = () => {
    n -= 1;
    $('introCount').textContent = String(n);
    if (n <= 0) begin(step);
  };
  tick();
  clearInterval(introTimer);
  introTimer = window.setInterval(tick, 1000);
}

function begin(step: Exclude<Step, { kind: 'quiz' }>) {
  clearInterval(introTimer);
  if (!$('intro').hidden) $('intro').hidden = true;
  if (active) return;
  const ex = getExercise(step.exercise);
  const now = Date.now();
  lastSetupSpoken = now;
  if (step.kind === 'hold') {
    if (ex.kind !== 'hold') throw new Error(`${ex.id} is not a hold`);
    const timer = new HoldTimer(ex, step.seconds * 1000);
    active = { kind: 'hold', step, timer, state: timer.state(now), lastSpoken: 0, lastCue: '', greeted: false };
  } else {
    if (ex.kind !== 'reps') throw new Error(`${ex.id} is not a rep exercise`);
    if (step.kind === 'reps') {
      const counter = new RepCounter(ex, step.reps);
      active = { kind: 'reps', step, counter, state: counter.state(now), greeted: false };
    } else {
      const counter = new RepCounter(ex, 9999, true);
      active = { kind: 'clock', step, counter, state: counter.state(now), startedAt: null, greeted: false };
    }
  }
}
$('introGo').addEventListener('click', () => {
  const r = run;
  if (!r) return;
  const step = r.steps[r.index];
  if (step.kind !== 'quiz') begin(step);
});

stage.onFrame = (pose, now, aspect) => {
  const a = active;
  if (!a || ending) return;
  let setup = false;
  if (a.kind === 'hold') {
    a.timer.update(pose, now, aspect);
    a.state = a.timer.state(now);
    setup = a.state.phase === 'setup';
    const ex = a.timer.exercise;
    if (!setup && !a.greeted) {
      a.greeted = true;
      say(ex.getInCue);
    }
    // Speak cue changes (form tips), at most every 4 s, and the halfway mark.
    if (a.state.phase === 'holding' && a.state.cue.text !== a.lastCue && now - a.lastSpoken > 4000) {
      a.lastCue = a.state.cue.text;
      a.lastSpoken = now;
      say(a.state.cue.text);
    }
    if (a.state.done) endStep('Done! Nice hold.');
  } else {
    const rep = a.counter.update(pose, now, aspect);
    a.state = a.counter.state(now);
    setup = a.state.phase === 'setup';
    if (!setup && !a.greeted) {
      a.greeted = true;
      if (a.kind === 'reps') say(`I can see you. ${a.state.cue.text}.`);
      else say('Go! Only good reps count.');
    }
    if (a.kind === 'clock' && a.startedAt === null && !setup) a.startedAt = now;
    if (rep) onRep(a, rep, now);
    if (a.kind === 'reps' && a.state.done) endStep('Set complete! Great work.');
    if (a.kind === 'clock' && a.startedAt !== null && now - a.startedAt >= a.step.seconds * 1000) {
      const hit = a.state.reps >= a.step.goal;
      endStep(hit ? `Time! ${a.state.reps} good reps. Goal smashed!` : `Time! ${a.state.reps} good reps.`);
    }
  }
  if (setup && now - lastSetupSpoken > 8000) {
    lastSetupSpoken = now;
    say('Step back so your whole body is in view');
  }
  const showSetup = setup && !hasProgress(a);
  $('setup').hidden = !showSetup;
  if (showSetup) {
    const st = $('setupStatus');
    st.textContent = pose ? 'Almost there, get your whole body in view' : 'Looking for you…';
    st.className = pose ? 'ok' : 'warn';
  }
};

function hasProgress(a: Active): boolean {
  return a.kind === 'hold' ? a.state.heldMs > 0 : a.state.reps > 0 || (a.state.lastRep !== null);
}

function onRep(a: Extract<Active, { kind: 'reps' | 'clock' }>, rep: RepResult, now: number) {
  const t = run!.tally;
  t.dots.push(!rep.counted ? 'miss' : rep.quality === 'good' ? 'good' : 'okay');
  const ex = a.counter.exercise;
  if (!rep.counted) {
    buzz([40, 40, 40]);
    say(a.kind === 'clock' && rep.quality !== 'bad' ? issueCue(ex, rep.issues[0]) : ex.shallowCue);
    return;
  }
  buzz(40);
  if (rep.quality === 'good') stage.flashUntil = now + 700;
  const n = a.state.reps;
  const word = NUMBER_WORDS[n] ?? String(n);
  say(rep.quality === 'good' ? word : `${word}. ${issueCue(ex, rep.issues[0])}`);
}

/** Ends the current camera step, adds it to the tally and moves on. */
function endStep(message?: string) {
  const a = active;
  if (!a || ending) return;
  ending = true;
  const t = run!.tally;
  if (a.kind === 'hold') {
    t.holdMs += a.state.heldMs;
    t.goodHoldMs += a.state.heldMs * a.state.formScore;
  } else {
    t.reps += a.state.reps;
    t.goodReps += a.state.goodReps;
    if (a.kind === 'clock') t.clockHit = (t.clockHit ?? true) && a.state.reps >= a.step.goal;
  }
  if (message) say(message);
  buzz([80, 60, 160]);
  setTimeout(() => {
    active = null;
    nextStep();
  }, message ? 1600 : 200);
}

$('nextBtn').addEventListener('click', () => {
  if (active) endStep();
  else if (run && !$('intro').hidden) {
    // Skip the exercise from its intro card.
    clearInterval(introTimer);
    $('intro').hidden = true;
    nextStep();
  }
});
recordBtn.addEventListener('click', () => {
  const err = stage.toggleRecord();
  if (err) {
    $('setup').hidden = false;
    $('setupStatus').textContent = err;
    $('setupStatus').className = 'warn';
  }
});
$('closeBtn').addEventListener('click', quitLesson);

/* HUD drawn on the canvas, so recorded clips include it. */
stage.drawHud = (ctx: CanvasRenderingContext2D, v: View, now: number) => {
  const r = run;
  const a = active;
  if (!r) return;
  const cx = v.x + v.w / 2;
  const u = v.u;

  // Lesson progress bar along the top.
  const barY = v.y + v.h * 0.055;
  const barW = v.w * 0.62;
  const stepFrac = a ? stepFraction(a) : 0;
  const frac = (r.index + stepFrac) / r.steps.length;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, barY, barW, u * 2.6, u * 1.3);
  ctx.fill();
  ctx.fillStyle = COLORS.good;
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, barY, Math.max(u * 2.6, barW * frac), u * 2.6, u * 1.3);
  ctx.fill();

  if (!a) return;
  const ex = a.kind === 'hold' ? a.timer.exercise : a.counter.exercise;
  const label = r.isPenalty ? 'PENALTY SET' : `${ex.name.toUpperCase()}`;
  ctx.save();
  pill(ctx, label, cx, barY + u * 9, u * 3.6, 'rgba(0,0,0,0.5)', u * 1.6, 800);
  ctx.restore();

  const big = u * 16;
  const topY = v.y + v.h * 0.2;
  let cue: { text: string; tone: string } | null = null;
  if (a.kind === 'hold') {
    const s = a.state;
    const secs = Math.floor(s.heldMs / 1000);
    ring(ctx, cx, topY + u * 2, big * 0.85, s.heldMs / s.targetMs, s.phase === 'holding' ? COLORS.good : COLORS.warn, u * 2.2);
    pill(ctx, `${secs}s`, cx, topY + u * 2, big * 0.7, null, 0, 900);
    pill(ctx, `of ${Math.round(s.targetMs / 1000)}s`, cx, topY + big * 1.2, u * 4, null, 0, 700);
    if (!(s.phase === 'setup' && s.heldMs === 0)) cue = s.cue;
  } else {
    const s = a.state;
    const goal = a.kind === 'reps' ? s.target : a.step.goal;
    pill(ctx, `${s.reps}/${goal}`, cx, topY, big, 'rgba(0,0,0,0.35)', u * 2.6, 900);
    if (now < stage.flashUntil) pill(ctx, '✓', cx, topY + big * 0.95, u * 8, COLORS.good, u * 1.8, 900);
    if (a.kind === 'clock') {
      const left = a.startedAt === null ? a.step.seconds * 1000 : a.step.seconds * 1000 - (now - a.startedAt);
      const warn = left < 10_000 && a.startedAt !== null;
      pill(ctx, `⏱ ${formatTime(left)}`, cx, topY + big * 1.65, u * 5.5, warn ? COLORS.warn : 'rgba(0,0,0,0.5)', u * 1.8, 900);
    }
    if (!(s.phase === 'setup' && s.reps === 0 && !s.lastRep)) cue = s.cue;
  }
  if (cue) {
    const bg = cue.tone === 'good' ? COLORS.good : cue.tone === 'warn' ? COLORS.warn : COLORS.info;
    pill(ctx, cue.text, cx, v.y + v.h * 0.8, u * 5.4, bg, u * 2.4);
  }
};

function stepFraction(a: Active): number {
  if (a.kind === 'hold') return a.state.heldMs / a.state.targetMs;
  if (a.kind === 'reps') return Math.min(1, a.state.reps / a.state.target);
  if (a.startedAt === null) return 0;
  return Math.min(1, (Date.now() - a.startedAt) / (a.step.seconds * 1000));
}

/* ---------- Fix the Form quiz ---------- */

let quiz: { queue: QuizQuestion[]; total: number; done: number; firstTry: Set<QuizQuestion>; missed: Set<QuizQuestion> } | null = null;

function startQuiz(questions: QuizQuestion[]) {
  quiz = { queue: [...questions], total: questions.length, done: 0, firstTry: new Set(), missed: new Set() };
  show('quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = quiz!.queue[0];
  $('quizBar').style.width = `${(quiz!.done / quiz!.total) * 100}%`;
  $('quizPrompt').textContent = q.prompt;
  $('quizFigure').innerHTML = figureSvg(q.figure);
  $('quizOptions').innerHTML = q.options
    .map((o, i) => `<button type="button" class="opt" data-i="${i}">${esc(o)}</button>`)
    .join('');
  $('quizFeedback').hidden = true;
}

$('quizOptions').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.opt');
  if (!btn || !quiz || btn.disabled) return;
  const q = quiz.queue[0];
  const pick = Number(btn.dataset.i);
  const right = pick === q.answer;
  const opts = [...document.querySelectorAll<HTMLButtonElement>('#quizOptions .opt')];
  opts.forEach((o, i) => {
    o.disabled = true;
    if (i === q.answer) o.classList.add('right');
    else if (i === pick) o.classList.add('wrong');
  });
  $('quizFigure').innerHTML = figureSvg(q.figure, true);
  const fb = $('quizFeedback');
  fb.hidden = false;
  fb.classList.toggle('no', !right);
  $('quizVerdict').textContent = right ? 'Correct!' : 'Not quite';
  $('quizExplain').textContent = q.explain;
  buzz(right ? 30 : [40, 40, 40]);
  if (right) {
    if (!quiz.missed.has(q)) quiz.firstTry.add(q);
  } else {
    quiz.missed.add(q);
  }
  $('quizNext').focus();
});

$('quizNext').addEventListener('click', () => {
  if (!quiz) return;
  const q = quiz.queue.shift()!;
  const wasRight = $('quizVerdict').textContent === 'Correct!';
  if (wasRight) quiz.done += 1;
  else quiz.queue.push(q); // wrong answers come back at the end, Duolingo style
  if (quiz.queue.length) {
    renderQuestion();
    return;
  }
  run!.tally.quizRight += quiz.firstTry.size;
  run!.tally.quizTotal += quiz.total;
  quiz = null;
  nextStep();
});
$('quizClose').addEventListener('click', () => {
  quiz = null;
  quitLesson();
});

/* ---------- finish + result ---------- */

async function finishLesson() {
  const r = run!;
  active = null;
  await stage.finishRecording();
  const clip = stage.clip;
  stage.stop();

  const t = r.tally;
  const holdSec = t.holdMs / 1000;
  const goodHoldSec = t.goodHoldMs / 1000;
  const denom = t.reps + holdSec + t.quizTotal;
  const form = denom > 0 ? (t.goodReps + goodHoldSec + t.quizRight) / denom : 0;
  const did = t.reps + t.holdMs + t.quizTotal > 0;
  const today = dayKey();

  let xp = 0;
  let fresh: Badge[] = [];
  const before = streakInfo(profile).streak;
  if (did) {
    const rec = {
      date: today,
      lessonId: r.lesson.id,
      xp: 0,
      reps: t.reps,
      goodReps: t.goodReps,
      holdMs: Math.round(t.holdMs),
      form,
    };
    if (r.isPenalty) {
      fresh = commit(payPenalty(profile, rec, today));
    } else {
      xp = r.lesson.xp + (form >= 0.8 ? 5 : 0) + (t.clockHit ? 10 : 0);
      fresh = commit(recordLesson(profile, { ...rec, xp }, today));
    }
  }
  const after = streakInfo(profile);

  $('resultMascot').innerHTML = rhino(did ? 'cheer' : 'worried');
  $('resultTitle').textContent = !did
    ? 'No reps this time'
    : r.isPenalty
      ? 'Tax paid. Streak saved!'
      : t.clockHit === false
        ? 'Close one! Lesson done.'
        : 'Lesson complete!';
  $('xpEarned').textContent = r.isPenalty ? `🔥 ${after.streak} day streak kept` : `+${xp} XP`;
  $('streakLine').textContent = r.isPenalty
    ? 'Now do a lesson to grow it.'
    : after.streak > before && did
      ? `🔥 ${after.streak} day streak!`
      : `🔥 ${after.streak} day streak`;
  const hasReps = t.reps + t.dots.length > 0 || (t.holdMs === 0 && t.quizTotal === 0);
  $('statReps').textContent = hasReps ? String(t.reps) : t.holdMs ? `${Math.round(holdSec)}s` : `${t.quizRight}/${t.quizTotal}`;
  $('statRepsLabel').textContent = hasReps ? 'Reps' : t.holdMs ? 'Held' : 'First try';
  $('statGood').textContent = `${Math.round(form * 100)}%`;
  $('statTime').textContent = formatTime(Date.now() - r.startMs);
  $('dots').innerHTML = t.dots.map((d) => `<i class="${d === 'good' ? '' : d}"></i>`).join('');
  $('newBadges').innerHTML = fresh.map((b) => `<span>${b.emoji} New badge: ${esc(b.name)}</span>`).join('');

  const clipVideo = $<HTMLVideoElement>('clipVideo');
  $('clipStatus').textContent = '';
  const hasClip = !!clip;
  $('clipCard').hidden = !hasClip;
  $('noClip').hidden = hasClip || r.steps.every((s) => s.kind === 'quiz');
  if (clip) {
    clipVideo.src = clip.url;
    clipVideo.play().catch(() => undefined);
  } else {
    clipVideo.removeAttribute('src');
  }
  show('result');
  if (did) say(r.isPenalty ? 'Streak saved!' : `Lesson complete! Plus ${xp} XP.`);
}

function clipFile() {
  const c = stage.clip!;
  const name = run?.lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'workout';
  return new File([c.blob], `formup-${name}-${Date.now()}.${c.ext}`, { type: c.blob.type });
}

$('saveBtn').addEventListener('click', () => {
  if (!stage.clip) return;
  const a = document.createElement('a');
  a.href = stage.clip.url;
  a.download = clipFile().name;
  a.click();
  $('clipStatus').textContent = 'Saved to your downloads.';
});

$('shareBtn').addEventListener('click', async () => {
  if (!stage.clip) return;
  const file = clipFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My FormUp workout', text: 'Trained with FormUp 🦏' });
    } catch {
      /* closed the share sheet */
    }
  } else {
    $('clipStatus').textContent = 'Sharing files is not supported in this browser. Use Save, then share from your gallery.';
  }
});

$('againBtn').addEventListener('click', () => {
  run = null;
  showHome();
});

/* ---------- Progress ---------- */

function renderProgress() {
  const info = streakInfo(profile);
  const lessons = profile.history.filter((h) => !h.penalty);
  const reps = profile.history.reduce((a, h) => a + h.reps, 0);
  const holdMin = profile.history.reduce((a, h) => a + h.holdMs, 0) / 60000;
  const tiles: [string, string][] = [
    [`🔥 ${info.streak}`, 'Day streak'],
    [`⚡ ${profile.xp}`, 'Total XP'],
    [String(reps), 'Reps done'],
    [`${profile.bestStreak}`, 'Best streak'],
    [String(lessons.length), 'Lessons'],
    [holdMin >= 1 ? `${holdMin.toFixed(1)} min` : `${Math.round(holdMin * 60)} s`, 'Time in holds'],
  ];
  $('tiles').innerHTML = tiles.map(([b, s]) => `<div class="tile"><b>${esc(b)}</b><span>${s}</span></div>`).join('');

  // XP per day, last 14 days.
  const today = dayKey();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const xpBy = new Map<string, number>();
  for (const h of profile.history) xpBy.set(h.date, (xpBy.get(h.date) ?? 0) + h.xp);
  const vals = days.map((d) => xpBy.get(d) ?? 0);
  const max = Math.max(20, ...vals);
  const W = 320;
  const H = 130;
  const bw = W / 14;
  let bars = '';
  days.forEach((d, i) => {
    const v = vals[i];
    const h = (v / max) * (H - 30);
    const x = i * bw + 3;
    const isToday = d === today;
    bars += `<rect x="${x}" y="${H - 18 - h}" width="${bw - 6}" height="${Math.max(2, h)}" rx="3" fill="${v ? (isToday ? '#FF6B2C' : '#FFC93C') : '#222935'}"><title>${d}: ${v} XP</title></rect>`;
    if (v) bars += `<text x="${x + (bw - 6) / 2}" y="${H - 22 - h}" text-anchor="middle">${v}</text>`;
    if (i % 2 === 1 || isToday) {
      const lbl = isToday ? 'Today' : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });
      bars += `<text x="${x + (bw - 6) / 2}" y="${H - 4}" text-anchor="middle">${lbl}</text>`;
    }
  });
  $('xpChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="XP earned per day over the last 14 days">${bars}</svg>`;

  // Form score line, last 10 lessons.
  const recent = lessons.filter((h) => h.reps + h.holdMs > 0 || h.form > 0).slice(-10);
  if (recent.length < 2) {
    $('formChart').innerHTML = `<p class="empty">${recent.length ? 'One lesson so far. Do another to see your trend.' : 'Finish two lessons to see your form trend.'}</p>`;
  } else {
    const L = 36;
    const pts = recent.map((h, i) => [L + (i / (recent.length - 1)) * (W - L - 10), 10 + (1 - h.form) * (H - 34)] as const);
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const grid = [1, 0.5, 0]
      .map((g) => {
        const y = 10 + (1 - g) * (H - 34);
        return `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#2C3442" stroke-dasharray="3 4"/><text x="${L - 4}" y="${y + 3}" text-anchor="end">${g * 100}%</text>`;
      })
      .join('');
    const dots = pts
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#33BF66"><title>${Math.round(recent[i].form * 100)}% good form</title></circle>`)
      .join('');
    $('formChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Good form percentage over the last ${recent.length} lessons">${grid}<path d="${path}" fill="none" stroke="#33BF66" stroke-width="3" stroke-linejoin="round"/>${dots}</svg>`;
  }

  $('badges').innerHTML = BADGES.map((b) => {
    const got = profile.badges.includes(b.id);
    return `<div class="badge ${got ? '' : 'lock'}"><i aria-hidden="true">${b.emoji}</i><b>${esc(b.name)}</b><span>${got ? 'Earned' : esc(b.how)}</span></div>`;
  }).join('');
}

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset all your XP, streak and progress on this device?')) return;
  profile = reset();
  renderProgress();
  renderLearn();
});

/* ---------- tabs + boot ---------- */

function showHome() {
  renderLearn();
  show('learn');
}

$('tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  if (btn.dataset.tab === 'progress') {
    renderProgress();
    show('progress');
  } else showHome();
});

// Debug helper for testing streaks and penalties: ?days-ago=N pretends the last workout was N days ago.
const daysAgo = Number(new URLSearchParams(location.search).get('days-ago'));
if (daysAgo > 0 && profile.lastActive) {
  profile = { ...profile, lastActive: addDays(dayKey(), -daysAgo), penaltyPaidFor: null, streak: Math.max(1, profile.streak) };
  save(profile);
}

fillRhinos();
showHome();
// Start downloading the model while the person looks at the path.
getLandmarker().catch((e) => console.warn('Model preload failed', e));
