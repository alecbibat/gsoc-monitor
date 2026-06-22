import { useEffect, useRef } from 'react';
import { useScreensaverStore } from './screensaverStore';

// Speaks the name of the current POI via the Web Speech API when the screensaver
// arrives at a location (phase === 'at-poi'). Triggered only when voiceEnabled is
// on; cancelled immediately if voice is toggled off or the screensaver stops.
export function PinsVoice() {
  const active = useScreensaverStore((s) => s.active);
  const phase = useScreensaverStore((s) => s.phase);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const voiceEnabled = useScreensaverStore((s) => s.voiceEnabled);

  // Track what we last announced so rapid re-renders don't repeat the same name.
  const lastKey = useRef('');

  useEffect(() => {
    if (!active || !voiceEnabled || phase !== 'at-poi' || !poi) return;

    const key = `${poi.title}::${poi.lat}::${poi.lon}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    const synth = window.speechSynthesis;
    if (!synth) return;

    synth.cancel();
    const u = new SpeechSynthesisUtterance(poi.title);
    u.rate = 0.88;
    u.pitch = 1.0;
    synth.speak(u);
  }, [active, voiceEnabled, phase, poi]);

  // Cancel immediately when voice is disabled or screensaver stops.
  useEffect(() => {
    if (active && voiceEnabled) return;
    try { window.speechSynthesis?.cancel(); } catch {}
    lastKey.current = '';
  }, [active, voiceEnabled]);

  return null;
}
