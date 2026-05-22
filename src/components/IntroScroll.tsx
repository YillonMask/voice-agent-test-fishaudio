import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Cpu, GitGraph, ShieldCheck, Mic } from 'lucide-react';

/**
 * Below-the-fold introduction. Uses IntersectionObserver to reveal blocks
 * as the reader scrolls down. Aims for an editorial, lightly-paced feel —
 * not a marketing page.
 */
export default function IntroScroll() {
  return (
    <section className="relative w-full max-w-5xl mx-auto px-6 sm:px-10 py-24 sm:py-32 space-y-32">
      {/* Lead */}
      <Reveal>
        <div className="space-y-5">
          <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-500">
            on the architecture
          </span>
          <h2 className="font-display text-[44px] sm:text-[68px] leading-[0.98] tracking-tight text-zinc-900 text-balance">
            The graph owns the dialogue.
            <br />
            <em className="italic text-zinc-500">LiveKit owns the audio.</em>
          </h2>
          <p className="font-display italic text-[20px] sm:text-[22px] text-zinc-600 max-w-2xl leading-snug text-pretty">
            Two processes, one rule. The single architectural law that keeps a voice
            agent from drifting into a thousand prompt-engineered hacks.
          </p>
        </div>
      </Reveal>

      {/* Process split */}
      <Reveal>
        <div className="grid md:grid-cols-2 gap-5">
          <ArchCard
            badge="01"
            tone="indigo"
            kicker="Node · :3000"
            title="The portal"
            body="Mints LiveKit JWT tokens, pre-creates the room with the debtor JSON in room.metadata, and never touches an audio buffer."
            tag={['/api/livekit/token', '/api/agent-status', '/api/compliance/logs']}
          />
          <ArchCard
            badge="02"
            tone="rose"
            kicker="Python worker"
            title="The agent"
            body="Joins the room, reads debtor metadata, seeds CallState, then runs an AgentSession with LangGraph as the LLM. State persists per-room via MemorySaver."
            tag={['Silero VAD', 'Deepgram Nova-3', 'Gemini 3.5 Flash', 'Fish S1']}
          />
        </div>
      </Reveal>

      {/* Three steps */}
      <Reveal>
        <div className="space-y-8">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-500">
              how a turn flows
            </span>
            <h3 className="font-display text-[32px] sm:text-[40px] text-zinc-900 leading-tight mt-1">
              From spoken syllable to <em className="italic text-zinc-500">audited</em> reply.
            </h3>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <Step
              icon={<Mic className="w-4 h-4" />}
              n="01"
              title="Capture"
              body="VAD detects speech onset, Deepgram returns endpointed text."
            />
            <Step
              icon={<GitGraph className="w-4 h-4" />}
              n="02"
              title="Reason"
              body="LangGraph routes by stage — opening → verify → explain → negotiate → commit — never re-asking what's verified."
            />
            <Step
              icon={<ShieldCheck className="w-4 h-4" />}
              n="03"
              title="Audit"
              body="Every draft passes a compliance node. Up to two FDCPA rewrites, then a canned-safe fallback."
            />
          </div>
        </div>
      </Reveal>

      {/* Closing rule */}
      <Reveal>
        <div className="glass-deep rounded-3xl px-8 sm:px-12 py-10 sm:py-14 space-y-5">
          <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-500">
            the one rule
          </span>
          <p className="font-display italic text-[26px] sm:text-[34px] text-zinc-900 leading-[1.15] text-balance">
            Anything about <span className="text-zinc-500">what should the agent say</span> is a graph node.
            Anything about <span className="text-zinc-500">when does the agent speak</span> is LiveKit.
          </p>
          <p className="text-[13px] text-zinc-600 max-w-xl leading-relaxed">
            Compliance, audit, cease-and-desist — all graph nodes, never prompt instructions.
            The boundary is what makes the system testable without spinning up an audio stack.
          </p>
        </div>
      </Reveal>

      <div className="text-center pt-10 pb-6">
        <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-400">
          fin · scroll up to dial
        </span>
      </div>
    </section>
  );
}

function ArchCard({
  badge,
  kicker,
  title,
  body,
  tag,
  tone,
}: {
  badge: string;
  kicker: string;
  title: string;
  body: string;
  tag: string[];
  tone: 'rose' | 'indigo';
}) {
  return (
    <div className="glass-deep rounded-3xl p-7 sm:p-8 space-y-3 relative overflow-hidden">
      <div
        className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none"
        style={{
          background:
            tone === 'rose'
              ? 'radial-gradient(circle, rgba(255,110,199,0.4) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)',
          filter: 'blur(30px)',
        }}
      />
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.22em]">
        <span className="text-zinc-400">{badge}</span>
        <span className="text-zinc-500">{kicker}</span>
      </div>
      <h4 className="font-display text-[36px] text-zinc-900 leading-none">{title}</h4>
      <p className="text-[14px] text-zinc-600 leading-relaxed">{body}</p>
      <div className="flex flex-wrap gap-1.5 pt-2">
        {tag.map((t) => (
          <span
            key={t}
            className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/55 border border-white/60 text-zinc-700"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Step({
  icon,
  n,
  title,
  body,
}: {
  icon: React.ReactNode;
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="glass-thin rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#ff8fd0] to-[#8b5cf6] text-white grid place-items-center">
          {icon}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">{n}</span>
      </div>
      <h5 className="font-display text-[22px] text-zinc-900 leading-none">{title}</h5>
      <p className="text-[12px] text-zinc-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -80px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(28px)',
        transition: 'opacity 900ms cubic-bezier(0.22, 1, 0.36, 1), transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {children}
    </div>
  );
}

// Tiny visual cue that there's more below
export function ScrollCue() {
  return (
    <div className="text-center">
      <div className="inline-flex flex-col items-center gap-1 text-zinc-400 animate-bounce">
        <span className="text-[9px] font-mono uppercase tracking-[0.28em]">scroll</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}
