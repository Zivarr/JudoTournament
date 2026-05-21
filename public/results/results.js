// Results & Draw page — JBN-style layout
// Fetches full state from /api/tournament and renders all categories.

export async function loadData() {
  try {
    const res = await fetch('/api/tournament');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    const now = new Date();
    document.getElementById('refreshInfo').textContent =
      `Bijgewerkt: ${now.toLocaleTimeString('nl-NL')}`;
    render(state);
  } catch (e) {
    document.getElementById('loadingMsg').style.display = 'none';
    document.getElementById('errorMsg').style.display = 'block';
  }
}
window.loadData = loadData;

// ---- Top-level render ----

function render(state) {
  document.getElementById('loadingMsg').style.display = 'none';
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  const t = state.tournament;
  document.getElementById('tournamentName').textContent = t ? t.name : 'Toernooi';
  if (t) {
    const date = t.date
      ? new Date(t.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const tatamis = t.tatamiCount ? `${t.tatamiCount} tatami's` : '';
    document.getElementById('tournamentMeta').textContent =
      [date, tatamis].filter(Boolean).join(' · ');
  }

  const container = document.getElementById('categoriesContainer');

  if (!state.categories || state.categories.length === 0) {
    container.innerHTML = '<div class="empty">Geen categorieën aangemaakt.</div>';
    return;
  }

  container.innerHTML = '';
  for (const cat of state.categories) {
    const pool = (state.pools || []).find(p => p.categoryId === cat.id);
    const catFights = (state.fights || []).filter(f => f.categoryId === cat.id);
    container.appendChild(buildCategorySection(cat, pool, catFights, state.competitors || []));
  }

  // Measure bracket dimensions after layout, store for use in beforeprint
  requestAnimationFrame(() => {
    document.querySelectorAll('.bracket-tree-wrap').forEach(wrap => {
      const cols = wrap.querySelector('.bracket-columns');
      if (!cols) return;
      const nW = cols.scrollWidth;
      const nH = cols.scrollHeight;
      cols.dataset.naturalW = nW;
      cols.dataset.naturalH = nH;
    });
  });
}

function buildCategorySection(cat, pool, fights, competitors) {
  const section = document.createElement('div');
  section.className = 'category-section';

  const isRR = cat.format === 'roundrobin' || (pool && pool.format === 'roundrobin');
  const formatLabel = isRR ? 'Poule' : 'Dubbele eliminatie';

  const checkId = `print-check-${cat.id}`;
  section.innerHTML = `
    <div class="category-header">
      <div class="print-check-wrap">
        <input type="checkbox" class="print-check" id="${checkId}">
        <label class="print-select-label" for="${checkId}">Afdrukken</label>
      </div>
      <h2>${esc(cat.name)}</h2>
      <span class="format-badge">${formatLabel}</span>
    </div>
    <div class="category-body" id="catbody-${cat.id}"></div>
  `;

  const body = section.querySelector(`#catbody-${cat.id}`);

  const hasData = fights.length > 0 || (pool && pool.standings && pool.standings.length > 0);
  if (!hasData) {
    body.innerHTML = '<div class="empty">Loting nog niet gegenereerd.</div>';
    return section;
  }

  if (isRR) {
    body.appendChild(buildRoundRobin(pool, fights, competitors));
  } else {
    body.appendChild(buildDoubleElim(fights, competitors));
  }

  return section;
}

// ---- Round Robin: cross-table ----

function buildRoundRobin(pool, fights, competitors) {
  const frag = document.createDocumentFragment();

  // Ordered competitor list from pool
  const compIds = pool ? (pool.competitorIds || []) : [];
  const comps = compIds
    .map(id => competitors.find(c => c.id === id))
    .filter(Boolean);

  if (comps.length === 0) {
    frag.appendChild(el('div', 'empty', 'Geen deelnemers.'));
    return frag;
  }

  // Build fight lookup
  const fightLookup = {};
  for (const f of fights) {
    if (!f.whiteId || !f.blueId || f.isBye) continue;
    if (!fightLookup[f.whiteId]) fightLookup[f.whiteId] = {};
    if (!fightLookup[f.blueId])  fightLookup[f.blueId]  = {};
    fightLookup[f.whiteId][f.blueId] = f;
    fightLookup[f.blueId][f.whiteId] = f;
  }

  // Build standings lookup for W/V/Pts/Rang columns
  const standings = pool ? (pool.standings || []) : [];
  const standingsMap = {};
  standings.forEach((s, rank) => { standingsMap[s.competitorId] = { ...s, rank: rank + 1 }; });

  // Schedule table
  frag.appendChild(el('div', 'section-label', 'Wedstrijdschema'));
  frag.appendChild(buildScheduleTable(fights, comps));

  // Matrix / pouleblad
  frag.appendChild(el('div', 'section-label', 'Pouleblad'));

  const wrap = document.createElement('div');
  wrap.className = 'matrix-wrap';

  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header: name | 1 | 2 | ... | W | V | Ptn | Rang
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML =
    `<th class="name-header">Deelnemer</th>` +
    comps.map((_, i) => `<th>${i + 1}</th>`).join('') +
    `<th class="score-col">W</th><th class="score-col">V</th><th class="score-col">Ptn</th><th class="score-col">Rang</th>`;
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  comps.forEach((rowComp, i) => {
    const tr = document.createElement('tr');

    // Name cell — includes club for paper use
    const nameTd = document.createElement('td');
    nameTd.className = 'name-cell';
    const clubStr = rowComp.club ? `<span class="name-club">${esc(rowComp.club)}</span>` : '';
    nameTd.innerHTML = `<strong>${i + 1}.</strong> ${esc(rowComp.name)}${clubStr}`;
    tr.appendChild(nameTd);

    // Result cells
    comps.forEach((colComp, j) => {
      const td = document.createElement('td');
      if (i === j) {
        td.className = 'self';
        td.textContent = '—';
      } else {
        const fight = fightLookup[rowComp.id] && fightLookup[rowComp.id][colComp.id];
        if (!fight || fight.status === 'pending') {
          td.className = 'pending-cell';
        } else {
          const rowIsWhite = fight.whiteId === rowComp.id;
          const winner = fight.score && fight.score.winner;
          const rowWon = winner && ((rowIsWhite && winner === 'white') || (!rowIsWhite && winner === 'blue'));
          td.className = rowWon ? 'win' : 'loss';
          const resultSpan = `<span class="result">${rowWon ? 'W' : 'V'}</span>`;
          const methodSpan = fight.score && fight.score.method
            ? `<span class="method-abbr">${methodAbbr(fight.score.method)}</span>`
            : '';
          td.innerHTML = resultSpan + methodSpan;
        }
      }
      tr.appendChild(td);
    });

    // W / V / Punten / Rang columns
    const s = standingsMap[rowComp.id];
    const wTd = document.createElement('td'); wTd.className = 'score-col';
    const vTd = document.createElement('td'); vTd.className = 'score-col';
    const pTd = document.createElement('td'); pTd.className = 'score-col';
    const rTd = document.createElement('td'); rTd.className = 'score-col score-rang';
    if (s) {
      wTd.textContent = s.wins;
      vTd.textContent = s.losses;
      pTd.textContent = s.points;
      rTd.textContent = s.rank;
    }
    tr.appendChild(wTd); tr.appendChild(vTd); tr.appendChild(pTd); tr.appendChild(rTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  frag.appendChild(wrap);

  // Eindstand (only when fights have been recorded)
  if (standings.length > 0) {
    frag.appendChild(el('div', 'section-label', 'Eindstand'));
    frag.appendChild(buildStandingsTable(standings, competitors));
  }

  return frag;
}

function buildScheduleTable(fights, comps) {
  const wrap = document.createElement('div');
  wrap.className = 'schedule-wrap';

  const poolFights = fights.filter(f => !f.isBye && f.whiteId && f.blueId);

  // Group fights by round number
  const roundMap = new Map();
  for (const f of poolFights) {
    const r = f.round || 1;
    if (!roundMap.has(r)) roundMap.set(r, []);
    roundMap.get(r).push(f);
  }
  const roundNums = [...roundMap.keys()].sort((a, b) => a - b);

  // Determine max fights per round (for column count)
  const maxFightsPerRound = Math.max(...roundNums.map(r => roundMap.get(r).length), 1);

  // Does any round have a resting player? (odd N)
  const hasRest = comps.length % 2 === 1;

  // Build player-number lookup: competitorId → 1-based index
  const compIndex = new Map(comps.map((c, i) => [c.id, i + 1]));

  const table = document.createElement('table');
  table.className = 'schedule-table';

  // Header
  const thead = document.createElement('thead');
  let headerHtml = '<tr><th>Ronde</th>';
  for (let i = 0; i < maxFightsPerRound; i++) {
    headerHtml += `<th>Gevecht ${i + 1}</th>`;
  }
  if (hasRest) headerHtml += '<th>Rust</th>';
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  for (const r of roundNums) {
    const roundFights = roundMap.get(r);
    const tr = document.createElement('tr');

    // Round number cell
    const roundTd = document.createElement('td');
    roundTd.className = 'round-num';
    roundTd.textContent = r;
    tr.appendChild(roundTd);

    // Fight cells
    const participatingIds = new Set();
    for (let fi = 0; fi < maxFightsPerRound; fi++) {
      const td = document.createElement('td');
      td.className = 'fight-cell';
      const fight = roundFights[fi];
      if (!fight) {
        td.textContent = '—';
      } else {
        participatingIds.add(fight.whiteId);
        participatingIds.add(fight.blueId);

        const wComp = comps.find(c => c.id === fight.whiteId);
        const bComp = comps.find(c => c.id === fight.blueId);
        const wNum = compIndex.get(fight.whiteId) || '?';
        const bNum = compIndex.get(fight.blueId) || '?';
        const wName = wComp ? esc(wComp.name) : '?';
        const bName = bComp ? esc(bComp.name) : '?';

        if (!fight.score || fight.status !== 'ended') {
          td.className += ' fight-pending';
          td.innerHTML =
            `<span class="s-pnum">${wNum}</span>${wName}` +
            `<span class="s-vs">–</span>` +
            `<span class="s-pnum">${bNum}</span>${bName}`;
        } else {
          td.className += ' fight-done';
          const whiteWon = fight.score.winner === 'white';
          const wClass = whiteWon ? 's-winner' : 's-loser';
          const bClass = whiteWon ? 's-loser' : 's-winner';
          td.innerHTML =
            `<span class="${wClass}"><span class="s-pnum">${wNum}</span>${wName}</span>` +
            `<span class="s-vs">–</span>` +
            `<span class="${bClass}"><span class="s-pnum">${bNum}</span>${bName}</span>`;
        }
      }
      tr.appendChild(td);
    }

    // Rest cell
    if (hasRest) {
      const restTd = document.createElement('td');
      restTd.className = 'rest-cell';
      const resting = comps.find(c => !participatingIds.has(c.id));
      if (resting) {
        const rNum = compIndex.get(resting.id) || '?';
        restTd.innerHTML = `<span class="s-pnum">${rNum}</span>${esc(resting.name)}`;
      } else {
        restTd.textContent = '—';
      }
      tr.appendChild(restTd);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildStandingsTable(standings, competitors) {
  const table = document.createElement('table');
  table.className = 'standings-table';
  table.innerHTML = `<thead><tr>
    <th class="rank">#</th>
    <th>Naam</th>
    <th>Club</th>
    <th title="Gewonnen">W</th>
    <th title="Verloren">V</th>
    <th>Punten</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  standings.forEach((s, i) => {
    const comp = competitors.find(c => c.id === s.competitorId);
    const rankClass = i === 0 ? 'rank-gold' : i === 1 ? 'rank-silver' : i === 2 ? 'rank-bronze' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank ${rankClass}">${i + 1}</td>
      <td>${esc(comp ? comp.name : '?')}</td>
      <td style="color:var(--muted)">${esc(comp ? comp.club || '' : '')}</td>
      <td>${s.wins}</td>
      <td>${s.losses}</td>
      <td class="pts">${s.points}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// ---- Double Elimination: bracket tree ----

function buildDoubleElim(fights, competitors) {
  const frag = document.createDocumentFragment();

  const nonBye = fights.filter(f => !f.isBye);
  const wbFights = nonBye.filter(f => f.bracketType === 'winner');
  const lbFights = nonBye.filter(f => f.bracketType === 'loser');
  const gfFights = nonBye.filter(f => f.bracketType === 'grand-final');

  if (!wbFights.length && !lbFights.length && !gfFights.length) {
    frag.appendChild(el('div', 'empty', 'Geen gevechten.'));
    return frag;
  }

  // Assign fight numbers in interleaved order: WB R1 → LB R1 → WB R2 → LB R2 → ...
  // This reflects the actual fight schedule: LB can start as soon as WB losers are known.
  const fightNums = new Map();
  let num = 1;
  const allRounds = [...new Set([
    ...wbFights.map(f => f.bracketRound || 1),
    ...lbFights.map(f => f.bracketRound || 1),
  ])].sort((a, b) => a - b);
  for (const round of allRounds) {
    const wb = wbFights.filter(f => (f.bracketRound || 1) === round)
      .sort((a, b) => (a.bracketSlot || 0) - (b.bracketSlot || 0));
    const lb = lbFights.filter(f => (f.bracketRound || 1) === round)
      .sort((a, b) => (a.bracketSlot || 0) - (b.bracketSlot || 0));
    for (const f of wb) fightNums.set(f.id, num++);
    for (const f of lb) fightNums.set(f.id, num++);
  }
  for (const f of gfFights) fightNums.set(f.id, num++);

  if (wbFights.length) {
    frag.appendChild(el('div', 'bracket-section-title', 'Winner Bracket'));
    frag.appendChild(buildBracketColumns(wbFights, competitors, fightNums));
  }

  if (lbFights.length) {
    const lbTitle = el('div', 'bracket-section-title bracket-page-break', 'Loser Bracket');
    frag.appendChild(lbTitle);
    frag.appendChild(buildBracketColumns(lbFights, competitors, fightNums));
  }

  if (gfFights.length) {
    const gfTitle = el('div', 'bracket-section-title bracket-page-break', 'Grand Final');
    frag.appendChild(gfTitle);
    frag.appendChild(buildGrandFinal(gfFights[0], competitors, fightNums));
  }

  return frag;
}

function buildBracketColumns(fights, competitors, fightNums = new Map()) {
  // Group by bracketRound
  const byRound = new Map();
  for (const f of fights) {
    const r = f.bracketRound || 1;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(f);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  const wrap = document.createElement('div');
  wrap.className = 'bracket-tree-wrap';

  const cols = document.createElement('div');
  cols.className = 'bracket-columns';

  rounds.forEach((round, roundIdx) => {
    const roundFights = byRound.get(round)
      .sort((a, b) => (a.bracketSlot || 0) - (b.bracketSlot || 0));

    const col = document.createElement('div');
    col.className = 'bracket-col';

    const header = document.createElement('div');
    header.className = 'bracket-col-header';
    header.textContent = roundLabel(round, roundIdx, rounds.length);
    col.appendChild(header);

    // Spacers: R1 = 0 spacers between cards, R2 = 1, R3 = 3, etc.
    // Each card is flanked by half-spacers at top and bottom
    // Between cards: 2^roundIdx - 1 spacers (but rendered as spacer divs with flex:1)
    // We add a spacer before and after each fight, doubling each round.
    const spacersBetween = Math.pow(2, roundIdx) - 1;

    roundFights.forEach((fight, fi) => {
      // Spacer before first card (half = same flex as between, creates centering)
      if (fi === 0) col.appendChild(makeSpacers(Math.floor(spacersBetween / 2) + 1));
      // Fight card
      col.appendChild(buildFightCard(fight, competitors, false, fightNums.get(fight.id)));
      // Spacer after card
      if (fi < roundFights.length - 1) {
        col.appendChild(makeSpacers(spacersBetween + 1));
      } else {
        col.appendChild(makeSpacers(Math.floor(spacersBetween / 2) + 1));
      }
    });

    cols.appendChild(col);
  });

  wrap.appendChild(cols);
  return wrap;
}

function buildGrandFinal(fight, competitors, fightNums = new Map()) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:0.5rem 0;';
  const label = el('div', 'gf-label', '★ Grand Final ★');
  wrap.appendChild(label);
  wrap.appendChild(buildFightCard(fight, competitors, true, fightNums.get(fight.id)));
  return wrap;
}

function buildFightCard(fight, competitors, isGF, fightNum) {
  const white = competitors.find(c => c.id === fight.whiteId);
  const blue  = competitors.find(c => c.id === fight.blueId);
  const ended = fight.status === 'ended';
  const wWins = ended && fight.score && fight.score.winner === 'white';
  const bWins = ended && fight.score && fight.score.winner === 'blue';

  const card = document.createElement('div');
  card.className = 'b-fight' + (isGF ? ' grand-final-card' : '');

  if (fightNum != null) {
    const numLabel = document.createElement('div');
    numLabel.className = 'b-fight-num';
    numLabel.textContent = fightNum;
    card.appendChild(numLabel);
  }

  card.appendChild(buildSlot('white', white, fight.whiteId, wWins, fight.score));
  card.appendChild(buildSlot('blue',  blue,  fight.blueId,  bWins, fight.score));

  return card;
}

function buildSlot(side, comp, id, isWinner, score) {
  const slot = document.createElement('div');
  slot.className = `b-slot ${side}-slot${isWinner ? ' winner' : ''}`;

  const dot = document.createElement('div');
  dot.className = 'b-dot';
  slot.appendChild(dot);

  const name = document.createElement('div');
  name.className = 'b-name' + (!id ? ' tbd' : '');
  name.textContent = comp ? comp.name : (id ? '?' : 'TBD');
  slot.appendChild(name);

  if (isWinner && score && score.method) {
    const sc = document.createElement('div');
    sc.className = 'b-score';
    sc.textContent = methodAbbr(score.method);
    slot.appendChild(sc);
  }

  return slot;
}

function makeSpacers(count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'bracket-spacer';
    frag.appendChild(s);
  }
  return frag;
}

function roundLabel(round, idx, total) {
  if (total === 1) return 'Ronde 1';
  if (idx === total - 1) return 'Finale';
  return `Ronde ${idx + 1}`;
}

// ---- Helpers ----

function methodAbbr(method) {
  switch (method) {
    case 'ippon':                   return 'I';
    case 'waza-ari-awasete-ippon':  return 'WA';
    case 'wazaari':
    case 'waza-ari':                return 'W';
    case 'yuko':                    return 'Y';
    case 'hansoku-make':            return 'HM';
    case 'shido-hansoku-make':      return 'S';
    case 'referee-decision':        return 'B';
    case 'bye':                     return '—';
    default:                        return method;
  }
}

function el(tag, className, text) {
  const d = document.createElement(tag);
  d.className = className;
  d.textContent = text;
  return d;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Init ----
loadData();
