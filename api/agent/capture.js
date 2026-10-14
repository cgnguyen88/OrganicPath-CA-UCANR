import { createAgentHandlers } from '../_lib/agent/createAgentHandlers.js';

// Vercel serverless entry for POST /api/agent/capture. The Express dev server mounts the same code.
export default createAgentHandlers().capture;
