import { v4 as uuidv4 } from 'uuid';

export function applyScore(fight, event) {
  const f = JSON.parse(JSON.stringify(fight)); // deep clone
  const { type, side } = event;
  const opponent = side === 'white' ? 'blue' : 'white';

  // Record history
  if (!f.scoreHistory) f.scoreHistory = [];
  f.scoreHistory.push({ ...event, timestamp: Date.now() });

  switch (type) {
    case 'ippon':
      f.score[side].ippon = true;
      f.score.winner = side;
      f.score.method = 'ippon';
      f.status = 'ended';
      f.score.clock.running = false;
      break;

    case 'wazaari':
      f.score[side].wazaAri = (f.score[side].wazaAri || 0) + 1;
      if (f.score[side].wazaAri >= 2) {
        f.score[side].ippon = true;
        f.score.winner = side;
        f.score.method = 'waza-ari-awasete-ippon';
        f.status = 'ended';
        f.score.clock.running = false;
      }
      break;

    case 'yuko':
      f.score[side].yuko = (f.score[side].yuko || 0) + 1;
      break;

    case 'shido':
      f.score[side].shido = (f.score[side].shido || 0) + 1;
      if (f.score[side].shido >= 3) {
        // 3rd shido = hansoku-make, opponent wins
        f.score[side].hansokuMake = true;
        f.score[opponent].ippon = true;
        f.score.winner = opponent;
        f.score.method = 'shido-hansoku-make';
        f.status = 'ended';
        f.score.clock.running = false;
      }
      break;

    case 'hansoku':
      f.score[side].hansokuMake = true;
      f.score[opponent].ippon = true;
      f.score.winner = opponent;
      f.score.method = 'hansoku-make';
      f.status = 'ended';
      f.score.clock.running = false;
      break;

    default:
      break;
  }

  return f;
}

export function replayScore(baseFight, history) {
  let f = JSON.parse(JSON.stringify(baseFight));
  // Reset score
  f.score.white = { ippon: false, wazaAri: 0, yuko: 0, shido: 0, hansokuMake: false };
  f.score.blue = { ippon: false, wazaAri: 0, yuko: 0, shido: 0, hansokuMake: false };
  f.score.winner = null;
  f.score.method = null;
  f.status = 'active';
  f.scoreHistory = [];

  for (const event of history) {
    f = applyScore(f, event);
    if (f.status === 'ended') break;
  }
  return f;
}

export function checkFightEnd(fight) {
  const { score } = fight;
  if (!score) return { ended: false };

  if (score.winner) {
    return { ended: true, winnerId: score.winner === 'white' ? fight.whiteId : fight.blueId, method: score.method };
  }
  return { ended: false };
}

export function applyOsaekomiTick(fight, elapsedMs) {
  const f = JSON.parse(JSON.stringify(fight));
  if (!f.score.osaekomi || !f.score.osaekomi.active) return f;

  const side = f.score.osaekomi.side;
  if (elapsedMs >= 20000 && !f.score.osaekomi.ipponAwarded) {
    f.score.osaekomi.ipponAwarded = true;
    f.score[side].ippon = true;
    f.score.winner = side;
    f.score.method = 'ippon';
    f.status = 'ended';
    f.score.clock.running = false;
    f.score.osaekomi.active = false;
  } else if (elapsedMs >= 10000 && !f.score.osaekomi.wazaAriAwarded) {
    f.score.osaekomi.wazaAriAwarded = true;
    // Yuko at 5s upgrades to waza-ari — remove it
    if (f.score.osaekomi.yukoAwarded) {
      f.score[side].yuko = Math.max(0, (f.score[side].yuko || 0) - 1);
    }
    f.score[side].wazaAri = (f.score[side].wazaAri || 0) + 1;
    if (f.score[side].wazaAri >= 2) {
      f.score[side].ippon = true;
      f.score.winner = side;
      f.score.method = 'waza-ari-awasete-ippon';
      f.status = 'ended';
      f.score.clock.running = false;
      f.score.osaekomi.active = false;
    }
  } else if (elapsedMs >= 5000 && !f.score.osaekomi.yukoAwarded) {
    f.score.osaekomi.yukoAwarded = true;
    f.score[side].yuko = (f.score[side].yuko || 0) + 1;
  }
  return f;
}

