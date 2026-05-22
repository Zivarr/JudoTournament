import { t, setLang, getLang, applyTranslations } from '/shared/i18n.js';

window.switchLang = function(lang) {
  setLang(lang);
  applyTranslations();
  updateLangButtons();
  renderChecklist();
  if (window._tatamiCount) renderTatamiCards(window._tatamiCount);
};

function updateLangButtons() {
  const lang = getLang();
  document.getElementById('langNl').classList.toggle('active', lang === 'nl');
  document.getElementById('langEn').classList.toggle('active', lang === 'en');
}

window.copyServerUrl = function() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyUrlBtn');
    const span = btn.querySelector('span');
    const original = span.textContent;
    span.textContent = t('copied');
    btn.classList.add('btn-success');
    setTimeout(() => {
      span.textContent = original;
      btn.classList.remove('btn-success');
    }, 1500);
  });
};

function qrUrl(path) {
  return `/api/qr?data=${encodeURIComponent(window.location.origin + path)}`;
}

function fullUrl(path) {
  return window.location.origin + path;
}

function renderTatamiCards(count) {
  window._tatamiCount = count;
  const list = document.getElementById('tatamiSetupList');
  const section = document.getElementById('tatamiSectionTitle');
  section.style.display = 'block';
  list.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const tatamiPath = `/tatami/${i}`;
    const controlPath = `/control/${i}`;

    const card = document.createElement('div');
    card.className = 'tatami-setup-card';
    card.innerHTML = `
      <div class="tatami-setup-header">Tatami ${i}</div>
      <div class="tatami-setup-body">
        <div class="setup-device">
          <div class="setup-device-icon">🖥️</div>
          <div class="setup-device-label">${t('bigScreen')}</div>
          <div class="setup-qr">
            <img src="${qrUrl(tatamiPath)}" alt="QR Tatami ${i}" width="140" height="140">
          </div>
          <div class="setup-device-url">${fullUrl(tatamiPath)}</div>
          <div class="setup-device-hint">${t('openFullscreen')}</div>
        </div>
        <div class="setup-device">
          <div class="setup-device-icon">🎮</div>
          <div class="setup-device-label">${t('controlDevice')}</div>
          <div class="setup-qr">
            <img src="${qrUrl(controlPath)}" alt="QR Control ${i}" width="140" height="140">
          </div>
          <div class="setup-device-url">${fullUrl(controlPath)}</div>
          <div class="setup-device-hint">${t('pinRequired')}</div>
        </div>
      </div>
    `;
    list.appendChild(card);
  }
}

const CHECKLIST_KEYS = [
  'checkServerStarted',
  'checkWifi',
  'checkScoreboards',
  'checkControlDevices',
  'checkAdminOpen',
];

function renderChecklist() {
  const container = document.getElementById('checklist');
  const saved = JSON.parse(sessionStorage.getItem('setupChecklist') || '{}');
  container.innerHTML = '';

  CHECKLIST_KEYS.forEach(key => {
    const item = document.createElement('label');
    item.className = 'checklist-item' + (saved[key] ? ' checked' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!saved[key];
    cb.addEventListener('change', () => {
      const state = JSON.parse(sessionStorage.getItem('setupChecklist') || '{}');
      state[key] = cb.checked;
      sessionStorage.setItem('setupChecklist', JSON.stringify(state));
      item.classList.toggle('checked', cb.checked);
    });

    const span = document.createElement('span');
    span.textContent = t(key);

    item.appendChild(cb);
    item.appendChild(span);
    container.appendChild(item);
  });
}

async function init() {
  updateLangButtons();
  applyTranslations();

  document.getElementById('serverUrlValue').textContent = window.location.origin;

  renderChecklist();

  try {
    const res = await fetch('/api/tournament');
    const data = await res.json();

    if (data.tournament) {
      renderTatamiCards(data.tournament.tatamiCount);
    } else {
      document.getElementById('noTournamentBanner').style.display = 'block';
    }
  } catch (e) {
    console.error('Failed to load tournament:', e);
    document.getElementById('noTournamentBanner').style.display = 'block';
  }
}

init();
