import './style.css';

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Same counting and form logic as the phone app.
import { ISSUE_CUES, SquatCounter, type RepResult, type SquatState } from '../../src/exercises/squat';
import { SKELETON_BONES, SKELETON_JOINTS, type PosePoint } from '../../src/pose/landmarks';

/* ---------- small helpers ---------- */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const COLORS = { brand: '#FF6B2C', good: '#33BF66', warn: '#F28C1A', info: 'rgba(0,0,0,0.55)' };
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

function say(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
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
function show(view: 'home' | 'workout' | 'result') {
  for (const v of ['home', 'workout', 'result'] as const) $(v).hidden = v !== view;
}
function formatTime(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- settings (home) ---------- */

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') === 'full' ? 'pose_landmarker_full.task' : 'pose_landmarker_lite.task';
let target = 15;
let facing: 'user' | 'environment' = 'user';

function bindChips(containerId: string, onPick: (el: HTMLElement) => void) {
  const box = $(containerId);
  box.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    onPick(btn);
  });
}
bindChips('targets', (b) => (target = Number(b.dataset.target)));
bindChips('cameras', (b) => (facing = b.dataset.facing as 'user' | 'environment'));

/* ---------- pose model (loaded once) ---------- */

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
function getLandmarker() {
  landmarkerPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(new URL('./wasm', location.href).href);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: new URL(`./models/${MODEL}`, location.href).href, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
    });
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  })();
  return landmarkerPromise;
}

/* ---------- workout session ---------- */

interface Session {
  counter: SquatCounter;
  startMs: number;
  reps: RepResult[];
  goodFlashUntil: number;
  greeted: boolean;
  lastSetupSpoken: number;
  doneAt: number | null;
  stream: MediaStream;
  raf: number;
  lastVideoTime: number;
  points: PosePoint[] | null;
  state: SquatState;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  clip: { url: string; blob: Blob; ext: string } | null;
  finishing: boolean;
}

let session: Session | null = null;
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;
const recordBtn = $<HTMLButtonElement>('recordBtn');

async function startWorkout() {
  show('workout');
  $('loading').hidden = false;
  $('setup').hidden = true;
  $('loadingText').textContent = 'Starting camera…';
  // Unlock speech on iOS: it must start from a tap.
  say('');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    $('loadingText').textContent =
      'FormUp needs the camera to count your reps. Allow camera access in your browser settings, then try again.';
    console.warn(e);
    return;
  }
  video.srcObject = stream;
  await video.play();

  $('loadingText').textContent = 'Loading the pose model…';
  const landmarker = await getLandmarker();
  $('loading').hidden = true;
  $('setup').hidden = false;

  const counter = new SquatCounter(target);
  session = {
    counter,
    startMs: Date.now(),
    reps: [],
    goodFlashUntil: 0,
    greeted: false,
    lastSetupSpoken: 0,
    doneAt: null,
    stream,
    raf: 0,
    lastVideoTime: -1,
    points: null,
    state: counter.state(Date.now()),
    recorder: null,
    chunks: [],
    clip: null,
    finishing: false,
  };
  setRecordUi(false);
  loop(landmarker);
}

function loop(landmarker: PoseLandmarker) {
  const s = session;
  if (!s) return;
  s.raf = requestAnimationFrame(() => loop(landmarker));

  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  const now = Date.now();
  if (video.currentTime !== s.lastVideoTime) {
    s.lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    const lm = res.landmarks[0];
    const mirror = facing === 'user';
    s.points = lm
      ? lm.map((p) => ({ x: (mirror ? 1 - p.x : p.x) * W, y: p.y * H, visibility: p.visibility ?? 1 }))
      : null;

    if (!s.finishing) {
      // Counting is always on while the camera is open.
      const rep = s.counter.update(lm ?? null, now, W / H);
      s.state = s.counter.state(now);
      if (rep) onRep(s, rep, now);
      if (s.state.phase === 'up' && !s.greeted) {
        s.greeted = true;
        say(`I can see you. Let's do ${target} squats.`);
      }
      if (s.state.phase === 'setup' && now - s.lastSetupSpoken > 8000 && s.lastSetupSpoken !== 0) {
        say(s.state.cue.text);
        s.lastSetupSpoken = now;
      }
      if (s.lastSetupSpoken === 0) s.lastSetupSpoken = now;
      if (s.state.done && s.doneAt === null) {
        s.doneAt = now;
        say('Set complete! Great work.');
        buzz([80, 60, 160]);
        setTimeout(finishWorkout, 1500);
      }
    }
  }

  const setupVisible = s.state.phase === 'setup' && s.state.reps === 0;
  $('setup').hidden = !setupVisible;
  const status = $('setupStatus');
  status.textContent = s.points ? 'Almost there, stand tall 👍' : 'Looking for you…';
  status.className = s.points ? 'ok' : 'warn';

  draw(s, W, H, now);
}

