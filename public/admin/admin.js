import { WsClient, getWsUrl } from '/shared/ws-client.js';
import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';

// JBN BondsVademecum 4.03a (20.12.2025) — leeftijdscategorieën en gewichtsklassen
const JBN_WEIGHTS = {
  U7:     { M: [27,30,34,38,42,46,50,55,Infinity], F: [28,32,36,40,44,48,52,57,Infinity] },
  U9:     { M: [34,38,42,46,50,55,60,66,Infinity], F: [32,36,40,44,48,52,57,63,Infinity] },
  U11:    { M: [46,50,55,60,66,73,81,90,Infinity], F: [40,44,48,52,57,63,70,Infinity] },
  U13:    { M: [46,50,55,60,66,73,81,90,Infinity], F: [40,44,48,52,57,63,70,Infinity] },
  U15:    { M: [60,66,73,81,90,100,Infinity], F: [48,52,57,63,70,78,Infinity] },
  U18:    { M: [60,66,73,81,90,100,Infinity], F: [48,52,57,63,70,78,Infinity] },
  U21:    { M: [60,66,73,81,90,100,Infinity], F: [48,52,57,63,70,78,Infinity] },
  Senior: { M: [60,66,73,81,90,100,Infinity], F: [48,52,57,63,70,78,Infinity] },
};
const JBN_DURATIONS = {
  U7: 120000, U9: 120000, U11: 120000, U13: 120000,
  U15: 180000, U18: 240000, U21: 240000, Senior: 240000,
};
const JBN_AGE_LABELS = {
  U7: '-7', U9: '-9', U11: '-11', U13: '-13',
  U15: '-15', U18: '-18', U21: '-21', Senior: 'Senior',
};

function getAgeCategory(birthYear) {
  const age = new Date().getFullYear() - Number(birthYear);
  if (age <= 6)  return 'U7';
  if (age <= 8)  return 'U9';
  if (age <= 10) return 'U11';
  if (age <= 12) return 'U13';
  if (age <= 14) return 'U15';
  if (age <= 17) return 'U18';
  if (age <= 20) return 'U21';
  return 'Senior';
}

let ws;
let pin = sessionStorage.getItem('adminPin') || '';
let state = { tournament: null, competitors: [], categories: [], pools: [], fights: [], activeFightByTatami: {} };

// ID of tournament pending activation (set in chooser before PIN entry)
let pendingActivateTournamentId = null;

// ---- Tournament Chooser ----

