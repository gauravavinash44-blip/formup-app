import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { CameraPosition } from 'react-native-vision-camera';

import { APP, COLORS } from '../config';

export interface WorkoutSettings {
  target: number;
  position: CameraPosition;
  record: boolean;
}

interface Props {
  settings: WorkoutSettings;
  onChange: (s: WorkoutSettings) => void;
  onStart: () => void;
}

export function HomeScreen({ settings, onChange, onStart }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.mascot}>🦏</Text>
      <Text style={styles.brand}>{APP.name}</Text>
      <Text style={styles.tagline}>Your phone counts the reps and checks your form.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today: Squats</Text>
        <Text style={styles.label}>Reps</Text>
        <View style={styles.chips}>
          {APP.targetChoices.map((n) => (
            <Pressable
              key={n}
              style={[styles.chip, settings.target === n && styles.chipOn]}
              onPress={() => onChange({ ...settings, target: n })}
            >
              <Text style={[styles.chipText, settings.target === n && styles.chipTextOn]}>{n}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Camera</Text>
        <View style={styles.chips}>
          {(['front', 'back'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.chip, styles.wide, settings.position === p && styles.chipOn]}
              onPress={() => onChange({ ...settings, position: p })}
            >
              <Text style={[styles.chipText, settings.position === p && styles.chipTextOn]}>
                {p === 'front' ? 'Front (see yourself)' : 'Back (better quality)'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Record a clip</Text>
            <Text style={styles.switchHint}>Saved on your phone only. Watch out for other people in frame at the gym.</Text>
          </View>
          <Switch
            value={settings.record}
            onValueChange={(record) => onChange({ ...settings, record })}
            trackColor={{ true: COLORS.brand }}
          />
        </View>
      </View>

      <Pressable style={styles.start} onPress={onStart}>
        <Text style={styles.startText}>Start squats</Text>
      </Pressable>
      <Text style={styles.disclaimer}>Prototype. Form tips are guidance, not medical advice.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, padding: 20, paddingTop: 80, alignItems: 'center', gap: 10 },
  mascot: { fontSize: 64 },
  brand: { color: COLORS.text, fontSize: 36, fontWeight: '900' },
  tagline: { color: COLORS.muted, fontSize: 16, textAlign: 'center', marginBottom: 12 },
  card: { alignSelf: 'stretch', backgroundColor: COLORS.card, borderRadius: 20, padding: 18, gap: 10 },
  cardTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  label: { color: COLORS.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: '#11151B', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 },
  wide: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  chipOn: { backgroundColor: COLORS.brand },
  chipText: { color: COLORS.muted, fontWeight: '700' },
  chipTextOn: { color: 'white' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  switchTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  switchHint: { color: COLORS.muted, fontSize: 13 },
  start: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.brand,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  startText: { color: 'white', fontSize: 20, fontWeight: '900' },
  disclaimer: { color: COLORS.muted, fontSize: 12, marginTop: 6 },
});
