// ---------------------------------------------------------------------------
// Bichitos Rumble — multiplayer server entry point
// ---------------------------------------------------------------------------

import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import { BrawlRoom } from './BrawlRoom.js';

const PORT = Number(process.env.PORT) || 2567;
const httpServer = createServer((req, res) => {
  // Health check endpoint for hosting platforms (Fly.io, Railway)
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bichitos Rumble multiplayer server. Connect via WebSocket.');
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('brawl', BrawlRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[server] listening on ws://localhost:${PORT}`);
  console.log(`[server] health: http://localhost:${PORT}/health`);
});
