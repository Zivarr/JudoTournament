import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ACTIVE_FILE = path.join(DATA_DIR, 'active.json');
const LEGACY_FILE = path.join(DATA_DIR, 'tournament.json');

let state = {
  tournament: null,
  competitors: [],
  categories: [],
  pools: [],
  fights: [],
  activeFightByTatami: {}
};

// Map<fightId, intervalId>
export const activeClockIntervals = new Map();

export function getState() {
  return state;
}

export function setState(partial) {
  state = { ...state, ...partial };
}

function tournamentFile(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

export function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!state.tournament) return;
    fs.writeFileSync(tournamentFile(state.tournament.id), JSON.stringify(state, null, 2), 'utf8');
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ id: state.tournament.id }), 'utf8');
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

function pauseRunningClocks(loadedState) {
  for (const fight of loadedState.fights) {
    if (fight.score && fight.score.clock && fight.score.clock.running) {
      fight.score.clock.running = false;
      fight.score.clock.runningAt = null;
    }
    if (fight.score && fight.score.osaekomi && fight.score.osaekomi.active) {
      fight.score.osaekomi.active = false;
      fight.score.osaekomi.startedAt = null;
    }
  }
}

function applyLoaded(loaded) {
  state = {
    tournament: loaded.tournament || null,
    competitors: loaded.competitors || [],
    categories: loaded.categories || [],
    pools: loaded.pools || [],
    fights: loaded.fights || [],
    activeFightByTatami: loaded.activeFightByTatami || {}
  };
  pauseRunningClocks(state);
}

export function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Migrate legacy single-file format
    if (fs.existsSync(LEGACY_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
        if (raw.tournament && raw.tournament.id) {
          const dest = tournamentFile(raw.tournament.id);
          if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, JSON.stringify(raw, null, 2), 'utf8');
          }
          if (!fs.existsSync(ACTIVE_FILE)) {
            fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ id: raw.tournament.id }), 'utf8');
          }
          fs.unlinkSync(LEGACY_FILE);
          console.log('Migrated legacy tournament data.');
        }
      } catch (e) {
        console.error('Migration failed:', e);
      }
    }

    // Load active tournament
    if (fs.existsSync(ACTIVE_FILE)) {
      const { id } = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
      const file = tournamentFile(id);
      if (id && fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        applyLoaded(raw);
        console.log(`State loaded: "${state.tournament ? state.tournament.name : id}"`);
        return;
      }
    }

    console.log('No active tournament. Select one from /admin.');
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

export function listTournaments() {
  try {
    if (!fs.existsSync(DATA_DIR)) return [];
    const activeId = state.tournament ? state.tournament.id : null;
    return fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json') && f !== 'active.json')
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
          if (!data.tournament) return null;
          const t = data.tournament;
          return {
            id: t.id,
            name: t.name,
            date: t.date,
            status: t.status,
            tatamiCount: t.tatamiCount,
            isActive: t.id === activeId
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch { return []; }
}

export function activateTournament(id) {
  try {
    const file = tournamentFile(id);
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    applyLoaded(raw);
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ id }), 'utf8');
    console.log(`Activated tournament: "${state.tournament ? state.tournament.name : id}"`);
    return true;
  } catch (err) {
    console.error('Failed to activate tournament:', err);
    return false;
  }
}

