export interface Debtor {
  id: string;
  name: string;
  debtAmount: number;
  originallyCreditedBy: string;
  overdueDays: number;
  ssnSuffix: string;
  birthYear: number;
  phone: string;
  accountNumber: string;
  notes: string;
  presetObjection: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: Date;
  isAudio?: boolean;
  // True until the producer signals the utterance is final. Pending user
  // messages render as greyed-out drafts; pending agent messages animate.
  pending?: boolean;
  // Server-emitted sequence number; used to render in emission order rather
  // than DataReceived arrival order.
  seq?: number;
}

export type CallStage =
  | 'idle'
  | 'opening'
  | 'verify'
  | 'explain'
  | 'negotiation'
  | 'compliance'
  | 'commitment'
  | 'summary';

export interface ComplianceCheck {
  id: string;
  timestamp: string;
  category: string;
  status: 'pass' | 'violation' | 'review';
  ruleName: string;
  detail: string;
}

export interface CallStats {
  duration: number;
  interruptionCount: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'tense';
  complianceScore: number; // 0 - 100
}
