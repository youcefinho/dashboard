// ── sensorial.ts — Sprint 25 vague 4A ──────────────────────────────────────
// Singleton Web Audio + Vibration plumbing. Non-hook fallback for global code
// (Toast variants, lib modules, anywhere outside React render tree).
//
// Pourquoi : on veut un AudioContext partagé entre useSound hook et playSound
// global. Sinon plusieurs contexts (un par mount) = autoplay policy bugs.
//
// Storage keys (préfixés intralys_*) :
//   - intralys_sound_enabled   ('true'|'false', default true)
//   - intralys_sound_volume    (0..1 string, default '0.3')
//   - intralys_haptic_enabled  ('true'|'false', default true)
//
// `prefers-reduced-motion: reduce` → coupe TOUT (sons + haptics) sans
// possibilité de re-activer tant que la préférence système est active.

export type SoundName =
  | 'toggle'
  | 'success'
  | 'error'
  | 'notif'
  | 'send'
  | 'celebrate'
  | 'tick';

export type HapticIntensity =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'error';

// ── Constantes storage ─────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  soundEnabled: 'intralys_sound_enabled',
  soundVolume: 'intralys_sound_volume',
  hapticEnabled: 'intralys_haptic_enabled',
} as const;

export const DEFAULTS = {
  soundEnabled: true,
  soundVolume: 0.3,
  hapticEnabled: true,
} as const;

// ── Mapping haptic patterns (ms) ───────────────────────────────────────────
export const HAPTIC_PATTERNS: Record<HapticIntensity, number | number[]> = {
  light: 10,
  medium: 18,
  heavy: 30,
  success: [10, 40, 18],
  error: [30, 60, 30, 60, 30],
};

// ── Reduced motion detection (live) ────────────────────────────────────────
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
}

// ── Storage helpers ────────────────────────────────────────────────────────
function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function readFloat(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  } catch {
    return fallback;
  }
}

export function writeBool(key: string, v: boolean): void {
  try {
    window.localStorage.setItem(key, v ? 'true' : 'false');
  } catch {
    /* noop */
  }
}

export function writeFloat(key: string, v: number): void {
  try {
    window.localStorage.setItem(key, String(Math.max(0, Math.min(1, v))));
  } catch {
    /* noop */
  }
}

export function getSoundEnabled(): boolean {
  return readBool(STORAGE_KEYS.soundEnabled, DEFAULTS.soundEnabled);
}

export function getSoundVolume(): number {
  return readFloat(STORAGE_KEYS.soundVolume, DEFAULTS.soundVolume);
}

export function getHapticEnabled(): boolean {
  return readBool(STORAGE_KEYS.hapticEnabled, DEFAULTS.hapticEnabled);
}

// ── AudioContext singleton ─────────────────────────────────────────────────
// Lazy : créé au premier appel à getAudioContext(). On évite Web Audio
// instancié avant interaction utilisateur (bypass autoplay policy Chrome/Safari).

let _ctx: AudioContext | null = null;
let _ctxCreationAttempted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (_ctx) {
    // Resume si suspended (cas Safari/iOS après idle)
    if (_ctx.state === 'suspended') {
      _ctx.resume().catch(() => { /* ignore */ });
    }
    return _ctx;
  }
  if (_ctxCreationAttempted) return null;
  _ctxCreationAttempted = true;
  try {
    const AC =
      (window as any).AudioContext ||
      (window as any).webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
    // Best-effort resume — si autoplay policy bloque, échoue silencieusement
    if (_ctx && _ctx.state === 'suspended') {
      _ctx.resume().catch(() => { /* ignore */ });
    }
    return _ctx;
  } catch {
    return null;
  }
}

// ── Sound generators (procédural, 30-180ms max) ────────────────────────────
//
// Choix design (vague 4A) :
// - toggle   : square 200Hz, 40ms, decay (click switch satisfaisant)
// - success  : sine sweep 440→880Hz, 120ms, ADSR (mini-arpège up)
// - error    : sine sweep 220→110Hz, 180ms (descente "uh-oh")
// - notif    : triangle 660Hz, double pulse 80ms + pause 40ms + 80ms
// - send     : sine 880Hz, 30ms, attack rapide (le "plink" Superhuman)
// - celebrate: chord C4+E4+G4 (261.63+329.63+392), 200ms harmonique sine
// - tick     : square 1000Hz, 15ms (drag&drop step click sec)

