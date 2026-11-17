import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '../config';
import type { SquatState } from '../exercises/squat';

interface Props {
  state: SquatState;
  goodFlash: boolean;
  recording: boolean;
}

/** Big rep counter, check mark on a good rep, and the coaching cue. */
export function Hud({ state, goodFlash, recording }: Props) {
  const toneColor =
    state.cue.tone === 'good' ? COLORS.good : state.cue.tone === 'warn' ? COLORS.warn : COLORS.info;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.top}>
        <View style={styles.counter}>
          <Text style={styles.counterText}>
            {state.reps}
            <Text style={styles.counterTarget}>/{state.target}</Text>
          </Text>
        </View>
        {goodFlash ? (
          <View style={styles.check}>
            <Text style={styles.checkText}>✓</Text>
          </View>
        ) : null}
      </View>
      {recording ? (
        <View style={styles.rec}>
          <View style={styles.recDot} />
          <Text style={styles.recText}>REC</Text>
        </View>
      ) : null}
      <View style={styles.bottom}>
        <View style={[styles.cue, { backgroundColor: toneColor }]}>
          <Text style={styles.cueText}>{state.cue.text}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center' },
  counter: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 40,
    paddingHorizontal: 28,
    paddingVertical: 4,
  },
  counterText: { color: COLORS.text, fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  counterTarget: { fontSize: 36, color: 'rgba(255,255,255,0.75)' },
  check: {
    marginTop: 12,
    backgroundColor: COLORS.good,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: 'white', fontSize: 32, fontWeight: '900' },
  rec: {
    position: 'absolute',
    top: 60,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30', marginRight: 6 },
  recText: { color: 'white', fontWeight: '700', fontSize: 12 },
  bottom: { position: 'absolute', bottom: 150, left: 16, right: 16, alignItems: 'center' },
  cue: { borderRadius: 26, paddingHorizontal: 22, paddingVertical: 12 },
  cueText: { color: 'white', fontSize: 22, fontWeight: '800', textAlign: 'center' },
});
