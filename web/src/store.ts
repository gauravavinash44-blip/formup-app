/**
 * Everything FormUp remembers, kept in this browser's localStorage.
 * No account and no server yet: clearing site data starts fresh.
 */

export interface SessionRecord {
  date: string; // YYYY-MM-DD, local time
  lessonId: string;
  xp: number;
  reps: number;
  goodReps: number;
  holdMs: number;
  /** 0..1 share of good form across the lesson. */
  form: number;
  penalty?: boolean;
}

export interface Profile {
  version: 1;
  xp: number;
  streak: number;
  bestStreak: number;
  lastActive: string | null;
  completed: string[];
  history: SessionRecord[];
  badges: string[];
  clips: number;
  /** Day the last penalty set was cleared, so it is asked once. */
  penaltyPaidFor: string | null;
}

const KEY = 'formup.profile.v1';

/** Penalty: extra squats per missed day, and how many missed days can be paid off. */
export const PENALTY = { squatsPerDay: 10, maxDays: 3 } as const;

const empty = (): Profile => ({
  version: 1,
  xp: 0,
  streak: 0,
  bestStreak: 0,
  lastActive: null,
  completed: [],
  history: [],
  badges: [],
  clips: 0,
  penaltyPaidFor: null,
});

export function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...(JSON.parse(raw) as Profile) };
  } catch {
    /* private mode or corrupted: start fresh */
  }
  return empty();
}

export function save(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: progress lives only for this visit */
  }
}

export function reset(): Profile {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return empty();
}

/* ---------- dates ---------- */

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  const pa = new Date(`${a}T12:00:00`);
  const pb = new Date(`${b}T12:00:00`);
  return Math.round((pb.getTime() - pa.getTime()) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/* ---------- streak + penalty ---------- */

export interface StreakInfo {
  /** Streak to show right now. */
  streak: number;
  doneToday: boolean;
  /** Days missed since the last workout (0 if none). */
  missed: number;
  /** Squats owed to keep the streak, 0 if nothing owed. */
  penaltyReps: number;
}

export function streakInfo(p: Profile, today = dayKey()): StreakInfo {
  if (!p.lastActive) return { streak: 0, doneToday: false, missed: 0, penaltyReps: 0 };
  const gap = daysBetween(p.lastActive, today);
  const doneToday = gap === 0;
  const missed = Math.max(0, gap - 1);
  if (missed === 0) return { streak: p.streak, doneToday, missed, penaltyReps: 0 };
  // Missed a few days: the streak is kept if the penalty set is done first.
  if (missed <= PENALTY.maxDays && p.streak > 0 && p.penaltyPaidFor !== today) {
    return { streak: p.streak, doneToday, missed, penaltyReps: missed * PENALTY.squatsPerDay };
  }
  return { streak: p.penaltyPaidFor === today ? p.streak : 0, doneToday, missed, penaltyReps: 0 };
}

/** Pay the penalty: the streak is kept as if yesterday was a workout day. */
export function payPenalty(p: Profile, rec: SessionRecord, today = dayKey()): Profile {
  return {
    ...p,
    lastActive: addDays(today, -1),
    penaltyPaidFor: today,
    history: [...p.history, { ...rec, penalty: true }],
  };
}

/** Record a finished lesson: XP, streak, completion. */
export function recordLesson(p: Profile, rec: SessionRecord, today = dayKey()): Profile {
  const info = streakInfo(p, today);
  let streak: number;
  if (info.doneToday) streak = p.streak;
  else if (p.lastActive && (info.missed === 0 || p.penaltyPaidFor === today)) streak = p.streak + 1;
  else streak = 1;
  const completed = p.completed.includes(rec.lessonId) ? p.completed : [...p.completed, rec.lessonId];
  return {
    ...p,
    xp: p.xp + rec.xp,
    streak,
    bestStreak: Math.max(p.bestStreak, streak),
    lastActive: today,
    completed,
    history: [...p.history, rec],
  };
}

/** Extra reps unlocked by the streak: +1 every 3 days, up to +5. */
export function streakBonus(streak: number): number {
  return Math.min(5, Math.floor(streak / 3));
}

/* ---------- badges ---------- */

export interface Badge {
  id: string;
  emoji: string;
  name: string;
  how: string;
  earned: (p: Profile) => boolean;
}

const totalReps = (p: Profile) => p.history.reduce((a, h) => a + h.reps, 0);

export const BADGES: Badge[] = [
  { id: 'first', emoji: '🌱', name: 'First step', how: 'Finish your first lesson', earned: (p) => p.history.some((h) => !h.penalty) },
  { id: 'streak3', emoji: '🔥', name: 'On fire', how: 'Reach a 3-day streak', earned: (p) => p.bestStreak >= 3 },
  { id: 'streak7', emoji: '📅', name: 'Full week', how: 'Reach a 7-day streak', earned: (p) => p.bestStreak >= 7 },
  { id: 'reps100', emoji: '💯', name: 'Hundred club', how: 'Do 100 reps in total', earned: (p) => totalReps(p) >= 100 },
  { id: 'reps500', emoji: '🏔️', name: 'Mountain', how: 'Do 500 reps in total', earned: (p) => totalReps(p) >= 500 },
  {
    id: 'perfect',
    emoji: '🎯',
    name: 'Perfect form',
    how: 'Finish a lesson with 100% good form',
    earned: (p) => p.history.some((h) => !h.penalty && h.reps + h.holdMs > 0 && h.form >= 0.999),
  },
  { id: 'penalty', emoji: '⚖️', name: 'Paid in full', how: 'Clear a penalty set', earned: (p) => p.history.some((h) => h.penalty) },
  { id: 'clip', emoji: '🎬', name: 'Director', how: 'Record a coach clip', earned: (p) => p.clips > 0 },
  { id: 'riser', emoji: '⏰', name: 'Early riser', how: 'Beat a wake-up alarm', earned: (p) => p.history.some((h) => h.lessonId === 'alarm') },
  { id: 'xp500', emoji: '⭐', name: 'Rising star', how: 'Earn 500 XP', earned: (p) => p.xp >= 500 },
];

/** Adds newly earned badges; returns the profile and the new ones. */
export function awardBadges(p: Profile): { profile: Profile; fresh: Badge[] } {
  const fresh = BADGES.filter((b) => !p.badges.includes(b.id) && b.earned(p));
  if (!fresh.length) return { profile: p, fresh };
  return { profile: { ...p, badges: [...p.badges, ...fresh.map((b) => b.id)] }, fresh };
}
