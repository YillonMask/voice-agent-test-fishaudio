import React, { useState } from 'react';
import { CallStage, ComplianceCheck } from '../types';
import type { Signals, Emotion, Objection } from '../App';
import { COMPLIANCE_RULES } from '../data';
import { Shield, ShieldCheck, ScrollText, ChevronDown, Cpu } from 'lucide-react';

const STAGES = [
  { id: 'opening', label: 'Disclosure', desc: 'State purpose & company' },
  { id: 'verify', label: 'Verification', desc: 'SSN tail & birth year' },
  { id: 'explain', label: 'Dossier', desc: 'Creditor, balance, aging' },
  { id: 'negotiation', label: 'Negotiation', desc: 'Handle objections' },
  { id: 'commitment', label: 'Resolution', desc: 'Plan committed' },
];

function stageIndex(s: CallStage): number {
  if (s === 'opening') return 0;
  if (s === 'verify') return 1;
  if (s === 'explain') return 2;
  if (s === 'negotiation' || s === 'compliance' || (s as string) === 'hardship' ||
      (s as string) === 'dispute' || (s as string) === 'paid' ||
      (s as string) === 'deescalate' || (s as string) === 'plan') return 3;
  if (s === 'commitment' || s === 'summary' || (s as string) === 'commit' ||
      (s as string) === 'recap' || (s as string) === 'close') return 4;
  return -1;
}

// ── Stage chip with hover-expand ─────────────────────────────────────

const EMOTION_DOT: Record<Emotion, string> = {
  neutral: 'bg-zinc-400',
  anxious: 'bg-violet-400',
  confused: 'bg-amber-400',
  angry: 'bg-rose-400',
};

const OBJECTION_LABEL: Record<Objection, string> = {
  no_money: 'claims hardship',
  not_mine: 'disputes ownership',
  already_paid: 'states paid',
  need_proof: 'wants validation',
  refuse: 'asks to cease',
};

export function StageChip({ stage, signals }: { stage: CallStage; signals?: Signals }) {
  const idx = stageIndex(stage);
  const active = STAGES[idx];

  return (
    <div className="group relative">
      <button className="gloss rounded-full pl-2 pr-3.5 py-1.5 flex items-center gap-2 text-[11px]">
        {/* Mini dot strip */}
        <span className="flex items-center gap-1 pl-1.5 pr-2 border-r border-zinc-300/40">
          {STAGES.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i < idx
                  ? 'bg-zinc-900'
                  : i === idx
                  ? 'bg-gradient-to-br from-[#ff6ec7] to-[#8b5cf6] shadow-[0_0_8px_rgba(208,76,232,0.55)]'
                  : 'bg-zinc-300'
              }`}
            />
          ))}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {idx < 0 ? 'idle' : `${idx + 1}/5`}
        </span>
        <span className="text-zinc-800">
          {active?.label || 'Standby'}
        </span>
      </button>

      {/* Hover cascade — three floating cards unfurl downward.
          Each card uses the same translate/opacity transition, but with a
          staggered delay so they feel like the chip is "exhaling" its state. */}
      <div className="absolute right-0 top-[calc(100%+8px)] w-[280px] pointer-events-none group-hover:pointer-events-auto space-y-2">
        <CascadeCard delay={0}>
          <PipelineCard idx={idx} />
        </CascadeCard>
        <CascadeCard delay={80}>
          <DebtorReadCard signals={signals} />
        </CascadeCard>
        <CascadeCard delay={160}>
          <IdentityCard signals={signals} />
        </CascadeCard>
      </div>
    </div>
  );
}

function CascadeCard({ children, delay }: { children: React.ReactNode; delay: number }) {
  // Hidden until parent .group:hover, then fades+slides into place.
  // duration-300 + per-card delay → the three cards arrive in sequence.
  return (
    <div
      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-out"
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="glass-deep rounded-2xl p-3.5">
        {children}
      </div>
    </div>
  );
}

function PipelineCard({ idx }: { idx: number }) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400">
        Conversation pipeline
      </div>
      {STAGES.map((s, i) => {
        const isCurrent = i === idx;
        const isDone = i < idx;
        return (
          <div key={s.id} className="flex items-baseline gap-2">
            <span
              className={`w-4 h-4 rounded-full grid place-items-center text-[9px] font-mono shrink-0 ${
                isCurrent
                  ? 'bg-gradient-to-br from-[#ff6ec7] to-[#8b5cf6] text-white'
                  : isDone
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white/65 text-zinc-400 border border-white/70'
              }`}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className={`text-[11px] font-medium ${isCurrent ? 'text-zinc-900' : 'text-zinc-700'}`}>
                {s.label}
              </div>
              <div className="text-[10px] text-zinc-500 leading-snug">{s.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DebtorReadCard({ signals }: { signals?: Signals }) {
  const emotion = signals?.emotion ?? null;
  const objection = signals?.objection ?? null;
  const ceasing = signals?.cease_requested;

  // Always render two rows so the card height stays stable as readings arrive.
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400">
        Debtor read
      </div>
      {/* Emotion row */}
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            emotion ? EMOTION_DOT[emotion] : 'bg-zinc-300'
          }`}
          style={emotion ? { animation: 'breathe 1.8s ease-in-out infinite' } : undefined}
        />
        <span className="text-[11px] font-medium text-zinc-800 capitalize">
          {emotion ?? 'awaiting tone…'}
        </span>
      </div>
      {/* Objection / intent row */}
      <div className="flex items-baseline gap-2 pl-3.5">
        <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400 shrink-0">
          intent
        </span>
        <span className="text-[11px] text-zinc-700 leading-snug">
          {ceasing
            ? 'asks to cease'
            : objection
            ? OBJECTION_LABEL[objection]
            : <span className="text-zinc-400 italic">no objection yet</span>}
        </span>
      </div>
    </div>
  );
}

