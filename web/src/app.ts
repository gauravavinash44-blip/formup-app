/**
 * FormUp alarm-first app: splash → onboarding → alarms → ring → reps on camera → "You're up!".
 * Original FormUp design (Tank the rhino); the wake-by-moving mechanic is the idea, not anyone's screens.
 */
import './app.css';

import { RepCounter, type RepState } from '../../src/exercises/engine';
import { getExercise } from '../../src/exercises/library';
import {
  ALARM_EXERCISES,
  SOUNDS,
  alarmIcs,
  daysLabel,
  due,
  formatClock,
  keepAwake,
  loadAlarms,
  newAlarm,
  saveAlarms,
  siren,
  soonest,
  untilLabel,
  type Alarm,
  type AlarmExercise,
  type SoundId,
} from './alarm';
import { COLORS, Stage, getLandmarker, pill, ring as ringArc, type View } from './camera';
import { rhino } from './rhino';

/* ---------- helpers ---------- */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REP_OPTIONS = [
  { n: 10, name: 'Easy start' },
  { n: 15, name: 'Solid' },
  { n: 20, name: 'Strong' },
  { n: 30, name: 'Beast mode' },
];
const RING_TITLES = ['Time to move!', 'Rise and stomp!', 'Up you get!', 'Morning, legend!'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function say(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
function buzz(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
}
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const mission = (a: Pick<Alarm, 'exercise' | 'reps'>) => `${a.reps} ${getExercise(a.exercise).name.toLowerCase()}`;
const wakeLink = (id?: string) => `${location.origin}${location.pathname}?wake=${id ?? '1'}`;

type ScreenId = 'splash' | 'onb' | 'main' | 'bedside' | 'ringing' | 'cam' | 'win';
function show(id: ScreenId) {
  for (const s of ['splash', 'onb', 'main', 'bedside', 'ringing', 'cam', 'win'] as const) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}
function fillRhinos(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-rhino]').forEach((el) => (el.innerHTML = rhino(el.dataset.rhino as Parameters<typeof rhino>[0])));
}

/* ---------- app state (this browser only) ---------- */

interface Wake {
  /** When it started ringing (ms). */
  at: number;
  /** When the reps were done or it was stopped (ms). */
  end: number;
  exercise: AlarmExercise;
  reps: number;
  outcome: 'done' | 'stopped';
  test?: boolean;
}
/** Answers from the intro questionnaire. Each one shapes the suggested plan (see suggest()). */
export interface Answers {
  goal?: 'snooze' | 'fit' | 'routine' | 'onTime';
  snooze?: 'never' | 'few' | 'many' | 'lost';
  feel?: 'zombie' | 'slow' | 'fine';
  active?: 'new' | 'some' | 'most' | 'athlete';
  company?: 'alone' | 'partner' | 'family';
}
interface AppState {
  onboarded: boolean;
  answers: Answers;
  sound: SoundId;
  safety: boolean;
  history: Wake[];
}
const STATE_KEY = 'formup.alarmapp.v1';
function loadState(): AppState {
  const empty: AppState = { onboarded: false, answers: {}, sound: 'stampede', safety: true, history: [] };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return { ...empty, ...(JSON.parse(raw) as AppState) };
  } catch {
    /* blocked */
  }
  return empty;
}
let state = loadState();
const saveState = () => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* blocked */
  }
};
let alarms = loadAlarms();
const saveList = () => saveAlarms(alarms);

/** Days in a row (ending today or yesterday) with at least one real wake-up done by moving. */
function streaks(): { current: number; best: number } {
  const days = new Set(state.history.filter((w) => w.outcome === 'done' && !w.test).map((w) => dayKey(new Date(w.at))));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let current = 0;
  while (days.has(dayKey(d))) {
    current += 1;
    d.setDate(d.getDate() - 1);
  }
  const sorted = [...days].map((k) => new Date(k.replace(/-(\d+)-(\d+)$/, (_, m, dd) => `-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`) + 'T12:00:00').getTime()).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i && Math.round((sorted[i] - sorted[i - 1]) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current) };
}

/* ---------- onboarding ---------- */

const draft: Alarm = newAlarm();
let onbStep = 0;
let cameraOk: boolean | null = null;

interface Step {
  body: () => string;
  cta: () => string;
  alt?: () => string | null;
  next?: () => Promise<boolean> | boolean;
  onAlt?: () => void;
}

