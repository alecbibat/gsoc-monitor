import { useEffect, useRef } from 'react';
import { useScreensaverStore } from './screensaverStore';

// Preferred British female voices across platforms (Edge neural, Chrome Google,
// macOS, Windows). Earlier in the list = stronger preference. The neural/online
// voices (Sonia, Libby, …) sound dramatically better than the legacy ones.
const PREFERRED_GB_FEMALE = [
  'sonia',   // Microsoft Sonia (Natural) — en-GB, smooth + composed
  'libby',   // Microsoft Libby (Natural) — en-GB
  'olivia',  // Microsoft Olivia (Natural) — en-GB
  'hollie',  // Microsoft Hollie (Natural) — en-GB
  'bella',   // Microsoft Bella (Natural) — en-GB
  'abbi',    // Microsoft Abbi (Natural) — en-GB
  'serena',  // macOS — en-GB
  'kate',    // macOS — en-GB
  'stephanie',
  'martha',
  'hazel',   // Microsoft Hazel (legacy) — en-GB
  'google uk english female',
];

const GB_MALE = ['daniel', 'george', 'arthur', 'ryan', 'oliver', 'thomas', 'alfie', 'elliot', 'ethan', 'noah', 'google uk english male'];

function isBritish(v: SpeechSynthesisVoice): boolean {
  const lang = (v.lang ?? '').toLowerCase().replace('_', '-');
  return lang.startsWith('en-gb');
}

// Score voices so the coolest British woman wins: British + a known female
// neural name beats everything; male voices are pushed to the bottom.
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase();
    let s = isBritish(v) ? 100 : 0;
    const idx = PREFERRED_GB_FEMALE.findIndex((n) => name.includes(n));
    if (idx >= 0) s += 60 - idx;
    if (name.includes('natural') || name.includes('neural') || name.includes('online')) s += 15;
    if (name.includes('female')) s += 25;
    else if (name.includes('male')) s -= 60; // note: 'female' handled above
    if (GB_MALE.some((n) => name.includes(n))) s -= 80;
    return s;
  };

  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Speaks the name of the current POI via the Web Speech API when the screensaver
// arrives at a location (phase === 'at-poi'), in a cool British female voice.
// Triggered only when voiceEnabled is on; cancelled if voice is toggled off or
// the screensaver stops.
export function PinsVoice() {
  const active = useScreensaverStore((s) => s.active);
  const phase = useScreensaverStore((s) => s.phase);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const voiceEnabled = useScreensaverStore((s) => s.voiceEnabled);

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Track what we last announced so rapid re-renders don't repeat the same name.
  const lastKey = useRef('');

  // Resolve the best British-female voice once the list is available. Voices load
  // asynchronously in most browsers, so also listen for voiceschanged.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => { voiceRef.current = pickVoice(synth.getVoices()); };
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
    return () => synth.removeEventListener?.('voiceschanged', refresh);
  }, []);

  useEffect(() => {
    if (!active || !voiceEnabled || phase !== 'at-poi' || !poi) return;

    const key = `${poi.title}::${poi.lat}::${poi.lon}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    const synth = window.speechSynthesis;
    if (!synth) return;

    synth.cancel();
    const u = new SpeechSynthesisUtterance(poi.title);
    const v = voiceRef.current ?? pickVoice(synth.getVoices());
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      // No explicit pick available — still nudge the engine toward British English.
      u.lang = 'en-GB';
    }
    u.rate = 0.92;  // measured, composed
    u.pitch = 0.9;  // smooth + slightly lower — "cool"
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
