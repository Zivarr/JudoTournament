import { WsClient, getWsUrl } from '/shared/ws-client.js';
import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';
import { initKeyboardControl } from '/shared/keymap.js';

const pathParts = window.location.pathname.split('/');
const tatamiNum = parseInt(pathParts[pathParts.length - 1]) || 1;

document.getElementById('mcTitle').textContent = `${t('control')} Tatami ${tatamiNum}`;
document.getElementById('tatamiNumDisplay').textContent = tatamiNum;
document.title = `Mat ${tatamiNum} - Judo`;

let pin = sessionStorage.getItem('adminPin') || '';
let currentFightId = null;
let clockRunning = false;
let state = { tournament: null, competitors: [], categories: [], fights: [], activeFightByTatami: {} };

// Clock interpolation
let clockState = null;
let clockReceivedAt = 0;
let clockRafId = null;

// Osaekomi animation
let osaekomiRafId = null;
let osaekomiStartedAt = 0;
let lastPendingKey = '';

// ---- PIN ----
window.submitCtrlPin = function() {
  const val = document.getElementById('ctrlPinInput').value.trim();
  if (!val) return;
  pin = val;
  sessionStorage.setItem('adminPin', pin);
  document.getElementById('pinModal').style.display = 'none';
};

document.getElementById('ctrlPinInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.submitCtrlPin();
});

if (pin) {
  document.getElementById('pinModal').style.display = 'none';
}

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

// ---- WebSocket ----
const ws = new WsClient(getWsUrl());

ws.on('open', () => {
  document.getElementById('connIndicator').classList.add('connected');
  ws.send('register', { role: 'control', tatami: tatamiNum });
});

ws.on('close', () => {
  document.getElementById('connIndicator').classList.remove('connected');
});

ws.on('state:full', (data) => {
  state = data.state || state;
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
});

ws.on('fight:started', (data) => {
  if (data.fight.tatami !== tatamiNum && data.fight.tatami !== String(tatamiNum)) return;
  showFight(data.fight, data.white, data.blue, data.category);
});

ws.on('fight:score', (data) => {
  if (data.fightId !== currentFightId) return;
  updateScore(data.score);
});

ws.on('fight:clock', (data) => {
  if (data.fightId !== currentFightId) return;
  onClockUpdate(data.clock);
  if (data.osaekomi !== undefined) updateOsaekomi(data.osaekomi);
});

ws.on('clock:started', (data) => {
  if (data.fightId !== currentFightId) return;
  clockRunning = true;
  updateClockButton();
  onClockUpdate(data.clock);
});

ws.on('clock:stopped', (data) => {
  if (data.fightId !== currentFightId) return;
  clockRunning = false;
  updateClockButton();
  onClockUpdate(data.clock);
});

ws.on('fight:osaekomi', (data) => {
  if (data.fightId !== currentFightId) return;
  updateOsaekomi(data.osaekomi);
});

ws.on('fight:golden_score', (data) => {
  if (data.fightId !== currentFightId) return;
  document.getElementById('goldenScoreBanner').classList.add('show');
  if (data.score) {
    updateScore(data.score);
    onClockUpdate(data.score.clock);
  }
});

ws.on('fight:ended', (data) => {
  if (data.fightId !== currentFightId) return;
  clockRunning = false;
  stopClockLoop();
  updateClockButton();
  showWinner(data.winner);
  stopOsaekomiDisplay();
  clearPendingFlash();
  updateConfirmButton(null);
});

ws.on('error', (data) => {
  if (data.message === 'wrongPin') {
    document.getElementById('ctrlPinError').style.display = 'block';
    document.getElementById('pinModal').style.display = 'flex';
  }
});

ws.on('tournament:updated', (data) => {
  state.tournament = data.tournament;
});

// ---- Display: show fight ----
function showFight(fight, white, blue, category) {
  currentFightId = fight.id;
  clockRunning = !!(fight.score && fight.score.clock && fight.score.clock.running);

  document.getElementById('noFightDisplay').style.display = 'none';
  document.getElementById('scoreboardSection').style.display = 'flex';

  document.getElementById('whiteName').textContent = white ? white.name : '—';
  document.getElementById('whiteClub').textContent = white ? (white.club || '') : '';
  document.getElementById('blueName').textContent = blue ? blue.name : '—';
  document.getElementById('blueClub').textContent = blue ? (blue.club || '') : '';
  document.getElementById('catName').textContent = category ? category.name : '—';
  document.getElementById('fightRound').textContent = fight.roundName || '';

  resetScoreDisplay();

  if (fight.score) {
    updateScore(fight.score);
    if (fight.score.clock) onClockUpdate(fight.score.clock);
    if (fight.score.osaekomi) updateOsaekomi(fight.score.osaekomi);
    if (fight.score.clock && fight.score.clock.goldenScore) {
      document.getElementById('goldenScoreBanner').classList.add('show');
    }
    if (fight.status === 'ended' && fight.score.winner) {
      showWinner(fight.score.winner);
    }
  }

  updateClockButton();
}

