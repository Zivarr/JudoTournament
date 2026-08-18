import { t } from './i18n.js';

// Per-device keyboard shortcuts for the control/matcontrol panels.
// Overrides are stored per-browser in localStorage so each mat's keyboard
// (and whoever is running it) can be configured independently.
const STORAGE_KEY = 'judoKeymap';

const ACTIONS = [
  { id: 'clockToggle', category: 'clock', defaultKey: 'Space', label: () => t('clockToggle') },
  { id: 'scoreIpponWhite', category: 'score', defaultKey: 'Q', label: () => `${t('ippon')} · ${t('white')}` },
  { id: 'scoreIpponBlue', category: 'score', defaultKey: 'Y', label: () => `${t('ippon')} · ${t('blue')}` },
  { id: 'scoreWazaAriWhite', category: 'score', defaultKey: 'W', label: () => `${t('wazaAri')} · ${t('white')}` },
  { id: 'scoreWazaAriBlue', category: 'score', defaultKey: 'U', label: () => `${t('wazaAri')} · ${t('blue')}` },
  { id: 'scoreYukoWhite', category: 'score', defaultKey: 'E', label: () => `${t('yuko')} · ${t('white')}` },
  { id: 'scoreYukoBlue', category: 'score', defaultKey: 'I', label: () => `${t('yuko')} · ${t('blue')}` },
  { id: 'scoreShidoWhite', category: 'score', defaultKey: 'R', label: () => `${t('shido')} · ${t('white')}` },
  { id: 'scoreShidoBlue', category: 'score', defaultKey: 'O', label: () => `${t('shido')} · ${t('blue')}` },
  { id: 'scoreHansokuWhite', category: 'score', defaultKey: 'T', label: () => `${t('hansokuMake')} · ${t('white')}` },
  { id: 'scoreHansokuBlue', category: 'score', defaultKey: 'P', label: () => `${t('hansokuMake')} · ${t('blue')}` },
  { id: 'osaekomiWhite', category: 'osaekomi', defaultKey: 'A', label: () => t('osaekomiWhite') },
  { id: 'osaekomiBlue', category: 'osaekomi', defaultKey: 'K', label: () => t('osaekomiBlue') },
  { id: 'osaekomiBreak', category: 'osaekomi', defaultKey: 'S', label: () => t('breakHold') },
  { id: 'osaekomiConfirm', category: 'osaekomi', defaultKey: 'Enter', label: () => t('confirmScore') },
  { id: 'undo', category: 'other', defaultKey: 'Backspace', label: () => t('undo') },
  { id: 'nextFight', category: 'other', defaultKey: 'N', label: () => t('nextFight') },
  { id: 'refereeDecisionWhite', category: 'other', defaultKey: null, label: () => t('refereeDecisionWhite') },
  { id: 'refereeDecisionBlue', category: 'other', defaultKey: null, label: () => t('refereeDecisionBlue') },
];

const CATEGORY_ORDER = ['clock', 'score', 'osaekomi', 'other'];

function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function getKeymap() {
  const overrides = loadOverrides();
  const map = {};
  for (const a of ACTIONS) {
    const key = Object.prototype.hasOwnProperty.call(overrides, a.id) ? overrides[a.id] : a.defaultKey;
    if (key) map[a.id] = key;
  }
  return map;
}

export function setActionKey(actionId, key) {
  const overrides = loadOverrides();
  // A key can only be bound to one action at a time — bumping it here
  // unbinds whichever other action previously held it.
  const current = getKeymap();
  for (const [id, k] of Object.entries(current)) {
    if (k === key && id !== actionId) overrides[id] = null;
  }
  overrides[actionId] = key;
  saveOverrides(overrides);
  document.dispatchEvent(new CustomEvent('keymapchange'));
}

export function resetActionKey(actionId) {
  const overrides = loadOverrides();
  delete overrides[actionId];
  saveOverrides(overrides);
  document.dispatchEvent(new CustomEvent('keymapchange'));
}

export function resetAllKeys() {
  localStorage.removeItem(STORAGE_KEY);
  document.dispatchEvent(new CustomEvent('keymapchange'));
}

