import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type DataPacket_Kind,
} from 'livekit-client';
import { Debtor, Message, CallStage, ComplianceCheck } from './types';
import { DEBTORS, DEFAULT_COMPLIANCE_CHECKS } from './data';

import AmbientOrb from './components/AmbientOrb';
import AudioVisualizer from './components/AudioVisualizer';
import LogDrawer from './components/LogDrawer';
import ContactsDrawer from './components/ContactsDrawer';
import IntroScroll, { ScrollCue } from './components/IntroScroll';
import { StageChip, ComplianceChip, StackChip } from './components/InfoChips';

import {
  Users, PhoneOff, ScrollText, Shield, AlertCircle, Loader2, Phone,
} from 'lucide-react';

type AgentStatus = {
  livekitConfigured: boolean;
  livekitUrl: string | null;
  geminiModel: string;
};

type TranscriptEvent = {
  type: 'transcript';
  role: 'user' | 'agent' | 'system';
  id?: string;
  text: string;
  done?: boolean;
  seq?: number;
};
type TranscriptDeltaEvent = {
  type: 'transcript_delta';
  role: 'user' | 'agent';
  id: string;
  // Agent path sends `delta` (each chunk appends). User path sends `text`
  // (whole interim transcript that replaces the prior interim).
  delta?: string;
  text?: string;
  done?: boolean;
  seq?: number;
};
type ComplianceEvent = {
  type: 'compliance';
  ruleName: string;
  status: 'pass' | 'violation' | 'review';
  detail: string;
  category?: string;
  seq?: number;
};
type StageEvent = { type: 'stage'; stage: CallStage; seq?: number };

export type Emotion = 'neutral' | 'angry' | 'anxious' | 'confused';
export type Objection = 'no_money' | 'not_mine' | 'already_paid' | 'need_proof' | 'refuse';

export type Signals = {
  stage: CallStage | string; // raw graph stage; collapsed to 5 buckets in StageChip
  identity_verified: boolean;
  verify_attempts: number;
  emotion: Emotion | null;
  objection: Objection | null;
  cease_requested: boolean;
  must_handoff: boolean;
};

type SignalsEvent = Signals & { type: 'signals'; seq?: number };

const EMPTY_SIGNALS: Signals = {
  stage: 'idle',
  identity_verified: false,
  verify_attempts: 0,
  emotion: null,
  objection: null,
  cease_requested: false,
  must_handoff: false,
};

const decoder = new TextDecoder();

