import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Message } from '../types';
import { X, Send, ArrowDown } from 'lucide-react';

interface LogDrawerProps {
  open: boolean;
  onClose: () => void;
  messages: Message[];
  isAgentTalking: boolean;
  status: string;
  onSendText?: (text: string) => void;
}

/**
 * Right-side glass drawer holding the full session log. Apple-Music-style
 * stack: the most recent utterance is large, earlier ones trail upward
 * scaled and faded. Auto-scrolls to the latest line as messages arrive.
 * Closes on ESC, on backdrop click, or via the close button.
 */
export default function LogDrawer({
  open,
  onClose,
  messages,
  isAgentTalking,
  status,
  onSendText,
}: LogDrawerProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages or when drawer opens
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, messages.length, isAgentTalking]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const connected = status === 'connected';
  const count = messages.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v || !onSendText || !connected) return;
    onSendText(v);
    setDraft('');
  };

  return (
    <>
      {/* Click-outside catcher — restricted to the area between header and dock
          so the top chips and bottom dock remain interactive while the card is open. */}
      <div
        onClick={onClose}
        className={`fixed left-0 right-0 top-[88px] bottom-[92px] z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'transparent' }}
      />

      {/* Floating card — clears the top header (88px) and the bottom dock (92px),
          with breathing room on the right edge so it reads as a panel, not a wall. */}
      <aside
        className={`fixed top-[88px] bottom-[92px] right-4 sm:right-6 z-50 w-[calc(100%-32px)] sm:w-[380px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open
            ? 'translate-x-0 opacity-100'
            : 'translate-x-[calc(100%+24px)] opacity-0 pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <div className="glass-deep h-full flex flex-col rounded-3xl">
          {/* Header */}
          <div className="px-5 pt-5 pb-3 flex items-start justify-between">
            <div>
              <div className="text-[9px] font-mono uppercase tracking-[0.24em] text-zinc-500">
                Session log
              </div>
              <h3 className="font-display text-[26px] text-zinc-900 leading-snug mt-0.5">
                {count === 0 ? (
                  <em className="italic text-zinc-500">silent</em>
                ) : (
                  <>
                    {count} <em className="italic text-zinc-500">utterances</em>
                  </>
                )}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="gloss w-9 h-9 rounded-full grid place-items-center text-zinc-700 hover:text-zinc-900"
              aria-label="Close log"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable stack */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto thin-scrollbar px-5 pb-4 space-y-4 scroll-smooth"
          >
            {count === 0 ? (
              <EmptyState connected={connected} />
            ) : (
              messages.map((m, i) => (
                <React.Fragment key={m.id}>
                  {renderLine(m, i === messages.length - 1)}
                </React.Fragment>
              ))
            )}
            {isAgentTalking && (
              <div className="flex items-center gap-1.5 pl-1 animate-fade">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--magenta)]" style={{ animation: 'breathe 1.2s ease-in-out infinite' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--magenta)]" style={{ animation: 'breathe 1.2s ease-in-out infinite 0.15s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--magenta)]" style={{ animation: 'breathe 1.2s ease-in-out infinite 0.3s' }} />
              </div>
            )}
          </div>

          {/* Footer / dictation */}
          {connected && (
            <form
              onSubmit={submit}
              className="px-4 pb-4 pt-3 border-t border-white/40"
            >
              <div className="glass-input flex items-center gap-2 rounded-full px-2 py-1.5">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Dictate as the debtor…"
                  className="flex-1 bg-transparent px-3 py-1.5 text-[13px] text-zinc-800 placeholder-zinc-400 outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="gloss-rose w-9 h-9 rounded-full grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </>
  );
}

function renderLine(msg: Message, isLatest: boolean) {
  if (msg.role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500 bg-white/45 border border-white/55">
          {msg.text}
        </span>
      </div>
    );
  }
  const isAgent = msg.role === 'agent';
  const sizeClass = isLatest
    ? 'text-[22px] sm:text-[24px] leading-[1.22]'
    : 'text-[16px] sm:text-[17px] leading-[1.3] opacity-55';
  return (
    <div
      className={`font-display ${sizeClass} ${
        isAgent ? 'text-left text-zinc-900' : 'text-right'
      } animate-rise`}
      style={{
        color: isAgent ? undefined : 'var(--rose-text)',
        transition: 'opacity 500ms ease',
      }}
    >
      <span className="text-pretty">{msg.text}</span>
      <div
        className={`text-[9px] font-mono uppercase tracking-[0.18em] text-zinc-400 mt-1 ${
          isAgent ? 'text-left' : 'text-right'
        }`}
      >
        {isAgent ? 'Fish Recovery' : 'Debtor'} ·{' '}
        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="h-full grid place-items-center text-center px-4 pt-12">
      <div className="space-y-3">
        <div className="font-display italic text-[20px] text-zinc-700 leading-snug text-balance">
          {connected ? 'Listening for the first word.' : 'The line is silent.'}
        </div>
        <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-zinc-400">
          {connected ? 'Speak — voice is captured continuously' : 'Dial to begin'}
        </p>
        {!connected && (
          <div className="text-zinc-400 pt-2">
            <ArrowDown className="w-4 h-4 inline-block opacity-50" />
          </div>
        )}
      </div>
    </div>
  );
}
