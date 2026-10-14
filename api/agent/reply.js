import { createAgentHandlers } from '../_lib/agent/createAgentHandlers.js';

// Vercel serverless entry for POST /api/agent/reply.
export default createAgentHandlers().reply;