async function loadChooser() {
  const list = document.getElementById('chooserList');
  list.innerHTML = '<div style="color:var(--muted);font-size:0.875rem;">Laden...</div>';
  try {
    const res = await fetch('/api/tournaments');
    const tournaments = await res.json();
    if (tournaments.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);font-size:0.875rem;">Geen opgeslagen toernooien. Maak een nieuw aan hieronder.</div>';
      return;
    }
    list.innerHTML = '';
    for (const t of tournaments) {
      const date = t.date ? new Date(t.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const card = document.createElement('div');
      card.className = 'chooser-card' + (t.isActive ? ' is-active' : '');
      card.innerHTML = `
        <div class="chooser-card-info">
          <div class="chooser-card-name">${esc(t.name)}${t.isActive ? ' <span class="chooser-active-badge">Actief</span>' : ''}</div>
          <div class="chooser-card-meta">${date}${t.tatamiCount ? ` · ${t.tatamiCount} tatami's` : ''}</div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-shrink:0;">
          ${t.isActive
            ? `<button class="btn btn-sm btn-success" onclick="chooserManageCurrent()">Beheren</button>`
            : `<button class="btn btn-sm btn-primary" onclick="chooserActivate('${t.id}', ${JSON.stringify(esc(t.name))})">Activeer</button>`
          }
        </div>
      `;
      list.appendChild(card);
    }
  } catch (e) {
    list.innerHTML = '<div style="color:var(--danger);font-size:0.875rem;">Kon toernooien niet laden.</div>';
  }
}

window.showChooser = function() {
  pendingActivateTournamentId = null;
  document.getElementById('chooserModal').style.display = 'block';
  document.getElementById('pinModal').style.display = 'none';
  loadChooser();
};

window.chooserManageCurrent = function() {
  document.getElementById('chooserModal').style.display = 'none';
  showPinModal(null);
};

window.chooserActivate = function(id, name) {
  pendingActivateTournamentId = id;
  document.getElementById('chooserModal').style.display = 'none';
  showPinModal(name);
};

window.chooserCreateNew = function() {
  pendingActivateTournamentId = null;
  document.getElementById('chooserModal').style.display = 'none';
  document.getElementById('pinModal').style.display = 'none';
  // Go to tournament tab with create form
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-tournament').classList.add('active');
  document.querySelector('.tab-btn').classList.add('active');
  pin = '';
  sessionStorage.removeItem('adminPin');
};

function showPinModal(tournamentName) {
  const ctx = document.getElementById('pinContext');
  const backBtn = document.getElementById('pinBackBtn');
  if (tournamentName) {
    ctx.textContent = `Toernooi: ${tournamentName}`;
    ctx.style.display = 'block';
    backBtn.style.display = 'inline-flex';
  } else {
    ctx.style.display = 'none';
    backBtn.style.display = 'none';
  }
  document.getElementById('pinError').style.display = 'none';
  document.getElementById('pinInput').value = '';
  document.getElementById('pinModal').style.display = 'flex';
}

// ---- PIN Modal ----
async function submitPin() {
  const val = document.getElementById('pinInput').value.trim();
  if (!val) return;

  if (pendingActivateTournamentId) {
    // Activate a different tournament
    try {
      const res = await fetch(`/api/tournaments/${pendingActivateTournamentId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: val })
      });
      if (res.status === 403) {
        document.getElementById('pinError').style.display = 'block';
        return;
      }
      if (!res.ok) throw new Error();
      pin = val;
      sessionStorage.setItem('adminPin', pin);
      pendingActivateTournamentId = null;
      document.getElementById('pinModal').style.display = 'none';
      // state:full will be broadcast by the server, re-rendering everything
    } catch (e) {
      document.getElementById('pinError').style.display = 'block';
    }
    return;
  }

  // Normal login for current active tournament
  pin = val;
  sessionStorage.setItem('adminPin', pin);
  document.getElementById('pinModal').style.display = 'none';
  initApp();
}
window.submitPin = submitPin;

document.getElementById('pinInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitPin();
});

function checkPin() {
  if (!state.tournament) {
    document.getElementById('pinModal').style.display = 'none';
    return;
  }
  if (pin && pin === state.tournament.adminPin) {
    document.getElementById('pinModal').style.display = 'none';
  }
}

// ---- Header label ----
function updateActiveTournamentLabel() {
  const label = document.getElementById('activeTournamentLabel');
  label.textContent = state.tournament ? state.tournament.name : '';
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

// ---- Tabs ----
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  event.target.classList.add('active');

  if (tab === 'fights') renderFightsTab();
  if (tab === 'categories') renderCategoriesTab();
  if (tab === 'competitors') renderCompetitorsTab();
};

// ---- WS Setup ----
function initWs() {
  ws = new WsClient(getWsUrl());

  ws.on('open', () => {
    document.getElementById('connIndicator').classList.add('connected');
    ws.send('register', { role: 'admin' });
  });

  ws.on('close', () => {
    document.getElementById('connIndicator').classList.remove('connected');
  });

  ws.on('state:full', (data) => {
    state = data.state || state;
    checkPin();
    renderAll();
    updateActiveTournamentLabel();
  });

  ws.on('tournament:updated', (data) => {
    state.tournament = data.tournament;
    updateActiveTournamentLabel();
    renderTournamentTab();
  });

  ws.on('competitor:added', (data) => {
    state.competitors.push(data.competitor);
    renderCompetitorsTab();
  });

  ws.on('competitors:imported', (data) => {
    state.competitors.push(...data.competitors);
    renderCompetitorsTab();
  });

  ws.on('competitor:deleted', (data) => {
    state.competitors = state.competitors.filter(c => c.id !== data.id);
    renderCompetitorsTab();
  });

  ws.on('competitor:updated', (data) => {
    const idx = state.competitors.findIndex(c => c.id === data.competitor.id);
    if (idx !== -1) state.competitors[idx] = data.competitor;
    renderCompetitorsTab();
  });

  ws.on('category:added', (data) => {
    state.categories.push(data.category);
    renderCategoriesTab();
  });

  ws.on('category:updated', (data) => {
    const idx = state.categories.findIndex(c => c.id === data.category.id);
    if (idx !== -1) state.categories[idx] = data.category;
    renderCategoriesTab();
  });

  ws.on('bracket:updated', (data) => {
    state.pools = data.pools || state.pools;
    state.fights = data.fights || state.fights;
    renderCategoriesTab();
    renderFightsTab();
  });

  ws.on('error', (data) => {
    if (data.message === 'wrongPin') {
      document.getElementById('pinError').style.display = 'block';
      document.getElementById('pinModal').style.display = 'flex';
    }
  });
}