export default function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor>(DEBTORS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [complianceChecks, setComplianceChecks] = useState<ComplianceCheck[]>(DEFAULT_COMPLIANCE_CHECKS);
  const [currentStage, setCurrentStage] = useState<CallStage>('idle');
  const [signals, setSignals] = useState<Signals>(EMPTY_SIGNALS);
  const [errorString, setErrorString] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  // Drawers — independent of call state, opened only on user trigger.
  const [logOpen, setLogOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  const [checklist, setChecklist] = useState({
    disclosure: false,
    confidentiality: false,
    professional: false,
    noThreats: false,
  });

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/agent-status')
      .then((res) => res.json())
      .then((data: AgentStatus) => setAgentStatus(data))
      .catch(() => setAgentStatus({ livekitConfigured: false, livekitUrl: null, geminiModel: 'unknown' }));
  }, []);

  // Compliance checklist derived from the graph's own classifications — the
  // router writes identity_verified, the audit node writes compliance_flags
  // (delivered as `compliance` data frames), and stage progression tells us
  // whether disclosure has happened. No transcript heuristics.
  useEffect(() => {
    if (status !== 'connected') {
      setChecklist({ disclosure: false, confidentiality: false, professional: false, noThreats: false });
      return;
    }
    // `disclosure` flips once the graph has moved past `opening`.
    const stageStr = String(signals.stage);
    const disclosed = stageStr !== 'idle' && stageStr !== 'opening';
    // `professional` clears as long as the graph hasn't escalated to a forced handoff.
    const professional = !signals.must_handoff;
    // `noThreats` reflects the audit ledger: any logged violation flips it off.
    const noThreats = !complianceChecks.some((c) => c.status === 'violation');
    setChecklist({
      disclosure: disclosed,
      confidentiality: signals.identity_verified,
      professional,
      noThreats,
    });
  }, [signals, complianceChecks, status]);

  // ── LiveKit event handlers ────────────────────────────────────────

  // Server-emitted `seq` orders frames deterministically. Without this,
  // chunks from different code paths (LLM tap, STT, audit) can arrive in
  // a different order than they were emitted on the agent side, especially
  // under bursty network conditions.
  const upsertMessageBySeq = (next: Message, prev: Message[]): Message[] => {
    const existingIdx = next.id ? prev.findIndex((m) => m.id === next.id) : -1;
    let merged: Message[];
    if (existingIdx >= 0) {
      merged = [...prev];
      merged[existingIdx] = { ...prev[existingIdx], ...next, timestamp: prev[existingIdx].timestamp };
    } else {
      merged = [...prev, next];
    }
    // Stable sort by seq when present, falling back to insertion order.
    return merged.sort((a, b) => {
      if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
      if (a.seq !== undefined) return -1;
      if (b.seq !== undefined) return 1;
      return 0;
    });
  };

  const handleDataReceived = (
    payload: Uint8Array,
    _participant?: RemoteParticipant,
    _kind?: DataPacket_Kind,
  ) => {
    let parsed: unknown;
    try { parsed = JSON.parse(decoder.decode(payload)); } catch { return; }
    if (!parsed || typeof parsed !== 'object') return;
    const evt = parsed as TranscriptEvent | TranscriptDeltaEvent | ComplianceEvent | StageEvent | SignalsEvent;

    if (evt.type === 'transcript_delta') {
      // Agent stream: each frame appends `delta` to the existing bubble.
      // User stream: each frame REPLACES the bubble text with the new
      // interim transcript (Deepgram emits whole-utterance refinements,
      // not deltas).
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === evt.id);
        let nextText: string;
        if (evt.role === 'agent') {
          nextText = (existing?.text ?? '') + (evt.delta ?? '');
        } else {
          nextText = evt.text ?? existing?.text ?? '';
        }
        return upsertMessageBySeq(
          {
            id: evt.id,
            role: evt.role,
            text: nextText,
            timestamp: existing?.timestamp ?? new Date(),
            pending: !evt.done,
            seq: existing?.seq ?? evt.seq,
          },
          prev,
        );
      });
      return;
    }

    if (evt.type === 'transcript') {
      const id = evt.id ?? `m-${evt.role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setMessages((prev) =>
        upsertMessageBySeq(
          {
            id,
            role: evt.role,
            text: evt.text,
            timestamp: prev.find((m) => m.id === id)?.timestamp ?? new Date(),
            pending: false,
            seq: prev.find((m) => m.id === id)?.seq ?? evt.seq,
          },
          prev,
        ),
      );
      return;
    }
    if (evt.type === 'compliance') {
      setComplianceChecks((prev) => [
        {
          id: `c-evt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          category: evt.category || 'Conduct',
          status: evt.status,
          ruleName: evt.ruleName,
          detail: evt.detail,
        },
        ...prev,
      ]);
      return;
    }
    if (evt.type === 'stage') setCurrentStage(evt.stage);
    if (evt.type === 'signals') {
      setSignals({
        stage: evt.stage,
        identity_verified: !!evt.identity_verified,
        verify_attempts: evt.verify_attempts ?? 0,
        emotion: (evt.emotion as Emotion) ?? null,
        objection: (evt.objection as Objection) ?? null,
        cease_requested: !!evt.cease_requested,
        must_handoff: !!evt.must_handoff,
      });
      // Mirror raw graph stage into currentStage; StageChip collapses it to 5 buckets.
      if (evt.stage) setCurrentStage(evt.stage as CallStage);
    }
  };

  const handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    _participant: RemoteParticipant,
  ) => {
    if (track.kind === Track.Kind.Audio && audioRef.current) {
      track.attach(audioRef.current);
    }
  };

  const handleActiveSpeakersChanged = (speakers: { identity: string }[]) => {
    const localId = roomRef.current?.localParticipant?.identity;
    const remoteSpeaking = speakers.some((s) => s.identity !== localId);
    const localSpeaking = !!localId && speakers.some((s) => s.identity === localId);
    setIsAgentTalking(remoteSpeaking);
    setIsUserTalking(localSpeaking);
  };

  // ── Lifecycle ─────────────────────────────────────────────────────

  const startCall = async () => {
    setErrorString(null);
    setStatus('connecting');
    setMessages([]);
    setCurrentStage('opening');
    setSignals({ ...EMPTY_SIGNALS, stage: 'opening' });

    setComplianceChecks((prev) => [
      {
        id: `c-init-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        category: 'Privacy',
        status: 'pass',
        ruleName: 'Session initiated securely',
        detail: `LiveKit room minted for ${selectedDebtor.name}.`,
      },
      ...prev,
    ]);

    try {
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: selectedDebtor.id }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        throw new Error(body.error || `Token endpoint returned ${tokenRes.status}`);
      }
      const { token, url } = await tokenRes.json();

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.DataReceived, handleDataReceived)
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
        .on(RoomEvent.Disconnected, () => {
          setStatus('disconnected');
          setIsAgentTalking(false);
          setIsUserTalking(false);
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      setStatus('connected');
      setMessages([
        {
          id: 'm-sys-conn',
          role: 'system',
          text: 'Fish Recovery secure channel active',
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorString(err.message || 'Failed to connect to LiveKit room.');
      setStatus('error');
      await stopCall();
    }
  };

  const stopCall = async () => {
    setIsAgentTalking(false);
    setIsUserTalking(false);

    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try { await room.disconnect(); } catch {}
    }
    if (audioRef.current) audioRef.current.srcObject = null;

    setStatus((s) => (s === 'error' ? 'error' : 'disconnected'));
    setComplianceChecks((prev) => [
      {
        id: `c-stop-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        category: 'Privacy',
        status: 'pass',
        ruleName: 'Session cleared',
        detail: 'Room disconnected. Audio tracks released.',
      },
      ...prev,
    ]);
  };

  useEffect(() => {
    return () => { void stopCall(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendManualText = (text: string) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    setMessages((prev) => [
      ...prev,
      { id: `m-user-text-${Date.now()}`, role: 'user', text, timestamp: new Date() },
    ]);
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'user_text', text }));
    void room.localParticipant.publishData(payload, { reliable: true });
  };

  // ── Derived ──────────────────────────────────────────────────────

  const credsReady = !!agentStatus?.livekitConfigured;

  const mood: 'idle' | 'connecting' | 'listening' | 'agent' | 'user' | 'error' = useMemo(() => {
    if (status === 'error') return 'error';
    if (status === 'connecting') return 'connecting';
    if (status === 'connected') {
      if (isAgentTalking) return 'agent';
      if (isUserTalking) return 'user';
      return 'listening';
    }
    return 'idle';
  }, [status, isAgentTalking, isUserTalking]);

  const onCall = status === 'connected' || status === 'connecting';

  // Most recent non-system utterance — fuels the live ticker beneath the orb.
  const currentLine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'system') return messages[i];
    }
    return null;
  }, [messages]);

  return (
    <div className="relative min-h-screen text-zinc-900">
      <AmbientOrb mood={mood} emotion={signals.emotion} />
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* ─── HEADER ───────────────────────────────────────────── */}
      <header className="relative z-30 px-5 sm:px-8 py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="gloss-dark w-9 h-9 rounded-2xl grid place-items-center">
            <Shield className="w-4 h-4 text-[#ff8fd0]" />
          </div>
          <div>
            <div className="font-display text-[20px] leading-none text-zinc-900">
              Fish <em className="italic text-zinc-500">Recovery</em>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-[0.24em] text-zinc-500 mt-1">
              Vocal compliance suite
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StackChip geminiModel={agentStatus?.geminiModel} />
          <StageChip stage={currentStage} signals={signals} />
          <ComplianceChip logs={complianceChecks} checklist={checklist} />
        </div>
      </header>

      {/* ─── MAIN STAGE — orb-centric ───────────────────────── */}
      <main className="relative z-10 min-h-[calc(100vh-88px)] flex flex-col items-center justify-center px-5 sm:px-8 pb-32">
        {(!credsReady || errorString) && (
          <div className="w-full max-w-2xl mb-6 space-y-2">
            {!credsReady && (
              <div className="glass-thin rounded-2xl px-4 py-3 flex items-start gap-3 text-[12px] text-amber-900/90">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">Credentials needed.</span>{' '}
                  Set <code className="font-mono text-[11px]">LIVEKIT_URL</code>,{' '}
                  <code className="font-mono text-[11px]">LIVEKIT_API_KEY</code>,{' '}
                  <code className="font-mono text-[11px]">LIVEKIT_API_SECRET</code> and run the agent worker.
                </div>
              </div>
            )}
            {errorString && (
              <div className="glass-thin rounded-2xl px-4 py-3 flex items-start gap-3 text-[12px] text-rose-900/90">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorString}</span>
              </div>
            )}
          </div>
        )}

        <div className="w-full max-w-2xl flex flex-col items-center text-center">
          <StatusEyebrow mood={mood} debtorName={selectedDebtor.name} />

          {/* The canvas orb — central, hero element.
              Emotion is sticky: once the router classifies a tone it persists
              across listening turns, so the orb feels like the agent is
              remembering what it heard rather than re-reading silence. */}
          <AudioVisualizer
            status={status}
            isAgentTalking={isAgentTalking}
            isUserTalking={isUserTalking}
            emotion={signals.emotion}
          />

          {/* Debtor identity */}
          <div className="mt-2 space-y-1">
            <h1 className="font-display text-[44px] sm:text-[56px] leading-[0.95] text-zinc-900 tracking-tight">
              {selectedDebtor.name.split(' ')[0]}
              <em className="italic text-zinc-500">
                {' '}
                {selectedDebtor.name.split(' ').slice(1).join(' ')}
              </em>
            </h1>
            <div className="text-[12px] text-zinc-500">
              {selectedDebtor.originallyCreditedBy} ·{' '}
              <span className="font-mono">${selectedDebtor.debtAmount.toFixed(2)}</span> ·{' '}
              <span style={{ color: 'var(--rose-text)' }}>
                {selectedDebtor.overdueDays}d aged
              </span>
            </div>
          </div>

          {/* Live one-line ticker (only during a call, with a current line).
              The dial action lives only in the persistent dock below, so the
              centerpiece stays focused on the orb. */}
          <LiveTicker line={currentLine} isAgentTalking={isAgentTalking} visible={onCall} />
        </div>
      </main>

      {/* ─── DRAWERS ─────────────────────────────────────────── */}
      <ContactsDrawer
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        debtors={DEBTORS}
        selected={selectedDebtor}
        onSelect={(d) => {
          setSelectedDebtor(d);
          setMessages([]);
        }}
        locked={onCall}
      />
      <LogDrawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        messages={messages}
        isAgentTalking={isAgentTalking}
        status={status}
        onSendText={sendManualText}
      />

      {/* ─── DOCK ────────────────────────────────────────────── */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
        {/* Hint above the dock when the line is cold — gently nudges
            first-time users toward the primary action. */}
        {!onCall && credsReady && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-500 animate-nudge">
            <span>tap dial to begin</span>
            <span aria-hidden>↓</span>
          </div>
        )}
        <div className="glass-deep rounded-full px-2 py-2 flex items-center gap-1.5">
          <DockButton
            active={contactsOpen}
            onClick={() => setContactsOpen(true)}
            icon={<Users className="w-4 h-4" />}
            label="Contacts"
          />
          <DockPrimary
            status={status}
            credsReady={credsReady}
            onDial={startCall}
            onHangUp={stopCall}
          />
          <DockButton
            active={logOpen}
            onClick={() => setLogOpen(true)}
            icon={<ScrollText className="w-4 h-4" />}
            label="Log"
            badge={messages.length || undefined}
          />
        </div>
      </div>

      {/* ─── SCROLL CUE ──────────────────────────────────────── */}
      <div className="relative z-10 -mt-12 mb-10">
        <ScrollCue />
      </div>

      {/* ─── BELOW-FOLD ──────────────────────────────────────── */}
      <IntroScroll />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function StatusEyebrow({
  mood,
  debtorName,
}: {
  mood: 'idle' | 'connecting' | 'listening' | 'agent' | 'user' | 'error';
  debtorName: string;
}) {
  const text =
    mood === 'agent' ? 'agent speaking' :
    mood === 'user' ? 'you are speaking' :
    mood === 'listening' ? 'listening' :
    mood === 'connecting' ? 'opening secure line' :
    mood === 'error' ? 'line interrupted' :
    'standby';

  const dotColor =
    mood === 'agent' ? 'bg-[var(--magenta)]' :
    mood === 'user' ? 'bg-violet-400' :
    mood === 'listening' ? 'bg-[var(--magenta)]' :
    mood === 'connecting' ? 'bg-amber-400' :
    mood === 'error' ? 'bg-rose-500' :
    'bg-zinc-400';

  return (
    <div className="flex items-center justify-center gap-2.5 mb-4">
      <span
        className={`w-1.5 h-1.5 rounded-full ${dotColor}`}
        style={{ animation: 'breathe 1.6s ease-in-out infinite' }}
      />
      <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-500">
        {text} · {debtorName}
      </span>
    </div>
  );
}

