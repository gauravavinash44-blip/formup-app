import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Delegate,
  RunningMode,
  usePoseDetection,
  type PoseDetectionResultBundle,
  type ViewCoordinator,
} from 'react-native-mediapipe-posedetection';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  type CameraPosition,
} from 'react-native-vision-camera';

import { APP, COLORS } from '../config';
import { ISSUE_CUES, SquatCounter, type RepResult, type SquatState } from '../exercises/squat';
import { Hud } from '../components/Hud';
import { SkeletonOverlay } from '../components/SkeletonOverlay';
import { TimelineRecorder, packPoints, type Size, type TimelineFrame } from '../clip/timeline';
import type { PosePoint } from '../pose/landmarks';

export interface SessionResult {
  reps: number;
  goodReps: number;
  target: number;
  durationMs: number;
  reps_detail: RepResult[];
  /** Present when the session was recorded. */
  clip?: {
    videoPath: string;
    videoSize: Size;
    viewSize: Size;
    frames: TimelineFrame[];
    mirrored: boolean;
  };
}

interface Props {
  target: number;
  position: CameraPosition;
  record: boolean;
  onFinish: (result: SessionResult) => void;
  onCancel: () => void;
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

function say(text: string) {
  Speech.stop();
  Speech.speak(text, { rate: 1.05 });
}

export function WorkoutScreen({ target, position, record, onFinish, onCancel }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(position);
  // 720p keeps both pose detection and the recorded file light.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);
  const cameraRef = useRef<Camera>(null);

  const counter = useMemo(() => new SquatCounter(target), [target]);
  const timeline = useRef(new TimelineRecorder()).current;
  const [squat, setSquat] = useState<SquatState>(() => counter.state(Date.now()));
  const [points, setPoints] = useState<PosePoint[] | null>(null);
  const [goodFlashUntil, setGoodFlashUntil] = useState(0);
  const [started, setStarted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const viewSize = useRef<Size>({ width: 1, height: 1 });
  const startMs = useRef(0);
  const repsDetail = useRef<RepResult[]>([]);
  const lastSpokenSetup = useRef(0);
  const goodFlashRef = useRef(0);
  const finished = useRef(false);
  const doneHandled = useRef(false);
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(
    () => () => {
      Speech.stop();
    },
    [],
  );

  const onRep = useCallback(
    (rep: RepResult, state: SquatState, now: number) => {
      repsDetail.current.push(rep);
      if (!rep.counted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        say('Go deeper');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (rep.quality === 'good') {
        goodFlashRef.current = now + 700;
        setGoodFlashUntil(now + 700);
      }
      const count = NUMBER_WORDS[state.reps] ?? String(state.reps);
      say(rep.quality === 'good' ? count : `${count}. ${ISSUE_CUES[rep.issues[0]]}`);
    },
    [],
  );

  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    setFinishing(true);
    const base = {
      reps: counter.state(Date.now()).reps,
      goodReps: counter.state(Date.now()).goodReps,
      target,
      durationMs: startMs.current ? Date.now() - startMs.current : 0,
      reps_detail: repsDetail.current,
    };
    if (!recordingRef.current || !cameraRef.current) {
      onFinish(base);
      return;
    }
    // The recording callback in start() hands over the clip.
    await cameraRef.current.stopRecording().catch(() => onFinish(base));
  }, [counter, onFinish, target]);

  const handleResults = useCallback(
    (result: PoseDetectionResultBundle, vc: ViewCoordinator) => {
      const now = Date.now();
      const landmarks = result.results[0]?.landmarks[0];
      const frameDims = vc.getFrameDims(result);
      const aspect = frameDims.width / frameDims.height;

      let viewPoints: PosePoint[] | null = null;
      if (landmarks && landmarks.length >= 33) {
        viewPoints = landmarks.map((p) => {
          const v = vc.convertPoint(frameDims, { x: p.x, y: p.y });
          return { x: v.x, y: v.y, visibility: p.visibility ?? 1 };
        });
      }
      setPoints(viewPoints);

      if (!started || finished.current) return;

      const rep = counter.update(landmarks ?? null, now, aspect);
      const state = counter.state(now);
      setSquat(state);
      if (rep) onRep(rep, state, now);

      if (state.phase === 'setup' && now - lastSpokenSetup.current > 6000) {
        lastSpokenSetup.current = now;
        say(state.cue.text);
      }

      timeline.push(now, {
        pts: viewPoints ? packPoints(viewPoints, viewSize.current) : [],
        reps: state.reps,
        target: state.target,
        cue: state.cue.text,
        tone: state.cue.tone,
        goodFlash: now < goodFlashRef.current,
      });

      if (state.done && !doneHandled.current) {
        doneHandled.current = true;
        setFinishing(true);
        say('Set complete! Great work.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(finish, APP.finishDelayMs);
      }
    },
    [counter, finish, onRep, started, timeline],
  );

  const pose = usePoseDetection(
    {
      onResults: handleResults,
      onError: (e) => console.warn('Pose detection error', e.message),
    },
    RunningMode.LIVE_STREAM,
    APP.poseModel,
    { numPoses: 1, delegate: Delegate.GPU },
  );

  useEffect(() => {
    if (device) pose.cameraDeviceChangeHandler(device);
  }, [device, pose]);

  const start = useCallback(() => {
    finished.current = false;
    startMs.current = Date.now();
    setStarted(true);
    say(`Let's do ${target} squats. Squat down.`);
    if (!record || !cameraRef.current) return;
    const mirrored = position === 'front';
    cameraRef.current.startRecording({
      fileType: 'mp4',
      onRecordingFinished: (video) => {
        const frames = timeline.stop();
        recordingRef.current = false;
        setRecording(false);
        const s = counter.state(Date.now());
        onFinish({
          reps: s.reps,
          goodReps: s.goodReps,
          target,
          durationMs: Date.now() - startMs.current,
          reps_detail: repsDetail.current,
          clip: {
            videoPath: video.path,
            videoSize: { width: video.width, height: video.height },
            viewSize: viewSize.current,
            frames,
            mirrored: mirrored && APP.flipFrontClipOverlay,
          },
        });
      },
      onRecordingError: (e) => {
        console.warn('Recording error', e);
        timeline.stop();
        recordingRef.current = false;
        setRecording(false);
        const s = counter.state(Date.now());
        if (finished.current) {
          onFinish({
            reps: s.reps,
            goodReps: s.goodReps,
            target,
            durationMs: Date.now() - startMs.current,
            reps_detail: repsDetail.current,
          });
        }
      },
    });
    timeline.start(Date.now());
    recordingRef.current = true;
    setRecording(true);
  }, [counter, onFinish, position, record, target, timeline]);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>FormUp needs the camera to see your squats. Video stays on your phone.</Text>
        <Pressable style={styles.primary} onPress={() => Linking.openSettings()}>
          <Text style={styles.primaryText}>Open settings</Text>
        </Pressable>
        <Pressable onPress={onCancel}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="white" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive
        video={record}
        audio={false}
        pixelFormat="rgb"
        resizeMode="cover"
        outputOrientation="preview"
        frameProcessor={pose.frameProcessor}
        onOutputOrientationChanged={pose.cameraOrientationChangedHandler}
        onLayout={(e) => {
          viewSize.current = {
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          };
          pose.cameraViewLayoutChangeHandler(e);
        }}
      />
      <SkeletonOverlay points={points} highlight={Date.now() < goodFlashUntil} />
      {started ? (
        <Hud state={squat} goodFlash={Date.now() < goodFlashUntil} recording={recording} />
      ) : (
        <View style={styles.setup} pointerEvents="none">
          <Text style={styles.setupTitle}>Place your phone on the floor</Text>
          <Text style={styles.setupBody}>
            Step back until your whole body, head to feet, is in the frame. A side or front view both work.
          </Text>
          <Text style={[styles.setupBody, { color: points ? COLORS.good : COLORS.warn }]}>
            {points ? 'I can see you 👍' : 'Looking for you…'}
          </Text>
        </View>
      )}
      <View style={styles.controls}>
        <Pressable style={styles.secondary} onPress={onCancel}>
          <Text style={styles.secondaryText}>✕</Text>
        </Pressable>
        {started ? (
          <Pressable style={[styles.primary, styles.stop]} onPress={finish} disabled={finishing}>
            <Text style={styles.primaryText}>{finishing ? 'Finishing…' : 'Finish'}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={start}>
            <Text style={styles.primaryText}>{record ? 'Start & record' : 'Start'}</Text>
          </Pressable>
        )}
        <View style={styles.secondary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  msg: { color: COLORS.text, fontSize: 17, textAlign: 'center' },
  link: { color: COLORS.muted, fontSize: 16, marginTop: 8 },
  setup: {
    position: 'absolute',
    top: 90,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    padding: 18,
    gap: 6,
  },
  setupTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  setupBody: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primary: {
    backgroundColor: COLORS.brand,
    borderRadius: 30,
    paddingHorizontal: 32,
    paddingVertical: 16,
    minWidth: 180,
    alignItems: 'center',
  },
  stop: { backgroundColor: '#2B3240' },
  primaryText: { color: 'white', fontSize: 18, fontWeight: '800' },
  secondary: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: 'white', fontSize: 20, fontWeight: '700' },
});
