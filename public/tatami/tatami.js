import { WsClient, getWsUrl } from '/shared/ws-client.js';
import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';

// Determine tatami number from URL
const pathParts = window.location.pathname.split('/');
const tatamiNum = parseInt(pathParts[pathParts.length - 1]) || 1;

document.getElementById('topBarTitle').textContent = `Tatami ${tatamiNum}`;
document.getElementById('tatamiNumDisplay').textContent = tatamiNum;
document.title = `Tatami ${tatamiNum} - Judo Tournament`;

let state = { tournament: null, competitors: [], categories: [], pools: [], fights: [], activeFightByTatami: {} };
let currentFight = null;
let currentFightId = null;

// Clock interpolation
let clockState = null;
let clockReceivedAt = 0;
let clockRafId = null;

// Osaekomi rAF
let osaekomiRafId = null;
let osaekomiStartedAt = 0;

// ---- Lang ----
window.switchLang = function(lang) {
  setLang(lang);
  applyTranslations();
  updateLangButtons();
};

function updateLangButtons() {
  const lang = getLang();
  document.getElementById('langNl').classList.toggle('active', lang === 'nl');
  document.getElementById('langEn').classList.toggle('active', lang === 'en');
}

// ---- WS ----
const ws = new WsClient(getWsUrl());

ws.on('open', () => {
  document.getElementById('connIndicator').classList.add('connected');
  ws.send('register', { role: 'tatami', tatami: tatamiNum });
});

ws.on('close', () => {
  document.getElementById('connIndicator').classList.remove('connected');
});

ws.on('state:full', (data) => {
  state = data.state || state;

  // Restore active fight if exists
  const activeFightId = state.activeFightByTatami && state.activeFightByTatami[String(tatamiNum)];
  if (activeFightId) {
    const fight = state.fights.find(f => f.id === activeFightId);
    if (fight && fight.status !== 'ended') {
      const white = state.competitors.find(c => c.id === fight.whiteId);
      const blue = state.competitors.find(c => c.id === fight.blueId);
      const category = state.categories.find(c => c.id === fight.categoryId);
      showFight(fight, white, blue, category);
    }
  }
  renderBracket();
});

ws.on('fight:started', (data) => {
  if (data.fight.tatami !== tatamiNum && data.fight.tatami !== String(tatamiNum)) return;
  showFight(data.fight, data.white, data.blue, data.category);
  renderBracket();
});

ws.on('fight:score', (data) => {
  if (data.fightId !== currentFightId) return;
  updateScore(data.score);
});

ws.on('fight:clock', (data) => {
  if (data.fightId !== currentFightId) return;
  onClockUpdate(data.clock);
  if (data.osaekomi) updateOsaekomi(data.osaekomi);
});

ws.on('clock:started', (data) => {
  if (data.fightId !== currentFightId) return;
  onClockUpdate(data.clock);
});

ws.on('clock:stopped', (data) => {
  if (data.fightId !== currentFightId) return;
  onClockUpdate(data.clock);
});

ws.on('fight:osaekomi', (data) => {
  if (data.fightId !== currentFightId) return;
  updateOsaekomi(data.osaekomi);
});

ws.on('fight:golden_score', (data) => {
  if (data.fightId !== currentFightId) return;
  document.getElementById('goldenScoreBanner').classList.add('show');
  onClockUpdate(data.score ? data.score.clock : null);
  updateScore(data.score);
});

ws.on('fight:ended', (data) => {
  if (data.fightId !== currentFightId) return;
  stopClockLoop();
  showWinner(data.winner, data.method, data.score);
  stopOsaekomiDisplay();
});

ws.on('bracket:updated', (data) => {
  state.pools = data.pools || state.pools;
  state.fights = data.fights || state.fights;
  renderBracket();
});

ws.on('tournament:updated', (data) => {
  state.tournament = data.tournament;
});

