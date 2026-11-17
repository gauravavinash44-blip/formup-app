/**
 * MediaPipe Pose Landmarker gives 33 landmarks per person.
 * Coordinates are normalized to the analyzed frame: x and y in 0..1, z is a
 * relative depth. `visibility` is how likely the point is actually in view.
 */
export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type Pose = PosePoint[];

export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** Bones drawn for the skeleton overlay (face points are left out on purpose). */
export const SKELETON_BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.leftAnkle, LM.leftFootIndex],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
  [LM.rightAnkle, LM.rightFootIndex],
];

/** Joints drawn as dots on the overlay. */
export const SKELETON_JOINTS: ReadonlyArray<number> = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];
