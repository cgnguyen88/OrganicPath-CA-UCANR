import { createAgentHandlers } from '../_lib/agent/createAgentHandlers.js';

// Vercel serverless entry for POST /api/agent/check-material.
export default createAgentHandlers().material;
