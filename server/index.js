import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createDefaultHandler } from '../api/_lib/createDefaultHandler.js';
import { createAgentHandlers } from '../api/_lib/agent/createAgentHandlers.js';
import { loadConfig } from '../api/_lib/config.js';

// Load .env.local for dev. Must run before the handler reads the environment.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = process.env.API_PORT || 3001;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: loadConfig(process.env).bodyLimitBytes }));

// Same handler Vercel runs in production (api/claude.js).
app.all('/api/claude', createDefaultHandler());

// Farm-records agent (same handlers as api/agent/*.js on Vercel).
const agent = createAgentHandlers();
app.all('/api/agent/capture', agent.capture);
app.all('/api/agent/reply', agent.reply);
app.all('/api/agent/check-material', agent.material);
app.all('/api/agent/telegram', agent.telegram);

// JSON errors only: no stack traces or HTML error pages.
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error('[api] unexpected error:', err?.name ?? 'unknown');
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, HOST, () => {
  console.info(`OrganicPath CA API server running on http://${HOST}:${PORT}`);
  console.info(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET (add to .env.local)'}`);
  console.info(`  Service role key:  ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET (the records agent cannot save captures)'}`);
  console.info(`  Supabase auth:     ${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL ? 'configured' : 'NOT CONFIGURED (AI requests will be refused)'}`);
});
