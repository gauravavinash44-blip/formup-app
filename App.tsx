import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';

import { APP } from './src/config';
import { HomeScreen, type WorkoutSettings } from './src/screens/HomeScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { WorkoutScreen, type SessionResult } from './src/screens/WorkoutScreen';

type Screen = { name: 'home' } | { name: 'workout' } | { name: 'result'; result: SessionResult };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [settings, setSettings] = useState<WorkoutSettings>({
    target: APP.defaultTarget,
    position: 'front',
    record: true,
  });

  return (
    <>
      <StatusBar style="light" />
      {screen.name === 'home' && (
        <HomeScreen settings={settings} onChange={setSettings} onStart={() => setScreen({ name: 'workout' })} />
      )}
      {screen.name === 'workout' && (
        <WorkoutScreen
          target={settings.target}
          position={settings.position}
          record={settings.record}
          onCancel={() => setScreen({ name: 'home' })}
          onFinish={(result) => setScreen({ name: 'result', result })}
        />
      )}
      {screen.name === 'result' && (
        <ResultScreen result={screen.result} onDone={() => setScreen({ name: 'home' })} />
      )}
    </>
  );
}
