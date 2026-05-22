import React, { useEffect, useRef } from 'react';
import type { Emotion } from '../App';

interface AudioVisualizerProps {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  isAgentTalking: boolean;
  isUserTalking: boolean;
  /** Last detected debtor emotion. Held across listening to feel like memory. */
  emotion?: Emotion | null;
}

// Per-emotion paint set. Used only for the user-talking and connected-listening
// states (the agent has no emotion of its own; error has its own red palette).
type Paint = {
  ringRgb: string;          // "r, g, b" for rgba interpolation
  userRing: string;         // solid hex for the user-talking ring stroke
  userGradHi: string;
  userGradLo: string;
  listenGradHi: string;
  listenGradLo: string;
  listenRingRgb: string;    // "r, g, b" used for the listening ring/halo
};

const EMOTION_PAINTS: Record<Emotion, Paint> = {
  neutral: {
    ringRgb: '208, 76, 232',
    userRing: '#8b5cf6',
    userGradHi: 'rgba(238, 230, 252, 0.95)',
    userGradLo: 'rgba(225, 217, 248, 0.5)',
    listenGradHi: 'rgba(252, 234, 246, 0.85)',
    listenGradLo: 'rgba(239, 228, 247, 0.45)',
    listenRingRgb: '208, 76, 232',
  },
  anxious: {
    ringRgb: '170, 130, 230',
    userRing: '#7c6cc9',
    userGradHi: 'rgba(232, 226, 252, 0.95)',
    userGradLo: 'rgba(214, 210, 246, 0.5)',
    listenGradHi: 'rgba(238, 232, 250, 0.85)',
    listenGradLo: 'rgba(224, 220, 246, 0.45)',
    listenRingRgb: '150, 120, 220',
  },
  confused: {
    ringRgb: '220, 160, 110',
    userRing: '#b08a82',
    userGradHi: 'rgba(252, 238, 226, 0.95)',
    userGradLo: 'rgba(244, 228, 216, 0.5)',
    listenGradHi: 'rgba(250, 236, 224, 0.85)',
    listenGradLo: 'rgba(240, 226, 214, 0.45)',
    listenRingRgb: '210, 160, 120',
  },
  angry: {
    ringRgb: '220, 92, 132',
    userRing: '#b75a82',
    userGradHi: 'rgba(252, 226, 234, 0.95)',
    userGradLo: 'rgba(244, 216, 226, 0.5)',
    listenGradHi: 'rgba(250, 226, 234, 0.85)',
    listenGradLo: 'rgba(240, 216, 226, 0.45)',
    listenRingRgb: '210, 100, 140',
  },
};

/**
 * Siri-style organic orb rendered on canvas. The waveform amplitude and
 * inner glow shift with state. Palette is rose/magenta/violet to harmonise
 * with the ambient backdrop — never indigo or emerald.
 */
