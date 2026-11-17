# FormUp (prototype) 🦏

Phase 1 camera prototype: your phone watches you squat, counts the reps, gives
simple form feedback, and records a clip with the skeleton and rep counter
burned in so you can share it.

Works on **iPhone and Android** from one React Native (Expo) codebase. All pose
detection runs on the phone with Google MediaPipe. No video leaves the phone
unless you share it.

## What it does

- **Live skeleton** drawn over the camera preview (MediaPipe Pose Landmarker, 33 points).
- **Squat counter**: big `7/15` counter, "Squat down" / "Stand back up" cues, voice count and a haptic tap per rep.
- **Form feedback** per rep, spoken and on screen:
  - depth: a quarter squat doesn't count ("Go deeper"), a slightly high one counts with "Go a little deeper"
  - "Keep your chest up" when the torso leans too far forward
  - "Push your knees out" when the knees cave in (front view only)
  - "Slow down" for reps faster than 0.7 s
- **Setup check**: asks you to step back until your whole body is in view.
- **Recording**: optional; when on, the session is recorded and you get two clips:
  - **Coach clip**: the video with the skeleton, rep counter, cue, check mark on good reps and FormUp branding drawn into every frame
  - **Clean clip**: the plain video
  
  Save either one to Photos, or share it through the phone's share sheet (Instagram, TikTok, WhatsApp, ...).
- **Celebration screen**: reps, % good form, time, and a dot per rep (green good, orange needs work, grey didn't count).

## Project layout

| Path | What it is |
| --- | --- |
| `src/exercises/squat.ts` | Rep counter and form rules (knee-angle state machine). All thresholds are in `SQUAT_THRESHOLDS`. |
| `src/pose/` | Landmark indices, skeleton bones, angle maths. |
| `src/clip/timeline.ts` | Records the skeleton and HUD per frame during a recording, and maps it onto the video. |
| `src/screens/` | Home, Workout (camera) and Result (celebration + clip) screens. |
| `modules/coach-clip/` | Small native module (Swift + Kotlin) that burns the overlay into the video. iOS uses AVFoundation, Android uses Media3 Transformer. |
| `assets/models/` | MediaPipe pose models (`full` is used by default, `lite` for older phones). |

## Run it on your phone

This app uses native camera and ML code, so it needs a **development build**
(Expo Go won't work).

### Android (easiest)

1. Install Node 20+ and run `npm install`.
2. `npx eas-cli@latest login` (free Expo account).
3. `npx eas-cli@latest build --profile development --platform android`
4. Open the link EAS gives you on your Android phone and install the APK.
5. Run `npx expo start --dev-client` on your computer, then open the app on the phone and scan the QR code.

Or, with Android Studio installed and the phone plugged in: `npx expo run:android`.

### iPhone

- With a Mac and Xcode: `npx expo run:ios --device`.
- Without a Mac: `npx eas-cli@latest build --profile development --platform ios`. Installing on a real iPhone needs an Apple Developer account ($99/year); EAS walks you through registering the device.

## How to test it

1. Put the phone on the floor or a low shelf, leaning against something, about 2 to 3 m away.
2. Front camera lets you see yourself; back camera gives better quality.
3. Step back until "I can see you 👍" shows, tap **Start & record**, and squat.
4. After the set, wait for the coach clip to render, then try **Save** and **Share**.

Things worth checking on a real phone and reporting back:
- Does the counter ever miss a rep or count twice?
- Do the form cues feel right, too strict, or too lenient? (tune `SQUAT_THRESHOLDS`)
- In the coach clip, does the skeleton line up with your body (also with the front camera)? If it is mirrored, set `flipFrontClipOverlay` in `src/config.ts`.

## Developing

```bash
npm install
npm test            # unit tests for the counter, form rules and clip timeline
npx tsc --noEmit    # typecheck
```

The tests drive the squat counter with synthetic poses: clean reps, quarter
squats, forward lean, fast reps, knee cave, tracking drop-outs and jitter.

## Known limits of this prototype

- Squats only; other exercises come in Phase 2.
- The phone must see the whole body, and only one person should be in frame.
- No audio is recorded in clips.
- Thresholds are first guesses and need tuning with real people.