interface Choice {
  v: string;
  e: string;
  t: string;
}
/** One multiple-choice question. Picking an answer saves it and moves on. */
function question(key: keyof Answers, title: string, lead: string, choices: Choice[]): Step {
  return {
    body: () => `
      <h1>${title}</h1>
      <p class="lead">${lead}</p>
      <div class="options">${choices
        .map((c) => `<button type="button" class="opt ${state.answers[key] === c.v ? 'on' : ''}" data-answer="${key}" data-v="${c.v}"><span class="e">${c.e}</span>${esc(c.t)}</button>`)
        .join('')}</div>`,
    cta: () => 'Continue',
    next: () => {
      if (state.answers[key]) return true;
      $('onbBody').querySelector('.options')?.animate?.([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], 200);
      return false;
    },
  };
}

/** Turns the answers into a starting plan. Kept in one place so it's easy to tune. */
function suggest(a: Answers): { exercise: AlarmExercise; reps: number; sound: SoundId; why: string[] } {
  let reps = { new: 10, some: 15, most: 20, athlete: 30 }[a.active ?? 'some'];
  if (a.snooze === 'many' || a.snooze === 'lost') reps = Math.min(30, reps + 5);
  const quiet = a.company === 'partner' || a.company === 'family';
  const exercise: AlarmExercise = quiet ? 'squat' : a.feel === 'zombie' ? 'jacks' : a.active === 'athlete' ? 'pushup' : 'squat';
  const sound: SoundId = a.feel === 'zombie' || a.snooze === 'lost' ? 'horn' : quiet ? 'beeper' : 'stampede';
  const why: string[] = [];
  if (a.snooze === 'many' || a.snooze === 'lost') why.push('A few extra reps, because snoozing is a habit to break.');
  if (quiet) why.push('A quiet move that won\'t shake the floor for others.');
  else if (exercise === 'jacks') why.push('Jumping jacks get your heart going fastest when you wake up groggy.');
  if (a.active === 'new') why.push('A gentle start. Add reps as it gets easy.');
  if (sound === 'horn') why.push('The loudest sound, for deep sleepers.');
  return { exercise, reps, sound, why };
}