function onRep(s: Session, rep: RepResult, now: number) {
  s.reps.push(rep);
  if (!rep.counted) {
    buzz([40, 40, 40]);
    say('Go deeper');
    return;
  }
  buzz(40);
  if (rep.quality === 'good') s.goodFlashUntil = now + 700;
  const count = NUMBER_WORDS[s.state.reps] ?? String(s.state.reps);
  say(rep.quality === 'good' ? count : `${count}. ${ISSUE_CUES[rep.issues[0]]}`);
}

/* ---------- drawing: video + skeleton + HUD, all on one canvas so recordings include it ---------- */

/** Part of the canvas actually visible on screen (the canvas is shown with object-fit: cover). */
function visibleRect(W: number, H: number) {
  const r = canvas.getBoundingClientRect();
  const scale = Math.max(r.width / W, r.height / H);
  const vw = r.width / scale;
  const vh = r.height / scale;
  return { x: (W - vw) / 2, y: (H - vh) / 2, w: vw, h: vh };
}

function pill(text: string, cx: number, cy: number, size: number, bg: string | null, pad: number, weight = 800) {
  ctx.font = `${weight} ${size}px Archivo, Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const th = size * 1.15;
  if (bg) {
    ctx.fillStyle = bg;
    const w = tw + pad * 2.8;
    const h = th + pad * 1.2;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy + size * 0.04);
}

function draw(s: Session, W: number, H: number, now: number) {
  ctx.save();
  if (facing === 'user') {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();

  const vis = visibleRect(W, H);
  const u = Math.min(vis.w, vis.h) / 100;
  const flash = now < s.goodFlashUntil;

  // skeleton
  const pts = s.points;
  if (pts) {
    const ok = (i: number) => (pts[i].visibility ?? 1) >= 0.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(3, u * 1.2);
    ctx.beginPath();
    for (const [a, b] of SKELETON_BONES) {
      if (!ok(a) || !ok(b)) continue;
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    }
    ctx.stroke();
    ctx.fillStyle = flash ? COLORS.good : '#fff';
    for (const j of SKELETON_JOINTS) {
      if (!ok(j)) continue;
      ctx.beginPath();
      ctx.arc(pts[j].x, pts[j].y, Math.max(4, u * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // HUD
  const cx = vis.x + vis.w / 2;
  const st = s.state;
  pill(`${st.reps}/${st.target}`, cx, vis.y + vis.h * 0.12, u * 15, 'rgba(0,0,0,0.35)', u * 2.6, 900);
  if (flash) pill('✓', cx, vis.y + vis.h * 0.22, u * 9, COLORS.good, u * 1.8, 900);
  if (!(st.phase === 'setup' && st.reps === 0)) {
    const bg = st.cue.tone === 'good' ? COLORS.good : st.cue.tone === 'warn' ? COLORS.warn : COLORS.info;
    pill(st.cue.text, cx, vis.y + vis.h * 0.78, u * 5.6, bg, u * 2.4);
  }
  const brandSize = u * 4.4;
  ctx.font = `800 ${brandSize}px Archivo, Inter, sans-serif`;
  const bw = ctx.measureText('🦏 FormUp').width;
  pill('🦏 FormUp', vis.x + vis.w - bw / 2 - u * 6, vis.y + vis.h * 0.68, brandSize, 'rgba(0,0,0,0.35)', u * 1.6);
}

/* ---------- recording (only when the Record button is pressed) ---------- */

function pickMime() {
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

function setRecordUi(on: boolean) {
  recordBtn.classList.toggle('on', on);
  recordBtn.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
}

function toggleRecord() {
  const s = session;
  if (!s || s.finishing) return;
  if (s.recorder) {
    s.recorder.stop();
    return;
  }
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
    alertInline('Recording is not supported in this browser.');
    return;
  }
  const mime = pickMime();
  const rec = new MediaRecorder(canvas.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  s.chunks = [];
  rec.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm';
    const blob = new Blob(s.chunks, { type });
    if (s.clip) URL.revokeObjectURL(s.clip.url);
    s.clip = { blob, url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm' };
    s.recorder = null;
    setRecordUi(false);
    if (s.finishing) showResult(s);
  };
  rec.start(500);
  s.recorder = rec;
  setRecordUi(true);
  buzz(30);
}

function alertInline(text: string) {
  const el = $('setupStatus');
  $('setup').hidden = false;
  el.textContent = text;
  el.className = 'warn';
}

/* ---------- finish + result ---------- */

function stopCamera(s: Session) {
  cancelAnimationFrame(s.raf);
  s.stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

function finishWorkout() {
  const s = session;
  if (!s || s.finishing) return;
  s.finishing = true;
  if (s.recorder) s.recorder.stop(); // onstop shows the result
  else showResult(s);
}

function showResult(s: Session) {
  stopCamera(s);
  const st = s.counter.state(Date.now());
  $('resultTitle').textContent = st.reps >= st.target ? 'Set complete!' : 'Nice work!';
  $('statReps').textContent = `${st.reps}/${st.target}`;
  $('statGood').textContent = st.reps ? `${Math.round((st.goodReps / st.reps) * 100)}%` : '0%';
  $('statTime').textContent = formatTime(Date.now() - s.startMs);
  $('dots').innerHTML = s.reps
    .map((r) => `<i class="${!r.counted ? 'miss' : r.quality === 'good' ? '' : 'okay'}"></i>`)
    .join('');
  const clipVideo = $<HTMLVideoElement>('clipVideo');
  $('clipStatus').textContent = '';
  if (s.clip) {
    $('clipCard').hidden = false;
    $('noClip').hidden = true;
    clipVideo.src = s.clip.url;
    clipVideo.play().catch(() => undefined);
  } else {
    $('clipCard').hidden = true;
    $('noClip').hidden = false;
    clipVideo.removeAttribute('src');
  }
  show('result');
}

function clipFile(s: Session) {
  return new File([s.clip!.blob], `formup-squats-${Date.now()}.${s.clip!.ext}`, { type: s.clip!.blob.type });
}

$('saveBtn').addEventListener('click', () => {
  const s = session;
  if (!s?.clip) return;
  const a = document.createElement('a');
  a.href = s.clip.url;
  a.download = clipFile(s).name;
  a.click();
  $('clipStatus').textContent = 'Saved to your downloads.';
});

$('shareBtn').addEventListener('click', async () => {
  const s = session;
  if (!s?.clip) return;
  const file = clipFile(s);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My FormUp squats', text: `${s.state.reps} squats with FormUp 🦏` });
    } catch {
      /* user closed the share sheet */
    }
  } else {
    $('clipStatus').textContent = 'Sharing files is not supported in this browser. Use Save, then share from your gallery.';
  }
});

/* ---------- wiring ---------- */

$('startBtn').addEventListener('click', () => {
  startWorkout().catch((e) => {
    console.error(e);
    $('loading').hidden = false;
    $('loadingText').textContent = `Something went wrong starting the camera: ${(e as Error).message}`;
  });
});
$('finishBtn').addEventListener('click', finishWorkout);
recordBtn.addEventListener('click', toggleRecord);
$('closeBtn').addEventListener('click', () => {
  const s = session;
  if (s) {
    s.finishing = true;
    s.recorder?.stop();
    stopCamera(s);
  }
  speechSynthesis?.cancel();
  show('home');
});
$('againBtn').addEventListener('click', () => show('home'));

// Start downloading the model while the person reads the home screen.
getLandmarker().catch((e) => console.warn('Model preload failed', e));