// ---- Show Fight ----
function showFight(fight, white, blue, category) {
  currentFight = fight;
  currentFightId = fight.id;

  document.getElementById('noFightDisplay').style.display = 'none';
  document.getElementById('scoreboardSection').style.display = 'flex';
  document.getElementById('bracketSection').style.display = 'block';

  // Fighter info
  document.getElementById('whiteName').textContent = white ? white.name : '—';
  document.getElementById('whiteClub').textContent = white ? white.club : '';
  document.getElementById('blueName').textContent = blue ? blue.name : '—';
  document.getElementById('blueClub').textContent = blue ? blue.club : '';

  // Category
  document.getElementById('catName').textContent = category ? category.name : '—';
  document.getElementById('fightRound').textContent = fight.roundName || '';

  // Reset score display
  resetScoreDisplay();

  // Apply current score if any
  if (fight.score) {
    updateScore(fight.score);
    if (fight.score.clock) onClockUpdate(fight.score.clock);
    if (fight.score.osaekomi) updateOsaekomi(fight.score.osaekomi);
    if (fight.score.clock && fight.score.clock.goldenScore) {
      document.getElementById('goldenScoreBanner').classList.add('show');
    }
    if (fight.status === 'ended' && fight.score.winner) {
      showWinner(fight.score.winner, fight.score.method, fight.score);
    }
  }
}

function resetScoreDisplay() {
  // Reset ippon
  document.getElementById('whiteIppon').classList.remove('scored');
  document.getElementById('blueIppon').classList.remove('scored');
  // Reset waza-ari
  document.getElementById('whiteWa1').classList.remove('scored');
  document.getElementById('whiteWa2').classList.remove('scored');
  document.getElementById('blueWa1').classList.remove('scored');
  document.getElementById('blueWa2').classList.remove('scored');
  // Reset yuko
  document.getElementById('whiteYukoCount').textContent = '0';
  document.getElementById('blueYukoCount').textContent = '0';
  // Reset shidos
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`whiteShido${i}`).className = 'shido-dot';
    document.getElementById(`blueShido${i}`).className = 'shido-dot';
  }
  // Reset clock
  stopClockLoop();
  stopOsaekomiDisplay();
  document.getElementById('clockDigits').textContent = '0:00';
  document.getElementById('clockDigits').className = 'clock-digits';
  // Reset golden score
  document.getElementById('goldenScoreBanner').classList.remove('show');
  // Reset osaekomi
  document.getElementById('osaekomiSection').style.visibility = 'hidden';
  document.getElementById('osaekomiBar').style.width = '0%';
  // Reset winners
  document.getElementById('whiteWinnerBanner').classList.remove('show');
  document.getElementById('blueWinnerBanner').classList.remove('show');
  document.getElementById('whiteSide').classList.remove('winner-highlight');
  document.getElementById('blueSide').classList.remove('winner-highlight');
}

// ---- Update Score ----
function updateScore(score) {
  if (!score) return;

  // White
  const ws = score.white || {};
  document.getElementById('whiteIppon').classList.toggle('scored', !!ws.ippon);
  document.getElementById('whiteWa1').classList.toggle('scored', (ws.wazaAri || 0) >= 1);
  document.getElementById('whiteWa2').classList.toggle('scored', (ws.wazaAri || 0) >= 2);
  document.getElementById('whiteYukoCount').textContent = ws.yuko || 0;
  updateShidos('white', ws.shido || 0, !!ws.hansokuMake);

  // Blue
  const bs = score.blue || {};
  document.getElementById('blueIppon').classList.toggle('scored', !!bs.ippon);
  document.getElementById('blueWa1').classList.toggle('scored', (bs.wazaAri || 0) >= 1);
  document.getElementById('blueWa2').classList.toggle('scored', (bs.wazaAri || 0) >= 2);
  document.getElementById('blueYukoCount').textContent = bs.yuko || 0;
  updateShidos('blue', bs.shido || 0, !!bs.hansokuMake);

  if (score.clock) onClockUpdate(score.clock);
  if (score.osaekomi) updateOsaekomi(score.osaekomi);
  if (score.clock && score.clock.goldenScore) {
    document.getElementById('goldenScoreBanner').classList.add('show');
  }
}

function updateShidos(side, count, hansoku) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`${side}Shido${i}`);
    if (hansoku && i <= count) {
      dot.className = 'shido-dot hansoku';
    } else if (i <= count) {
      dot.className = 'shido-dot filled';
    } else {
      dot.className = 'shido-dot';
    }
  }
}

// ---- Clock interpolation ----
function onClockUpdate(clock) {
  if (!clock) return;
  clockState = clock;
  clockReceivedAt = Date.now();
  if (clock.running) {
    if (!clockRafId) clockRafId = requestAnimationFrame(tickClock);
  } else {
    stopClockLoop();
    renderClock(clock);
  }
}