function initApp() {
  updateLangButtons();
  applyTranslations();
  document.getElementById('tDate').value = new Date().toISOString().split('T')[0];
}

// ---- Render All ----
function renderAll() {
  renderTournamentTab();
  renderCompetitorsTab();
  renderCategoriesTab();
  renderFightsTab();
  updateTatamiSelects();
}

// ---- Tournament Tab ----
function renderTournamentTab() {
  const infoDiv = document.getElementById('currentTournamentInfo');
  const infoCard = document.getElementById('tournamentInfo');
  if (state.tournament) {
    infoCard.style.display = 'block';
    infoDiv.innerHTML = `
      <div class="form-row">
        <div><span class="text-muted">${t('tournamentName')}:</span> <strong>${state.tournament.name}</strong></div>
        <div><span class="text-muted">${t('date')}:</span> <strong>${state.tournament.date}</strong></div>
        <div><span class="text-muted">${t('tatamiCount')}:</span> <strong>${state.tournament.tatamiCount}</strong></div>
        <div><span class="text-muted">${t('fightDuration')}:</span> <strong>${state.tournament.fightDurationMs / 60000} min</strong></div>
        <div><span class="text-muted">${t('adminPin')}:</span> <strong>${state.tournament.adminPin}</strong></div>
      </div>
    `;
  } else {
    infoCard.style.display = 'none';
  }
}

// ---- Competitors Tab ----
function renderCompetitorsTab() {
  const tbody = document.getElementById('competitorsTbody');
  if (!state.competitors || state.competitors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted text-center">Geen deelnemers</td></tr>`;
    return;
  }

  const compCatMap = {};
  for (const cat of (state.categories || [])) {
    for (const cid of (cat.competitorIds || [])) {
      compCatMap[cid] = cat.name;
    }
  }

  tbody.innerHTML = state.competitors.map((c, i) => `
    <tr>
      <td class="text-muted">${i + 1}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.club)}</td>
      <td>${c.gender === 'M' ? t('male') : t('female')}</td>
      <td>${c.weightKg} kg</td>
      <td>${c.birthYear || '-'}</td>
      <td>${compCatMap[c.id] ? `<span class="badge badge-info">${esc(compCatMap[c.id])}</span>` : `<span class="text-muted">-</span>`}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteCompetitor('${c.id}')">
          ${t('delete')}
        </button>
      </td>
    </tr>
  `).join('');
}

