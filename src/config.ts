/** App-wide knobs for the prototype, kept in one place for tuning on real phones. */
export const APP = {
  name: 'FormUp',
  /** MediaPipe model bundled from assets/models. Switch to the lite model on older phones. */
  poseModel: 'pose_landmarker_full.task',
  defaultTarget: 15,
  targetChoices: [10, 15, 20] as const,
  /**
   * VisionCamera mirrors front-camera video the same way as the preview, so
   * the overlay needs no extra flip. If a phone records a front-camera clip
   * with the skeleton on the wrong side, set this to true.
   */
  flipFrontClipOverlay: false,
  /** Pause after the last rep before the recording stops, so the clip ends on the celebration. */
  finishDelayMs: 1500,
};

export const COLORS = {
  bg: '#0E1116',
  card: '#1A1F27',
  text: '#FFFFFF',
  muted: '#9AA4B2',
  brand: '#FF6B2C',
  good: '#33BF66',
  warn: '#F28C1A',
  info: 'rgba(0,0,0,0.55)',
};
