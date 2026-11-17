import { TimelineRecorder, packPoints, toVideoTimeline, uprightVideoSize, viewToVideo } from '../timeline';

describe('viewToVideo', () => {
  it('is the identity when view and video have the same aspect', () => {
    const [x, y] = viewToVideo(0.25, 0.75, { width: 390, height: 693.33 }, { width: 1080, height: 1920 });
    expect(x).toBeCloseTo(0.25, 2);
    expect(y).toBeCloseTo(0.75, 2);
  });

  it('undoes the cover crop on a tall phone screen', () => {
    // 390x844 view showing a 1080x1920 video: video is scaled to 844 tall,
    // 474.75 wide, so ~42 px are cropped on each side.
    const view = { width: 390, height: 844 };
    const video = { width: 1080, height: 1920 };
    const [left] = viewToVideo(0, 0.5, view, video);
    const [right] = viewToVideo(1, 0.5, view, video);
    const [center, cy] = viewToVideo(0.5, 0.5, view, video);
    expect(left).toBeGreaterThan(0.08);
    expect(right).toBeLessThan(0.92);
    expect(center).toBeCloseTo(0.5, 5);
    expect(cy).toBeCloseTo(0.5, 5);
  });

  it('mirrors x when asked', () => {
    const [x] = viewToVideo(0.2, 0.5, { width: 100, height: 100 }, { width: 100, height: 100 }, true);
    expect(x).toBeCloseTo(0.8, 5);
  });
});

describe('uprightVideoSize', () => {
  it('swaps a landscape-reported size for a portrait view', () => {
    expect(uprightVideoSize({ width: 1920, height: 1080 }, { width: 390, height: 844 })).toEqual({
      width: 1080,
      height: 1920,
    });
  });
});

describe('TimelineRecorder', () => {
  it('records times relative to start and converts to video space', () => {
    const rec = new TimelineRecorder();
    rec.push(0, { pts: [], reps: 0, target: 15, cue: 'x', tone: 'info', goodFlash: false });
    rec.start(1000);
    const pts = packPoints([{ x: 195, y: 422, visibility: 0.9 }], { width: 390, height: 844 });
    rec.push(1100, { pts, reps: 1, target: 15, cue: 'Good rep!', tone: 'good', goodFlash: true });
    const frames = rec.stop();
    expect(frames).toHaveLength(1);
    expect(frames[0].t).toBe(100);
    const video = toVideoTimeline(frames, { width: 390, height: 844 }, { width: 1920, height: 1080 });
    expect(video[0].pts[0]).toBeCloseTo(0.5, 3);
    expect(video[0].pts[1]).toBeCloseTo(0.5, 3);
    expect(video[0].pts[2]).toBe(0.9);
  });
});
