import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { getOrCreateUser, getUserCloudData, syncUserCloudData } from './src/db/users.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  // Health / connectivity endpoint for online/offline sync probe
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Cloud SQL Authenticated Get State
  app.get('/api/cloud/state', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@poolmint.app`;
      await getOrCreateUser(uid, email);
      const data = await getUserCloudData(uid);
      res.json(data);
    } catch (error: any) {
      console.error('Failed to fetch cloud state:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch cloud state' });
    }
  });

  // Cloud SQL Authenticated Idempotent Synchronization
  app.post('/api/cloud/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@poolmint.app`;
      await getOrCreateUser(uid, email);

      const { trips = [], transactions = [], auditLogs = [] } = req.body || {};
      const synced = await syncUserCloudData(uid, trips, transactions, auditLogs);
      res.json({
        status: 'SYNC_COMPLETED',
        syncedAt: new Date().toISOString(),
        data: synced,
      });
    } catch (error: any) {
      console.error('Failed to synchronize with Cloud SQL:', error);
      res.status(500).json({ error: error.message || 'Failed to synchronize with Cloud SQL' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pool Mint server running on http://localhost:${PORT}`);
  });
}

startServer();