function resetScoreDisplay() {
  document.getElementById('whiteIppon').classList.remove('scored');
  document.getElementById('blueIppon').classList.remove('scored');
  document.getElementById('whiteWa1').classList.remove('scored');
  document.getElementById('whiteWa2').classList.remove('scored');
  document.getElementById('blueWa1').classList.remove('scored');
  document.getElementById('blueWa2').classList.remove('scored');
  document.getElementById('whiteYukoCount').textContent = '0';
  document.getElementById('blueYukoCount').textContent = '0';
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`whiteShido${i}`).className = 'shido-dot';
    document.getElementById(`blueShido${i}`).className = 'shido-dot';
  }
  stopClockLoop();
  stopOsaekomiDisplay();
  clearPendingFlash();
  updateConfirmButton(null);
  document.getElementById('clockDigits').textContent = '0:00';
  document.getElementById('clockDigits').className = 'clock-digits';
  document.getElementById('goldenScoreBanner').classList.remove('show');
  document.getElementById('osaekomiSection').style.visibility = 'hidden';
  document.getElementById('osaekomiBar').style.width = '0%';
  document.getElementById('whiteWinnerBanner').classList.remove('show');
  document.getElementById('blueWinnerBanner').classList.remove('show');
  document.getElementById('whiteSide').classList.remove('winner-highlight');
  document.getElementById('blueSide').classList.remove('winner-highlight');
}

