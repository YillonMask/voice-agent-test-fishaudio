import React, { useEffect } from 'react';
import { Debtor } from '../types';
import { X, CreditCard, HeartPulse, Car, Target, Check } from 'lucide-react';

interface ContactsDrawerProps {
  open: boolean;
  onClose: () => void;
  debtors: Debtor[];
  selected: Debtor;
  onSelect: (d: Debtor) => void;
  locked: boolean;
}

const ICONS: Record<string, React.ReactNode> = {
  '1': <CreditCard className="w-4 h-4" />,
  '2': <HeartPulse className="w-4 h-4" />,
  '3': <Car className="w-4 h-4" />,
};

export default function ContactsDrawer({
  open,
  onClose,
  debtors,
  selected,
  onSelect,
  locked,
}: ContactsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed left-0 right-0 top-[88px] bottom-[92px] z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'transparent' }}
      />

      <aside
        className={`fixed top-[88px] bottom-[92px] left-4 sm:left-6 z-50 w-[calc(100%-32px)] sm:w-[380px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open
            ? 'translate-x-0 opacity-100'
            : '-translate-x-[calc(100%+24px)] opacity-0 pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <div className="glass-deep h-full flex flex-col rounded-3xl">
          <div className="px-5 pt-5 pb-3 flex items-start justify-between">
            <div>
              <div className="text-[9px] font-mono uppercase tracking-[0.24em] text-zinc-500">
                Simulated dossiers
              </div>
              <h3 className="font-display text-[26px] text-zinc-900 leading-snug mt-0.5">
                Choose a <em className="italic text-zinc-500">debtor</em>
              </h3>
            </div>
            <button
              onClick={onClose}
              className="gloss w-9 h-9 rounded-full grid place-items-center text-zinc-700 hover:text-zinc-900"
              aria-label="Close contacts"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto thin-scrollbar px-4 pb-4 space-y-2.5">
            {debtors.map((d) => {
              const isSelected = d.id === selected.id;
              return (
                <button
                  key={d.id}
                  onClick={() => { onSelect(d); onClose(); }}
                  disabled={locked}
                  className={`w-full text-left transition-all rounded-2xl px-4 py-3.5 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected ? 'gloss-dark' : 'glass-thin hover:bg-white/55'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl shrink-0 grid place-items-center ${
                        isSelected
                          ? 'bg-gradient-to-br from-[#ff8fd0] to-[#8b5cf6] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
                          : 'bg-white/55 text-zinc-600 border border-white/60'
                      }`}
                    >
                      {ICONS[d.id] || <Target className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`font-display text-[19px] leading-none ${
                            isSelected ? 'text-white' : 'text-zinc-900'
                          }`}
                        >
                          {d.name}
                        </div>
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 text-emerald-300" />
                        ) : (
                          <span className="text-[9px] font-mono tracking-[0.2em] text-zinc-400 uppercase">
                            select
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-[11px] font-mono mt-1 ${
                          isSelected ? 'text-white/65' : 'text-zinc-500'
                        }`}
                      >
                        ${d.debtAmount.toFixed(2)} · {d.overdueDays}d overdue
                      </div>
                      <div
                        className={`text-[11px] mt-1.5 leading-snug line-clamp-2 ${
                          isSelected ? 'text-white/55' : 'text-zinc-500'
                        }`}
                      >
                        {d.originallyCreditedBy}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Verification key for the currently-selected debtor */}
            <div className="glass-thin rounded-2xl px-4 py-3 mt-3">
              <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-400 mb-2">
                Verification key · {selected.name}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <KV label="SSN tail" value={'•••• ' + selected.ssnSuffix} />
                <KV label="Birth yr" value={String(selected.birthYear)} />
                <KV label="Balance" value={'$' + selected.debtAmount.toFixed(2)} />
                <KV label="Aging" value={selected.overdueDays + ' days'} accent />
              </div>
              <div className="text-[11px] italic text-zinc-500 mt-2 leading-snug font-display">
                “{selected.presetObjection.replace(/^[^:]+:\s*/, '').replace(/^"|"$/g, '')}”
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function KV({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-400 uppercase tracking-wider text-[9px] font-mono">{label}</span>
      <span
        className="font-mono"
        style={{ color: accent ? 'var(--rose-text)' : '#1c1820' }}
      >
        {value}
      </span>
    </div>
  );
}