export function enterGoldenScore(fight) {
  const f = JSON.parse(JSON.stringify(fight));
  f.score.clock.goldenScore = true;
  f.score.clock.remainingMs = 0;
  f.score.clock.storedRemainingMs = 0;
  f.score.clock.elapsedGs = 0;
  f.score.clock.running = false;
  f.score.clock.runningAt = null;
  return f;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function createEmptyFight(categoryId, tatami, round, roundName, matchIndex, fightDurationMs) {
  return {
    id: uuidv4(),
    categoryId,
    tatami,
    round,
    roundName,
    matchIndex,
    whiteId: null,
    blueid: null,
    blueId: null,
    status: 'pending',
    isBye: false,
    scoreHistory: [],
    score: {
      white: { ippon: false, wazaAri: 0, yuko: 0, shido: 0, hansokuMake: false },
      blue: { ippon: false, wazaAri: 0, yuko: 0, shido: 0, hansokuMake: false },
      winner: null,
      method: null,
      clock: {
        running: false,
        runningAt: null,
        remainingMs: fightDurationMs || 240000,
        storedRemainingMs: fightDurationMs || 240000,
        goldenScore: false,
        elapsedGs: 0
      },
      osaekomi: { active: false, side: null, startedAt: null, yukoAwarded: false, wazaAriAwarded: false, ipponAwarded: false }
    }
  };
}

export function generateDraw(category, competitors) {
  const fightDurationMs = category.fightDurationMs || 240000;
  const tatami  = category.tatami  || 1;
  const tatami2 = category.tatami2 || null;

  if (category.format === 'roundrobin') {
    return generateRoundRobin(category, competitors, fightDurationMs, tatami, tatami2);
  } else if (category.format === 'doubleelim') {
    return generateDoubleElim(category, competitors, fightDurationMs, tatami);
  } else {
    if (competitors.length <= 5) {
      return generateRoundRobin(category, competitors, fightDurationMs, tatami, tatami2);
    } else {
      return generateDoubleElim(category, competitors, fightDurationMs, tatami);
    }
  }
}

// Circle method: each player fights at most once per round (guarantees ≥1 rest between fights).
// Returns array of rounds; each round: { pairs: [[i,j], ...], restIndex: number|null }
function buildRoundRobinSchedule(n) {
  const rounds = [];
  if (n % 2 === 0) {
    // Fix index 0, rotate indices 1..n-1
    const rotating = Array.from({ length: n - 1 }, (_, i) => i + 1);
    for (let r = 0; r < n - 1; r++) {
      const pairs = [[0, rotating[rotating.length - 1]]];
      for (let i = 0; i < Math.floor((n - 2) / 2); i++) {
        pairs.push([rotating[i], rotating[rotating.length - 2 - i]]);
      }
      rounds.push({ pairs, restIndex: null });
      rotating.unshift(rotating.pop());
    }
  } else {
    // Odd: one player sits out per round
    const rotating = Array.from({ length: n }, (_, i) => i);
    for (let r = 0; r < n; r++) {
      const pairs = [];
      for (let i = 0; i < Math.floor(n / 2); i++) {
        pairs.push([rotating[i], rotating[n - 2 - i]]);
      }
      rounds.push({ pairs, restIndex: rotating[n - 1] });
      rotating.unshift(rotating.pop());
    }
  }
  return rounds;
}

function generateRoundRobin(category, competitors, fightDurationMs, tatami, tatami2) {
  const fights = [];
  const poolId = uuidv4();
  const pool = {
    id: poolId,
    categoryId: category.id,
    format: 'roundrobin',
    competitorIds: competitors.map(c => c.id),
    standings: competitors.map(c => ({
      competitorId: c.id,
      wins: 0,
      losses: 0,
      points: 0,
      ipponsScored: 0,
      ipponsConc: 0
    }))
  };

  const schedule = buildRoundRobinSchedule(competitors.length);
  let matchIndex = 0;
  schedule.forEach(({ pairs }, roundIndex) => {
    pairs.forEach(([i, j], pairIndex) => {
      // Alternate between tatami and tatami2 within each round so parallel fights are possible
      const assignedTatami = tatami2 && pairIndex % 2 === 1 ? tatami2 : tatami;
      const fight = createEmptyFight(category.id, assignedTatami, roundIndex + 1, 'Pool', matchIndex, fightDurationMs);
      fight.poolId = poolId;
      fight.whiteId = competitors[i].id;
      fight.blueId = competitors[j].id;
      fights.push(fight);
      matchIndex++;
    });
  });

  return { pools: [pool], fights };
}

function generateDoubleElim(category, competitors, fightDurationMs, tatami) {
  const fights = [];
  const n = competitors.length;
  const bracketSize = nextPowerOf2(n);
  const byeCount = bracketSize - n;

  // Seed competitors — first byeCount get byes
  const seeded = [...competitors];

  // Winner bracket: R1 has bracketSize/2 slots
  // We store bracket slots as arrays
  const wbR1Fights = [];
  let matchIndex = 0;

  for (let i = 0; i < bracketSize / 2; i++) {
    const topSeed = seeded[i * 2] || null;
    const botSeed = seeded[i * 2 + 1] || null;

    const fight = createEmptyFight(category.id, tatami, 1, 'WB-R1', matchIndex, fightDurationMs);
    fight.bracketType = 'winner';
    fight.bracketRound = 1;
    fight.bracketSlot = i;

    if (!topSeed || !botSeed) {
      // Bye
      fight.isBye = true;
      fight.whiteId = topSeed ? topSeed.id : null;
      fight.blueId = botSeed ? botSeed.id : null;
      fight.status = 'bye';
      fight.score.winner = topSeed ? 'white' : 'blue';
      fight.score.method = 'bye';
      fight.winnerId = topSeed ? topSeed.id : null;
    } else {
      fight.whiteId = topSeed.id;
      fight.blueId = botSeed.id;
    }
    wbR1Fights.push(fight);
    fights.push(fight);
    matchIndex++;
  }

  // Build winner bracket subsequent rounds
  let prevRoundFights = wbR1Fights;
  let wbRound = 2;
  const wbRounds = [wbR1Fights];

  while (prevRoundFights.length > 1) {
    const nextRoundFights = [];
    for (let i = 0; i < prevRoundFights.length / 2; i++) {
      const fight = createEmptyFight(category.id, tatami, wbRound, `WB-R${wbRound}`, matchIndex, fightDurationMs);
      fight.bracketType = 'winner';
      fight.bracketRound = wbRound;
      fight.bracketSlot = i;
      fight.prevFight1Id = prevRoundFights[i * 2].id;
      fight.prevFight2Id = prevRoundFights[i * 2 + 1].id;
      nextRoundFights.push(fight);
      fights.push(fight);
      matchIndex++;
    }
    prevRoundFights = nextRoundFights;
    wbRounds.push(nextRoundFights);
    wbRound++;
  }

  const wbFinal = prevRoundFights[0];

  // Loser bracket
  // LB R1: losers from WB R1 (bracketSize/4 fights if bracketSize > 2)
  const lbRounds = [];
  let lbRound = 1;
  let lbPrevFights = [];

  if (wbR1Fights.length > 1) {
    const lbR1Fights = [];
    for (let i = 0; i < wbR1Fights.length / 2; i++) {
      const fight = createEmptyFight(category.id, tatami, lbRound, `LB-R${lbRound}`, matchIndex, fightDurationMs);
      fight.bracketType = 'loser';
      fight.bracketRound = lbRound;
      fight.bracketSlot = i;
      fight.loserOf1 = wbR1Fights[i * 2].id;
      fight.loserOf2 = wbR1Fights[i * 2 + 1].id;
      lbR1Fights.push(fight);
      fights.push(fight);
      matchIndex++;
    }
    lbRounds.push(lbR1Fights);
    lbPrevFights = lbR1Fights;
    lbRound++;

    // LB subsequent rounds paired with WB loser drop-ins
    for (let wbIdx = 1; wbIdx < wbRounds.length - 1; wbIdx++) {
      const wbDropIns = wbRounds[wbIdx];
      const combinedFights = [];

      // Match LB survivors against WB losers
      for (let i = 0; i < lbPrevFights.length; i++) {
        const fight = createEmptyFight(category.id, tatami, lbRound, `LB-R${lbRound}`, matchIndex, fightDurationMs);
        fight.bracketType = 'loser';
        fight.bracketRound = lbRound;
        fight.bracketSlot = i;
        fight.prevLbFightId = lbPrevFights[i].id;
        fight.loserOf = wbDropIns[i] ? wbDropIns[i].id : null;
        combinedFights.push(fight);
        fights.push(fight);
        matchIndex++;
      }
      lbRounds.push(combinedFights);
      lbPrevFights = combinedFights;
      lbRound++;

      if (lbPrevFights.length > 1) {
        const reducedFights = [];
        for (let i = 0; i < lbPrevFights.length / 2; i++) {
          const fight = createEmptyFight(category.id, tatami, lbRound, `LB-R${lbRound}`, matchIndex, fightDurationMs);
          fight.bracketType = 'loser';
          fight.bracketRound = lbRound;
          fight.bracketSlot = i;
          fight.prevFight1Id = lbPrevFights[i * 2].id;
          fight.prevFight2Id = lbPrevFights[i * 2 + 1].id;
          reducedFights.push(fight);
          fights.push(fight);
          matchIndex++;
        }
        lbRounds.push(reducedFights);
        lbPrevFights = reducedFights;
        lbRound++;
      }
    }
  }

  // Grand Final
  const grandFinal = createEmptyFight(category.id, tatami, 99, 'Grand Final', matchIndex, fightDurationMs);
  grandFinal.bracketType = 'grand-final';
  grandFinal.bracketRound = 99;
  grandFinal.bracketSlot = 0;
  grandFinal.prevFight1Id = wbFinal.id;
  grandFinal.prevFight2Id = lbPrevFights.length > 0 ? lbPrevFights[0].id : null;
  grandFinal.roundName = 'Grand Final';
  fights.push(grandFinal);

  // Auto-resolve byes
  for (const fight of fights) {
    if (fight.isBye && fight.status === 'bye') {
      fight.winnerId = fight.score.winner === 'white' ? fight.whiteId : fight.blueId;
    }
  }

  const pool = {
    id: uuidv4(),
    categoryId: category.id,
    format: 'doubleelim',
    competitorIds: competitors.map(c => c.id),
    standings: []
  };

  return { pools: [pool], fights };
}

export function advanceFight(fight, allFights, allPools) {
  const updatedFights = allFights.map(f => ({ ...f }));
  const updatedPools = allPools.map(p => ({ ...p }));

  if (!fight.score || !fight.score.winner) return { updatedFights, updatedPools };

  const winnerId = fight.score.winner === 'white' ? fight.whiteId : fight.blueId;
  const loserId = fight.score.winner === 'white' ? fight.blueId : fight.whiteId;

  // Update bracket next fights
  for (const f of updatedFights) {
    // Winner bracket advancement
    if (f.prevFight1Id === fight.id || f.prevFight2Id === fight.id) {
      if (f.bracketType === 'winner' || f.bracketType === 'grand-final') {
        if (f.prevFight1Id === fight.id) {
          f.whiteId = winnerId;
        } else if (f.prevFight2Id === fight.id) {
          f.blueId = winnerId;
        }
      } else if (f.bracketType === 'loser') {
        if (f.prevFight1Id === fight.id) {
          f.whiteId = winnerId;
        } else if (f.prevFight2Id === fight.id) {
          f.blueId = winnerId;
        } else if (f.prevLbFightId === fight.id) {
          f.whiteId = winnerId;
        }
      }
    }

    // Loser drops from winner bracket into loser bracket
    if (f.loserOf === fight.id || f.loserOf1 === fight.id || f.loserOf2 === fight.id) {
      if (f.loserOf === fight.id) {
        f.blueId = loserId;
      } else if (f.loserOf1 === fight.id) {
        f.whiteId = loserId;
      } else if (f.loserOf2 === fight.id) {
        f.blueId = loserId;
      }
    }

    // LB prev fight advancement
    if (f.prevLbFightId === fight.id) {
      f.whiteId = winnerId;
    }
  }

  // Update pool standings
  if (fight.poolId) {
    const poolIdx = updatedPools.findIndex(p => p.id === fight.poolId);
    if (poolIdx !== -1) {
      const pool = updatedPools[poolIdx];
      const poolFights = updatedFights.filter(f => f.poolId === fight.poolId && f.status === 'ended');
      updatedPools[poolIdx] = {
        ...pool,
        standings: calculatePoolStandings(pool, poolFights)
      };
    }
  }

  return { updatedFights, updatedPools };
}

export function calculatePoolStandings(pool, fights) {
  const competitorIds = pool.competitorIds || [];
  const standings = {};

  for (const id of competitorIds) {
    standings[id] = {
      competitorId: id,
      wins: 0,
      losses: 0,
      points: 0,
      ipponsScored: 0,
      ipponsConc: 0
    };
  }

  for (const fight of fights) {
    if (fight.status !== 'ended' || !fight.score || !fight.score.winner) continue;
    const winnerId = fight.score.winner === 'white' ? fight.whiteId : fight.blueId;
    const loserId = fight.score.winner === 'white' ? fight.blueId : fight.whiteId;
    const method = fight.score.method;
    const pts = standingsPoints(method);

    if (standings[winnerId]) {
      standings[winnerId].wins++;
      standings[winnerId].points += pts;
      if (method === 'ippon' || method === 'waza-ari-awasete-ippon' || method === 'hansoku-make' || method === 'shido-hansoku-make') {
        standings[winnerId].ipponsScored++;
      }
    }
    if (standings[loserId]) {
      standings[loserId].losses++;
      if (method === 'ippon' || method === 'waza-ari-awasete-ippon' || method === 'hansoku-make' || method === 'shido-hansoku-make') {
        standings[loserId].ipponsConc++;
      }
    }
  }

  // JBN art. 22: wins → points sum → head-to-head → ippons scored → ippons conceded
  const arr = Object.values(standings);
  arr.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.points !== a.points) return b.points - a.points;
    // Direct head-to-head comparison
    const h2hFight = fights.find(f =>
      f.status === 'ended' &&
      ((f.whiteId === a.competitorId && f.blueId === b.competitorId) ||
       (f.whiteId === b.competitorId && f.blueId === a.competitorId))
    );
    if (h2hFight && h2hFight.score) {
      const h2hWinner = h2hFight.score.winner === 'white' ? h2hFight.whiteId : h2hFight.blueId;
      if (h2hWinner === a.competitorId) return -1;
      if (h2hWinner === b.competitorId) return 1;
    }
    if (b.ipponsScored !== a.ipponsScored) return b.ipponsScored - a.ipponsScored;
    return a.ipponsConc - b.ipponsConc;
  });

  return arr;
}

export function getWinMethod(fight) {
  if (!fight.score) return null;
  return fight.score.method || null;
}

export function standingsPoints(method) {
  switch (method) {
    case 'ippon':
    case 'waza-ari-awasete-ippon':
    case 'hansoku-make':
    case 'shido-hansoku-make':
      return 10;
    case 'wazaari':
    case 'waza-ari':
      return 7;
    case 'yuko':
      return 5;
    case 'referee-decision':
      return 1;
    case 'bye':
      return 10;
    default:
      return 1;
  }
}