function normalizeKey(e) {
  if (e.code === 'Space') return 'Space';
  if (e.key === 'Enter') return 'Enter';
  if (e.key === 'Backspace') return 'Backspace';
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase();
  if (/^[0-9]$/.test(e.key)) return e.key;
  return null;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// ---- Live control ----
let activeHandlers = null;

export function initKeyboardControl(handlers) {
  activeHandlers = handlers;
  document.addEventListener('keydown', onKeyDown);
}

function onKeyDown(e) {
  if (isTypingTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const pinModal = document.getElementById('pinModal');
  if (pinModal && pinModal.style.display !== 'none') return;
  if (modalEl && modalEl.style.display !== 'none') return;

  const key = normalizeKey(e);
  if (!key) return;
  const map = getKeymap();
  const actionId = Object.keys(map).find(id => map[id] === key);
  if (!actionId) return;
  const fn = activeHandlers && activeHandlers[actionId];
  if (!fn) return;
  e.preventDefault();
  fn();
}

// ---- Settings UI ----
let modalEl = null;
let rebindState = null;

export function openKeymapSettings() {
  if (!modalEl) buildModal();
  renderModal();
  modalEl.style.display = 'flex';
}

export function closeKeymapSettings() {
  if (modalEl) modalEl.style.display = 'none';
  cancelRebind();
}

function buildModal() {
  injectStyles();
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay keymap-overlay';
  modalEl.style.display = 'none';
  modalEl.innerHTML = `
    <div class="modal keymap-modal">
      <h2></h2>
      <p class="keymap-hint text-muted text-small"></p>
      <div class="keymap-list"></div>
      <div class="keymap-modal-actions">
        <button class="btn" data-action="reset-all"></button>
        <button class="btn btn-primary" data-action="close"></button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeKeymapSettings();
  });
  modalEl.querySelector('[data-action="close"]').addEventListener('click', closeKeymapSettings);
  modalEl.querySelector('[data-action="reset-all"]').addEventListener('click', () => {
    resetAllKeys();
    renderModal();
  });
  document.addEventListener('langchange', () => {
    if (modalEl.style.display !== 'none') renderModal();
  });
}

function keyDisplayName(key) {
  if (key === 'Space') return '␣';
  return key;
}

function renderModal() {
  cancelRebind();
  modalEl.querySelector('h2').textContent = t('keyboardShortcuts');
  modalEl.querySelector('.keymap-hint').textContent = t('keymapHint');
  modalEl.querySelector('[data-action="reset-all"]').textContent = t('resetAll');
  modalEl.querySelector('[data-action="close"]').textContent = t('close');

  const map = getKeymap();
  const groups = {};
  for (const a of ACTIONS) {
    (groups[a.category] = groups[a.category] || []).push(a);
  }

  const listEl = modalEl.querySelector('.keymap-list');
  listEl.innerHTML = CATEGORY_ORDER.map(cat => `
    <div class="keymap-group">
      ${(groups[cat] || []).map(a => rowHtml(a, map[a.id])).join('')}
    </div>
  `).join('');

  listEl.querySelectorAll('[data-rebind]').forEach(btn => {
    btn.addEventListener('click', () => startRebind(btn.dataset.rebind, btn));
  });
  listEl.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      resetActionKey(btn.dataset.reset);
      renderModal();
    });
  });
}

function rowHtml(action, key) {
  const label = action.label();
  const keyDisplay = key ? keyDisplayName(key) : t('unassigned');
  return `
    <div class="keymap-row">
      <span class="keymap-row-label">${label}</span>
      <button type="button" class="keymap-key-btn${key ? '' : ' unassigned'}" data-rebind="${action.id}">${keyDisplay}</button>
      <button type="button" class="keymap-reset-btn" data-reset="${action.id}" title="${t('reset')}">↺</button>
    </div>
  `;
}

function startRebind(actionId, btnEl) {
  cancelRebind();
  rebindState = { actionId, btnEl };
  btnEl.textContent = t('pressKey');
  btnEl.classList.add('listening');
  document.addEventListener('keydown', onRebindKeyDown, true);
}

function cancelRebind() {
  if (rebindState) {
    document.removeEventListener('keydown', onRebindKeyDown, true);
    rebindState = null;
  }
}

function onRebindKeyDown(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    cancelRebind();
    renderModal();
    return;
  }
  const key = normalizeKey(e);
  if (!key) return;
  setActionKey(rebindState.actionId, key);
  cancelRebind();
  renderModal();
}

function injectStyles() {
  if (document.getElementById('keymapStyles')) return;
  const style = document.createElement('style');
  style.id = 'keymapStyles';
  style.textContent = `
    .keymap-overlay { z-index: 10000; }
    .keymap-modal { max-width: 480px; max-height: 85vh; display: flex; flex-direction: column; }
    .keymap-hint { margin-top: -0.75rem; margin-bottom: 1rem; }
    .keymap-list { overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .keymap-group { display: flex; flex-direction: column; gap: 0.25rem; padding-bottom: 0.5rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
    .keymap-group:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .keymap-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
    .keymap-row-label { flex: 1; font-size: 0.9rem; }
    .keymap-key-btn {
      min-width: 3rem;
      padding: 0.3rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface2);
      color: var(--text);
      font-family: var(--font-display);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-align: center;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .keymap-key-btn:hover { background: var(--accent-hover); }
    .keymap-key-btn.unassigned { color: var(--muted); font-weight: 400; font-family: var(--font-body); }
    .keymap-key-btn.listening { border-color: var(--info); color: var(--info); animation: keymapPulse 1s ease-in-out infinite; }
    .keymap-reset-btn {
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 1rem;
      padding: 0.2rem 0.35rem;
      transition: color 0.15s;
    }
    .keymap-reset-btn:hover { color: var(--text); }
    .keymap-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    @keyframes keymapPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') {
  window.openKeymapSettings = openKeymapSettings;
}
