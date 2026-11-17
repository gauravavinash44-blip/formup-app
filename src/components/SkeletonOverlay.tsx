import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { COLORS } from '../config';
import { SKELETON_BONES, SKELETON_JOINTS, type PosePoint } from '../pose/landmarks';

interface Props {
  /** Landmarks already converted to view pixels. */
  points: PosePoint[] | null;
  highlight: boolean;
}

const MIN_VIS = 0.5;

export function SkeletonOverlay({ points, highlight }: Props) {
  if (!points || points.length < 33) return null;
  const ok = (i: number) => (points[i].visibility ?? 1) >= MIN_VIS;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {SKELETON_BONES.map(([a, b]) =>
        ok(a) && ok(b) ? (
          <Line
            key={`${a}-${b}`}
            x1={points[a].x}
            y1={points[a].y}
            x2={points[b].x}
            y2={points[b].y}
            stroke="white"
            strokeOpacity={0.92}
            strokeWidth={5}
            strokeLinecap="round"
          />
        ) : null,
      )}
      {SKELETON_JOINTS.map((j) =>
        ok(j) ? (
          <Circle key={j} cx={points[j].x} cy={points[j].y} r={6} fill={highlight ? COLORS.good : 'white'} />
        ) : null,
      )}
    </Svg>
  );
}
