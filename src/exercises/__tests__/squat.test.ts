import { SquatCounter } from '../squat';
import { LM, type Pose } from '../../pose/landmarks';
import { jointAngle } from '../../pose/geometry';

const ASPECT = 9 / 16;
const FPS = 15;
const DT = 1000 / FPS;

/**
 * Build a synthetic pose with a given knee angle and torso lean, as a phone
 * on the floor would see it. Lengths are in "height units"; x is converted to
 * normalized-frame units by dividing by the aspect ratio.
 */
function pose({
  knee = 175,
  lean = 10,
  view = 'side' as 'side' | 'front',
  kneeCave = false,
  vis = 0.95,
}: {
  knee?: number;
  lean?: number;
  view?: 'side' | 'front';
  kneeCave?: boolean;
  vis?: number;
}): Pose {
  const shin = 0.2;
  const thigh = 0.2;
  const torso = 0.28;
  const k = (knee * Math.PI) / 180;
  const l = (lean * Math.PI) / 180;

  const makeSide = (cx: number, kneeDx: number) => {
    const ankle = { x: 0, y: 0.9 };
    const kneeP = { x: kneeDx, y: ankle.y - shin };
    // knee->ankle points straight down (0, 1); rotate by the knee angle.
    const hip = { x: kneeP.x + thigh * Math.sin(k), y: kneeP.y + thigh * Math.cos(k) };
    const shoulder = { x: hip.x - torso * Math.sin(l), y: hip.y - torso * Math.cos(l) };
    const toFrame = (p: { x: number; y: number }) => ({ x: cx + p.x / ASPECT, y: p.y, visibility: vis });
    return {
      ankle: toFrame(ankle),
      knee: toFrame(kneeP),
      hip: toFrame(hip),
      shoulder: toFrame(shoulder),
    };
  };

  const p: Pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  if (view === 'side') {
    const s = makeSide(0.4, 0);
    for (const side of ['left', 'right'] as const) {
      p[LM[`${side}Shoulder`]] = s.shoulder;
      p[LM[`${side}Hip`]] = s.hip;
      p[LM[`${side}Knee`]] = s.knee;
      p[LM[`${side}Ankle`]] = s.ankle;
    }
  } else {
    // Front view: approximate the knee angle by foreshortening the thigh
    // vertically. Good enough to drive the counter and the knee-width rule.
    const halfHip = 0.08;
    const halfAnkle = 0.1;
    const halfKnee = kneeCave ? 0.05 : 0.1;
    const kneeY = 0.9 - shin;
    const thighDy = thigh * Math.abs(Math.cos(Math.PI - k));
    const hipY = kneeY - thighDy;
    const shoulderY = hipY - torso;
    const place = (sign: number) => ({
      shoulder: { x: 0.5 + (sign * 0.12) / ASPECT, y: shoulderY, visibility: vis },
      hip: { x: 0.5 + (sign * halfHip) / ASPECT, y: hipY, visibility: vis },
      knee: { x: 0.5 + (sign * halfKnee) / ASPECT, y: kneeY, visibility: vis },
      ankle: { x: 0.5 + (sign * halfAnkle) / ASPECT, y: 0.9, visibility: vis },
    });
    const L = place(1);
    const R = place(-1);
    Object.assign(p, {
      [LM.leftShoulder]: L.shoulder,
      [LM.leftHip]: L.hip,
      [LM.leftKnee]: L.knee,
      [LM.leftAnkle]: L.ankle,
      [LM.rightShoulder]: R.shoulder,
      [LM.rightHip]: R.hip,
      [LM.rightKnee]: R.knee,
      [LM.rightAnkle]: R.ankle,
    });
  }
  return p;
}

/** Drive the counter through one rep: stand, go down to `bottom`, come back. */
function doRep(
  c: SquatCounter,
  t: { now: number },
  bottom: number,
  opts: { lean?: number; frames?: number; view?: 'side' | 'front'; kneeCave?: boolean } = {},
) {
  const frames = opts.frames ?? 20; // ~1.3 s down, ~1.3 s up at 15 fps
  const results = [];
  for (let i = 0; i <= frames; i++) {
    const angle = 175 - ((175 - bottom) * i) / frames;
    const lean = 10 + ((opts.lean ?? 10) - 10) * (i / frames);
    results.push(c.update(pose({ knee: angle, lean, view: opts.view, kneeCave: opts.kneeCave }), (t.now += DT), ASPECT));
  }
  for (let i = frames; i >= 0; i--) {
    const angle = 175 - ((175 - bottom) * i) / frames;
    results.push(c.update(pose({ knee: angle, view: opts.view }), (t.now += DT), ASPECT));
  }
  // hold standing a few frames so smoothing settles
  for (let i = 0; i < 4; i++) results.push(c.update(pose({ knee: 175, view: opts.view }), (t.now += DT), ASPECT));
  return results.filter(Boolean);
}

