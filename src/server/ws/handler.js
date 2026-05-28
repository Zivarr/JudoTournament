import { v4 as uuidv4 } from 'uuid';
import { getState, setState, save, startClock, stopClock, startOsaekomi, stopOsaekomi } from '../state.js';
import * as engine from '../engine.js';
import { register, unregister, updateConnection, broadcastAll, broadcastToTatami, broadcast } from './broadcast.js';

function safeSend(ws, obj) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  } catch (e) { /* ignore */ }
}

function validatePin(pin) {
  const state = getState();
  if (!state.tournament) return false;
  return state.tournament.adminPin === String(pin);
}

function makeClockBroadcaster(tatami) {
  return function(event, data) {
    broadcastToTatami(tatami, event, data);
  };
}

export function handleConnection(ws, req) {
  register(ws, 'viewer', null);

  // Send full state on connect
  const state = getState();
  safeSend(ws, { type: 'state:full', state });

  ws.on('message', (rawMsg) => {
    let msg;
    try {
      msg = JSON.parse(rawMsg.toString());
    } catch (e) {
      safeSend(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const { type, pin } = msg;
    const state = getState();

    switch (type) {
      case 'register': {
        const { role, tatami } = msg;
        updateConnection(ws, role, tatami !== undefined ? tatami : null);
        safeSend(ws, { type: 'registered', role, tatami });
        break;
      }

      case 'clock:start': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId } = msg;
        const fight = state.fights.find(f => f.id === fightId);
        if (!fight) { safeSend(ws, { type: 'error', message: 'Fight not found' }); return; }
        if (fight.status === 'ended') return;
        fight.status = 'active';
        startClock(fightId, (event, data) => {
          broadcastToTatami(fight.tatami, event, data);
        });
        broadcastToTatami(fight.tatami, 'clock:started', { fightId, clock: fight.score.clock });
        save();
        break;
      }

      case 'clock:stop': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId } = msg;
        const fight = state.fights.find(f => f.id === fightId);
        if (!fight) return;
        stopClock(fightId);
        broadcastToTatami(fight.tatami, 'clock:stopped', { fightId, clock: fight.score.clock });
        save();
        break;
      }

      case 'score:ippon':
      case 'score:wazaari':
      case 'score:yuko':
      case 'score:shido':
      case 'score:hansoku': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const scoreType = type.split(':')[1];
        const { fightId, side } = msg;
        const fightIdx = state.fights.findIndex(f => f.id === fightId);
        if (fightIdx === -1) return;
        if (state.fights[fightIdx].status === 'ended') return;

        const updatedFight = engine.applyScore(state.fights[fightIdx], { type: scoreType, side });
        state.fights[fightIdx] = updatedFight;

        broadcastToTatami(updatedFight.tatami, 'fight:score', { fightId, score: updatedFight.score });

        if (updatedFight.status === 'ended') {
          stopClock(fightId);
          stopOsaekomi(fightId);

          const winnerId = updatedFight.score.winner === 'white' ? updatedFight.whiteId : updatedFight.blueId;
          broadcastToTatami(updatedFight.tatami, 'fight:ended', {
            fightId,
            winner: updatedFight.score.winner,
            winnerId,
            method: updatedFight.score.method,
            score: updatedFight.score
          });

          // Advance bracket
          const { updatedFights, updatedPools } = engine.advanceFight(updatedFight, state.fights, state.pools);
          setState({ fights: updatedFights, pools: updatedPools });
          broadcastAll('bracket:updated', { categoryId: updatedFight.categoryId, pools: updatedPools, fights: updatedFights });
        }

        save();
        break;
      }

      case 'score:undo': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId } = msg;
        const fightIdx = state.fights.findIndex(f => f.id === fightId);
        if (fightIdx === -1) return;
        const fight = state.fights[fightIdx];
        if (!fight.scoreHistory || fight.scoreHistory.length === 0) return;

        const newHistory = fight.scoreHistory.slice(0, -1);
        const replayedFight = engine.replayScore(fight, newHistory);
        state.fights[fightIdx] = replayedFight;

        broadcastToTatami(replayedFight.tatami, 'fight:score', { fightId, score: replayedFight.score });
        save();
        break;
      }

      case 'osaekomi:start': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId, side } = msg;
        const fight = state.fights.find(f => f.id === fightId);
        if (!fight || fight.status === 'ended') return;
        startOsaekomi(fightId, side);
        broadcastToTatami(fight.tatami, 'fight:osaekomi', { fightId, osaekomi: fight.score.osaekomi });
        save();
        break;
      }

      case 'osaekomi:break': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId } = msg;
        const fight = state.fights.find(f => f.id === fightId);
        if (!fight) return;
        stopOsaekomi(fightId);
        broadcastToTatami(fight.tatami, 'fight:osaekomi', { fightId, osaekomi: fight.score.osaekomi });
        save();
        break;
      }

      case 'fight:next': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { tatami } = msg;
        const tatamiNum = Number(tatami);

        // Find next pending fight for this tatami
        const nextFight = state.fights.find(f =>
          (f.tatami === tatamiNum || f.tatami === String(tatamiNum)) &&
          f.status === 'pending' &&
          f.whiteId && f.blueId
        );

        if (!nextFight) {
          safeSend(ws, { type: 'info', message: 'No next fight available' });
          return;
        }

        state.activeFightByTatami[String(tatamiNum)] = nextFight.id;
        nextFight.status = 'active';

        const currentState = getState();
        const white = currentState.competitors.find(c => c.id === nextFight.whiteId);
        const blue = currentState.competitors.find(c => c.id === nextFight.blueId);
        const category = currentState.categories.find(c => c.id === nextFight.categoryId);

        broadcastToTatami(tatamiNum, 'fight:started', {
          fightId: nextFight.id,
          fight: nextFight,
          white: white || null,
          blue: blue || null,
          category: category || null
        });
        save();
        break;
      }

      case 'fight:start': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId } = msg;
        const fight = state.fights.find(f => f.id === fightId);
        if (!fight) return;
        const tatamiNum = Number(fight.tatami);
        state.activeFightByTatami[String(tatamiNum)] = fight.id;
        fight.status = 'active';

        const currentState = getState();
        const white = currentState.competitors.find(c => c.id === fight.whiteId);
        const blue = currentState.competitors.find(c => c.id === fight.blueId);
        const category = currentState.categories.find(c => c.id === fight.categoryId);

        broadcastToTatami(tatamiNum, 'fight:started', {
          fightId: fight.id,
          fight,
          white: white || null,
          blue: blue || null,
          category: category || null
        });
        save();
        break;
      }

      case 'fight:referee_decision': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { fightId, side } = msg;
        const fightIdx = state.fights.findIndex(f => f.id === fightId);
        if (fightIdx === -1) return;
        const fight = state.fights[fightIdx];
        if (fight.status === 'ended') return;

        fight.score.winner = side;
        fight.score.method = 'referee-decision';
        fight.status = 'ended';
        stopClock(fightId);
        stopOsaekomi(fightId);

        const winnerId = side === 'white' ? fight.whiteId : fight.blueId;
        broadcastToTatami(fight.tatami, 'fight:score', { fightId, score: fight.score });
        broadcastToTatami(fight.tatami, 'fight:ended', {
          fightId,
          winner: side,
          winnerId,
          method: 'referee-decision',
          score: fight.score
        });

        const { updatedFights, updatedPools } = engine.advanceFight(fight, state.fights, state.pools);
        setState({ fights: updatedFights, pools: updatedPools });
        broadcastAll('bracket:updated', { categoryId: fight.categoryId, pools: updatedPools, fights: updatedFights });
        save();
        break;
      }

      case 'admin:create_tournament': {
        if (!validatePin(pin) && !(state.tournament === null && pin !== undefined)) {
          // Allow first creation with any pin
        }
        const { name, date, tatamiCount, fightDurationMs, adminPin } = msg;
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
          activeFightByTatami: {}
        });
        broadcastAll('tournament:updated', { tournament });
        save();
        break;
      }

      case 'admin:add_competitor': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const competitor = {
          id: uuidv4(),
          name: msg.name || '',
          club: msg.club || '',
          gender: msg.gender || 'M',
          weightKg: Number(msg.weightKg) || 0,
          birthYear: Number(msg.birthYear) || 0,
          actualWeightKg: null
        };
        state.competitors.push(competitor);
        broadcastAll('competitor:added', { competitor });
        save();
        break;
      }

      case 'admin:update_competitor': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const idx = state.competitors.findIndex(c => c.id === msg.id);
        if (idx === -1) return;
        state.competitors[idx] = { ...state.competitors[idx], ...msg };
        broadcastAll('competitor:updated', { competitor: state.competitors[idx] });
        save();
        break;
      }

      case 'admin:weigh_competitor': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const idx = state.competitors.findIndex(c => c.id === msg.id);
        if (idx === -1) return;
        const actualKg = msg.actualWeightKg != null ? Number(msg.actualWeightKg) : null;
        state.competitors[idx] = { ...state.competitors[idx], actualWeightKg: actualKg };
        broadcastAll('competitor:updated', { competitor: state.competitors[idx] });
        save();
        break;
      }

      case 'admin:delete_competitor': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const idx = state.competitors.findIndex(c => c.id === msg.id);
        if (idx !== -1) {
          state.competitors.splice(idx, 1);
          broadcastAll('competitor:deleted', { id: msg.id });
          save();
        }
        break;
      }

      case 'admin:add_category': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const defaultDuration = state.tournament ? state.tournament.fightDurationMs : 240000;
        const category = {
          id: uuidv4(),
          name: msg.name || '',
          gender: msg.gender || 'M',
          ageCategory: msg.ageCategory || null,
          maxWeight: Number(msg.maxWeight) || 0,
          competitorIds: msg.competitorIds || [],
          tatami: Number(msg.tatami) || 1,
          tatami2: msg.tatami2 ? Number(msg.tatami2) : null,
          format: msg.format || 'roundrobin',
          status: 'pending',
          fightDurationMs: msg.fightDurationMs ? Number(msg.fightDurationMs) : defaultDuration
        };
        state.categories.push(category);
        broadcastAll('category:added', { category });
        save();
        break;
      }

      case 'admin:update_category': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const idx = state.categories.findIndex(c => c.id === msg.id);
        if (idx === -1) return;
        state.categories[idx] = { ...state.categories[idx], ...msg };
        broadcastAll('category:updated', { category: state.categories[idx] });
        save();
        break;
      }

      case 'admin:generate_draw': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { categoryId } = msg;
        const category = state.categories.find(c => c.id === categoryId);
        if (!category) { safeSend(ws, { type: 'error', message: 'Category not found' }); return; }

        const competitors = state.competitors.filter(c => category.competitorIds.includes(c.id));
        if (competitors.length < 2) {
          safeSend(ws, { type: 'error', message: 'Need at least 2 competitors' });
          return;
        }

        // Remove old pools and fights for this category
        const filteredPools = state.pools.filter(p => p.categoryId !== categoryId);
        const filteredFights = state.fights.filter(f => f.categoryId !== categoryId);

        const { pools: newPools, fights: newFights } = engine.generateDraw(category, competitors);
        setState({
          pools: [...filteredPools, ...newPools],
          fights: [...filteredFights, ...newFights]
        });

        category.status = 'drawn';
        broadcastAll('bracket:updated', { categoryId, pools: getState().pools, fights: getState().fights });
        save();
        break;
      }

      case 'admin:assign_tatami': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const { categoryId, tatami, tatami2 } = msg;
        const cat = state.categories.find(c => c.id === categoryId);
        if (cat) {
          const fromTatami = cat.tatami;
          cat.tatami  = Number(tatami);
          cat.tatami2 = tatami2 ? Number(tatami2) : null;
          // Re-distribute fight tatamis: alternate between tatami and tatami2
          let fightCount = 0;
          const catFights = state.fights.filter(f => f.categoryId === categoryId && !f.isBye);
          if (cat.tatami2) {
            catFights.forEach((f, i) => { f.tatami = i % 2 === 0 ? cat.tatami : cat.tatami2; fightCount++; });
          } else {
            catFights.forEach(f => { f.tatami = cat.tatami; fightCount++; });
          }
          broadcastAll('category:updated', { category: cat });
          broadcastAll('category:reassigned', {
            fromTatami, toTatami: cat.tatami, category: { name: cat.name }, fightCount
          });
          broadcastAll('bracket:updated', { pools: state.pools, fights: state.fights });
          save();
        }
        break;
      }

      case 'admin:reassign_fight': {
        if (!validatePin(pin)) { safeSend(ws, { type: 'error', message: 'wrongPin' }); return; }
        const fight = state.fights.find(f => f.id === msg.fightId);
        if (fight && fight.status === 'pending') {
          const fromTatami = fight.tatami;
          fight.tatami = Number(msg.tatami);
          const white = state.competitors.find(c => c.id === fight.whiteId);
          const blue  = state.competitors.find(c => c.id === fight.blueId);
          const cat   = state.categories.find(c => c.id === fight.categoryId);
          broadcastAll('fight:reassigned', {
            fightId: fight.id,
            fromTatami,
            toTatami: fight.tatami,
            category: cat   ? { name: cat.name }   : null,
            white:    white ? { name: white.name }  : null,
            blue:     blue  ? { name: blue.name }   : null
          });
          broadcastAll('bracket:updated', { pools: state.pools, fights: state.fights });
          save();
        }
        break;
      }

      default:
        safeSend(ws, { type: 'error', message: `Unknown message type: ${type}` });
    }
  });

  ws.on('close', () => {
    unregister(ws);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
    unregister(ws);
  });
}