function envelopeADSR(
  gain: GainNode,
  _ctx: AudioContext,
  startTime: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  sustainLevelRatio: number,
  release: number,
): void {
  const g = gain.gain;
  g.cancelScheduledValues(startTime);
  g.setValueAtTime(0, startTime);
  g.linearRampToValueAtTime(peak, startTime + attack);
  g.linearRampToValueAtTime(peak * sustainLevelRatio, startTime + attack + decay);
  g.setValueAtTime(peak * sustainLevelRatio, startTime + attack + decay + sustain);
  g.linearRampToValueAtTime(0, startTime + attack + decay + sustain + release);
}

function playToggle(ctx: AudioContext, volume: number): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(200, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume * 0.5, t0 + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.040);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.045);
}

function playSuccess(ctx: AudioContext, volume: number): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.100);
  envelopeADSR(gain, ctx, t0, volume * 0.6, 0.008, 0.024, 0.060, 0.65, 0.028);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.130);
}

function playError(ctx: AudioContext, volume: number): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.180);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume * 0.55, t0 + 0.012);
  gain.gain.linearRampToValueAtTime(volume * 0.45, t0 + 0.090);
  gain.gain.linearRampToValueAtTime(0, t0 + 0.180);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.185);
}

function playNotif(ctx: AudioContext, volume: number): void {
  // Double pulse 80ms + 40ms pause + 80ms
  const t0 = ctx.currentTime;
  const playPulse = (start: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * 0.5, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.080);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.085);
  };
  playPulse(t0);
  playPulse(t0 + 0.080 + 0.040);
}

function playSend(ctx: AudioContext, volume: number): void {
  // Le "plink" Superhuman — sine 880Hz, 30ms, attack ultra-rapide
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume * 0.55, t0 + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.030);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.035);
}

function playCelebrate(ctx: AudioContext, volume: number): void {
  // Chord harmonique C4 + E4 + G4 sine, 200ms
  const t0 = ctx.currentTime;
  const freqs = [261.63, 329.63, 392.0];
  const mix = ctx.createGain();
  mix.gain.setValueAtTime(0, t0);
  mix.gain.linearRampToValueAtTime(volume * 0.45, t0 + 0.012);
  mix.gain.linearRampToValueAtTime(volume * 0.35, t0 + 0.130);
  mix.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.200);
  mix.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t0);
    osc.connect(mix);
    osc.start(t0);
    osc.stop(t0 + 0.210);
  }
}

function playTick(ctx: AudioContext, volume: number): void {
  // Sec et bref — square 1000Hz, 15ms
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1000, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume * 0.35, t0 + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.015);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.020);
}

const SOUND_DISPATCH: Record<SoundName, (ctx: AudioContext, v: number) => void> = {
  toggle: playToggle,
  success: playSuccess,
  error: playError,
  notif: playNotif,
  send: playSend,
  celebrate: playCelebrate,
  tick: playTick,
};

// ── playSound public (non-hook fallback) ───────────────────────────────────
export function playSound(name: SoundName): void {
  if (prefersReducedMotion()) return;
  if (!getSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const volume = getSoundVolume();
  if (volume <= 0) return;
  try {
    SOUND_DISPATCH[name](ctx, volume);
  } catch {
    /* silent — autoplay policy ou bug oscillator */
  }
}

// ── triggerHaptic public (non-hook fallback) ───────────────────────────────
export function triggerHaptic(intensity: HapticIntensity | number | number[]): void {
  if (prefersReducedMotion()) return;
  if (!getHapticEnabled()) return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    let pattern: number | number[];
    if (typeof intensity === 'string') {
      pattern = HAPTIC_PATTERNS[intensity];
    } else {
      pattern = intensity;
    }
    navigator.vibrate(pattern);
  } catch {
    /* iOS Safari throws parfois — noop */
  }
}

// ── Touch device detection (used by Settings UI) ───────────────────────────
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  if ('ontouchstart' in window) return true;
  if ((navigator as any).maxTouchPoints > 0) return true;
  return false;
}

// ── Reduced motion live subscription ───────────────────────────────────────
export function subscribeReducedMotion(cb: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => { /* noop */ };
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => cb(mq.matches);
  apply();
  mq.addEventListener?.('change', apply);
  return () => mq.removeEventListener?.('change', apply);
}

export function isReducedMotion(): boolean {
  return prefersReducedMotion();
}