function standingCounter(target = 15) {
  const c = new SquatCounter(target);
  const t = { now: 0 };
  for (let i = 0; i < 5; i++) c.update(pose({ knee: 175 }), (t.now += DT), ASPECT);
  return { c, t };
}

describe('synthetic pose helper', () => {
  it('produces the requested knee angle', () => {
    const p = pose({ knee: 90 });
    const a = jointAngle(p[LM.leftHip], p[LM.leftKnee], p[LM.leftAnkle], ASPECT);
    expect(a).toBeCloseTo(90, 0);
  });
});

describe('SquatCounter', () => {
  it('waits in setup until the whole body is visible and standing', () => {
    const c = new SquatCounter();
    c.update(pose({ knee: 175, vis: 0.2 }), 0, ASPECT);
    expect(c.state(0).phase).toBe('setup');
    expect(c.state(0).cue.text).toMatch(/whole body/);
    c.update(pose({ knee: 175 }), 70, ASPECT);
    expect(c.state(70).phase).toBe('up');
    expect(c.state(70).cue.text).toBe('Squat down');
  });

  it('counts 15 clean reps and finishes the set', () => {
    const { c, t } = standingCounter(15);
    for (let i = 0; i < 15; i++) {
      const reps = doRep(c, t, 85);
      expect(reps).toHaveLength(1);
      expect(reps[0]!.quality).toBe('good');
    }
    const s = c.state(t.now);
    expect(s.reps).toBe(15);
    expect(s.goodReps).toBe(15);
    expect(s.done).toBe(true);
    expect(s.cue.text).toBe('Set complete!');
  });

  it('does not count a quarter squat', () => {
    const { c, t } = standingCounter();
    const reps = doRep(c, t, 128);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.counted).toBe(false);
    expect(c.state(t.now).reps).toBe(0);
  });

  it('counts a slightly shallow rep but flags it', () => {
    const { c, t } = standingCounter();
    const [rep] = doRep(c, t, 108);
    expect(rep!.counted).toBe(true);
    expect(rep!.quality).toBe('okay');
    expect(rep!.issues).toContain('shallow');
  });

  it('flags leaning too far forward', () => {
    const { c, t } = standingCounter();
    const [rep] = doRep(c, t, 85, { lean: 65 });
    expect(rep!.issues).toContain('chest');
    expect(c.state(rep!.endMs).cue.text).toBe('Keep your chest up');
  });

  it('flags reps that are too fast', () => {
    const { c, t } = standingCounter();
    const [rep] = doRep(c, t, 85, { frames: 4 });
    expect(rep!.counted).toBe(true);
    expect(rep!.issues).toContain('fast');
  });

  it('flags knees caving in when facing the camera', () => {
    const { c, t } = standingCounter();
    const [ok] = doRep(c, t, 85, { view: 'front' });
    expect(ok!.counted).toBe(true);
    expect(ok!.issues).not.toContain('knees');
    const [cave] = doRep(c, t, 85, { view: 'front', kneeCave: true });
    expect(cave!.issues).toContain('knees');
  });

  it('ignores jitter while standing', () => {
    const { c, t } = standingCounter();
    for (let i = 0; i < 200; i++) {
      const noise = Math.sin(i * 1.7) * 8 + Math.cos(i * 0.9) * 5;
      c.update(pose({ knee: 165 + noise }), (t.now += DT), ASPECT);
    }
    expect(c.state(t.now).reps).toBe(0);
  });

  it('survives brief tracking drop-outs mid rep', () => {
    const { c, t } = standingCounter();
    for (let i = 0; i <= 20; i++) c.update(pose({ knee: 175 - (90 * i) / 20 }), (t.now += DT), ASPECT);
    c.update(null, (t.now += DT), ASPECT);
    c.update(null, (t.now += DT), ASPECT);
    for (let i = 20; i >= 0; i--) c.update(pose({ knee: 175 - (90 * i) / 20 }), (t.now += DT), ASPECT);
    for (let i = 0; i < 4; i++) c.update(pose({ knee: 175 }), (t.now += DT), ASPECT);
    expect(c.state(t.now).reps).toBe(1);
  });

  it('goes back to setup when the body is lost for a while', () => {
    const { c, t } = standingCounter();
    for (let i = 0; i < 15; i++) c.update(null, (t.now += DT), ASPECT);
    expect(c.state(t.now).phase).toBe('setup');
  });
});