function IdentityCard({ signals }: { signals?: Signals }) {
  const verified = !!signals?.identity_verified;
  const attempts = signals?.verify_attempts ?? 0;
  const handoff = !!signals?.must_handoff;

  const ATTEMPT_SLOTS = 3;
  const statusWord = handoff
    ? 'mailed handoff'
    : verified
    ? 'verified'
    : attempts === 0
    ? 'pending'
    : 'in progress';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400">
          Identity
        </div>
        <div
          className={`text-[9px] font-mono uppercase tracking-[0.22em] ${
            verified
              ? 'text-emerald-600'
              : handoff
              ? 'text-rose-600'
              : 'text-zinc-500'
          }`}
        >
          {statusWord}
        </div>
      </div>

      {/* Three attempt slots laid horizontally — visual counter without showing the number */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {Array.from({ length: ATTEMPT_SLOTS }).map((_, i) => {
          const used = i < attempts;
          const tone = verified
            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
            : handoff
            ? 'bg-rose-500/80'
            : used
            ? 'bg-zinc-900'
            : 'bg-white/70 border border-zinc-300/60';
          return (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${tone}`}
            />
          );
        })}
        <span className="ml-2 text-[10px] text-zinc-500 leading-snug">
          {verified
            ? 'records match'
            : handoff
            ? 'switching to physical mail'
            : attempts === 0
            ? 'awaiting credentials'
            : 'gathering credentials'}
        </span>
      </div>
    </div>
  );
}

// ── Compliance chip with click-expand ────────────────────────────────

export function ComplianceChip({
  logs,
  checklist,
}: {
  logs: ComplianceCheck[];
  checklist: { disclosure: boolean; confidentiality: boolean; noThreats: boolean; professional: boolean };
}) {
  const [open, setOpen] = useState(false);
  const passed = Object.values(checklist).filter(Boolean).length;
  const total = 4;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="gloss rounded-full px-3.5 py-1.5 flex items-center gap-2 text-[11px]"
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-zinc-800">
          FDCPA <span className="font-mono text-zinc-500">{passed}/{total}</span>
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            passed === total ? 'bg-emerald-500' : passed > 0 ? 'bg-amber-400' : 'bg-zinc-300'
          }`}
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-zinc-900/15 backdrop-blur-sm animate-fade flex items-end sm:items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-deep rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden animate-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-white/40">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400">
                  Compliance ledger · Fair Debt Collection Practices Act
                </div>
                <h3 className="font-display italic text-[24px] text-zinc-900 leading-snug">
                  Compliance is a graph node, not a prompt.
                </h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[11px] text-zinc-500 hover:text-zinc-800 flex items-center gap-1"
              >
                close <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            <div className="overflow-y-auto thin-scrollbar max-h-[64vh] px-6 py-5 space-y-5">
              {/* Live checklist */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <ChecklistTile label="Disclosure" code="§ 805" passed={checklist.disclosure} />
                <ChecklistTile label="Verify ID" code="Privacy" passed={checklist.confidentiality} />
                <ChecklistTile label="Decorum" code="§ 806" passed={checklist.professional} />
                <ChecklistTile label="No threats" code="§ 807" passed={checklist.noThreats} />
              </div>

              {/* Audit log */}
              <div>
                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400 mb-2">
                  Continuous audit · {logs.length} entries
                </div>
                <div className="glass-thin rounded-2xl overflow-hidden">
                  {logs.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[11px] text-zinc-500 italic font-display">
                      No verification events recorded. Dial a session to begin.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/40">
                      {logs.slice(0, 12).map((l) => (
                        <div key={l.id} className="px-4 py-2.5 grid grid-cols-[80px_90px_1fr] gap-3 items-baseline">
                          <span className="font-mono text-[10px] text-zinc-400">{l.timestamp}</span>
                          <span
                            className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full inline-block w-fit ${
                              l.category === 'Privacy'
                                ? 'bg-indigo-50 text-indigo-700'
                                : l.category === 'Conduct'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-violet-50 text-violet-700'
                            }`}
                          >
                            {l.category}
                          </span>
                          <div>
                            <div className="text-[11px] font-medium text-zinc-800">{l.ruleName}</div>
                            <div className="text-[11px] text-zinc-500 leading-snug">{l.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Rule reference */}
              <div>
                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400 mb-2">
                  Statutory reference
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {COMPLIANCE_RULES.map((r) => (
                    <div key={r.code} className="glass-thin rounded-xl p-3">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[10px] font-mono text-zinc-500">{r.code}</span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">
                          {r.category}
                        </span>
                      </div>
                      <div className="text-[12px] font-medium text-zinc-900">{r.title}</div>
                      <div className="text-[11px] text-zinc-500 leading-snug mt-0.5">{r.summary}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChecklistTile({ label, code, passed }: { label: string; code: string; passed: boolean }) {
  return (
    <div
      className={`glass-thin rounded-xl p-3 transition-colors ${
        passed ? 'bg-gradient-to-br from-white/70 to-emerald-50/60' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">{code}</span>
        <span
          className={`w-2 h-2 rounded-full ${
            passed ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]' : 'bg-zinc-300'
          }`}
        />
      </div>
      <div className="text-[12px] font-medium text-zinc-900 mt-1">{label}</div>
    </div>
  );
}

// ── Stack chip (LLM/STT/TTS quick reveal) ────────────────────────────

export function StackChip({ geminiModel }: { geminiModel?: string }) {
  return (
    <div className="group relative">
      <button className="gloss rounded-full px-3.5 py-1.5 flex items-center gap-2 text-[11px]">
        <Cpu className="w-3.5 h-3.5 text-zinc-600" />
        <span className="text-zinc-800">Voice stack</span>
      </button>
      <div className="absolute left-0 top-[calc(100%+8px)] w-[240px] opacity-0 pointer-events-none translate-y-1 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 transition-all duration-300">
        <div className="glass-deep rounded-2xl p-3.5 space-y-1.5">
          <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400">
            Realtime pipeline
          </div>
          <StackRow label="STT" value="Deepgram Nova-3" />
          <StackRow label="LLM" value={geminiModel || 'gemini-3.5-flash'} />
          <StackRow label="TTS" value="Fish Audio S1" />
          <StackRow label="Turn" value="Silero VAD + endpointing" />
          <StackRow label="Audio" value="LiveKit WebRTC" />
        </div>
      </div>
    </div>
  );
}

function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="font-mono uppercase tracking-wider text-[9px] text-zinc-400">{label}</span>
      <span className="text-zinc-800 font-mono">{value}</span>
    </div>
  );
}
