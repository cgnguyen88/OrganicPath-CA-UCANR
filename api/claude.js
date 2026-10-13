import { createDefaultHandler } from './_lib/createDefaultHandler.js';

// Vercel serverless entry. All logic lives in api/_lib so the local Express
// dev server (server/index.js) runs exactly the same code.
export default createDefaultHandler();
