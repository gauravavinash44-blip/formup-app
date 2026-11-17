import { NativeModule, requireNativeModule } from 'expo';

import type { CoachClipModuleEvents } from './CoachClip.types';

declare class CoachClipModule extends NativeModule<CoachClipModuleEvents> {
  /**
   * Re-encode `inputUri` with the overlay described by `specJson` (a
   * CoachClipSpec, see src/clip/timeline.ts) drawn on every frame.
   * Resolves with the file URI of the finished MP4.
   */
  renderAsync(inputUri: string, specJson: string, outputUri: string): Promise<string>;
}

export default requireNativeModule<CoachClipModule>('CoachClip');