export function startClock(fightId, broadcastFn) {
  if (activeClockIntervals.has(fightId)) {
    return; // already running
  }
  const fightIndex = state.fights.findIndex(f => f.id === fightId);
  if (fightIndex === -1) return;

  const fight = state.fights[fightIndex];
  if (!fight.score || !fight.score.clock) return;

  fight.score.clock.running = true;
  fight.score.clock.runningAt = Date.now();

  const intervalId = setInterval(() => {
    const idx = state.fights.findIndex(f => f.id === fightId);
    if (idx === -1) {
      clearInterval(intervalId);
      activeClockIntervals.delete(fightId);
      return;
    }
    const f = state.fights[idx];
    if (!f.score || !f.score.clock || !f.score.clock.running) {
      clearInterval(intervalId);
      activeClockIntervals.delete(fightId);
      return;
    }

    const now = Date.now();
    const elapsed = now - f.score.clock.runningAt;

    // Golden score has no time limit and counts up; regular time counts down from storedRemainingMs.
    if (f.score.clock.goldenScore) {
      f.score.clock.elapsedGs = (f.score.clock.elapsedGs || 0) + 200;
    } else {
      f.score.clock.remainingMs = Math.max(0, f.score.clock.storedRemainingMs - elapsed);
    }

    // Check osaekomi — set pending score for referee to confirm
    // IJF thresholds: 5s → yuko, 10s → waza-ari, 20s → ippon.
    // pendingScore is staged here and committed only when the operator confirms via osaekomi:confirm.
    if (f.score.osaekomi && f.score.osaekomi.active && f.score.osaekomi.startedAt) {
      const osaElapsed = now - f.score.osaekomi.startedAt;
      const osa = f.score.osaekomi;

      if (osaElapsed >= 20000 && !osa.ipponAwarded && osa.pendingScore !== 'ippon') {
        osa.pendingScore = 'ippon';
      } else if (osaElapsed >= 10000 && !osa.wazaAriAwarded && osa.pendingScore !== 'wazaAri' && osa.pendingScore !== 'ippon') {
        osa.pendingScore = 'wazaAri';
      } else if (osaElapsed >= 5000 && !osa.yukoAwarded && !osa.pendingScore) {
        osa.pendingScore = 'yuko';
      }
    }

    // Check time expiry
    if (!f.score.clock.goldenScore && f.score.clock.remainingMs <= 0) {
      f.score.clock.goldenScore = true;
      f.score.clock.running = true;
      f.score.clock.runningAt = Date.now();
      f.score.clock.storedRemainingMs = 0;
      f.score.clock.remainingMs = 0;
      f.score.clock.elapsedGs = 0;
      broadcastFn('fight:golden_score', { fightId, score: f.score });
    }

    broadcastFn('fight:clock', { fightId, clock: f.score.clock, osaekomi: f.score.osaekomi });
  }, 200);

  activeClockIntervals.set(fightId, intervalId);
}

export function stopClock(fightId) {
  const intervalId = activeClockIntervals.get(fightId);
  if (intervalId) {
    clearInterval(intervalId);
    activeClockIntervals.delete(fightId);
  }
  const fightIndex = state.fights.findIndex(f => f.id === fightId);
  if (fightIndex === -1) return;
  const fight = state.fights[fightIndex];
  if (!fight.score || !fight.score.clock) return;

  if (fight.score.clock.running) {
    const elapsed = Date.now() - fight.score.clock.runningAt;
    if (!fight.score.clock.goldenScore) {
      fight.score.clock.storedRemainingMs = Math.max(0, fight.score.clock.storedRemainingMs - elapsed);
      fight.score.clock.remainingMs = fight.score.clock.storedRemainingMs;
    } else {
      fight.score.clock.elapsedGs = (fight.score.clock.elapsedGs || 0) + elapsed;
    }
    fight.score.clock.running = false;
    fight.score.clock.runningAt = null;
  }
}

export function startOsaekomi(fightId, side) {
  const fight = state.fights.find(f => f.id === fightId);
  if (!fight || !fight.score) return;
  fight.score.osaekomi = {
    active: true,
    side,
    startedAt: Date.now(),
    pendingScore: null,
    yukoAwarded: false,
    wazaAriAwarded: false,
    ipponAwarded: false
  };
}

export function stopOsaekomi(fightId) {
  const fight = state.fights.find(f => f.id === fightId);
  if (!fight || !fight.score) return;
  if (fight.score.osaekomi) {
    fight.score.osaekomi.active = false;
    fight.score.osaekomi.startedAt = null;
    // pendingScore is preserved so the client can show the confirmation UI
  }
}