export default function AudioVisualizer({
  status,
  isAgentTalking,
  isUserTalking,
  emotion,
}: AudioVisualizerProps) {
  const paint = EMOTION_PAINTS[emotion ?? 'neutral'];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    let phase = 0;

    const draw = () => {
      ctx.clearRect(0, 0, rect.width, rect.height);
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // Base radius scales to canvas size so the orb feels generous.
      const minDim = Math.min(rect.width, rect.height);
      let baseRadius = minDim * 0.24;
      let amplitude = 0;
      let ringStroke = 'rgba(28, 24, 32, 0.18)';
      let ringRGBA = 'rgba(208, 76, 232, 0.0)';
      // Idle gets a true zero-deform circle — no waveform, no shake,
      // just a still pearl disc with one soft halo. Active states keep
      // the waveform deformation.
      let deformPath = true;
      let drawHalo = false;

      if (status === 'error') {
        amplitude = 1;
        baseRadius += Math.sin(phase) * 1.5;
        ringStroke = '#ef4444';
        ringRGBA = 'rgba(239, 68, 68, 0.12)';
      } else if (status === 'connecting') {
        amplitude = 3;
        baseRadius += Math.sin(phase * 4) * 2.5;
        ringStroke = '#f59e0b';
        ringRGBA = 'rgba(245, 158, 11, 0.1)';
      } else if (isAgentTalking) {
        amplitude = minDim * 0.075;
        baseRadius += Math.sin(phase * 2.4) * 5;
        ringStroke = '#d04ce8';
        ringRGBA = 'rgba(208, 76, 232, 0.14)';
      } else if (isUserTalking) {
        amplitude = minDim * 0.05;
        baseRadius += Math.cos(phase * 3) * 4;
        ringStroke = paint.userRing;
        ringRGBA = `rgba(${paint.ringRgb}, 0.14)`;
      } else if (status === 'connected') {
        // Quiet listening — slow soft breath, no waveform shimmer.
        // Ring colour reads from `paint.listenRingRgb` so the *last* emotion
        // detected persists through the quiet moment as a held breath.
        amplitude = 0;
        baseRadius += Math.sin(phase * 0.5) * 1.2;
        ringStroke = `rgba(${paint.listenRingRgb}, 0.45)`;
        ringRGBA = `rgba(${paint.listenRingRgb}, 0.08)`;
        deformPath = false;
        drawHalo = true;
      } else {
        // Idle / disconnected — breathing pearl. Slow, noticeable scale
        // pulse (~±4%) plus halo opacity pulse to read as a living, waiting
        // object, not a static disc.
        amplitude = 0;
        const breath = Math.sin(phase * 0.6); // slow
        baseRadius += breath * minDim * 0.018;
        const haloAlpha = 0.06 + (breath + 1) * 0.05; // 0.06 → 0.16
        const strokeAlpha = 0.28 + (breath + 1) * 0.06; // 0.28 → 0.40
        ringStroke = `rgba(160, 113, 184, ${strokeAlpha.toFixed(3)})`;
        ringRGBA = `rgba(208, 138, 200, ${haloAlpha.toFixed(3)})`;
        deformPath = false;
        drawHalo = true;
      }

      phase += 0.07;

      // Concentric soft rings — denser when active.
      if (status === 'connected' || status === 'connecting' || status === 'error' || drawHalo) {
        const isIdle = status !== 'connected' && status !== 'connecting' && status !== 'error';
        const ringsCount = isAgentTalking
          ? 4
          : isUserTalking
          ? 3
          : status === 'connecting'
          ? 2
          : isIdle
          ? 3
          : 1;
        for (let i = 1; i <= ringsCount; i++) {
          ctx.beginPath();
          // Idle: each ring pulses outward with a phase-shifted breath,
          // creating a soft heartbeat that reads as "waiting, ready".
          if (isIdle) {
            const t = (phase * 0.18 + i * 0.45) % 1.4;
            const expansion = t / 1.4; // 0 → 1
            const r = baseRadius + minDim * 0.02 + expansion * minDim * 0.22;
            const alpha = (1 - expansion) * 0.18;
            ctx.strokeStyle = `rgba(208, 138, 200, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 1.2;
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
          } else {
            ctx.strokeStyle = ringRGBA;
            ctx.lineWidth = 1.4 / Math.sqrt(i);
            const breath = isAgentTalking || isUserTalking ? Math.sin(phase + i) * 0.1 : 0;
            const r = baseRadius + i * (minDim * 0.06) * (1 + breath);
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
          }
          ctx.stroke();
        }
      }

      // Main boundary — perfect circle when deformPath is false.
      ctx.beginPath();
      ctx.strokeStyle = ringStroke;
      ctx.lineWidth = deformPath ? 2 : 1.4;
      if (!deformPath) {
        ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      } else {
        const points = 96;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const offset =
            Math.sin(angle * 5 + phase) *
            Math.cos(angle * 3 + phase * 0.6) *
            amplitude *
            (0.6 + 0.4 * Math.sin(phase * 1.2));
          const r = baseRadius + offset;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.stroke();

      // Soft gradient core fill — pearlescent, never flat.
      const grad = ctx.createRadialGradient(
        cx - baseRadius * 0.25,
        cy - baseRadius * 0.3,
        baseRadius * 0.1,
        cx,
        cy,
        baseRadius,
      );

      if (status === 'error') {
        grad.addColorStop(0, 'rgba(254, 226, 226, 0.95)');
        grad.addColorStop(1, 'rgba(254, 242, 242, 0.55)');
      } else if (isAgentTalking) {
        grad.addColorStop(0, 'rgba(255, 232, 244, 0.95)');
        grad.addColorStop(0.55, 'rgba(241, 215, 248, 0.7)');
        grad.addColorStop(1, 'rgba(221, 207, 247, 0.45)');
      } else if (isUserTalking) {
        grad.addColorStop(0, paint.userGradHi);
        grad.addColorStop(1, paint.userGradLo);
      } else if (status === 'connecting') {
        grad.addColorStop(0, 'rgba(254, 243, 199, 0.9)');
        grad.addColorStop(1, 'rgba(255, 251, 235, 0.5)');
      } else if (status === 'connected') {
        grad.addColorStop(0, paint.listenGradHi);
        grad.addColorStop(1, paint.listenGradLo);
      } else {
        // Idle — soft pearl: warm cream → faint rose → faint lavender shadow
        grad.addColorStop(0, 'rgba(255, 250, 252, 0.95)');
        grad.addColorStop(0.55, 'rgba(245, 230, 240, 0.78)');
        grad.addColorStop(1, 'rgba(220, 205, 232, 0.52)');
      }
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(cx, cy, baseRadius - 1, 0, Math.PI * 2);
      ctx.fill();

      // Tiny highlight cap (gloss).
      const highlight = ctx.createRadialGradient(
        cx - baseRadius * 0.35,
        cy - baseRadius * 0.45,
        2,
        cx - baseRadius * 0.35,
        cy - baseRadius * 0.45,
        baseRadius * 0.55,
      );
      highlight.addColorStop(0, 'rgba(255,255,255,0.55)');
      highlight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.fillStyle = highlight;
      ctx.arc(cx, cy, baseRadius - 1, 0, Math.PI * 2);
      ctx.fill();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [status, isAgentTalking, isUserTalking, emotion]);

  return (
    <div className="relative w-full grid place-items-center">
      <canvas
        ref={canvasRef}
        className="w-[320px] h-[320px] sm:w-[400px] sm:h-[400px]"
      />
    </div>
  );
}
