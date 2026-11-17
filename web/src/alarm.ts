/**
 * Wake-up alarms: the schedule, the sound and the browser plumbing.
 *
 * Honest limits (see the research doc): a web page cannot ring while the phone
 * is locked or the tab is closed. Alarms ring while FormUp is open on screen
 * ("bedside mode" keeps the screen awake). If the ring time passed while the
 * page was hidden, the alarm rings as soon as the page is visible again.
 */

export type SoundId = 'stampede' | 'beeper' | 'horn';
export const SOUNDS: { id: SoundId; name: string }[] = [
  { id: 'stampede', name: 'Stampede' },
  { id: 'beeper', name: 'Beeper' },
  { id: 'horn', name: 'Rhino horn' },
];

/** Exercises an alarm can ask for: ones the camera counts well from a phone on the floor. */
export const ALARM_EXERCISES = ['squat', 'jacks', 'highknees', 'lunge', 'pushup'] as const;
export type AlarmExercise = (typeof ALARM_EXERCISES)[number];

export interface Alarm {
  id: string;
  /** "HH:MM", 24 h, local time. */
  time: string;
  /** Days it repeats, 0 = Sunday. Empty means once. */
  days: number[];
  exercise: AlarmExercise;
  reps: number;
  sound: SoundId;
  label: string;
  on: boolean;
  /** Epoch ms of the last ring handled (rang, or skipped because it was switched on later). */
  handled: number;
}

const KEY = 'formup.alarms.v1';
/** A ring missed while the page was hidden still fires if we notice within this window. */
export const CATCH_UP_MS = 3 * 60 * 60 * 1000;

export function loadAlarms(): Alarm[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Alarm[];
  } catch {
    /* private mode or corrupted */
  }
  return [];
}

export function saveAlarms(list: Alarm[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: alarms live only for this visit */
  }
}

export function newAlarm(): Alarm {
  return {
    id: Math.random().toString(36).slice(2, 9),
    time: '07:00',
    days: [1, 2, 3, 4, 5],
    exercise: 'squat',
    reps: 15,
    sound: 'stampede',
    label: '',
    on: true,
    handled: Date.now(),
  };
}

