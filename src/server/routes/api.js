import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { getState, setState, save, listTournaments, activateTournament } from '../state.js';
import * as engine from '../engine.js';
import { broadcastAll } from '../ws/broadcast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const router = express.Router();

// GET /api/tournament  (current active state)
router.get('/tournament', (req, res) => {
  const state = getState();
  res.json(state);
});

// GET /api/tournaments  (list all saved tournaments)
router.get('/tournaments', (req, res) => {
  res.json(listTournaments());
});

// POST /api/tournaments/:id/activate  (switch active tournament)
router.post('/tournaments/:id/activate', express.json(), (req, res) => {
  const { pin } = req.body;
  const file = path.join(DATA_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.tournament || data.tournament.adminPin !== String(pin)) {
      return res.status(403).json({ error: 'wrongPin' });
    }
    activateTournament(req.params.id);
    broadcastAll('state:full', { state: getState() });
    res.json({ ok: true, tournament: getState().tournament });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate' });
  }
});

// POST /api/tournament  (create new tournament — always creates, never updates)
router.post('/tournament', express.json(), (req, res) => {
  const { name, date, tatamiCount, fightDurationMs, adminPin } = req.body;

  const tournament = {
    id: uuidv4(),
    name: name || 'Judo Tournament',
    date: date || new Date().toISOString().split('T')[0],
    status: 'setup',
    tatamiCount: Number(tatamiCount) || 2,
    fightDurationMs: Number(fightDurationMs) || 240000,
    adminPin: String(adminPin || '1234')
  };
  setState({
    tournament,
    competitors: [],
    categories: [],
    pools: [],
    fights: [],
    activeFightByTatami: {}
  });
  broadcastAll('state:full', { state: getState() });
  save();
  res.json({ tournament });
});

// GET /api/overview
router.get('/overview', (req, res) => {
  const state = getState();
  const tatamiCount = state.tournament ? state.tournament.tatamiCount : 2;
  const result = [];

  for (let n = 1; n <= tatamiCount; n++) {
    const activeFightId = state.activeFightByTatami[String(n)];
    const activeFight = activeFightId ? state.fights.find(f => f.id === activeFightId) : null;
    const category = activeFight ? state.categories.find(c => c.id === activeFight.categoryId) : null;
    const whiteComp = activeFight ? state.competitors.find(c => c.id === activeFight.whiteId) : null;
    const blueComp = activeFight ? state.competitors.find(c => c.id === activeFight.blueId) : null;

    result.push({
      tatami: n,
      status: activeFight ? activeFight.status : 'idle',
      fightId: activeFight ? activeFight.id : null,
      categoryName: category ? category.name : null,
      white: whiteComp ? { name: whiteComp.name, club: whiteComp.club } : null,
      blue: blueComp ? { name: blueComp.name, club: blueComp.club } : null,
      score: activeFight ? activeFight.score : null
    });
  }

  res.json(result);
});

// POST /api/competitors
router.post('/competitors', express.json(), (req, res) => {
  const state = getState();
  const { pin, name, club, gender, weightKg, birthYear } = req.body;

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const competitor = {
    id: uuidv4(),
    name: name || '',
    club: club || '',
    gender: gender || 'M',
    weightKg: Number(weightKg) || 0,
    birthYear: Number(birthYear) || 0,
    actualWeightKg: null
  };
  state.competitors.push(competitor);
  broadcastAll('competitor:added', { competitor });
  save();
  res.json({ competitor });
});

// POST /api/competitors/import
router.post('/competitors/import', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
  const state = getState();
  const body = req.body;

  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const added = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.toLowerCase().startsWith('name')) continue;

    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) {
      errors.push({ line: i + 1, error: 'Invalid format' });
      continue;
    }

    const [name, club, gender, weightKg, birthYear] = parts;
    const competitor = {
      id: uuidv4(),
      name: name || '',
      club: club || '',
      gender: (gender || 'M').toUpperCase(),
      weightKg: Number(weightKg) || 0,
      birthYear: Number(birthYear) || 0,
      actualWeightKg: null
    };
    state.competitors.push(competitor);
    added.push(competitor);
  }

  if (added.length > 0) {
    broadcastAll('competitors:imported', { competitors: added });
    save();
  }

  res.json({ added: added.length, errors });
});