// ---- Categories Tab ----
function renderCategoriesTab() {
  const list = document.getElementById('categoriesList');
  if (!state.categories || state.categories.length === 0) {
    list.innerHTML = `<div class="text-muted">Geen categorieën aangemaakt</div>`;
    return;
  }

  list.innerHTML = state.categories.map(cat => {
    const competitors = (state.competitors || []).filter(c => (cat.competitorIds || []).includes(c.id));
    const catFights = (state.fights || []).filter(f => f.categoryId === cat.id);
    const tatamiCount = state.tournament ? state.tournament.tatamiCount : 2;
    const tatamiOptions = Array.from({length: tatamiCount}, (_, i) => i + 1)
      .map(n => `<option value="${n}" ${cat.tatami === n ? 'selected' : ''}>Tatami ${n}</option>`)
      .join('');
    const tatami2Options = `<option value="" ${!cat.tatami2 ? 'selected' : ''}>—</option>` +
      Array.from({length: tatamiCount}, (_, i) => i + 1)
        .map(n => `<option value="${n}" ${cat.tatami2 === n ? 'selected' : ''}>Tatami ${n}</option>`)
        .join('');

    const formatLabel = cat.format === 'doubleelim' ? t('doubleElim') : t('roundRobin');
    const statusBadge = cat.status === 'drawn'
      ? `<span class="badge badge-success">${t('drawGenerated')}</span>`
      : `<span class="badge">${t('pending')}</span>`;

    return `
      <div class="category-card">
        <div class="category-card-header">
          <div class="flex items-center gap-1">
            <strong>${esc(cat.name)}</strong>
            ${statusBadge}
          </div>
          <div class="flex gap-1">
            <select style="padding:0.3rem 0.6rem;border-radius:var(--radius);background:var(--surface2);border:1px solid var(--border);color:var(--text);font-size:0.85rem"
              onchange="assignTatami('${cat.id}', this.value)">
              ${tatamiOptions}
            </select>
            ${cat.format === 'roundrobin' ? `<select title="2e tatami (parallel)" style="padding:0.3rem 0.6rem;border-radius:var(--radius);background:var(--surface2);border:1px solid var(--border);color:var(--text);font-size:0.85rem"
              onchange="assignTatami2('${cat.id}', this.value)">
              ${tatami2Options}
            </select>` : ''}
            <button class="btn btn-primary btn-sm" onclick="generateDraw('${cat.id}')">
              ${t('generateDraw')}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteCategory('${cat.id}')">
              ${t('delete')}
            </button>
          </div>
        </div>
        <div class="category-card-body">
          <div class="category-meta">
            ${cat.ageCategory ? `<span>Leeftijd: <strong>${JBN_AGE_LABELS[cat.ageCategory] || cat.ageCategory}</strong></span>` : ''}
            <span>${t('gender')}: <strong>${cat.gender === 'M' ? t('male') : t('female')}</strong></span>
            <span>Klasse: <strong>${cat.maxWeight && cat.maxWeight < 999 ? '-' + cat.maxWeight + ' kg' : cat.maxWeight >= 999 ? 'Open' : '—'}</strong></span>
            <span>Tijd: <strong>${cat.fightDurationMs ? (cat.fightDurationMs / 60000) + ' min' : '—'}</strong></span>
            <span>${t('format')}: <strong>${formatLabel}</strong></span>
            <span>${t('competitorCount')}: <strong>${competitors.length}</strong></span>
            <span>Gevechten: <strong>${catFights.length}</strong></span>
          </div>
          <div style="font-size:0.85rem;color:var(--muted)">
            ${competitors.map(c => `<span style="display:inline-block;margin:0.15rem;padding:0.15rem 0.45rem;background:var(--bg);border-radius:4px;border:1px solid var(--border)">${esc(c.name)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---- Fights Tab ----
function renderFightsTab() {
  const container = document.getElementById('fightsByTatami');
  if (!state.tournament) {
    container.innerHTML = `<div class="text-muted">Geen toernooi aangemaakt</div>`;
    return;
  }

  const tatamiCount = state.tournament.tatamiCount;
  const tatamiOptions = (currentTatami) => Array.from({ length: tatamiCount }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === Number(currentTatami) ? 'selected' : ''}>Tatami ${n}</option>`)
    .join('');

  let html = '';

  for (let n = 1; n <= tatamiCount; n++) {
    const tatFights = (state.fights || []).filter(f => f.tatami === n || f.tatami === String(n));

    html += `
      <div class="tatami-section">
        <div class="flex justify-between items-center">
          <h3>Tatami ${n}</h3>
          <button class="btn btn-sm btn-primary" onclick="nextFight(${n})">
            ${t('nextFight')}
          </button>
        </div>
    `;

    if (tatFights.length === 0) {
      html += `<div class="text-muted text-small">Geen gevechten gepland</div>`;
    } else {
      // Group fights by category
      const catIds = [...new Map(tatFights.map(f => [f.categoryId, f])).keys()];

      catIds.forEach(catId => {
        const cat = state.categories.find(c => c.id === catId);
        const catFights = tatFights.filter(f => f.categoryId === catId);
        const catName = cat ? cat.name : '?';

        html += `
          <div style="margin-top:0.75rem;margin-bottom:0.25rem;padding:0.4rem 0.6rem;background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
            <strong style="font-size:0.875rem">${esc(catName)}</strong>
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:var(--muted);white-space:nowrap;">
              Verplaats alle →
              <select style="padding:0.2rem 0.5rem;border-radius:var(--radius);background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:0.8rem"
                onchange="assignTatami('${catId}', this.value); this.value='${n}'">
                ${tatamiOptions(n)}
              </select>
            </label>
          </div>
        `;

        html += catFights.map((f, i) => {
          const white = state.competitors.find(c => c.id === f.whiteId);
          const blue  = state.competitors.find(c => c.id === f.blueId);
          const whiteName = white ? white.name : (f.whiteId ? '?' : 'TBD');
          const blueName  = blue  ? blue.name  : (f.blueId  ? '?' : 'TBD');
          const statusClass = f.status === 'active' ? 'active' : f.status === 'ended' ? 'ended' : '';
          const isPending = f.status === 'pending' && f.whiteId && f.blueId;

          return `
            <div class="fight-item" style="margin-left:0.75rem;">
              <span class="fight-num">${i + 1}</span>
              <div class="fight-vs">
                <span class="fight-white">${esc(whiteName)}</span>
                <span class="text-muted">vs</span>
                <span class="fight-blue">${esc(blueName)}</span>
              </div>
              <span class="text-muted text-small">${esc(f.roundName || '')}</span>
              <span class="fight-status ${statusClass}">${t(f.status) || f.status}</span>
              ${isPending ? `
                <select style="padding:0.2rem 0.4rem;border-radius:var(--radius);background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:0.8rem"
                  title="Verplaats gevecht"
                  onchange="reassignFight('${f.id}', this.value)">
                  ${tatamiOptions(f.tatami)}
                </select>
                <button class="btn btn-sm btn-success" onclick="startFight('${f.id}')">▶</button>
              ` : `<span class="text-muted text-small">Tatami ${f.tatami}</span>`}
            </div>
          `;
        }).join('');
      });
    }

    html += `</div>`;
  }

  container.innerHTML = html || `<div class="text-muted">Geen gevechten</div>`;
}

window.reassignFight = function(fightId, tatami) {
  ws.send('admin:reassign_fight', { pin, fightId, tatami: Number(tatami) });
};

// ---- Update Tatami Selects ----
function updateTatamiSelects() {
  if (!state.tournament) return;
  const sel = document.getElementById('catTatami');
  sel.innerHTML = Array.from({length: state.tournament.tatamiCount}, (_, i) => i + 1)
    .map(n => `<option value="${n}">Tatami ${n}</option>`)
    .join('');
}

// ---- Actions ----
window.createTournament = function() {
  const name = document.getElementById('tName').value.trim() || 'Judo Tournament';
  const date = document.getElementById('tDate').value || new Date().toISOString().split('T')[0];
  const tatamiCount = Number(document.getElementById('tTatamiCount').value) || 2;
  const fightDurationMs = Number(document.getElementById('tFightDuration').value) || 240000;
  const adminPin = document.getElementById('tAdminPin').value.trim() || '1234';

  pin = adminPin;
  sessionStorage.setItem('adminPin', pin);
  ws.send('admin:create_tournament', { name, date, tatamiCount, fightDurationMs, adminPin, pin });
};

window.toggleAddCompetitor = function() {
  const form = document.getElementById('addCompetitorForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.toggleCsvImport = function() {
  const form = document.getElementById('csvImportForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.addCompetitor = function() {
  const name = document.getElementById('cName').value.trim();
  if (!name) return alert('Vul een naam in');
  ws.send('admin:add_competitor', {
    pin,
    name,
    club: document.getElementById('cClub').value.trim(),
    gender: document.getElementById('cGender').value,
    weightKg: Number(document.getElementById('cWeight').value) || 0,
    birthYear: Number(document.getElementById('cBirthYear').value) || 0
  });
  document.getElementById('cName').value = '';
  document.getElementById('cClub').value = '';
  document.getElementById('cWeight').value = '';
  document.getElementById('cBirthYear').value = '';
};

window.deleteCompetitor = function(id) {
  if (!confirm('Deelnemer verwijderen?')) return;
  ws.send('admin:delete_competitor', { pin, id });
};

window.importCsv = async function() {
  const csv = document.getElementById('csvTextarea').value.trim();
  if (!csv) return;
  try {
    const res = await fetch('/api/competitors/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: csv
    });
    const data = await res.json();
    alert(`${data.added} deelnemers geïmporteerd${data.errors.length > 0 ? `, ${data.errors.length} fouten` : ''}`);
    document.getElementById('csvTextarea').value = '';
    document.getElementById('csvImportForm').style.display = 'none';
  } catch (e) {
    alert('Importfout: ' + e.message);
  }
};

window.toggleAddCategory = function() {
  const form = document.getElementById('addCategoryForm');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderCompetitorSelectForCategory();
};

function renderCompetitorSelectForCategory() {
  const container = document.getElementById('catCompetitorSelect');
  container.innerHTML = state.competitors.map(c => `
    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;cursor:pointer">
      <input type="checkbox" value="${c.id}" style="width:auto">
      ${esc(c.name)} (${c.gender}, ${c.weightKg}kg)
    </label>
  `).join('') || '<span class="text-muted">Geen deelnemers</span>';
}

window.addCategory = function() {
  const name = document.getElementById('catName').value.trim();
  if (!name) return alert('Vul een naam in');
  const competitorIds = Array.from(document.querySelectorAll('#catCompetitorSelect input:checked'))
    .map(cb => cb.value);
  const ageCategory = document.getElementById('catAgeCategory').value || null;
  ws.send('admin:add_category', {
    pin,
    name,
    gender: document.getElementById('catGender').value,
    ageCategory: ageCategory || null,
    maxWeight: Number(document.getElementById('catMaxWeight').value) || 0,
    fightDurationMs: ageCategory ? JBN_DURATIONS[ageCategory] : null,
    format: document.getElementById('catFormat').value,
    tatami: Number(document.getElementById('catTatami').value) || 1,
    competitorIds
  });
  document.getElementById('catName').value = '';
  document.getElementById('addCategoryForm').style.display = 'none';
};

window.deleteCategory = function(id) {
  if (!confirm('Categorie verwijderen?')) return;
  ws.send('admin:update_category', { pin, id, status: 'deleted' });
  state.categories = state.categories.filter(c => c.id !== id);
  renderCategoriesTab();
};

window.generateDraw = function(categoryId) {
  ws.send('admin:generate_draw', { pin, categoryId });
};

window.generateAllDraws = function() {
  const pending = (state.categories || []).filter(c => c.status !== 'drawn' && c.status !== 'deleted');
  if (!pending.length) return alert('Alle categorieën hebben al een loting.');
  if (!confirm(`Loting genereren voor ${pending.length} categorie(ën)?`)) return;
  for (const cat of pending) {
    ws.send('admin:generate_draw', { pin, categoryId: cat.id });
  }
};

window.assignTatami = function(categoryId, tatami) {
  const cat = state.categories.find(c => c.id === categoryId);
  ws.send('admin:assign_tatami', { pin, categoryId, tatami: Number(tatami), tatami2: cat ? cat.tatami2 : null });
};

window.assignTatami2 = function(categoryId, tatami2Val) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  ws.send('admin:assign_tatami', { pin, categoryId, tatami: cat.tatami, tatami2: tatami2Val ? Number(tatami2Val) : null });
};

window.autoAssignTatamis = function() {
  if (!state.tournament) return alert('Geen toernooi aangemaakt');
  const tatamiCount = state.tournament.tatamiCount || 1;
  const cats = (state.categories || []).filter(c => c.status !== 'deleted');
  if (!cats.length) return alert('Geen categorieën om in te delen');

  function estimateMinutes(cat) {
    const n = (cat.competitorIds || []).length;
    const durationMin = (cat.fightDurationMs || 240000) / 60000;
    const fights = cat.format === 'roundrobin'
      ? Math.max(1, n * (n - 1) / 2)
      : Math.max(1, Math.ceil(2 * n));
    return fights * (durationMin + 1.5);
  }

  const totalMin = cats.reduce((s, c) => s + estimateMinutes(c), 0);
  const targetPerTatami = totalMin / tatamiCount;

  // tatami load state: { id, totalMin }
  const tatamis = Array.from({ length: tatamiCount }, (_, i) => ({ id: i + 1, totalMin: 0 }));

  // Sort categories: largest first for better bin-packing
  const sorted = [...cats].sort((a, b) => estimateMinutes(b) - estimateMinutes(a));

  for (const cat of sorted) {
    const catMin = estimateMinutes(cat);

    // Pick least-loaded tatami as primary
    tatamis.sort((a, b) => a.totalMin - b.totalMin);
    const primary = tatamis[0];

    // Consider splitting across 2 adjacent tatamis when:
    // - category is round-robin (double-elim dependencies make splitting harder)
    // - it's large enough to dominate the tatami
    // - there are ≥ 2 tatamis
    let secondary = null;
    if (cat.format === 'roundrobin' && tatamiCount >= 2 && catMin > targetPerTatami * 0.55) {
      // Prefer adjacent tatami (|id difference| = 1) with least load
      const candidates = tatamis
        .filter(t => t.id !== primary.id && Math.abs(t.id - primary.id) === 1)
        .sort((a, b) => a.totalMin - b.totalMin);
      if (candidates.length > 0) secondary = candidates[0];
    }

    if (secondary) {
      primary.totalMin   += catMin / 2;
      secondary.totalMin += catMin / 2;
      ws.send('admin:assign_tatami', { pin, categoryId: cat.id, tatami: primary.id, tatami2: secondary.id });
    } else {
      primary.totalMin += catMin;
      ws.send('admin:assign_tatami', { pin, categoryId: cat.id, tatami: primary.id, tatami2: null });
    }
  }

  // Show estimated finish times
  tatamis.sort((a, b) => a.id - b.id);
  const lines = tatamis.map(t => `Tatami ${t.id}: ~${Math.round(t.totalMin)} min`).join('\n');
  alert(`Tatami-indeling voltooid.\n\n${lines}`);
};

window.nextFight = function(tatami) {
  ws.send('fight:next', { pin, tatami });
};

window.startFight = function(fightId) {
  ws.send('fight:start', { pin, fightId });
};

window.autoGenerateCategories = function() {
  const competitors = state.competitors;
  if (!competitors.length) return alert('Geen deelnemers om te groeperen');

  const groups = {};
  for (const c of competitors) {
    const gender = c.gender || 'M';
    const ageCategory = c.birthYear ? getAgeCategory(c.birthYear) : 'Senior';
    const ranges = (JBN_WEIGHTS[ageCategory] || JBN_WEIGHTS.Senior)[gender] || JBN_WEIGHTS.Senior.M;
    let weightClass = ranges[ranges.length - 1];
    for (const r of ranges) {
      if (c.weightKg <= r) { weightClass = r; break; }
    }
    const key = `${ageCategory}-${gender}-${weightClass}`;
    if (!groups[key]) groups[key] = { ageCategory, gender, weightClass, competitors: [] };
    groups[key].competitors.push(c);
  }

  for (const [, g] of Object.entries(groups)) {
    if (g.competitors.length === 0) continue;
    const isYouth = ['U7','U9','U11','U13'].includes(g.ageCategory);
    const genderLabel = isYouth
      ? (g.gender === 'M' ? 'Jongens' : 'Meisjes')
      : (g.gender === 'M' ? 'Heren' : 'Dames');
    const ageLabel = g.ageCategory !== 'Senior' ? ` ${JBN_AGE_LABELS[g.ageCategory]}` : '';
    const weightLabel = g.weightClass === Infinity ? '+open' : `-${g.weightClass}kg`;
    ws.send('admin:add_category', {
      pin,
      name: `${genderLabel}${ageLabel} ${weightLabel}`,
      gender: g.gender,
      ageCategory: g.ageCategory,
      maxWeight: g.weightClass === Infinity ? 999 : g.weightClass,
      fightDurationMs: JBN_DURATIONS[g.ageCategory],
      format: g.competitors.length <= 5 ? 'roundrobin' : 'doubleelim',
      tatami: 1,
      competitorIds: g.competitors.map(c => c.id)
    });
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Init ----
updateLangButtons();
applyTranslations();
document.getElementById('tDate').value = new Date().toISOString().split('T')[0];
initWs();

// Decide initial screen: show chooser if multiple tournaments exist, otherwise PIN
(async () => {
  try {
    const res = await fetch('/api/tournaments');
    const tournaments = await res.json();
    if (tournaments.length > 1) {
      showChooser();
    } else if (tournaments.length === 1 && !tournaments[0].isActive) {
      // Only one tournament but it's not active — activate it silently? No, ask PIN.
      showChooser();
    } else {
      // 0 or 1 active tournament — show normal PIN flow
      if (pin) {
        document.getElementById('pinModal').style.display = 'none';
        initApp();
      }
      // else: pin modal is already visible from HTML default
    }
  } catch {
    // On error fall through to normal PIN flow
  }
})();