function at(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Next time this alarm rings strictly after `from`, or null if it never will. */
export function nextRing(a: Alarm, from = new Date()): Date | null {
  if (!a.on) return null;
  for (let i = 0; i <= 7; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    const t = at(day, a.time);
    if (t <= from) continue;
    if (a.days.length === 0 || a.days.includes(t.getDay())) return t;
  }
  return null;
}

/** Most recent scheduled ring at or before `now` (within the last 8 days). */
export function lastRing(a: Alarm, now = new Date()): Date | null {
  for (let i = 0; i <= 8; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const t = at(day, a.time);
    if (t > now) continue;
    if (a.days.length === 0 || a.days.includes(t.getDay())) return t;
  }
  return null;
}

/** The alarm that should be ringing now, if any. */
export function due(list: Alarm[], now = new Date()): { alarm: Alarm; at: Date } | null {
  for (const a of list) {
    if (!a.on) continue;
    const t = lastRing(a, now);
    if (t && t.getTime() > a.handled && now.getTime() - t.getTime() < CATCH_UP_MS) return { alarm: a, at: t };
  }
  return null;
}

export function soonest(list: Alarm[], from = new Date()): { alarm: Alarm; at: Date } | null {
  let best: { alarm: Alarm; at: Date } | null = null;
  for (const a of list) {
    const t = nextRing(a, from);
    if (t && (!best || t < best.at)) best = { alarm: a, at: t };
  }
  return best;
}

export function formatClock(time: string | Date): { hm: string; ampm: string } {
  const d = typeof time === 'string' ? at(new Date(), time) : time;
  const s = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const m = s.match(/^(.*?)\s?([AaPp]\.?[Mm]\.?)$/);
  return m ? { hm: m[1], ampm: m[2].toUpperCase() } : { hm: s, ampm: '' };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function daysLabel(days: number[]): string {
  const set = [...days].sort();
  if (set.length === 0) return 'Once';
  if (set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  return set.map((d) => DAY_NAMES[d]).join(' ');
}

export function untilLabel(t: Date, now = new Date()): string {
  const mins = Math.max(1, Math.round((t.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `in ${m} min`;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/* ---------- calendar file (a free way to get a reminder on a locked phone) ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
const icsDate = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function alarmIcs(a: Alarm, link: string, exerciseLabel: string): string {
  const start = nextRing({ ...a, on: true }) ?? new Date();
  const end = new Date(start.getTime() + 5 * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FormUp//Wake-up alarm//EN',
    'BEGIN:VEVENT',
    `UID:formup-alarm-${a.id}@formup`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    ...(a.days.length ? [`RRULE:FREQ=WEEKLY;BYDAY=${a.days.map((d) => ICS_DAYS[d]).join(',')}`] : []),
    `SUMMARY:⏰ FormUp: ${exerciseLabel}`,
    `DESCRIPTION:Tank says get up! Open FormUp and do ${exerciseLabel} to start your day: ${link}`,
    `URL:${link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Time to move with FormUp',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/* ---------- screen wake lock ---------- */

let lock: WakeLockSentinel | null = null;
let wantLock = false;

/** Keeps the screen on while the page is visible. Returns false if the browser can't. */
export async function keepAwake(on: boolean): Promise<boolean> {
  wantLock = on;
  if (!on) {
    await lock?.release().catch(() => undefined);
    lock = null;
    return true;
  }
  if (!('wakeLock' in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
    return true;
  } catch {
    return false;
  }
}
document.addEventListener('visibilitychange', () => {
  // The browser drops the lock when the page is hidden; take it back on return.
  if (document.visibilityState === 'visible' && wantLock && !lock) void keepAwake(true);
});

/* ---------- the alarm sound: synthesised here, so it is FormUp's own ---------- */

type Ctx = AudioContext;

function thump(ctx: Ctx, out: AudioNode, t: number, gain = 1) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
}

function beep(ctx: Ctx, out: AudioNode, t: number, freq: number, len: number, type: OscillatorType = 'square', gain = 0.35) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.setValueAtTime(gain, t + len - 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}

function horn(ctx: Ctx, out: AudioNode, t: number, len: number, from: number, to: number) {
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o1.type = 'sawtooth';
  o2.type = 'sawtooth';
  o1.frequency.setValueAtTime(from, t);
  o1.frequency.exponentialRampToValueAtTime(to, t + len * 0.6);
  o2.frequency.setValueAtTime(from * 1.505, t);
  o2.frequency.exponentialRampToValueAtTime(to * 1.505, t + len * 0.6);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900, t);
  f.frequency.linearRampToValueAtTime(2400, t + len * 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.06);
  g.gain.setValueAtTime(0.32, t + len - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o1.connect(f);
  o2.connect(f);
  f.connect(g).connect(out);
  o1.start(t);
  o2.start(t);
  o1.stop(t + len + 0.05);
  o2.stop(t + len + 0.05);
}

/** One bar of each sound; returns the bar length in seconds. `heat` (0..1) makes it busier. */
const BARS: Record<SoundId, (ctx: Ctx, out: AudioNode, t: number, heat: number) => number> = {
  stampede(ctx, out, t, heat) {
    const n = heat > 0.5 ? 8 : 4;
    const step = 0.2;
    for (let i = 0; i < n; i++) thump(ctx, out, t + i * step, i % 4 === 0 ? 1 : 0.7);
    beep(ctx, out, t + n * step, 784, 0.12, 'triangle', 0.25);
    beep(ctx, out, t + n * step + 0.14, 1046, 0.18, 'triangle', 0.25);
    return n * step + 0.6;
  },
  beeper(ctx, out, t, heat) {
    const n = heat > 0.5 ? 6 : 4;
    for (let i = 0; i < n; i++) beep(ctx, out, t + i * 0.16, i % 2 ? 1175 : 880, 0.1);
    return n * 0.16 + 0.5;
  },
  horn(ctx, out, t, heat) {
    horn(ctx, out, t, 0.7, 196, 294);
    if (heat > 0.4) horn(ctx, out, t + 0.8, 0.45, 220, 330);
    thump(ctx, out, t + 0.05, 0.8);
    return heat > 0.4 ? 1.6 : 1.3;
  },
};

class Siren {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private keepAlive: OscillatorNode | null = null;
  private timer = 0;
  private nextBar = 0;
  private startedAt = 0;
  private sound: SoundId = 'stampede';
  /** 0..1 from reps progress: the alarm calms down as you work. */
  private calm = 0;
  playing = false;

  /** Must be called from a tap: browsers only allow sound after one. */
  unlock(): void {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      // Safari: play like media, so the ring/silent switch does not mute it where supported.
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    // A short silent blip completes the unlock on iOS.
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.05);
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** A near-silent tone that keeps the tab "playing audio", so desktop and Android browsers don't throttle it. */
  hold(on: boolean): void {
    if (!this.ctx) return;
    if (on && !this.keepAlive) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = 30;
      g.gain.value = 0.0005;
      o.connect(g).connect(this.ctx.destination);
      o.start();
      this.keepAlive = o;
    } else if (!on && this.keepAlive) {
      this.keepAlive.stop();
      this.keepAlive = null;
    }
  }

  start(sound: SoundId): void {
    if (!this.ctx || !this.master) return;
    void this.ctx.resume();
    this.stop();
    this.sound = sound;
    this.playing = true;
    this.calm = 0;
    this.startedAt = this.ctx.currentTime;
    this.nextBar = this.ctx.currentTime + 0.05;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  /** Short sample for the sound picker. */
  preview(sound: SoundId): void {
    if (!this.ctx || !this.master) return;
    void this.ctx.resume();
    if (this.playing) return;
    const t = this.ctx.currentTime + 0.05;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.6, t);
    const len = BARS[sound](this.ctx, this.master, t, 0);
    this.master.gain.setValueAtTime(0, t + len + 0.1);
  }

  setCalm(frac: number): void {
    this.calm = Math.max(0, Math.min(1, frac));
  }

  private tick() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') void ctx.resume();
    const age = ctx.currentTime - this.startedAt;
    // Starts firm, gets louder over 30 s, then eases off as reps are done.
    const ramp = Math.min(1, 0.45 + age / 55);
    const level = ramp * (1 - 0.75 * this.calm);
    this.master!.gain.setTargetAtTime(level, ctx.currentTime, 0.3);
    while (this.nextBar < ctx.currentTime + 0.4) {
      const heat = Math.min(1, age / 30) * (1 - this.calm);
      this.nextBar += BARS[this.sound](ctx, this.master!, this.nextBar, heat);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.playing = false;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }
}

export const siren = new Siren();
