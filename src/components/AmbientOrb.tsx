import React from 'react';
import type { Emotion } from '../App';

type OrbMood = 'idle' | 'connecting' | 'listening' | 'agent' | 'user' | 'error';

interface AmbientOrbProps {
  mood: OrbMood;
  /** Last detected debtor emotion. Held across listening turns to read as memory. */
  emotion?: Emotion | null;
}

// Emotion → palette bias. Kept low-saturation: the shift should be felt
// in peripheral vision, never named outright by the operator.
const EMOTION_PALETTE: Record<Emotion, { a: string; b: string; c: string }> = {
  neutral: { a: '#d8a3c2', b: '#a071b8', c: '#6b5c92' }, // default rose-aubergine
  anxious: { a: '#c5a8de', b: '#8a78c0', c: '#5b6098' }, // cooler, drifts toward violet
  confused: { a: '#dfb89c', b: '#b08a82', c: '#8a6b78' }, // warmer amber-mauve
  angry:   { a: '#d893a8', b: '#a8557a', c: '#7a3a5a' }, // rose-deep, no actual red
};

/**
 * Drifting pink/purple ambient light. Three layered, blurred radial blobs
 * float independently; "mood" raises the overall intensity (saturation
 * and scale) without changing the palette — except errors, which shift
 * to a warm rose-red.
 *
 * The orb sits behind everything else, full-bleed, pointer-events: none.
 */
export default function AmbientOrb({ mood, emotion }: AmbientOrbProps) {
  // Backdrop only — never compete with the centerpiece canvas orb.
  // Intensity caps low; the visible pulse comes from the canvas, not the
  // background bloom.
  const intensity =
    mood === 'agent' ? 0.55 :
    mood === 'user' ? 0.48 :
    mood === 'listening' ? 0.42 :
    mood === 'connecting' ? 0.4 :
    mood === 'error' ? 0.5 :
    0.32; // idle

  const speed =
    mood === 'agent' ? '9s' :
    mood === 'user' ? '11s' :
    mood === 'connecting' ? '7s' :
    mood === 'listening' ? '16s' :
    '22s';

  // Duskier palette — pulled toward muted rose and aubergine, less candy.
  // Outside of error, the palette is biased by the *last* detected emotion.
  // During quiet listening the bias persists at full saturation (the
  // intensity damping below makes it feel like a held breath rather than
  // a re-cast). Active user-speaking inherits the same emotion tint so the
  // chromatic dimension reads continuous between speak-and-pause.
  const emotionPalette = EMOTION_PALETTE[emotion ?? 'neutral'];
  const palette = mood === 'error'
    ? { a: '#d96788', b: '#a23652', c: '#7a3046' }
    : emotionPalette;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Big top-right cloud — the headline blob */}
      <div
        className="absolute"
        style={{
          top: '-22%',
          right: '-18%',
          width: '78vw',
          height: '78vw',
          maxWidth: '1200px',
          maxHeight: '1200px',
          background: `radial-gradient(circle at 38% 38%, ${palette.a} 0%, ${palette.b} 38%, transparent 70%)`,
          filter: `blur(${170 / Math.max(intensity, 0.35)}px) saturate(${85 + intensity * 25}%)`,
          opacity: 0.5 * intensity,
          animation: `float-slow ${speed} ease-in-out infinite`,
          willChange: 'transform, opacity',
        }}
      />
      {/* Lower-left echo */}
      <div
        className="absolute"
        style={{
          bottom: '-25%',
          left: '-15%',
          width: '60vw',
          height: '60vw',
          maxWidth: '900px',
          maxHeight: '900px',
          background: `radial-gradient(circle at 50% 50%, ${palette.c} 0%, ${palette.b} 50%, transparent 75%)`,
          filter: `blur(${200 / Math.max(intensity, 0.35)}px) saturate(${80 + intensity * 25}%)`,
          opacity: 0.36 * intensity,
          animation: `float-medium ${speed} ease-in-out infinite reverse`,
          animationDelay: '-3s',
          willChange: 'transform, opacity',
        }}
      />
      {/* Center accent — only visible when active */}
      <div
        className="absolute"
        style={{
          top: '30%',
          left: '50%',
          width: '40vw',
          height: '40vw',
          maxWidth: '700px',
          maxHeight: '700px',
          transform: 'translateX(-50%)',
          background: `radial-gradient(circle at 50% 50%, ${palette.a} 0%, transparent 60%)`,
          filter: `blur(${130 / Math.max(intensity, 0.35)}px)`,
          opacity: intensity > 0.5 ? (intensity - 0.45) * 0.45 : 0,
          transition: 'opacity 700ms ease',
          animation: `breathe ${speed} ease-in-out infinite`,
          willChange: 'opacity',
        }}
      />

      {/* Sheen highlight along the top — gives the page a glossy ceiling */}
      <div
        className="absolute inset-x-0 top-0 h-40 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)',
        }}
      />

      {/* Grain */}
      <div
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")",
        }}
      />
    </div>
  );
}