// DELETE /api/competitors/:id
router.delete('/competitors/:id', (req, res) => {
  const state = getState();
  const pin = req.query.pin || req.headers['x-admin-pin'];

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const idx = state.competitors.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  state.competitors.splice(idx, 1);
  broadcastAll('competitor:deleted', { id: req.params.id });
  save();
  res.json({ ok: true });
});

// GET /api/categories
router.get('/categories', (req, res) => {
  const state = getState();
  res.json(state.categories);
});

// POST /api/categories
router.post('/categories', express.json(), (req, res) => {
  const state = getState();
  const { pin, name, gender, maxWeight, competitorIds, tatami, format } = req.body;

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const category = {
    id: uuidv4(),
    name: name || '',
    gender: gender || 'M',
    maxWeight: Number(maxWeight) || 0,
    competitorIds: competitorIds || [],
    tatami: Number(tatami) || 1,
    format: format || 'roundrobin',
    status: 'pending',
    fightDurationMs: state.tournament.fightDurationMs
  };
  state.categories.push(category);
  broadcastAll('category:added', { category });
  save();
  res.json({ category });
});

// POST /api/categories/:id/draw
router.post('/categories/:id/draw', express.json(), (req, res) => {
  const state = getState();
  const { pin } = req.body;

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const category = state.categories.find(c => c.id === req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const competitors = state.competitors.filter(c => category.competitorIds.includes(c.id));
  if (competitors.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 competitors' });
  }

  const filteredPools = state.pools.filter(p => p.categoryId !== category.id);
  const filteredFights = state.fights.filter(f => f.categoryId !== category.id);

  const { pools: newPools, fights: newFights } = engine.generateDraw(category, competitors);
  setState({
    pools: [...filteredPools, ...newPools],
    fights: [...filteredFights, ...newFights]
  });
  category.status = 'drawn';
  broadcastAll('bracket:updated', { categoryId: category.id, pools: getState().pools, fights: getState().fights });
  save();
  res.json({ pools: newPools, fights: newFights });
});

// PATCH /api/categories/:id
router.patch('/categories/:id', express.json(), (req, res) => {
  const state = getState();
  const { pin, ...updates } = req.body;

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const idx = state.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  state.categories[idx] = { ...state.categories[idx], ...updates };
  broadcastAll('category:updated', { category: state.categories[idx] });
  save();
  res.json({ category: state.categories[idx] });
});

// GET /api/fights
router.get('/fights', (req, res) => {
  const state = getState();
  let fights = state.fights;
  const { tatami, status } = req.query;

  if (tatami) {
    const n = Number(tatami);
    fights = fights.filter(f => f.tatami === n || f.tatami === String(n));
  }
  if (status) {
    fights = fights.filter(f => f.status === status);
  }

  res.json(fights);
});

// POST /api/tatami/:n/next
router.post('/tatami/:n/next', express.json(), (req, res) => {
  const state = getState();
  const { pin } = req.body;

  if (!state.tournament || state.tournament.adminPin !== String(pin)) {
    return res.status(403).json({ error: 'wrongPin' });
  }

  const tatamiNum = Number(req.params.n);
  const nextFight = state.fights.find(f =>
    (f.tatami === tatamiNum || f.tatami === String(tatamiNum)) &&
    f.status === 'pending' &&
    f.whiteId && f.blueId
  );

  if (!nextFight) {
    return res.status(404).json({ error: 'No next fight available' });
  }

  state.activeFightByTatami[String(tatamiNum)] = nextFight.id;
  nextFight.status = 'active';

  const white = state.competitors.find(c => c.id === nextFight.whiteId);
  const blue = state.competitors.find(c => c.id === nextFight.blueId);
  const category = state.categories.find(c => c.id === nextFight.categoryId);

  broadcastAll('fight:started', {
    fightId: nextFight.id,
    fight: nextFight,
    white: white || null,
    blue: blue || null,
    category: category || null
  });
  save();
  res.json({ fight: nextFight, white, blue, category });
});

// GET /api/server-info  — returns network IP addresses so the setup page can build correct QR codes
router.get('/server-info', (req, res) => {
  const port = req.socket.localPort;
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(`http://${net.address}:${port}`);
      }
    }
  }
  res.json({ addresses });
});

// GET /api/qr?data=<url>  — returns a QR code PNG for the given URL
router.get('/qr', async (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).json({ error: 'Missing data param' });
  try {
    const png = await QRCode.toBuffer(data, { width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

export default router;
