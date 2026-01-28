/**
 * Provenance Server
 *
 * Simple Express server for development and production.
 * In production, serves the built static files.
 * In development, Vite handles the frontend.
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Parse JSON bodies
app.use(express.json());

// Serve static files in production
const distPath = join(__dirname, '../../dist');
app.use(express.static(distPath));

// API Routes (for future use - file management, etc.)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   Provenance Server                                       ║
  ║   Prove your writing is human-crafted                     ║
  ║                                                           ║
  ║   Server running at: http://localhost:${PORT}               ║
  ║                                                           ║
  ║   For development, run: npm run dev                       ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
