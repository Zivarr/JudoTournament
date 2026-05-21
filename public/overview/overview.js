import { WsClient, getWsUrl } from '/shared/ws-client.js';
import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';

let state = { tournament: null, competitors: [], categories: [], fights: [], activeFightByTatami: {} };
let tatamiStates = {}; // { [n]: { status, fight, white, blue, category, clock, osaekomi } }
let endedTimers = {}; // For brief red highlight on ended

// ---- Lang ----
window.switchLang = function(lang) {
  setLang(lang);
  applyTranslations();
  updateLangButtons();
  renderGrid();
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
  ws.send('register', { role: 'overview' });
});

ws.on('close', () => {
  document.getElementById('connIndicator').classList.remove('connected');
});

ws.on('state:full', (data) => {
  state = data.state || state;

  // Init tatami states from active fights
  if (state.tournament) {
    for (let n = 1; n <= state.tournament.tatamiCount; n++) {
      const activeFightId = state.activeFightByTatami && state.activeFightByTatami[String(n)];
      if (activeFightId) {
        const fight = state.fights.find(f => f.id === activeFightId);
        if (fight && fight.status !== 'ended') {
          const white = state.competitors.find(c => c.id === fight.whiteId);
          const blue = state.competitors.find(c => c.id === fight.blueId);
          const category = state.categories.find(c => c.id === fight.categoryId);
          tatamiStates[n] = {
            status: fight.status,
            fight,
            white,
            blue,
            category,
            clock: fight.score ? fight.score.clock : null,
            osaekomi: fight.score ? fight.score.osaekomi : null
          };
        } else {
          tatamiStates[n] = { status: 'idle' };
        }
      } else {
        tatamiStates[n] = { status: 'idle' };
      }
    }
    if (state.tournament.name) {
      document.getElementById('overviewTitle').innerHTML =
        `📊 ${esc(state.tournament.name)} — <span data-i18n="overview">${t('overview')}</span>`;
    }
  }
  renderGrid();
});

ws.on('fight:started', (data) => {
  const tatami = data.fight.tatami;
  const n = Number(tatami);
  tatamiStates[n] = {
    status: 'active',
    fight: data.fight,
    white: data.white,
    blue: data.blue,
    category: data.category,
    clock: data.fight.score ? data.fight.score.clock : null,
    osaekomi: null
  };
  updateCard(n);
});

ws.on('fight:score', (data) => {
  const n = findTatamiForFight(data.fightId);
  if (!n) return;
  if (tatamiStates[n]) {
    tatamiStates[n].fight = { ...tatamiStates[n].fight, score: data.score };
  }
  updateCard(n);
});

ws.on('fight:clock', (data) => {
  const n = findTatamiForFight(data.fightId);
  if (!n) return;
  if (tatamiStates[n]) {
    tatamiStates[n].clock = data.clock;
    tatamiStates[n].osaekomi = data.osaekomi || tatamiStates[n].osaekomi;
  }
  updateCardClock(n);
});

ws.on('fight:osaekomi', (data) => {
  const n = findTatamiForFight(data.fightId);
  if (!n) return;
  if (tatamiStates[n]) {
    tatamiStates[n].osaekomi = data.osaekomi;
  }
  updateCard(n);
});

ws.on('fight:golden_score', (data) => {
  const n = findTatamiForFight(data.fightId);
  if (!n) return;
  if (tatamiStates[n]) {
    tatamiStates[n].status = 'golden';
    if (data.score && data.score.clock) tatamiStates[n].clock = data.score.clock;
  }
  updateCard(n);
});

ws.on('fight:ended', (data) => {
  const n = findTatamiForFight(data.fightId);
  if (!n) return;
  if (tatamiStates[n]) {
    tatamiStates[n].status = 'ended';
    if (data.score) {
      tatamiStates[n].fight = { ...tatamiStates[n].fight, score: data.score, status: 'ended' };
    }
  }
  updateCard(n);

  // Brief red highlight for 5 seconds, then go idle
  clearTimeout(endedTimers[n]);
  endedTimers[n] = setTimeout(() => {
    tatamiStates[n] = { status: 'idle' };
    updateCard(n);
  }, 5000);
});

