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
- **Always-on counting**: reps are counted as soon as the camera sees you, no start button.
- **Recording on demand**: nothing is recorded until you tap the red Record button (tap again to stop). You then get two clips:
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

## Web app (main focus for v1)

`web/` is the FormUp web app: a Duolingo-style lesson path that runs in any
phone browser, free, with no install. Pose detection runs in the browser with
MediaPipe; no video is uploaded.

- **Learn tab**: 3 units of short lessons. Formats: Warm-up, Rep Set, Hold It,
  Beat the Clock (only good-form reps count) and Fix the Form (spot the mistake
  in a stick figure, no camera).
- **15 exercises** in `src/exercises/library.ts` (squats, push-ups, lunges,
  bridges, jumping jacks, high knees, press, curls, lateral raises, plank,
  wall sit, deep squat hold, quad stretch, forward fold, overhead reach), all
  driven by the generic engine in `src/exercises/engine.ts`.
- **XP and streaks**: rep targets grow by 1 every 3 streak days (up to +5).
- **Penalty set ("rhino tax")**: miss 1 to 3 days and you owe 10 squats per
  missed day to keep your streak.
- **Progress tab**: XP per day, form trend, totals and badges.
- **Recording on demand**: the red button records the camera with the skeleton
  and counter; save or share it at the end.
- Progress is saved in the browser (localStorage). No account yet.

Live link: https://gauravavinash44-blip.github.io/formup-app/ (needs GitHub
Pages on, branch `gh-pages`). Add `?model=full` for the more accurate pose
model. For testing streaks, `?days-ago=2` pretends your last workout was 2 days
ago.

- Run locally: `cd web && npm install && npm run dev`, then open the printed address.
- Deploy: `cd web && npm run build`, then publish `web/dist` to the `gh-pages` branch.

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

- **Free, with a Mac:** install Xcode, sign in with your Apple ID in Xcode > Settings > Accounts, plug in the iPhone, then run `npx expo run:ios --device`. On the iPhone, trust the developer in Settings > General > VPN & Device Management. Apps signed with a free Apple ID stop opening after 7 days; run the command again to reinstall.
- **With an Apple Developer account ($99/year):** `npx eas-cli@latest build --profile development --platform ios` builds in the cloud and installs over the air; it is also what TestFlight and the App Store need.

## How to test it

1. Put the phone on the floor or a low shelf, leaning against something, about 2 to 3 m away.
2. Front camera lets you see yourself; back camera gives better quality.
3. Tap **Start squats** and step back until your whole body is in view. Counting starts by itself.
4. Tap the red button whenever you want to record, and again to stop.
5. After the set, wait for the coach clip to render, then try **Save** and **Share**.

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
