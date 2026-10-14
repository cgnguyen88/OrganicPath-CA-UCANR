import { createAgentHandlers } from '../_lib/agent/createAgentHandlers.js';

// Vercel serverless entry for POST /api/agent/telegram (the Telegram bot's webhook).
export default createAgentHandlers().telegram;