ws.on('tournament:updated', (data) => {
  state.tournament = data.tournament;
  renderGrid();
});

ws.on('bracket:updated', (data) => {
  state.fights = data.fights || state.fights;
  state.pools = data.pools || state.pools;
});

ws.on('fight:reassigned', (data) => {
  const cat = data.category ? data.category.name : '';
  const w   = data.white ? data.white.name : '?';
  const b   = data.blue  ? data.blue.name  : '?';
  showAnnouncement(`⚡ ${esc(cat)}: ${esc(w)} vs ${esc(b)} — Tatami ${data.fromTatami} → Tatami ${data.toTatami}`);
});

ws.on('category:reassigned', (data) => {
  const cat = data.category ? data.category.name : '';
  showAnnouncement(`⚡ ${esc(cat)} — Tatami ${data.fromTatami} → Tatami ${data.toTatami} (${data.fightCount} gevechten)`);
});

function findTatamiForFight(fightId) {
  for (const [n, ts] of Object.entries(tatamiStates)) {
    if (ts.fight && ts.fight.id === fightId) return Number(n);
  }
  // Fallback: search state
  const fight = state.fights.find(f => f.id === fightId);
  if (fight) return Number(fight.tatami);
  return null;
}

// ---- Render ----
function renderGrid() {
  const grid = document.getElementById('overviewGrid');
  if (!state.tournament) {
    grid.innerHTML = `<div class="text-muted text-center" style="grid-column:1/-1;padding:2rem">${t('noTournament')}</div>`;
    return;
  }

  grid.innerHTML = '';
  for (let n = 1; n <= state.tournament.tatamiCount; n++) {
    const card = createCard(n);
    grid.appendChild(card);
  }
}

function createCard(n) {
  const div = document.createElement('div');
  div.id = `tatami-card-${n}`;
  div.className = 'tatami-card';
  div.innerHTML = renderCardContent(n);
  return div;
}

function updateCard(n) {
  const card = document.getElementById(`tatami-card-${n}`);
  if (!card) {
    // Card doesn't exist yet — full re-render
    renderGrid();
    return;
  }
  card.className = `tatami-card ${getCardStatusClass(n)}`;
  card.innerHTML = renderCardContent(n);
}

