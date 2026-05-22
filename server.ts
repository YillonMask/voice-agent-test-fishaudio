import express, { Request, Response } from 'express';
import path from 'path';
import http from 'http';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(express.json());

// In-memory compliance ledger (kept; the Python agent will POST to it).
const complianceLogs: any[] = [];

// Mirror of agent/debtors.py so the Node side can attach metadata to the
// LiveKit room. The Python agent worker reads `debtorId` out of it to seed
// CallState.debtor.
const DEBTOR_PROFILES: Record<string, {
  name: string;
  amount: string;
  creditor: string;
  ssn: string;
  year: string;
}> = {
  '1': { name: 'John Smith', amount: '$1,450.00', creditor: 'Citibank N.A. (CashRewards Card)', ssn: '4321', year: '1982' },
  '2': { name: 'Emily Davis', amount: '$420.00', creditor: 'Metro Health Emergency Services', ssn: '8812', year: '1994' },
  '3': { name: 'Marcus Vance', amount: '$3,200.00', creditor: 'Capital Auto Finance', ssn: '5678', year: '1975' },
};

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// LiveKit RoomServiceClient needs the HTTP variant of the LiveKit URL.
const livekitHttpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
const roomService = LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
  ? new RoomServiceClient(livekitHttpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

function liveKitConfigured(): boolean {
  return !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

// ----- API: server status ---------------------------------------------------

app.get('/api/agent-status', (_req: Request, res: Response) => {
  res.json({
    livekitConfigured: liveKitConfigured(),
    livekitUrl: LIVEKIT_URL || null,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    environment: process.env.NODE_ENV || 'development',
    serverUtc: new Date().toISOString(),
  });
});

// ----- API: LiveKit token + room metadata ----------------------------------

app.post('/api/livekit/token', async (req: Request, res: Response) => {
  if (!liveKitConfigured() || !roomService) {
    return res.status(500).json({
      error: 'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.',
    });
  }

  const debtorId = String((req.body?.debtorId as string) || '1');
  const profile = DEBTOR_PROFILES[debtorId];
  if (!profile) {
    return res.status(400).json({ error: `Unknown debtorId: ${debtorId}` });
  }

  const stamp = Date.now().toString(36);
  const roomName = `fish-recovery-${debtorId}-${stamp}`;
  const identity = `debtor-${debtorId}-${stamp}`;

  // Create the room up-front so we can attach metadata. The agent worker
  // reads ctx.room.metadata to seed CallState.debtor.
  const metadata = JSON.stringify({ debtorId, ...profile });
  try {
    await roomService.createRoom({
      name: roomName,
      metadata,
      emptyTimeout: 60,
      maxParticipants: 4,
    });
  } catch (err: any) {
    // createRoom is idempotent in practice; surface anything other than the
    // "already exists" case.
    if (!String(err?.message || '').toLowerCase().includes('already exists')) {
      return res.status(500).json({ error: `Failed to create room: ${err.message}` });
    }
  }

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return res.json({ token, url: LIVEKIT_URL, room: roomName, identity });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to mint token: ${err.message}` });
  }
});

// ----- API: compliance audit log -------------------------------------------

app.post('/api/compliance/logs', (req: Request, res: Response) => {
  try {
    const { log } = req.body;
    if (log) {
      const id = `c-log-${Date.now()}`;
      complianceLogs.unshift({ id, timestamp: new Date().toLocaleTimeString(), ...log });
      return res.status(201).json({ status: 'ok', id });
    }
    return res.status(400).json({ error: 'Log payload missing' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/compliance/logs', (_req: Request, res: Response) => {
  res.json(complianceLogs);
});

// ----- Vite + static serving -----------------------------------------------

async function startServer() {
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fish Recovery portal listening on http://0.0.0.0:${PORT}`);
    if (!liveKitConfigured()) {
      console.warn('LiveKit credentials missing — /api/livekit/token will return 500 until LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET are set in .env');
    }
  });
}

startServer();