function LiveTicker({
  line,
  isAgentTalking,
  visible,
}: {
  line: Message | null;
  isAgentTalking: boolean;
  visible: boolean;
}) {
  if (!visible) return <div className="h-12" />; // reserve vertical rhythm
  if (!line && !isAgentTalking) {
    return (
      <div className="h-12 flex items-center justify-center">
        <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-zinc-400">
          waiting for first utterance…
        </span>
      </div>
    );
  }

  if (!line) return <div className="h-12" />;

  const isAgent = line.role === 'agent';
  return (
    <div
      key={line.id}
      className="mt-6 px-6 max-w-2xl mx-auto animate-rise"
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.28em] text-zinc-400 mb-1">
        {isAgent ? 'Fish Recovery' : 'Debtor'} · live
      </div>
      <div
        className="font-display italic text-[18px] sm:text-[20px] leading-snug text-balance"
        style={{ color: isAgent ? '#1c1820' : 'var(--rose-text)' }}
      >
        {line.text}
      </div>
    </div>
  );
}

function DockButton({
  icon,
  label,
  active,
  onClick,
  disabled,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`relative rounded-full px-3.5 h-10 flex items-center gap-2 text-[11px] font-medium transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
        active ? 'gloss-dark text-white' : 'text-zinc-700 hover:bg-white/55'
      }`}
    >
      {icon}
      <span className="hidden sm:inline tracking-wide">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-gradient-to-br from-[#ff6ec7] to-[#8b5cf6] text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function DockPrimary({
  status,
  credsReady,
  onDial,
  onHangUp,
}: {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  credsReady: boolean;
  onDial: () => void;
  onHangUp: () => void;
}) {
  const connected = status === 'connected';
  const connecting = status === 'connecting';

  if (connected) {
    return (
      <button
        onClick={onHangUp}
        className="gloss-dark rounded-full h-10 px-5 flex items-center gap-2 text-[11px] font-medium tracking-wide"
        title="Disconnect"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-rose-400"
          style={{ animation: 'breathe 1.4s ease-in-out infinite' }}
        />
        <PhoneOff className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">End call</span>
      </button>
    );
  }
  // Idle / disconnected: the dial pill carries an expanding halo to
  // visually announce itself as the primary action.
  const showHalo = !connecting && credsReady;
  return (
    <span className={showHalo ? 'dial-halo-wrap' : undefined}>
      <button
        onClick={onDial}
        disabled={!credsReady || connecting}
        className="gloss-rose rounded-full h-10 px-5 flex items-center gap-2 text-[11px] font-medium tracking-wide disabled:opacity-50 disabled:cursor-not-allowed relative"
        title="Dial"
      >
        {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{connecting ? 'Opening…' : 'Dial'}</span>
      </button>
    </span>
  );
}
