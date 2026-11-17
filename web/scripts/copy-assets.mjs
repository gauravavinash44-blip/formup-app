// Copies the MediaPipe WASM runtime and the pose model into public/ so the
// site serves everything itself (no runtime fetches from other hosts).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
mkdirSync(join(web, 'public/wasm'), { recursive: true });
mkdirSync(join(web, 'public/models'), { recursive: true });
cpSync(join(web, 'node_modules/@mediapipe/tasks-vision/wasm'), join(web, 'public/wasm'), { recursive: true });
for (const m of ['pose_landmarker_lite.task', 'pose_landmarker_full.task']) {
  cpSync(join(web, '../assets/models', m), join(web, 'public/models', m));
}
console.log('Copied MediaPipe wasm and models into web/public');