// ---- Score display ----
function updateScore(score) {
  if (!score) return;

  const wSide = score.white || {};
  document.getElementById('whiteIppon').classList.toggle('scored', !!wSide.ippon);
  document.getElementById('whiteWa1').classList.toggle('scored', (wSide.wazaAri || 0) >= 1);
  document.getElementById('whiteWa2').classList.toggle('scored', (wSide.wazaAri || 0) >= 2);
  document.getElementById('whiteYukoCount').textContent = wSide.yuko || 0;
  updateShidos('white', wSide.shido || 0, !!wSide.hansokuMake);

  const bSide = score.blue || {};
  document.getElementById('blueIppon').classList.toggle('scored', !!bSide.ippon);
  document.getElementById('blueWa1').classList.toggle('scored', (bSide.wazaAri || 0) >= 1);
  document.getElementById('blueWa2').classList.toggle('scored', (bSide.wazaAri || 0) >= 2);
  document.getElementById('blueYukoCount').textContent = bSide.yuko || 0;
  updateShidos('blue', bSide.shido || 0, !!bSide.hansokuMake);

  if (score.clock) onClockUpdate(score.clock);
  // Only update osaekomi display when it becomes inactive; active pending state
  // is owned by fight:clock and fight:osaekomi events to avoid race conditions
  // where a stale clone clears a pending score the client is already showing.
  if (score.osaekomi && !score.osaekomi.active) updateOsaekomi(score.osaekomi);
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

  if (clock.goldenScore) {
    const secs = Math.floor((clock.elapsedGs || 0) / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    el.textContent = `GS ${mins}:${String(s).padStart(2, '0')}`;
    el.className = 'clock-digits running';
  } else {
    const ms = clock.remainingMs || 0;
    const secs = Math.ceil(ms / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    el.textContent = `${mins}:${String(s).padStart(2, '0')}`;
    if (clock.running) {
      el.className = ms <= 30000 ? 'clock-digits danger' : 'clock-digits running';
    } else {
      el.className = 'clock-digits';
    }
  }
}

// ---- Osaekomi display ----
function updateOsaekomi(osaekomi) {
  const section = document.getElementById('osaekomiSection');
  const bar = document.getElementById('osaekomiBar');
  const timer = document.getElementById('osaekomiTimer');

  if (!osaekomi || (!osaekomi.active && !osaekomi.pendingScore)) {
    section.style.visibility = 'hidden';
    stopOsaekomiDisplay();
    clearPendingFlash();
    updateConfirmButton(null);
    return;
  }

  if (!osaekomi.active) {
    // Osaekomi broken but pending score still waiting for confirmation
    stopOsaekomiDisplay();
    applyPendingFlash(osaekomi.side, osaekomi.pendingScore);
    updateConfirmButton(osaekomi);
    return;
  }

  section.style.visibility = 'visible';
  stopOsaekomiDisplay();
  osaekomiStartedAt = osaekomi.startedAt;

  applyPendingFlash(osaekomi.side, osaekomi.pendingScore);
  updateConfirmButton(osaekomi);

  function tick() {
    const elapsed = Date.now() - osaekomiStartedAt;
    const secs = Math.min(elapsed / 1000, 20);
    bar.style.width = `${(secs / 20) * 100}%`;
    timer.textContent = `${secs.toFixed(1)}s`;
    if (secs < 20) {
      osaekomiRafId = requestAnimationFrame(tick);
    } else {
      osaekomiRafId = null;
    }
  }
  osaekomiRafId = requestAnimationFrame(tick);
}

function stopOsaekomiDisplay() {
  if (osaekomiRafId) {
    cancelAnimationFrame(osaekomiRafId);
    osaekomiRafId = null;
  }
}

function clearPendingFlash() {
  lastPendingKey = '';
  ['white', 'blue'].forEach(side => {
    document.getElementById(`${side}Ippon`).classList.remove('pending');
    document.getElementById(`${side}Wa1`).classList.remove('pending');
    document.getElementById(`${side}Wa2`).classList.remove('pending');
    const yukoEl = document.getElementById(`${side}Yuko`);
    if (yukoEl) yukoEl.classList.remove('pending');
  });
}

function applyPendingFlash(side, pendingScore) {
  const key = `${side}:${pendingScore || ''}`;
  if (key === lastPendingKey) return;
  clearPendingFlash();
  lastPendingKey = key;
  if (!side || !pendingScore) return;
  if (pendingScore === 'ippon') {
    document.getElementById(`${side}Ippon`).classList.add('pending');
  } else if (pendingScore === 'wazaAri') {
    const wa1 = document.getElementById(`${side}Wa1`);
    const wa2 = document.getElementById(`${side}Wa2`);
    if (!wa1.classList.contains('scored')) wa1.classList.add('pending');
    else if (!wa2.classList.contains('scored')) wa2.classList.add('pending');
  } else if (pendingScore === 'yuko') {
    const yukoEl = document.getElementById(`${side}Yuko`);
    if (yukoEl) yukoEl.classList.add('pending');
  }
}

function updateConfirmButton(osaekomi) {
  const btn = document.getElementById('btnConfirmScore');
  if (!btn) return;
  if (osaekomi && osaekomi.pendingScore) {
    const labels = { yuko: t('yuko'), wazaAri: t('wazaAri'), ippon: t('ippon') };
    const sideLabel = osaekomi.side === 'white' ? t('white') : t('blue');
    btn.textContent = `✔ ${labels[osaekomi.pendingScore] || osaekomi.pendingScore} (${sideLabel})`;
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

// ---- Winner ----
function showWinner(winner) {
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

// ---- Clock button ----
function updateClockButton() {
  const btn = document.getElementById('btnClockStart');
  if (clockRunning) {
    btn.className = 'btn-full btn-clock-stop';
    btn.innerHTML = `⏹ <span data-i18n="stopClock">${t('stopClock')}</span>`;
  } else {
    btn.className = 'btn-full btn-clock-start';
    btn.innerHTML = `▶ <span data-i18n="startClock">${t('startClock')}</span>`;
  }
}

// ---- Actions ----
window.score = function(type, side) {
  if (!currentFightId) return;
  ws.send(`score:${type}`, { pin, fightId: currentFightId, side });
};

window.clockAction = function() {
  if (!currentFightId) return;
  if (clockRunning) {
    ws.send('clock:stop', { pin, fightId: currentFightId });
  } else {
    ws.send('clock:start', { pin, fightId: currentFightId });
  }
  clockRunning = !clockRunning;
  updateClockButton();
};

window.osaekomi = function(side) {
  if (!currentFightId) return;
  ws.send('osaekomi:start', { pin, fightId: currentFightId, side });
};

window.osaekomiBreak = function() {
  if (!currentFightId) return;
  ws.send('osaekomi:break', { pin, fightId: currentFightId });
};

window.confirmOsaekomi = function() {
  if (!currentFightId) return;
  ws.send('osaekomi:confirm', { pin, fightId: currentFightId });
};

window.undo = function() {
  if (!currentFightId) return;
  ws.send('score:undo', { pin, fightId: currentFightId });
};

window.refereeDecision = function(side) {
  if (!currentFightId) return;
  if (!confirm(`${t('refereeDecision')}: ${side === 'white' ? t('white') : t('blue')}?`)) return;
  ws.send('fight:referee_decision', { pin, fightId: currentFightId, side });
};

window.nextFight = function() {
  ws.send('fight:next', { pin, tatami: tatamiNum });
};

// ---- Keyboard control ----
initKeyboardControl({
  clockToggle: () => window.clockAction(),
  scoreIpponWhite: () => window.score('ippon', 'white'),
  scoreIpponBlue: () => window.score('ippon', 'blue'),
  scoreWazaAriWhite: () => window.score('wazaari', 'white'),
  scoreWazaAriBlue: () => window.score('wazaari', 'blue'),
  scoreYukoWhite: () => window.score('yuko', 'white'),
  scoreYukoBlue: () => window.score('yuko', 'blue'),
  scoreShidoWhite: () => window.score('shido', 'white'),
  scoreShidoBlue: () => window.score('shido', 'blue'),
  scoreHansokuWhite: () => window.score('hansoku', 'white'),
  scoreHansokuBlue: () => window.score('hansoku', 'blue'),
  osaekomiWhite: () => window.osaekomi('white'),
  osaekomiBlue: () => window.osaekomi('blue'),
  osaekomiBreak: () => window.osaekomiBreak(),
  osaekomiConfirm: () => window.confirmOsaekomi(),
  undo: () => window.undo(),
  nextFight: () => window.nextFight(),
  refereeDecisionWhite: () => window.refereeDecision('white'),
  refereeDecisionBlue: () => window.refereeDecision('blue'),
});

// ---- Init ----
updateLangButtons();
applyTranslations();
