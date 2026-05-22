import { Debtor, ComplianceCheck } from './types';

export const DEBTORS: Debtor[] = [
  {
    id: '1',
    name: 'John Smith',
    debtAmount: 1450.00,
    originallyCreditedBy: 'Citibank N.A. (CashRewards Card)',
    overdueDays: 120,
    ssnSuffix: '4321',
    birthYear: 1982,
    phone: '+1 (555) 234-8901',
    accountNumber: 'XXXX-XXXX-8821-4321',
    notes: 'Primary job lost in March. Currently searching for contract positions. Willing to settle if a 40% discount is authorized.',
    presetObjection: 'Financial Hardship: "I lost my job two months ago due to company down-sizing. I really want to pay to save my credit, but I cannot pay the full amount right now. Can we do a reduction or a monthly plan?"'
  },
  {
    id: '2',
    name: 'Emily Davis',
    debtAmount: 420.00,
    originallyCreditedBy: 'Metro Health Emergency Services',
    overdueDays: 95,
    ssnSuffix: '8812',
    birthYear: 1994,
    phone: '+1 (555) 712-4012',
    accountNumber: 'MHS-994-01-88',
    notes: 'Hospital emergency visit in December. Expecting insurance to pay part of the claim. Speaks quickly and gets frustrated easily.',
    presetObjection: 'Disputed Debt: "This emergency visit should have been covered by my BlueShield insurance. I am not paying this $420 until I see an itemized invoice, and my insurance provider explains why it was rejected!"'
  },
  {
    id: '3',
    name: 'Marcus Vance',
    debtAmount: 3200.00,
    originallyCreditedBy: 'Capital Auto Finance',
    overdueDays: 165,
    ssnSuffix: '5678',
    birthYear: 1975,
    phone: '+1 (555) 901-2345',
    accountNumber: 'CAF-7521-AUTO',
    notes: 'Behind on car lease payments. Claims to have sent check payments but tracker shows no arrivals. Protective of his time.',
    presetObjection: 'Already Paid / Dispute Tracker: "Look, I already mailed out a physical check for $500 last Tuesday. If you have not gotten it, that is the post office\'s problem, not mine. Stop harassing me!"'
  }
];

export const COMPLIANCE_RULES = [
  {
    code: 'FDCPA-805',
    title: 'Communication Protocol',
    summary: 'Prohibits calling at unusual times (before 8:00 AM or after 9:00 PM local), or communicating if represented by an attorney.',
    category: 'Privacy'
  },
  {
    code: 'FDCPA-806',
    title: 'Harassment & Abuse',
    summary: 'Prohibits threatening violence, using obscene/profane language, or making continuous/repetitive phone calls to annoy.',
    category: 'Conduct'
  },
  {
    code: 'FDCPA-807',
    title: 'False Representations',
    summary: 'Strictly bans representing that the debtor will be arrested, facing jail time, or falsifying the legal nature/amount of the debt.',
    category: 'Accuracy'
  },
  {
    code: 'FDCPA-808',
    title: 'Unfair Practices',
    summary: 'Bans collecting any amount greater than the original debt agreement, depositing post-dated checks early, or standard mail exposure.',
    category: 'Fairness'
  }
];

export const DEFAULT_COMPLIANCE_CHECKS: ComplianceCheck[] = [
  {
    id: 'c1',
    timestamp: '09:15:32',
    category: 'Privacy',
    status: 'pass',
    ruleName: 'Verification and Third-Party Shield',
    detail: 'Verified customer identity via partial SSN match prior to disclosing debt details.'
  },
  {
    id: 'c2',
    timestamp: '09:15:45',
    category: 'Conduct',
    status: 'pass',
    ruleName: 'Professional Demeanor Control',
    detail: 'Voice pitch and choice of vocabulary remained highly professional under adversarial user input.'
  },
  {
    id: 'c3',
    timestamp: '09:16:02',
    category: 'Accuracy',
    status: 'pass',
    ruleName: 'Legal Representation Limits',
    detail: 'No false statement regarding credit score impact or prosecution threats were voiced.'
  }
];
