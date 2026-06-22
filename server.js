import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { load } from './src/server/state.js';
import apiRouter from './src/server/routes/api.js';
import { handleConnection } from './src/server/ws/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer(port = process.env.PORT || 3000) {
  const app = express();

  // Serve static files from public/
  app.use(express.static(path.join(__dirname, 'public')));

  // API router
  app.use('/api', apiRouter);

  // Catch-all for SPA-style navigation: serve index.html for non-API, non-asset routes
  app.get('/tatami/:n', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tatami', 'index.html'));
  });
  app.get('/control/:n', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'control', 'index.html'));
  });
  app.get('/matcontrol/:n', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'matcontrol', 'index.html'));
  });
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  });
  app.get('/overview', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overview', 'index.html'));
  });
  app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results', 'index.html'));
  });
  app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup', 'index.html'));
  });

  const server = createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws' || req.url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req);
  });

  // Load state from disk
  load();

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      console.log(`\nJudo Tournament System started!\n`);
      console.log(`Local:   http://localhost:${port}`);

      // Print all non-internal network IPv4 addresses
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            console.log(`Network: http://${net.address}:${port}`);
          }
        }
      }
      console.log('\nPages:');
      console.log(`  Setup:    http://localhost:${port}/setup`);
      console.log(`  Admin:    http://localhost:${port}/admin/`);
      console.log(`  Overview: http://localhost:${port}/overview/`);
      console.log(`  Tatami 1: http://localhost:${port}/tatami/1`);
      console.log(`  Control 1:http://localhost:${port}/control/1`);
      console.log(`  MatCtrl 1:http://localhost:${port}/matcontrol/1`);
      console.log('');
      resolve();
    });
  });
}

// Direct run: node server.js / npm start
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
