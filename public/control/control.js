import { WsClient, getWsUrl } from '/shared/ws-client.js';
import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';

// Tatami number from URL
const pathParts = window.location.pathname.split('/');
const tatamiNum = parseInt(pathParts[pathParts.length - 1]) || 1;

document.getElementById('ctrlTitle').textContent = `${t('control')} Tatami ${tatamiNum}`;
document.title = `Bediening ${tatamiNum} - Judo`;

let pin = sessionStorage.getItem('adminPin') || '';
let currentFightId = null;
let clockRunning = false;
let state = { tournament: null, competitors: [], categories: [], fights: [], activeFightByTatami: {} };

// Clock interpolation
let clockState = null;
let clockReceivedAt = 0;
let clockRafId = null;

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

// ---- WS ----
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
      setCurrentFight(fight);
    }
  }
});

ws.on('fight:started', (data) => {
  const fight = data.fight;
  if (fight.tatami !== tatamiNum && fight.tatami !== String(tatamiNum)) return;
  setCurrentFight(fight, data.white, data.blue, data.category);
});

ws.on('fight:score', (data) => {
  if (data.fightId !== currentFightId) return;
  updateClockFromScore(data.score);
});

ws.on('fight:clock', (data) => {
  if (data.fightId !== currentFightId) return;
  onClockUpdate(data.clock);
  if (data.osaekomi !== undefined) updateConfirmButton(data.osaekomi);
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
  const badge = document.getElementById('osaActiveBadge');
  if (data.osaekomi && data.osaekomi.active) {
    badge.classList.add('show');
    badge.textContent = `OSA ${data.osaekomi.side === 'white' ? 'W' : 'B'}`;
  } else {
    badge.classList.remove('show');
  }
  updateConfirmButton(data.osaekomi);
});

ws.on('fight:ended', (data) => {
  if (data.fightId !== currentFightId) return;
  clockRunning = false;
  stopClockLoop();
  updateClockButton();
  const clockEl = document.getElementById('fightClock');
  clockEl.textContent = 'EINDE';
  clockEl.className = 'fi-clock';
  document.getElementById('osaActiveBadge').classList.remove('show');
  updateConfirmButton(null);
});

ws.on('fight:golden_score', (data) => {
  if (data.fightId !== currentFightId) return;
  const clockEl = document.getElementById('fightClock');
  clockEl.className = 'fi-clock golden';
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

// ---- Set current fight ----
function setCurrentFight(fight, white, blue, category) {
  currentFightId = fight.id;
  clockRunning = fight.score && fight.score.clock && fight.score.clock.running;

  // Update info bar
  document.getElementById('fightCat').textContent = category ? category.name : fight.categoryId;
  document.getElementById('fightWhite').textContent = white ? white.name : resolveName(fight.whiteId);
  document.getElementById('fightBlue').textContent = blue ? blue.name : resolveName(fight.blueId);

  if (fight.score && fight.score.clock) {
    onClockUpdate(fight.score.clock);
  }

  updateClockButton();
}

function resolveName(id) {
  if (!id) return '—';
  const comp = state.competitors.find(c => c.id === id);
  return comp ? comp.name : '?';
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
    updateClockDisplay(clock);
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
  updateClockDisplay(interpolated);
  clockRafId = requestAnimationFrame(tickClock);
}

function stopClockLoop() {
  if (clockRafId) {
    cancelAnimationFrame(clockRafId);
    clockRafId = null;
  }
  clockState = null;
}

// ---- Clock display ----
function updateClockDisplay(clock) {
  if (!clock) return;
  const el = document.getElementById('fightClock');
  let displayStr;
  let cls = 'fi-clock';

  if (clock.goldenScore) {
    const elapsed = clock.elapsedGs || 0;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `GS ${mins}:${String(s).padStart(2,'0')}`;
    cls = 'fi-clock golden';
  } else {
    const ms = clock.remainingMs || 0;
    const secs = Math.ceil(ms / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `${mins}:${String(s).padStart(2,'0')}`;
    if (clock.running) {
      cls = ms <= 30000 ? 'fi-clock danger' : 'fi-clock running';
    }
  }

  el.textContent = displayStr;
  el.className = cls;
}

function updateClockFromScore(score) {
  if (score && score.clock) onClockUpdate(score.clock);
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

// ---- Confirm button ----
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

// ---- Init ----
updateLangButtons();
applyTranslations();