function updateCardClock(n) {
  const card = document.getElementById(`tatami-card-${n}`);
  if (!card) return;

  const ts = tatamiStates[n];
  if (!ts || !ts.clock) return;

  const clockEl = card.querySelector('.mini-clock');
  if (!clockEl) return;

  const clock = ts.clock;
  let displayStr;
  let cls = 'mini-clock';

  if (clock.goldenScore) {
    const elapsed = clock.elapsedGs || 0;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `GS ${mins}:${String(s).padStart(2,'0')}`;
    cls = 'mini-clock golden';
    card.className = `tatami-card golden`;
  } else {
    const ms = clock.remainingMs || 0;
    const secs = Math.ceil(ms / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    displayStr = `${mins}:${String(s).padStart(2,'0')}`;
    if (clock.running) {
      cls = ms <= 30000 ? 'mini-clock danger' : 'mini-clock running';
    }
  }

  clockEl.textContent = displayStr;
  clockEl.className = cls;
}

function getCardStatusClass(n) {
  const ts = tatamiStates[n];
  if (!ts) return 'idle';
  if (ts.status === 'golden') return 'golden';
  if (ts.status === 'ended') return 'ended';
  if (ts.status === 'active') return 'active';
  return 'idle';
}

function renderCardContent(n) {
  const ts = tatamiStates[n] || { status: 'idle' };
  const statusClass = getCardStatusClass(n);
  const statusLabel = ts.status === 'golden' ? t('goldenScore') :
                      ts.status === 'ended' ? t('ended') :
                      ts.status === 'active' ? t('active') :
                      t('idle');

  let html = `
    <div class="tatami-card-header">
      <div class="tatami-card-title">Tatami ${n}</div>
      <div class="tatami-card-status">${statusLabel}</div>
    </div>
  `;

  if (ts.status === 'idle' || !ts.fight) {
    html += `<div class="tatami-idle-content" data-i18n="idle">${t('idle')}</div>`;
    return html;
  }

  const fight = ts.fight;
  const white = ts.white;
  const blue = ts.blue;
  const category = ts.category;
  const score = fight ? fight.score : null;

  html += `<div class="tatami-card-category">${esc(category ? category.name : '')}</div>`;
  html += `<div class="mini-scoreboard">`;

  // White fighter
  const ws = score ? score.white : {};
  const wWinner = score && score.winner === 'white';
  html += `
    <div class="mini-fighter white-fighter ${wWinner ? 'winner-fighter' : ''}">
      <div class="mini-fighter-name">${esc(white ? white.name : '—')}</div>
      <div class="mini-score">
        ${ws.ippon ? `<span class="mini-score-item ippon">I</span>` : ''}
        ${(ws.wazaAri || 0) > 0 ? `<span class="mini-score-item wazaari">W${ws.wazaAri}</span>` : ''}
        ${(ws.yuko || 0) > 0 ? `<span class="mini-score-item">Y${ws.yuko}</span>` : ''}
        ${(ws.shido || 0) > 0 ? `<span class="mini-score-item shido">S${ws.shido}</span>` : ''}
      </div>
    </div>
  `;

  // Blue fighter
  const bs = score ? score.blue : {};
  const bWinner = score && score.winner === 'blue';
  html += `
    <div class="mini-fighter blue-fighter ${bWinner ? 'winner-fighter' : ''}">
      <div class="mini-fighter-name">${esc(blue ? blue.name : '—')}</div>
      <div class="mini-score">
        ${bs.ippon ? `<span class="mini-score-item ippon">I</span>` : ''}
        ${(bs.wazaAri || 0) > 0 ? `<span class="mini-score-item wazaari">W${bs.wazaAri}</span>` : ''}
        ${(bs.yuko || 0) > 0 ? `<span class="mini-score-item">Y${bs.yuko}</span>` : ''}
        ${(bs.shido || 0) > 0 ? `<span class="mini-score-item shido">S${bs.shido}</span>` : ''}
      </div>
    </div>
  `;

  html += `</div>`;

  // Clock + osaekomi
  const clock = ts.clock || (score ? score.clock : null);
  let clockStr = '—';
  let clockCls = 'mini-clock';
  if (clock) {
    if (clock.goldenScore) {
      const elapsed = clock.elapsedGs || 0;
      const secs = Math.floor(elapsed / 1000);
      clockStr = `GS ${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
      clockCls = 'mini-clock golden';
    } else {
      const ms = clock.remainingMs || 0;
      const secs = Math.ceil(ms / 1000);
      clockStr = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
      if (clock.running) clockCls = ms <= 30000 ? 'mini-clock danger' : 'mini-clock running';
    }
  }

  const osa = ts.osaekomi || (score ? score.osaekomi : null);
  const osaActive = osa && osa.active;

  html += `
    <div class="tatami-card-clock">
      <div class="${clockCls}">${clockStr}</div>
      ${osaActive ? `
        <div class="osaekomi-indicator">
          <div class="osaekomi-dot"></div>
          <span>OSA</span>
        </div>
      ` : ''}
    </div>
  `;

  return html;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Announcements ----
const MAX_ANNOUNCEMENTS = 3;
const ANNOUNCEMENT_MS   = 12000;

function showAnnouncement(text) {
  const area = document.getElementById('announcementArea');
  if (!area) return;
  // Drop oldest if at cap
  while (area.children.length >= MAX_ANNOUNCEMENTS) area.removeChild(area.firstChild);

  const el = document.createElement('div');
  el.className = 'announcement';
  el.textContent = text;
  area.appendChild(el);

  setTimeout(() => {
    el.classList.add('fading');
    setTimeout(() => el.remove(), 500);
  }, ANNOUNCEMENT_MS);
}

// ---- Init ----
updateLangButtons();
applyTranslations();
