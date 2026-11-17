/**
 * Alarm tab, editor, bedside mode and the ringing screen.
 * The wake-up set itself runs through the normal lesson flow in main.ts.
 */
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
  nextRing,
  saveAlarms,
  siren,
  soonest,
  untilLabel,
  type Alarm,
} from './alarm';
import type { Lesson } from './course';
import { rhino } from './rhino';

export interface AlarmRun {
  alarm: Alarm;
}

type View = 'learn' | 'progress' | 'alarm' | 'bedside' | 'ringing' | 'workout' | 'quiz' | 'result';

interface Hooks {
  show: (view: View) => void;
  /** True while a lesson or alarm set is running. */
  busy: () => boolean;
  start: (lesson: Lesson, alarm: AlarmRun) => void;
  quit: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TITLES = ["Up and at 'em!", 'Rise and stomp!', 'Tank says: UP!', 'Morning, legend!'];

function missionText(a: Pick<Alarm, 'exercise' | 'reps'>): string {
  const ex = getExercise(a.exercise);
  return `${a.reps} ${ex.name.toLowerCase()}`;
}

function wakeLink(id?: string): string {
  return `${location.origin}${location.pathname}?wake=${id ?? '1'}`;
}

/** Press-and-hold button: calls `done` after `ms` of continuous holding. */
function holdButton(btn: HTMLElement, ms: number, done: () => void) {
  const fill = btn.querySelector('i') as HTMLElement;
  let start = 0;
  let raf = 0;
  const reset = () => {
    cancelAnimationFrame(raf);
    start = 0;
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

export function initAlarms(h: Hooks) {
  let list = loadAlarms();
  let editing: Alarm | null = null;
  let isNew = false;
  let bedside = false;
  let ringing: Alarm | null = null;
  let buzzTimer = 0;
  let titleTimer = 0;
  const baseTitle = document.title;

  const persist = () => saveAlarms(list);

  /* ---------- alarm tab ---------- */

  function render() {
    const next = soonest(list);
    $('nextLabel').textContent = next ? 'Next alarm' : 'No alarm on';
    if (next) {
      const c = formatClock(next.at);
      const today = new Date().toDateString() === next.at.toDateString();
      const tomorrow = new Date(Date.now() + 86_400_000).toDateString() === next.at.toDateString();
      const day = today ? 'Today' : tomorrow ? 'Tomorrow' : DAY_FULL[next.at.getDay()];
      $('nextTime').textContent = `${c.hm} ${c.ampm}`.trim();
      $('nextSub').textContent = `${day}, ${untilLabel(next.at)} · ${missionText(next.alarm)}`;
    } else {
      $('nextTime').textContent = 'Sleep in?';
      $('nextSub').textContent = list.length ? 'Switch an alarm on and Tank will get you up.' : 'Set an alarm and Tank makes sure you get up.';
    }
    $('bedsideBtn').hidden = !next;
    $('alarmList').innerHTML = list.length
      ? list
          .map((a) => {
            const c = formatClock(a.time);
            const ex = getExercise(a.exercise);
            return `<div class="alarm-item ${a.on ? '' : 'off'}" data-id="${a.id}" role="button" tabindex="0" aria-label="Edit alarm ${esc(c.hm + ' ' + c.ampm)}">
              <div class="meta">
                <div class="t">${esc(c.hm)}<small>${esc(c.ampm)}</small></div>
                <b>${ex.emoji} ${esc(missionText(a))}</b>
                <span>${esc(daysLabel(a.days))}${a.label ? ` · ${esc(a.label)}` : ''}</span>
              </div>
              <button type="button" class="switch" role="switch" aria-checked="${a.on}" aria-label="Alarm on" data-toggle="${a.id}"></button>
            </div>`;
          })
          .join('')
      : `<p class="empty-alarms">No alarms yet.</p>`;
  }

  $('alarmList').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const toggle = t.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      siren.unlock();
      const a = list.find((x) => x.id === toggle.dataset.toggle);
      if (a) {
        a.on = !a.on;
        // Switching on never rings for a time that has already passed.
        if (a.on) a.handled = Date.now();
        persist();
        render();
      }
      return;
    }
    const item = t.closest<HTMLElement>('[data-id]');
    if (item) openEditor(list.find((x) => x.id === item.dataset.id) ?? null);
  });
  $('alarmList').addEventListener('keydown', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.alarm-item');
    if (item && (e.key === 'Enter' || e.key === ' ') && e.target === item) {
      e.preventDefault();
      openEditor(list.find((x) => x.id === item.dataset.id) ?? null);
    }
  });
  $('addAlarm').addEventListener('click', () => openEditor(null));
  $('testAlarm').addEventListener('click', () => {
    siren.unlock();
    const a = list.find((x) => x.on) ?? list[0] ?? newAlarm();
    ring({ ...a, reps: Math.min(a.reps, 5), label: 'Test alarm' }, true);
  });
  $('copyLink').addEventListener('click', async () => {
    const link = wakeLink();
    try {
      await navigator.clipboard.writeText(link);
      $('copyStatus').textContent = 'Copied! Paste it into the Open URLs action.';
    } catch {
      $('copyStatus').textContent = link;
    }
  });

  /* ---------- editor ---------- */

  function draw() {
    const a = editing!;
    $('alarmDays').innerHTML = DAY_LETTERS.map(
      (l, i) => `<button type="button" class="chip ${a.days.includes(i) ? 'on' : ''}" data-day="${i}" aria-pressed="${a.days.includes(i)}" aria-label="${DAY_FULL[i]}">${l}</button>`,
    ).join('');
    $('alarmExercise').innerHTML = ALARM_EXERCISES.map((id) => {
      const ex = getExercise(id);
      return `<button type="button" class="chip ${a.exercise === id ? 'on' : ''}" data-ex="${id}">${ex.emoji} ${esc(ex.name)}</button>`;
    }).join('');
    $('alarmSound').innerHTML = SOUNDS.map(
      (s) => `<button type="button" class="chip ${a.sound === s.id ? 'on' : ''}" data-sound="${s.id}">${esc(s.name)}</button>`,
    ).join('');
    $('alarmReps').textContent = String(a.reps);
  }

  function openEditor(a: Alarm | null) {
    siren.unlock();
    isNew = !a;
    editing = a ? { ...a, days: [...a.days] } : newAlarm();
    $('alarmSheetTitle').textContent = isNew ? 'New alarm' : 'Edit alarm';
    $<HTMLInputElement>('alarmTime').value = editing.time;
    $<HTMLInputElement>('alarmLabel').value = editing.label;
    $('alarmDelete').hidden = isNew;
    draw();
    $('alarmSheet').hidden = false;
  }
  const closeEditor = () => {
    $('alarmSheet').hidden = true;
    editing = null;
  };

  $('alarmDays').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (!b || !editing) return;
    const d = Number(b.dataset.day);
    editing.days = editing.days.includes(d) ? editing.days.filter((x) => x !== d) : [...editing.days, d].sort();
    draw();
  });
  $('alarmExercise').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ex]');
    if (!b || !editing) return;
    editing.exercise = b.dataset.ex as Alarm['exercise'];
    draw();
  });
  $('alarmSound').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sound]');
    if (!b || !editing) return;
    editing.sound = b.dataset.sound as Alarm['sound'];
    siren.unlock();
    siren.preview(editing.sound);
    draw();
  });
  const step = (d: number) => {
    if (!editing) return;
    editing.reps = Math.max(5, Math.min(50, editing.reps + d));
    draw();
  };
  $('repsMinus').addEventListener('click', () => step(-5));
  $('repsPlus').addEventListener('click', () => step(5));

  function readForm(): Alarm {
    const a = editing!;
    a.time = $<HTMLInputElement>('alarmTime').value || a.time;
    a.label = $<HTMLInputElement>('alarmLabel').value.trim();
    return a;
  }

  $('alarmSave').addEventListener('click', () => {
    if (!editing) return;
    const a = readForm();
    a.on = true;
    a.handled = Date.now();
    list = isNew ? [...list, a] : list.map((x) => (x.id === a.id ? a : x));
    list.sort((x, y) => x.time.localeCompare(y.time));
    persist();
    closeEditor();
    render();
  });
  $('alarmDelete').addEventListener('click', () => {
    if (!editing) return;
    list = list.filter((x) => x.id !== editing!.id);
    persist();
    closeEditor();
    render();
  });
  $('alarmIcs').addEventListener('click', () => {
    if (!editing) return;
    const a = readForm();
    const blob = new Blob([alarmIcs(a, wakeLink(a.id), missionText(a))], { type: 'text/calendar' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'formup-alarm.ics';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  });
  $('alarmCancel').addEventListener('click', closeEditor);
  $('alarmSheet').addEventListener('click', (e) => {
    if (e.target === $('alarmSheet')) closeEditor();
  });

  /* ---------- bedside mode ---------- */

  async function startBedside() {
    siren.unlock();
    siren.hold(true);
    bedside = true;
    h.show('bedside');
    tickBedside();
    const awake = await keepAwake(true);
    const checks: [boolean, string][] = [
      [awake, awake ? 'Screen will stay on' : "This browser can't keep the screen on. Set Auto-Lock to Never tonight."],
      [siren.unlocked, siren.unlocked ? 'Sound is ready' : 'Tap the screen once so the alarm can play sound'],
      [true, 'Keep FormUp open, plug in your phone, and turn the ringer up'],
    ];
    $('bedChecks').innerHTML = checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} ${esc(t)}</li>`).join('');
  }
  function stopBedside() {
    bedside = false;
    siren.hold(false);
    void keepAwake(false);
  }
  function tickBedside() {
    const now = new Date();
    const c = formatClock(now);
    $('bedClock').textContent = c.hm;
    $('bedDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const next = soonest(list, now);
    if (next) {
      const nc = formatClock(next.at);
      $('bedNext').textContent = `⏰ ${nc.hm} ${nc.ampm} · ${missionText(next.alarm)}`;
    } else $('bedNext').textContent = 'No alarm on';
  }
  $('bedsideBtn').addEventListener('click', () => void startBedside());
  $('bedExit').addEventListener('click', () => {
    stopBedside();
    open();
  });
  $('bedside').addEventListener('click', () => siren.unlock());

  /* ---------- ringing ---------- */

  function ring(a: Alarm, test = false) {
    ringing = a;
    const c = formatClock(new Date());
    $('ringTime').textContent = c.hm;
    $('ringTitle').textContent = TITLES[Math.floor(Math.random() * TITLES.length)];
    const ex = getExercise(a.exercise);
    $('ringTask').textContent = `${a.label && !test ? `${a.label}. ` : ''}${missionText(a)} and Tank stops stomping.`;
    $('ringGo').textContent = siren.unlocked ? `Start ${ex.name.toLowerCase()}` : `Tap to start ${ex.name.toLowerCase()}`;
    $('ringing').querySelector<HTMLElement>('[data-rhino]')!.innerHTML = rhino('stern');
    h.show('ringing');
    if (siren.unlocked) siren.start(a.sound);
    void keepAwake(true);
    clearInterval(buzzTimer);
    buzzTimer = window.setInterval(() => navigator.vibrate?.([400, 200, 400]), 2000);
    clearInterval(titleTimer);
    let flip = false;
    titleTimer = window.setInterval(() => (document.title = (flip = !flip) ? '⏰ WAKE UP!' : baseTitle), 800);
  }

  function stopRingEffects() {
    clearInterval(buzzTimer);
    clearInterval(titleTimer);
    document.title = baseTitle;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
  }

  $('ringGo').addEventListener('click', () => {
    if (!ringing) return;
    const a = ringing;
    siren.unlock();
    if (!siren.playing) siren.start(a.sound);
    stopRingEffects();
    const lesson: Lesson = {
      id: 'alarm',
      title: 'Wake-up alarm',
      format: 'Rep Set',
      emoji: '⏰',
      xp: 20,
      steps: [{ kind: 'reps', exercise: a.exercise, reps: a.reps }],
    };
    h.start(lesson, { alarm: a });
  });

  function bail() {
    siren.stop();
    stopRingEffects();
    stopBedside();
    ringing = null;
    if (h.busy()) h.quit();
    open();
  }
  holdButton($('ringBail'), 10_000, bail);
  holdButton($('workBail'), 10_000, bail);

  /* ---------- scheduler ---------- */

  function check() {
    if (ringing || h.busy()) return;
    const d = due(list);
    if (!d) return;
    // Mark it handled first, so it rings once. One-off alarms switch off.
    list = list.map((x) => (x.id === d.alarm.id ? { ...x, handled: d.at.getTime(), on: x.days.length ? x.on : false } : x));
    persist();
    if (!$('alarmSheet').hidden) $('alarmSheet').hidden = true;
    ring(d.alarm);
  }
  setInterval(() => {
    check();
    if (bedside) tickBedside();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  // Other tabs editing alarms.
  window.addEventListener('storage', (e) => {
    if (e.key === 'formup.alarms.v1') {
      list = loadAlarms();
      render();
    }
  });

  function open() {
    ringing = null;
    if (bedside) stopBedside();
    stopRingEffects();
    render();
    h.show('alarm');
  }

  return {
    open,
    /** Handles ?wake= links (from a Shortcuts automation or calendar). Returns true if it took over. */
    boot(): boolean {
      const params = new URLSearchParams(location.search);
      const id = params.get('wake');
      if (!id) return false;
      params.delete('wake');
      const q = params.toString();
      history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
      const a = list.find((x) => x.id === id) ?? list.find((x) => x.on) ?? newAlarm();
      ring(a);
      return true;
    },
    /** Exposed for tests and debugging. */
    nextRing: (a: Alarm) => nextRing(a),
  };
}