function tickClock() {
  if (!clockState || !clockState.running) {
    clockRafId = null;
    return;
  }
  const elapsed = Date.now() - clockReceivedAt;
  const interpolated = clockState.goldenScore
    ? { ...clockState, elapsedGs: (clockState.elapsedGs || 0) + elapsed }
    : { ...clockState, remainingMs: Math.max(0, (clockState.remainingMs || 0) - elapsed) };
  renderClock(interpolated);
  clockRafId = requestAnimationFrame(tickClock);
}

function stopClockLoop() {
  if (clockRafId) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
  clockState = null;
}

function renderClock(clock) {
  if (!clock) return;
  const el = document.getElementById('clockDigits');

  let displayMs;
  let displayStr;

  if (clock.goldenScore) {
    displayMs = clock.elapsedGs || 0;
    const secs = Math.floor(displayMs / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `GS ${mins}:${String(s).padStart(2, '0')}`;
    el.className = 'clock-digits running';
  } else {
    displayMs = clock.remainingMs || 0;
    const secs = Math.ceil(displayMs / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `${mins}:${String(s).padStart(2, '0')}`;

    if (clock.running) {
      el.className = displayMs <= 30000 ? 'clock-digits danger' : 'clock-digits running';
    } else {
      el.className = 'clock-digits';
    }
  }

  el.textContent = displayStr;
}

// ---- Osaekomi ----
function updateOsaekomi(osaekomi) {
  const section = document.getElementById('osaekomiSection');
  const bar = document.getElementById('osaekomiBar');
  const timer = document.getElementById('osaekomiTimer');

  if (!osaekomi || !osaekomi.active) {
    section.style.visibility = 'hidden';
    stopOsaekomiDisplay();
    return;
  }

  section.style.visibility = 'visible';
  stopOsaekomiDisplay();
  osaekomiStartedAt = osaekomi.startedAt;

  function tickOsaekomi() {
    const elapsed = Date.now() - osaekomiStartedAt;
    const secs = Math.min(elapsed / 1000, 20);
    bar.style.width = `${(secs / 20) * 100}%`;
    timer.textContent = `${secs.toFixed(1)}s`;
    if (secs < 20) {
      osaekomiRafId = requestAnimationFrame(tickOsaekomi);
    } else {
      osaekomiRafId = null;
    }
  }
  osaekomiRafId = requestAnimationFrame(tickOsaekomi);
}

function stopOsaekomiDisplay() {
  if (osaekomiRafId) {
    cancelAnimationFrame(osaekomiRafId);
    osaekomiRafId = null;
  }
}

// ---- Show Winner ----
function showWinner(winner, method, score) {
  if (winner === 'white') {
    document.getElementById('whiteWinnerBanner').classList.add('show');
    document.getElementById('whiteSide').classList.add('winner-highlight');
  } else if (winner === 'blue') {
    document.getElementById('blueWinnerBanner').classList.add('show');
    document.getElementById('blueSide').classList.add('winner-highlight');
  }
  stopOsaekomiDisplay();
  document.getElementById('osaekomiSection').style.visibility = 'hidden';
}

// ---- Render Bracket ----
function renderBracket() {
  const container = document.getElementById('bracketContent');
  const tatFights = state.fights.filter(f => f.tatami === tatamiNum || f.tatami === String(tatamiNum));
  const tatCategories = state.categories.filter(c => c.tatami === tatamiNum || c.tatami === String(tatamiNum));

  if (!tatCategories.length) {
    container.innerHTML = `<div class="text-muted text-small">Geen categorieën op Tatami ${tatamiNum}</div>`;
    return;
  }

  let html = '';
  for (const cat of tatCategories) {
    const catFights = tatFights.filter(f => f.categoryId === cat.id);
    const pool = state.pools.find(p => p.categoryId === cat.id);
    html += `<div style="margin-bottom:1rem"><strong style="font-size:0.95rem">${esc(cat.name)}</strong></div>`;

    if (cat.format === 'roundrobin' || (pool && pool.format === 'roundrobin')) {
      html += renderPoolBracket(pool, catFights);
    } else {
      html += renderDoubleBracket(catFights);
    }
  }

  container.innerHTML = html;
}

function renderPoolBracket(pool, fights) {
  const standings = pool ? pool.standings || [] : [];
  let html = `<div class="pool-section">`;

  if (standings.length > 0) {
    html += `<h3>${t('standings')}</h3><table class="pool-table"><thead><tr>
      <th>#</th><th>${t('name')}</th><th>${t('wins')}</th><th>${t('losses')}</th><th>${t('points')}</th>
    </tr></thead><tbody>`;

    standings.forEach((s, i) => {
      const comp = state.competitors.find(c => c.id === s.competitorId);
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      html += `<tr>
        <td class="rank ${rankClass}">${i + 1}</td>
        <td>${esc(comp ? comp.name : '?')}</td>
        <td>${s.wins}</td>
        <td>${s.losses}</td>
        <td class="pts">${s.points}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="pool-fights" style="margin-top:0.75rem">`;
  for (const f of fights) {
    const white = state.competitors.find(c => c.id === f.whiteId);
    const blue = state.competitors.find(c => c.id === f.blueId);
    let winnerClass = '';
    if (f.status === 'ended') {
      winnerClass = f.score && f.score.winner === 'white' ? 'winner-white' : 'winner-blue';
    }
    const method = f.score ? f.score.method : '';
    html += `<div class="pool-fight-row ${f.status === 'pending' ? 'pending' : ''} ${winnerClass}">
      <span class="pf-white">${esc(white ? white.name : 'TBD')}</span>
      <span class="pf-vs">vs</span>
      <span class="pf-blue">${esc(blue ? blue.name : 'TBD')}</span>
      ${method ? `<span class="pf-method">${method}</span>` : ''}
    </div>`;
  }
  html += `</div></div>`;
  return html;
}

function renderDoubleBracket(fights) {
  if (!fights.length) return `<div class="text-muted text-small">Geen gevechten</div>`;

  const wbFights = fights.filter(f => f.bracketType === 'winner').sort((a,b) => (a.bracketRound||0) - (b.bracketRound||0) || (a.bracketSlot||0) - (b.bracketSlot||0));
  const lbFights = fights.filter(f => f.bracketType === 'loser').sort((a,b) => (a.bracketRound||0) - (b.bracketRound||0) || (a.bracketSlot||0) - (b.bracketSlot||0));
  const gfFights = fights.filter(f => f.bracketType === 'grand-final');

  let html = '';

  if (wbFights.length) {
    html += `<div class="bracket-section-label">Winner Bracket</div>`;
    html += renderFightList(wbFights);
  }
  if (lbFights.length) {
    html += `<div class="bracket-section-label" style="margin-top:1rem">Loser Bracket</div>`;
    html += renderFightList(lbFights);
  }
  if (gfFights.length) {
    html += `<div class="bracket-section-label" style="margin-top:1rem">Grand Final</div>`;
    html += renderFightList(gfFights);
  }

  return html;
}

function renderFightList(fights) {
  let html = '';
  for (const f of fights) {
    const white = state.competitors.find(c => c.id === f.whiteId);
    const blue = state.competitors.find(c => c.id === f.blueId);
    const isActive = f.id === currentFightId;
    const isGf = f.bracketType === 'grand-final';

    const wWinner = f.score && f.score.winner === 'white';
    const bWinner = f.score && f.score.winner === 'blue';

    html += `<div class="bracket-fight ${isActive ? 'active-fight' : ''} ${f.status === 'ended' ? 'ended' : ''} ${isGf ? 'grand-final' : ''}">
      <div class="bracket-slot white-slot ${wWinner ? 'winner' : ''}">
        <div class="slot-color"></div>
        <div class="slot-name ${!f.whiteId ? 'tbd' : ''}">${esc(white ? white.name : (f.whiteId ? '?' : 'TBD'))}</div>
        ${f.score ? `<div class="slot-score">${scoreLabel(f.score.white)}</div>` : ''}
      </div>
      <div class="bracket-slot blue-slot ${bWinner ? 'winner' : ''}">
        <div class="slot-color"></div>
        <div class="slot-name ${!f.blueId ? 'tbd' : ''}">${esc(blue ? blue.name : (f.blueId ? '?' : 'TBD'))}</div>
        ${f.score ? `<div class="slot-score">${scoreLabel(f.score.blue)}</div>` : ''}
      </div>
    </div>`;
  }
  return html;
}

function scoreLabel(side) {
  if (!side) return '';
  if (side.ippon) return 'I';
  if ((side.wazaAri || 0) > 0) return `W${side.wazaAri}`;
  if ((side.yuko || 0) > 0) return `Y${side.yuko}`;
  return '';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Init ----
updateLangButtons();
applyTranslations();