const STEPS: Step[] = [
  {
    body: () => `
      <div class="onb-rhino" data-rhino="ready"></div>
      <h1>Snoozing is over.</h1>
      <p class="lead">FormUp is an alarm you switch off by moving. Your camera counts the reps, so you're properly awake before you can roll over.</p>
      <ul class="perks">
        <li><span>⏰</span><div><b>No snooze button</b>The only way out is a few reps.</div></li>
        <li><span>📷</span><div><b>Your camera counts</b>Everything stays on your phone.</div></li>
        <li><span>🔥</span><div><b>Build a streak</b>Watch your mornings stack up.</div></li>
      </ul>`,
    cta: () => 'Get started',
  },
  question('goal', 'What brings you to FormUp?', 'This helps Tank set you up right.', [
    { v: 'snooze', e: '😴', t: 'I snooze way too much' },
    { v: 'fit', e: '💪', t: 'I want to move every morning' },
    { v: 'routine', e: '🌅', t: 'I want a better morning routine' },
    { v: 'onTime', e: '⏱️', t: 'I keep being late' },
  ]),
  question('snooze', 'How often do you hit snooze?', 'Be honest, Tank won’t judge.', [
    { v: 'never', e: '🙂', t: 'Almost never' },
    { v: 'few', e: '😅', t: 'Once or twice' },
    { v: 'many', e: '😬', t: '3 to 5 times' },
    { v: 'lost', e: '🫠', t: 'I lose count' },
  ]),
  question('feel', 'How do you feel when the alarm goes off?', 'We’ll pick the right sound and move for it.', [
    { v: 'zombie', e: '🧟', t: 'Like a zombie' },
    { v: 'slow', e: '🐢', t: 'Slow, but I get there' },
    { v: 'fine', e: '⚡', t: 'Pretty awake' },
  ]),
  question('active', 'How active are you right now?', 'So your wake-up reps feel doable, not painful.', [
    { v: 'new', e: '🌱', t: 'Just getting started' },
    { v: 'some', e: '🚶', t: 'I move a few days a week' },
    { v: 'most', e: '🏃', t: 'I train most days' },
    { v: 'athlete', e: '🏆', t: 'Fitness is my thing' },
  ]),
  question('company', 'Who’s around when you wake up?', 'So we don’t wake the whole house.', [
    { v: 'alone', e: '🏠', t: 'Just me' },
    { v: 'partner', e: '🛏️', t: 'A partner or roommate' },
    { v: 'family', e: '👨‍👩‍👧', t: 'Family, kids or neighbours below' },
  ]),
  {
    body: () => `
      <h1>When do you want to get up?</h1>
      <input type="time" class="time-input big" id="onbTime" value="${draft.time}" aria-label="Wake-up time" />
      <div class="label">On these days</div>
      <div class="chips days">${DAY_LETTERS.map((l, i) => `<button type="button" class="chip ${draft.days.includes(i) ? 'on' : ''}" data-day="${i}" aria-pressed="${draft.days.includes(i)}" aria-label="${DAY_FULL[i]}">${l}</button>`).join('')}</div>
      <p class="hint" id="onbUntil"></p>`,
    cta: () => 'Continue',
    next: () => {
      draft.time = $<HTMLInputElement>('onbTime').value || draft.time;
      return true;
    },
  },
  {
    body: () => `
      <h1>Pick your wake-up move</h1>
      <p class="lead">You'll do this every time the alarm rings. You can change it per alarm later.</p>
      <div class="moves">${moveCards(draft.exercise)}</div>`,
    cta: () => 'Continue',
  },
  {
    body: () => `
      <h1>How many ${esc(getExercise(draft.exercise).name.toLowerCase())}?</h1>
      <p class="lead">Enough to get your heart going. Start easy, you can always add more.</p>
      <div class="reps-pick">${REP_OPTIONS.map((r) => `<button type="button" class="rep-card ${draft.reps === r.n ? 'on' : ''}" data-reps="${r.n}"><b>${r.n}</b><span>${r.name}</span></button>`).join('')}</div>`,
    cta: () => 'Continue',
  },
  {
    body: () => {
      const s = suggest(state.answers);
      const ex = getExercise(draft.exercise);
      const c = formatClock(draft.time);
      return `
      <div class="onb-rhino" data-rhino="cheer"></div>
      <h1>Your wake-up plan</h1>
      <div class="plan">
        <div class="plan-row"><span>Alarm</span><b>${esc(c.hm)} ${esc(c.ampm)} · ${esc(daysLabel(draft.days))}</b></div>
        <div class="plan-row"><span>To switch it off</span><b>${ex.emoji} ${esc(mission(draft))}</b></div>
        <div class="plan-row"><span>Sound</span><b>${esc(SOUNDS.find((x) => x.id === draft.sound)!.name)}</b></div>
        <div class="plan-row"><span>Snooze</span><b>None. Ever.</b></div>
      </div>
      ${s.why.length ? `<ul class="tips">${s.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="hint">You can change any of this later.</p>`;
    },
    cta: () => 'Looks good',
  },
  {
    body: () => `
      <div class="onb-icon">📷</div>
      <h1>Tank needs to see you move</h1>
      <p class="lead">When the alarm rings, your camera watches your reps and counts them. The video never leaves your phone and nothing is recorded.</p>
      <p class="perm ${cameraOk === true ? 'ok' : cameraOk === false ? 'bad' : ''}" id="camPerm">${
        cameraOk === true ? '✓ Camera ready' : cameraOk === false ? "Couldn't open the camera. Allow it in your browser settings, then try again." : ''
      }</p>`,
    cta: () => (cameraOk ? 'Continue' : 'Allow camera'),
    alt: () => (cameraOk ? null : 'Not now'),
    next: async () => {
      if (cameraOk) return true;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        s.getTracks().forEach((t) => t.stop());
        cameraOk = true;
        getLandmarker().catch(() => undefined);
      } catch {
        cameraOk = false;
      }
      renderOnb();
      return false;
    },
    onAlt: () => go(onbStep + 1),
  },
  {
    body: () => `
      <div class="onb-icon">🔊</div>
      <h1>Make it loud</h1>
      <p class="lead">Pick a sound. Tap one to hear it.</p>
      <div class="chips">${soundChips(draft.sound)}</div>
      <ul class="tips">
        <li>Turn your ringer on and the volume up.</li>
        <li>At night, open FormUp and tap <b>Start bedside mode</b>. Leave your phone on the charger.</li>
        <li>A web page can't ring when the phone is locked. For that, use the free iPhone Shortcuts trick in Settings.</li>
      </ul>`,
    cta: () => 'Sounds good',
    next: () => {
      siren.unlock();
      return true;
    },
  },
  {
    body: () => `
      <div class="onb-rhino" data-rhino="stern"></div>
      <h1>Try it once</h1>
      <p class="lead">We'll ring a practice alarm right now. Do <b>3 ${esc(getExercise(draft.exercise).name.toLowerCase())}</b> to switch it off.</p>
      <p class="hint">${esc(getExercise(draft.exercise).setup)}.</p>`,
    cta: () => 'Ring the practice alarm',
    alt: () => 'Skip for now',
    next: () => {
      siren.unlock();
      finishOnboarding();
      ring({ ...draft, reps: 3, label: 'Practice' }, { test: true });
      return false;
    },
    onAlt: () => {
      finishOnboarding();
      openMain('alarms');
    },
  },
];

function moveCards(selected: string): string {
  return ALARM_EXERCISES.map((id) => {
    const ex = getExercise(id);
    return `<button type="button" class="move ${selected === id ? 'on' : ''}" data-move="${id}"><span class="e">${ex.emoji}</span><b>${esc(ex.name)}</b></button>`;
  }).join('');
}
function soundChips(selected: SoundId): string {
  return SOUNDS.map((s) => `<button type="button" class="chip ${selected === s.id ? 'on' : ''}" data-sound="${s.id}">${esc(s.name)}</button>`).join('');
}

function renderOnb() {
  const st = STEPS[onbStep];
  $('onbBody').innerHTML = st.body();
  fillRhinos($('onbBody'));
  $('onbBar').style.width = `${((onbStep + 1) / STEPS.length) * 100}%`;
  $('onbBack').style.visibility = onbStep ? 'visible' : 'hidden';
  $('onbSkip').style.visibility = onbStep > 0 && onbStep < STEPS.length - 1 ? 'visible' : 'hidden';
  $('onbNext').textContent = st.cta();
  const alt = st.alt?.() ?? null;
  $('onbAlt').hidden = !alt;
  $('onbAlt').textContent = alt ?? '';
  updateUntil();
}
function updateUntil() {
  const el = document.getElementById('onbUntil');
  if (!el) return;
  const t = ($<HTMLInputElement>('onbTime')?.value || draft.time);
  const next = soonest([{ ...draft, time: t, on: true }]);
  el.textContent = next ? `First alarm: ${DAY_FULL[next.at.getDay()]}, ${untilLabel(next.at)}.` : 'Pick at least one day, or none for a one-off alarm.';
}
function go(n: number) {
  onbStep = Math.max(0, Math.min(STEPS.length - 1, n));
  renderOnb();
}
function finishOnboarding() {
  state.onboarded = true;
  state.sound = draft.sound;
  saveState();
  if (!alarms.length) {
    alarms = [{ ...draft, on: true, handled: Date.now() }];
    saveList();
  }
}
function startOnboarding() {
  onbStep = 0;
  show('onb');
  renderOnb();
}

$('onbNext').addEventListener('click', async () => {
  const st = STEPS[onbStep];
  const ok = st.next ? await st.next() : true;
  if (ok) go(onbStep + 1);
});
$('onbAlt').addEventListener('click', () => STEPS[onbStep].onAlt?.());
$('onbBack').addEventListener('click', () => go(onbStep - 1));
$('onbSkip').addEventListener('click', () => {
  const t = document.getElementById('onbTime') as HTMLInputElement | null;
  if (t?.value) draft.time = t.value;
  go(STEPS.length - 1);
});
$('onbBody').addEventListener('input', updateUntil);
function applySuggestion() {
  const s = suggest(state.answers);
  draft.exercise = s.exercise;
  draft.reps = s.reps;
  draft.sound = s.sound;
}

$('onbBody').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const ans = t.closest<HTMLElement>('[data-answer]');
  if (ans) {
    state.answers = { ...state.answers, [ans.dataset.answer!]: ans.dataset.v };
    saveState();
    applySuggestion();
    renderOnb();
    // Short pause so the pick is visible, then move on.
    setTimeout(() => go(onbStep + 1), 220);
    return;
  }
  const day = t.closest<HTMLElement>('[data-day]');
  const move = t.closest<HTMLElement>('[data-move]');
  const reps = t.closest<HTMLElement>('[data-reps]');
  const sound = t.closest<HTMLElement>('[data-sound]');
  const time = document.getElementById('onbTime') as HTMLInputElement | null;
  if (time?.value) draft.time = time.value;
  if (day) {
    const d = Number(day.dataset.day);
    draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort();
  } else if (move) draft.exercise = move.dataset.move as AlarmExercise;
  else if (reps) draft.reps = Number(reps.dataset.reps);
  else if (sound) {
    draft.sound = sound.dataset.sound as SoundId;
    siren.unlock();
    siren.preview(draft.sound);
  } else return;
  renderOnb();
});

/* ---------- main: alarms ---------- */

function openMain(tab: 'alarms' | 'history' | 'settings' = 'alarms') {
  show('main');
  for (const t of ['alarms', 'history', 'settings'] as const) $(`tab-${t}`).hidden = t !== tab;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'alarms') renderAlarms();
  if (tab === 'history') renderHistory();
  if (tab === 'settings') renderSettings();
}
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
  if (b) openMain(b.dataset.tab as 'alarms');
});

function renderAlarms() {
  const h = new Date().getHours();
  $('greet').textContent = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('streakPill').querySelector('b')!.textContent = String(streaks().current);
  const next = soonest(alarms);
  if (next) {
    const c = formatClock(next.at);
    $('heroLabel').textContent = 'Next alarm';
    $('heroTime').innerHTML = `${esc(c.hm)}<small>${esc(c.ampm)}</small>`;
    $('heroSub').textContent = `${untilLabel(next.at)} · ${getExercise(next.alarm.exercise).emoji} ${mission(next.alarm)}`;
  } else {
    $('heroLabel').textContent = 'No alarm on';
    $('heroTime').textContent = 'Sleep in';
    $('heroSub').textContent = 'Tap + to set one';
  }
  $('bedsideBtn').hidden = !next;
  $('alarmList').innerHTML = alarms.length
    ? alarms
        .map((a) => {
          const c = formatClock(a.time);
          return `<div class="alarm ${a.on ? '' : 'off'}" data-id="${a.id}" role="button" tabindex="0">
            <div class="alarm-main">
              <div class="alarm-time">${esc(c.hm)}<small>${esc(c.ampm)}</small></div>
              <div class="alarm-meta">${esc(daysLabel(a.days))}${a.label ? ` · ${esc(a.label)}` : ''}</div>
              <div class="alarm-move">${getExercise(a.exercise).emoji} ${esc(mission(a))}</div>
            </div>
            <button type="button" class="switch" role="switch" aria-checked="${a.on}" aria-label="Alarm on" data-toggle="${a.id}"></button>
          </div>`;
        })
        .join('')
    : `<p class="empty">No alarms yet. Tap + to add one.</p>`;
}

$('alarmList').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const tog = t.closest<HTMLElement>('[data-toggle]');
  siren.unlock();
  if (tog) {
    const a = alarms.find((x) => x.id === tog.dataset.toggle);
    if (a) {
      a.on = !a.on;
      if (a.on) a.handled = Date.now();
      saveList();
      renderAlarms();
    }
    return;
  }
  const item = t.closest<HTMLElement>('[data-id]');
  if (item) openEditor(alarms.find((x) => x.id === item.dataset.id) ?? null);
});
$('alarmList').addEventListener('keydown', (e) => {
  const item = e.target as HTMLElement;
  if (item.classList.contains('alarm') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEditor(alarms.find((x) => x.id === item.dataset.id) ?? null);
  }
});
$('addAlarm').addEventListener('click', () => openEditor(null));
$('hero').addEventListener('click', () => {
  const next = soonest(alarms);
  openEditor(next?.alarm ?? null);
});

/* ---------- editor ---------- */

let editing: Alarm | null = null;
let editingNew = false;

function drawEditor() {
  const a = editing!;
  $('edDays').innerHTML = DAY_LETTERS.map((l, i) => `<button type="button" class="chip ${a.days.includes(i) ? 'on' : ''}" data-day="${i}" aria-pressed="${a.days.includes(i)}" aria-label="${DAY_FULL[i]}">${l}</button>`).join('');
  $('edMove').innerHTML = moveCards(a.exercise);
  $('edReps').innerHTML = [5, 10, 15, 20, 30, 50].map((n) => `<button type="button" class="chip ${a.reps === n ? 'on' : ''}" data-reps="${n}">${n}</button>`).join('');
  $('edSound').innerHTML = soundChips(a.sound);
}
function openEditor(a: Alarm | null) {
  siren.unlock();
  editingNew = !a;
  editing = a ? { ...a, days: [...a.days] } : { ...newAlarm(), sound: state.sound };
  $('edTitle').textContent = editingNew ? 'New alarm' : 'Edit alarm';
  $<HTMLInputElement>('edTime').value = editing.time;
  $<HTMLInputElement>('edLabel').value = editing.label;
  $('edDelete').hidden = editingNew;
  drawEditor();
  $('editor').hidden = false;
}
const closeEditor = () => {
  $('editor').hidden = true;
  editing = null;
};
function readEditor(): Alarm {
  const a = editing!;
  a.time = $<HTMLInputElement>('edTime').value || a.time;
  a.label = $<HTMLInputElement>('edLabel').value.trim();
  return a;
}
$('editor').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === $('editor')) return closeEditor();
  if (!editing) return;
  const day = t.closest<HTMLElement>('[data-day]');
  const move = t.closest<HTMLElement>('[data-move]');
  const reps = t.closest<HTMLElement>('[data-reps]');
  const sound = t.closest<HTMLElement>('[data-sound]');
  if (day) {
    const d = Number(day.dataset.day);
    editing.days = editing.days.includes(d) ? editing.days.filter((x) => x !== d) : [...editing.days, d].sort();
  } else if (move) editing.exercise = move.dataset.move as AlarmExercise;
  else if (reps) editing.reps = Number(reps.dataset.reps);
  else if (sound) {
    editing.sound = sound.dataset.sound as SoundId;
    siren.preview(editing.sound);
  } else return;
  drawEditor();
});
$('edCancel').addEventListener('click', closeEditor);
$('edSave').addEventListener('click', () => {
  if (!editing) return;
  const a = readEditor();
  a.on = true;
  a.handled = Date.now();
  alarms = editingNew ? [...alarms, a] : alarms.map((x) => (x.id === a.id ? a : x));
  alarms.sort((x, y) => x.time.localeCompare(y.time));
  saveList();
  closeEditor();
  renderAlarms();
});
$('edDelete').addEventListener('click', () => {
  if (!editing) return;
  alarms = alarms.filter((x) => x.id !== editing!.id);
  saveList();
  closeEditor();
  renderAlarms();
});
$('edIcs').addEventListener('click', () => {
  if (!editing) return;
  const a = readEditor();
  const blob = new Blob([alarmIcs(a, wakeLink(a.id), mission(a))], { type: 'text/calendar' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'formup-alarm.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
});

/* ---------- history ---------- */

function renderHistory() {
  const real = state.history.filter((w) => !w.test);
  const done = real.filter((w) => w.outcome === 'done');
  const s = streaks();
  const avg = done.length ? done.reduce((t, w) => t + (w.end - w.at), 0) / done.length : 0;
  const tiles: [string, string][] = [
    [`🔥 ${s.current}`, 'Day streak'],
    [String(s.best), 'Best streak'],
    [String(done.length), 'Wake-ups'],
    [String(done.reduce((t, w) => t + w.reps, 0)), 'Reps done'],
    [done.length ? mmss(avg) : '–', 'Avg ring to up'],
    [String(real.length - done.length), 'Safety stops'],
  ];
  $('tiles').innerHTML = tiles.map(([b, l]) => `<div class="tile"><b>${esc(b)}</b><span>${l}</span></div>`).join('');
  const doneDays = new Set(done.map((w) => dayKey(new Date(w.at))));
  $('week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const hit = doneDays.has(dayKey(d));
    return `<div class="wday ${hit ? 'hit' : ''}"><i>${hit ? '<svg><use href="#i-check"/></svg>' : ''}</i><span>${i === 6 ? 'Today' : DAY_LETTERS[d.getDay()]}</span></div>`;
  }).join('');
  $('hist').innerHTML = real.length
    ? [...real]
        .reverse()
        .slice(0, 30)
        .map((w) => {
          const d = new Date(w.at);
          const c = formatClock(d);
          const ex = getExercise(w.exercise);
          const what = w.outcome === 'done' ? `Up in ${mmss(w.end - w.at)} · ${w.reps} ${ex.name.toLowerCase()}` : 'Stopped with the safety stop';
          return `<div class="hrow ${w.outcome}"><span class="e">${w.outcome === 'done' ? ex.emoji : '⏸️'}</span><div><b>${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(c.hm)} ${esc(c.ampm)}</b><span>${esc(what)}</span></div></div>`;
        })
        .join('')
    : `<p class="empty">Your wake-ups will show up here.</p>`;
}

/* ---------- settings ---------- */

function renderSettings() {
  $('setSound').innerHTML = soundChips(state.sound);
  $('setSafety').setAttribute('aria-checked', String(state.safety));
}
$('setSound').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sound]');
  if (!b) return;
  state.sound = b.dataset.sound as SoundId;
  saveState();
  siren.unlock();
  siren.preview(state.sound);
  renderSettings();
});
$('setSafety').addEventListener('click', () => {
  state.safety = !state.safety;
  saveState();
  renderSettings();
});
$('copyLink').addEventListener('click', async () => {
  const link = wakeLink();
  try {
    await navigator.clipboard.writeText(link);
    $('copyStatus').textContent = 'Copied. Paste it into the Open URLs action.';
  } catch {
    $('copyStatus').textContent = link;
  }
});
$('testAlarm').addEventListener('click', () => {
  siren.unlock();
  const a = alarms.find((x) => x.on) ?? alarms[0] ?? { ...newAlarm(), sound: state.sound };
  ring({ ...a, reps: 3, label: 'Test alarm' }, { test: true });
});
$('replayOnb').addEventListener('click', startOnboarding);
$('resetAll').addEventListener('click', () => {
  if (!confirm('Erase your alarms and history on this device?')) return;
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem('formup.alarms.v1');
  } catch {
    /* ignore */
  }
  state = loadState();
  alarms = [];
  startOnboarding();
});

/* ---------- bedside mode ---------- */

let bedside = false;
async function startBedside() {
  siren.unlock();
  siren.hold(true);
  bedside = true;
  show('bedside');
  tickBedside();
  const awake = await keepAwake(true);
  const checks: [boolean, string][] = [
    [awake, awake ? 'Screen stays on' : "This browser can't keep the screen on. Set Auto-Lock to Never tonight."],
    [siren.unlocked, siren.unlocked ? 'Sound is on' : 'Tap the screen once to turn sound on'],
    [true, 'Leave FormUp open, plug in, ringer up'],
  ];
  $('bedChecks').innerHTML = checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} ${esc(t)}</li>`).join('');
}
function stopBedside() {
  if (!bedside) return;
  bedside = false;
  siren.hold(false);
  void keepAwake(false);
}
function tickBedside() {
  const now = new Date();
  $('bedClock').textContent = formatClock(now).hm;
  $('bedDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const next = soonest(alarms, now);
  $('bedNext').textContent = next ? `⏰ ${formatClock(next.at).hm} ${formatClock(next.at).ampm} · ${mission(next.alarm)}` : 'No alarm on';
}
$('bedsideBtn').addEventListener('click', () => void startBedside());
$('bedExit').addEventListener('click', () => {
  stopBedside();
  openMain('alarms');
});
$('bedside').addEventListener('click', () => siren.unlock());

/* ---------- ringing ---------- */

interface Ringing {
  alarm: Alarm;
  at: number;
  test: boolean;
}
let ringing: Ringing | null = null;
let buzzTimer = 0;
let titleTimer = 0;
const baseTitle = document.title;

function ring(a: Alarm, opts: { test?: boolean } = {}) {
  ringing = { alarm: a, at: Date.now(), test: !!opts.test };
  $('editor').hidden = true;
  const c = formatClock(new Date());
  $('ringTime').innerHTML = `${esc(c.hm)}<small>${esc(c.ampm)}</small>`;
  $('ringLabel').textContent = a.label;
  $('ringTitle').textContent = RING_TITLES[Math.floor(Math.random() * RING_TITLES.length)];
  $('ringTask').textContent = `${mission(a)} to switch me off.`;
  $('ringGo').textContent = siren.unlocked ? `Start ${getExercise(a.exercise).name.toLowerCase()}` : 'Tap to start';
  $('ringBail').hidden = !state.safety;
  show('ringing');
  if (siren.unlocked) siren.start(a.sound);
  void keepAwake(true);
  clearInterval(buzzTimer);
  buzzTimer = window.setInterval(() => buzz([400, 200, 400]), 2000);
  clearInterval(titleTimer);
  let flip = false;
  titleTimer = window.setInterval(() => (document.title = (flip = !flip) ? '⏰ WAKE UP!' : baseTitle), 800);
}
function stopRingEffects() {
  clearInterval(buzzTimer);
  clearInterval(titleTimer);
  document.title = baseTitle;
  buzz(0);
}

$('ringGo').addEventListener('click', () => {
  if (!ringing) return;
  siren.unlock();
  if (!siren.playing) siren.start(ringing.alarm.sound);
  say('');
  stopRingEffects();
  void startCam();
});

/* ---------- reps on camera ---------- */

const stage = new Stage($<HTMLVideoElement>('video'), $<HTMLCanvasElement>('stage'));
let counter: RepCounter | null = null;
let repState: RepState | null = null;
let greeted = false;
let finishing = false;
let lastNudge = 0;

async function startCam() {
  const r = ringing!;
  const ex = getExercise(r.alarm.exercise);
  if (ex.kind !== 'reps') return;
  show('cam');
  $('camBail').hidden = !state.safety;
  $('frameHow').textContent = `${ex.setup}. Counting starts when Tank can see you.`;
  $('frameCard').hidden = true;
  $('camLoading').hidden = false;
  counter = null;
  repState = null;
  greeted = false;
  finishing = false;
  try {
    await stage.start('user', (t) => ($('camLoadingText').textContent = t));
  } catch (e) {
    $('camLoadingText').textContent = (e as Error).message;
    return;
  }
  $('camLoading').hidden = true;
  counter = new RepCounter(ex, r.alarm.reps);
  repState = counter.state(Date.now());
  lastNudge = Date.now();
  say(`${mission(r.alarm)}. Go!`);
}

stage.onFrame = (pose, now, aspect) => {
  if (!counter || !ringing || finishing) return;
  const rep = counter.update(pose, now, aspect);
  repState = counter.state(now);
  const setup = repState.phase === 'setup';
  $('frameCard').hidden = !(setup && repState.reps === 0 && !pose);
  if (!setup && !greeted) {
    greeted = true;
    say(`I see you. ${repState.cue.text}.`);
  }
  if (setup && now - lastNudge > 8000) {
    lastNudge = now;
    say('Step back so your whole body is in view');
  }
  if (rep) {
    if (rep.counted) {
      buzz(40);
      if (rep.quality === 'good') stage.flashUntil = now + 600;
      const n = repState.reps;
      say(NUMBER_WORDS[n] ?? String(n));
    } else {
      buzz([40, 40, 40]);
      say(counter.exercise.shallowCue);
    }
  }
  siren.setCalm(repState.reps / repState.target);
  if (repState.done) void finish('done');
};

stage.drawHud = (ctx: CanvasRenderingContext2D, v: View, now: number) => {
  if (!repState || !counter) return;
  const u = v.u;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h * 0.17;
  const r = u * 15;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ringArc(ctx, cx, cy, r, repState.reps / repState.target, now < stage.flashUntil ? COLORS.good : COLORS.brand, u * 2.4);
  pill(ctx, String(repState.target - repState.reps), cx, cy - u * 1.5, u * 13, null, 0, 900);
  pill(ctx, 'TO GO', cx, cy + u * 7, u * 3.2, null, 0, 800);
  pill(ctx, counter.exercise.name.toUpperCase(), cx, cy + r + u * 6, u * 3.6, 'rgba(0,0,0,0.5)', u * 1.6);
  if ($('frameCard').hidden) {
    const cue = repState.cue;
    const bg = cue.tone === 'good' ? COLORS.good : cue.tone === 'warn' ? COLORS.warn : COLORS.info;
    pill(ctx, cue.text, cx, v.y + v.h * 0.78, u * 5.2, bg, u * 2.4);
  }
};

async function finish(outcome: 'done' | 'stopped') {
  const r = ringing;
  if (!r || finishing) return;
  finishing = true;
  siren.stop();
  stopRingEffects();
  stage.stop();
  stopBedside();
  void keepAwake(false);
  const end = Date.now();
  const reps = repState?.reps ?? 0;
  state.history.push({ at: r.at, end, exercise: r.alarm.exercise, reps, outcome, test: r.test || undefined });
  saveState();
  ringing = null;
  counter = null;
  if (outcome === 'stopped') {
    say('');
    openMain('alarms');
    return;
  }
  const s = streaks();
  $('winTitle').textContent = r.test ? 'That’s how it works!' : "You're up!";
  $('winSub').textContent = r.test ? 'Practice done. The real alarm works exactly like this.' : 'Alarm off. Go win the day.';
  $('winTime').textContent = mmss(end - r.at);
  $('winReps').textContent = String(reps);
  $('winStreak').textContent = String(s.current);
  $('confetti').innerHTML = Array.from({ length: 28 }, (_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${(i % 7) * 0.12}s;background:${['#FF6B2C', '#FFC93C', '#33BF66', '#5AC8FA'][i % 4]}"></i>`).join('');
  show('win');
  buzz([80, 60, 160]);
  say(r.test ? 'Nice! That is how it works.' : "You're up! Alarm off.");
}
$('winDone').addEventListener('click', () => openMain('alarms'));

/* Hold-to-stop safety buttons. */
function holdButton(btn: HTMLElement, ms: number, done: () => void) {
  const fill = btn.querySelector('i') as HTMLElement;
  let start = 0;
  let raf = 0;
  const reset = () => {
    cancelAnimationFrame(raf);
    fill.style.width = '0';
  };
  const frame = () => {
    const f = (performance.now() - start) / ms;
    fill.style.width = `${Math.min(100, f * 100)}%`;
    if (f >= 1) {
      reset();
      done();
    } else raf = requestAnimationFrame(frame);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    start = performance.now();
    raf = requestAnimationFrame(frame);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, reset);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('ringBail'), 10_000, () => void finish('stopped'));
holdButton($('camBail'), 10_000, () => void finish('stopped'));

/* ---------- scheduler ---------- */

function check() {
  if (ringing || !state.onboarded) return;
  const d = due(alarms);
  if (!d) return;
  alarms = alarms.map((x) => (x.id === d.alarm.id ? { ...x, handled: d.at.getTime(), on: x.days.length ? x.on : false } : x));
  saveList();
  ring(d.alarm);
}
setInterval(() => {
  check();
  if (bedside) tickBedside();
  else if (!$('main').hidden && !$('tab-alarms').hidden) {
    // Keep "in 7 h 12 min" fresh.
    if (new Date().getSeconds() === 0) renderAlarms();
  }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') check();
});
window.addEventListener('storage', (e) => {
  if (e.key === 'formup.alarms.v1') {
    alarms = loadAlarms();
    if (!$('main').hidden) renderAlarms();
  }
});

/* ---------- boot ---------- */

fillRhinos();
const params = new URLSearchParams(location.search);
const wakeId = params.get('wake');
if (wakeId) {
  // Opened from an iPhone Shortcuts automation or a calendar reminder.
  params.delete('wake');
  const q = params.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
  state.onboarded = true;
  saveState();
  ring(alarms.find((x) => x.id === wakeId) ?? alarms.find((x) => x.on) ?? { ...newAlarm(), sound: state.sound });
} else {
  show('splash');
  setTimeout(() => {
    if (ringing) return;
    if (state.onboarded) openMain('alarms');
    else startOnboarding();
  }, 1400);
}
getLandmarker().catch(() => undefined);
