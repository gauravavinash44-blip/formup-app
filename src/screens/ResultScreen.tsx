import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import CoachClip from '../../modules/coach-clip';
import { toVideoTimeline, type CoachClipSpec } from '../clip/timeline';
import { APP, COLORS } from '../config';
import type { SessionResult } from './WorkoutScreen';

interface Props {
  result: SessionResult;
  onDone: () => void;
}

type ClipKind = 'coach' | 'clean';

const fileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

function formatTime(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Celebration + the recorded clip, with save and share. */
export function ResultScreen({ result, onDone }: Props) {
  const clip = result.clip;
  const [coachUri, setCoachUri] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [kind, setKind] = useState<ClipKind>('coach');
  const [status, setStatus] = useState<string | null>(null);

  const cleanUri = clip ? fileUri(clip.videoPath) : null;
  const shownUri = kind === 'coach' ? coachUri : cleanUri;

  useEffect(() => {
    if (!clip) return;
    let cancelled = false;
    const spec: CoachClipSpec = {
      frames: toVideoTimeline(clip.frames, clip.viewSize, clip.videoSize, clip.mirrored),
      brand: APP.name,
      title: `${result.target} squats`,
    };
    const out = new File(Paths.cache, `formup-coach-${Date.now()}.mp4`);
    CoachClip.renderAsync(fileUri(clip.videoPath), JSON.stringify(spec), out.uri)
      .then((uri) => !cancelled && setCoachUri(uri))
      .catch((e: Error) => {
        if (cancelled) return;
        setRenderError(e.message);
        setKind('clean');
      });
    return () => {
      cancelled = true;
    };
  }, [clip, result.target]);

  const player = useVideoPlayer(shownUri ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const good = useMemo(
    () => (result.reps ? Math.round((result.goodReps / result.reps) * 100) : 0),
    [result.goodReps, result.reps],
  );

  async function save() {
    if (!shownUri) return;
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      setStatus('Allow photo access to save clips.');
      return;
    }
    await MediaLibrary.saveToLibraryAsync(shownUri);
    setStatus('Saved to your photos ✓');
  }

  async function share() {
    if (!shownUri) return;
    if (!(await Sharing.isAvailableAsync())) {
      setStatus('Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(shownUri, {
      mimeType: 'video/mp4',
      UTI: 'public.mpeg-4',
      dialogTitle: 'Share your FormUp clip',
    });
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.mascot}>🦏</Text>
      <Text style={styles.title}>{result.reps >= result.target ? 'Set complete!' : 'Nice work!'}</Text>
      <View style={styles.stats}>
        <Stat label="Reps" value={`${result.reps}/${result.target}`} />
        <Stat label="Good form" value={`${good}%`} />
        <Stat label="Time" value={formatTime(result.durationMs)} />
      </View>

      {clip ? (
        <View style={styles.clipCard}>
          <View style={styles.tabs}>
            {(['coach', 'clean'] as const).map((k) => (
              <Pressable key={k} style={[styles.tab, kind === k && styles.tabOn]} onPress={() => setKind(k)}>
                <Text style={[styles.tabText, kind === k && styles.tabTextOn]}>
                  {k === 'coach' ? 'Coach clip' : 'Clean clip'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.video}>
            {shownUri ? (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
            ) : (
              <View style={styles.rendering}>
                <ActivityIndicator color="white" />
                <Text style={styles.muted}>Adding your skeleton and rep counter…</Text>
              </View>
            )}
          </View>
          {renderError ? <Text style={styles.error}>Coach clip failed: {renderError}</Text> : null}
          <View style={styles.row}>
            <Pressable style={[styles.button, !shownUri && styles.disabled]} onPress={save} disabled={!shownUri}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.shareButton, !shownUri && styles.disabled]}
              onPress={share}
              disabled={!shownUri}
            >
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
          </View>
          {status ? <Text style={styles.muted}>{status}</Text> : null}
        </View>
      ) : null}

      <View style={styles.reps}>
        {result.reps_detail.map((r) => (
          <View
            key={r.index}
            style={[
              styles.repDot,
              { backgroundColor: !r.counted ? '#59606B' : r.quality === 'good' ? COLORS.good : COLORS.warn },
            ]}
          />
        ))}
      </View>

      <Pressable style={styles.done} onPress={onDone}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, paddingTop: 70, alignItems: 'center', gap: 16 },
  mascot: { fontSize: 72 },
  title: { color: COLORS.text, fontSize: 30, fontWeight: '900' },
  stats: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  stat: { flex: 1, backgroundColor: COLORS.card, borderRadius: 16, padding: 14, alignItems: 'center' },
  statValue: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  clipCard: { alignSelf: 'stretch', backgroundColor: COLORS.card, borderRadius: 20, padding: 12, gap: 12 },
  tabs: { flexDirection: 'row', backgroundColor: '#11151B', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: '#2B3240' },
  tabText: { color: COLORS.muted, fontWeight: '700' },
  tabTextOn: { color: COLORS.text },
  video: { aspectRatio: 9 / 16, width: '100%', backgroundColor: 'black', borderRadius: 14, overflow: 'hidden' },
  rendering: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  row: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, backgroundColor: '#2B3240', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  shareButton: { backgroundColor: COLORS.brand },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '800' },
  muted: { color: COLORS.muted, textAlign: 'center' },
  error: { color: COLORS.warn, textAlign: 'center' },
  reps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  repDot: { width: 14, height: 14, borderRadius: 7 },
  done: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.brand,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 30,
  },
});
