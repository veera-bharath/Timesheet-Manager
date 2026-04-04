/* =============================================================
   SETTINGS — full-screen modal shell, nav routing, dirty state
   ============================================================= */

import { state, APP_VERSION } from './state.js';
import { saveState } from './store.js';
import { showToast } from './toast.js';
import { updateSummary } from './summary.js';
import { renderDays } from './render.js';
import { escHtml } from './utils.js';
import { applyTheme } from './theme.js';
import { renderTicketTypesSection } from './ticket-types.js';
import { renderLeaveTypesSection } from './leave-types.js';
import { renderErrorLogSection } from './error-log.js';

/* ── SECTION METADATA ───────────────────────────────────── */
const SECTION_META = {
    'general':       { parent: null,         label: 'General',       isParent: false },
    'appearance':    { parent: null,         label: 'Appearance',    isParent: false },
    'notifications': { parent: null,         label: 'Notifications', isParent: false },
    'management':    { parent: null,         label: 'Management',    isParent: true  },
    'ticket-types':  { parent: 'management', label: 'Ticket Types',  isParent: false },
    'leave-types':   { parent: 'management', label: 'Leave Types',   isParent: false },
    'developer':     { parent: null,         label: 'Developer',     isParent: true  },
    'error-logs':    { parent: 'developer',  label: 'Error Logs',    isParent: false },
    'about':         { parent: null,         label: 'About',         isParent: false },
};

const NOTIFICATION_KEY = 'notificationSettings';

/* ── STATE ──────────────────────────────────────────────── */
let currentSection = 'general';
let dirtySection   = null;
let _pendingTarget = null;   // section key or '__close__'
let settingsModalInst = null;

/* ── CHANGELOG ──────────────────────────────────────────── */
const CHANGELOG_KEY = 'changelog_v1';

export async function loadChangelog() {
    try {
        const saved = await window.electronStore.get(CHANGELOG_KEY);
        // Discard the old bogus seed (single "Initial release." entry)
        const isBogus = Array.isArray(saved) && saved.length === 1 && saved[0]?.notes === 'Initial release.';
        if (saved && Array.isArray(saved) && saved.length > 0 && !isBogus) {
            state.changelog = saved;
        }
    } catch (e) { /* silent */ }
    // Refresh from GitHub in background (non-blocking)
    _refreshChangelogFromGitHub().catch(() => {});
}

async function _refreshChangelogFromGitHub() {
    try {
        const res = await fetch('https://api.github.com/repos/veera-bharath/Timesheet-Manager/releases');
        if (!res.ok) return;
        const releases = await res.json();
        if (!Array.isArray(releases) || releases.length === 0) return;
        state.changelog = releases.map(r => ({
            version: r.tag_name.replace(/^v/, ''),
            date: r.published_at ? r.published_at.slice(0, 10) : '',
            notes: r.body || '',
        }));
        await window.electronStore.set(CHANGELOG_KEY, state.changelog);
    } catch (e) { /* offline or API error — silently keep existing data */ }
}

export async function addChangelogEntry(version, notes, date) {
    if (!Array.isArray(state.changelog)) state.changelog = [];
    // Avoid duplicate versions
    if (state.changelog.some(e => e.version === version)) return;
    state.changelog.unshift({ version, date: date || new Date().toISOString().slice(0, 10), notes: notes || '' });
    try { await window.electronStore.set(CHANGELOG_KEY, state.changelog); } catch (e) { /* silent */ }
}

/* ── INIT ───────────────────────────────────────────────── */
export function initSettings() {
    const modalEl = document.getElementById('settingsModal');
    if (!modalEl) return;

    settingsModalInst = new bootstrap.Modal(modalEl, {
        backdrop: 'static',
        keyboard: false,
    });

    document.getElementById('btn-settings-close')
        .addEventListener('click', attemptClose);

    // Top-level nav items
    modalEl.querySelectorAll('.settings-nav-item[data-section]').forEach(el => {
        el.addEventListener('click', () => navigateTo(el.dataset.section));
    });

    // Sub-nav items — stop propagation so parent click doesn't also fire
    modalEl.querySelectorAll('.settings-nav-subitem[data-section]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateTo(el.dataset.section);
        });
    });

    // Unsaved overlay buttons
    document.getElementById('btn-settings-keep')
        .addEventListener('click', hideUnsavedOverlay);

    document.getElementById('btn-settings-discard')
        .addEventListener('click', () => {
            const target = _pendingTarget;
            hideUnsavedOverlay();
            dirtySection = null;
            if (target === '__close__') {
                settingsModalInst.hide();
            } else if (target) {
                doNavigate(target);
            }
        });

    doNavigate('general');
}

/* ── PUBLIC API ─────────────────────────────────────────── */
export function openSettings(section = 'general') {
    doNavigate(section);
    settingsModalInst.show();
}

export function markDirty(section) { dirtySection = section; }
export function clearDirty()       { dirtySection = null; }

/* ── NAV ────────────────────────────────────────────────── */
function navigateTo(section) {
    if (dirtySection && dirtySection !== section) {
        _pendingTarget = section;
        showUnsavedOverlay();
        return;
    }
    doNavigate(section);
}

function doNavigate(section) {
    currentSection = section;
    updateNav(section);
    renderSection(section);
}

function updateNav(section) {
    const modal = document.getElementById('settingsModal');
    const info  = SECTION_META[section];

    // Clear all active states and collapse all subs
    modal.querySelectorAll('.settings-nav-item, .settings-nav-subitem')
         .forEach(el => el.classList.remove('active'));
    modal.querySelectorAll('.settings-nav-sub')
         .forEach(el => el.classList.remove('open'));
    modal.querySelectorAll('.settings-nav-parent')
         .forEach(el => el.classList.remove('expanded'));

    // Activate selected item
    const activeEl = modal.querySelector(`[data-section="${section}"]`);
    if (activeEl) activeEl.classList.add('active');

    // If item is a parent → expand its own sub-nav
    if (info?.isParent) {
        activeEl?.classList.add('expanded');
        modal.querySelector(`#sub-${section}`)?.classList.add('open');
    }

    // If item is a child → activate + expand parent
    if (info?.parent) {
        const parentEl = modal.querySelector(`.settings-nav-item[data-section="${info.parent}"]`);
        parentEl?.classList.add('active', 'expanded');
        modal.querySelector(`#sub-${info.parent}`)?.classList.add('open');
    }
}

/* ── SECTION RENDERERS (shells — filled by later issues) ── */
function renderSection(section) {
    const el = document.getElementById('settings-content');
    switch (section) {
        case 'general':        return renderGeneral(el);
        case 'appearance':     return renderAppearance(el);
        case 'notifications':  return renderNotifications(el);
        case 'management':     return renderManagement(el);
        case 'ticket-types': return renderTicketTypes(el);
        case 'leave-types':  return renderLeaveTypes(el);
        case 'developer':    return renderDeveloper(el);
        case 'error-logs':   return renderErrorLogs(el);
        case 'about':        return renderAbout(el);
    }
}

function renderGeneral(el) {
    const tgt = state.dailyTargetMins || 480;
    const hhVal = Math.floor(tgt / 60);
    const mmVal = tgt % 60;

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">General</h2>
            <p class="settings-section-desc">Sheet details used in the generated timesheet report.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form">
                <div class="settings-form-group">
                    <label class="label-text" for="settings-report-title">Report Title</label>
                    <input type="text" id="settings-report-title" class="form-control dark-input"
                        placeholder="e.g. Booked hours in Jira and Service Desk"
                        value="${escHtml(state.reportTitle || '')}" />
                </div>
                <div class="settings-form-group">
                    <label class="label-text" for="settings-emp-name">Employee Name</label>
                    <input type="text" id="settings-emp-name" class="form-control dark-input"
                        placeholder="e.g. John Doe"
                        value="${escHtml(state.employeeName || '')}" />
                </div>
                <div class="settings-form-group">
                    <label class="label-text">Daily Target</label>
                    <div class="d-flex align-items-center gap-2">
                        <input type="number" id="settings-target-hh" class="form-control dark-input text-center"
                            min="0" max="23" placeholder="08" value="${hhVal}" style="max-width:64px" />
                        <span class="label-text">hrs</span>
                        <input type="number" id="settings-target-mm" class="form-control dark-input text-center"
                            min="0" max="59" placeholder="00" value="${mmVal}" style="max-width:64px" />
                        <span class="label-text">min</span>
                    </div>
                </div>
                <div class="settings-form-actions">
                    <button class="btn btn-gradient px-4" id="btn-save-general">
                        <i class="bi bi-check-lg me-1"></i> Save
                    </button>
                </div>
            </div>
        </div>`;

    // Mark dirty on any change
    const markGeneralDirty = () => markDirty('general');
    el.querySelector('#settings-report-title').addEventListener('input', markGeneralDirty);
    el.querySelector('#settings-emp-name').addEventListener('input', markGeneralDirty);
    el.querySelector('#settings-target-hh').addEventListener('input', markGeneralDirty);
    el.querySelector('#settings-target-mm').addEventListener('input', markGeneralDirty);

    // HH auto-advance to MM
    el.querySelector('#settings-target-hh').addEventListener('input', function () {
        if (this.value.length >= 2) el.querySelector('#settings-target-mm').focus();
    });

    // Save
    el.querySelector('#btn-save-general').addEventListener('click', () => {
        const title = el.querySelector('#settings-report-title').value.trim();
        const name  = el.querySelector('#settings-emp-name').value.trim();
        const hh    = parseInt(el.querySelector('#settings-target-hh').value) || 0;
        const mm    = parseInt(el.querySelector('#settings-target-mm').value) || 0;
        const mins  = hh * 60 + mm;

        state.reportTitle    = title;
        state.employeeName   = name;
        state.dailyTargetMins = mins > 0 ? mins : 480;

        saveState();
        updateSummary();
        renderDays();
        updateSheetDetailsDisplay();
        clearDirty();
        showToast('Sheet details saved.', 'success');
    });
}

/* ── SHEET DETAILS DISPLAY (main page read-only panel) ───── */
export function updateSheetDetailsDisplay() {
    const titleEl  = document.getElementById('display-report-title');
    const nameEl   = document.getElementById('display-emp-name');
    const targetEl = document.getElementById('display-daily-target');

    if (titleEl)  titleEl.textContent  = state.reportTitle  || '—';
    if (nameEl)   nameEl.textContent   = state.employeeName || '—';
    if (targetEl) {
        const hh = Math.floor(state.dailyTargetMins / 60);
        const mm = state.dailyTargetMins % 60;
        targetEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
}

function renderAppearance(el) {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Appearance</h2>
            <p class="settings-section-desc">Customize the look of the app.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form-group">
                <label class="label-text">Theme</label>
                <div class="settings-theme-options">
                    <button class="settings-theme-btn ${currentTheme === 'dark' ? 'active' : ''}" data-select-theme="dark">
                        <i class="bi bi-moon-fill"></i>
                        <span>Dark</span>
                    </button>
                    <button class="settings-theme-btn ${currentTheme === 'light' ? 'active' : ''}" data-select-theme="light">
                        <i class="bi bi-sun-fill"></i>
                        <span>Light</span>
                    </button>
                </div>
                <p class="form-text mt-2">Changes apply immediately.</p>
            </div>
        </div>`;

    el.querySelectorAll('.settings-theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyTheme(btn.dataset.selectTheme);
            localStorage.setItem('theme', btn.dataset.selectTheme);
        });
    });
}

async function renderNotifications(el) {
    const saved = await window.electronStore.get(NOTIFICATION_KEY) || { enabled: true, time: '17:30' };
    const enabled = saved.enabled !== false;
    const time = saved.time || '17:30';

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Notifications</h2>
            <p class="settings-section-desc">Daily reminder to log your time before end of day.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form">
                <div class="settings-form-group">
                    <label class="label-text">Daily Reminder</label>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="notif-enabled" ${enabled ? 'checked' : ''} />
                        <label class="form-check-label label-text" for="notif-enabled">
                            Enable daily reminder notification
                        </label>
                    </div>
                    <p class="form-text text-muted mt-1">Shows a system notification if your daily target isn't met yet.</p>
                </div>
                <div class="settings-form-group" id="notif-time-group" style="${enabled ? '' : 'opacity:0.4;pointer-events:none'}">
                    <label class="label-text" for="notif-time">Reminder Time</label>
                    <input type="time" id="notif-time" class="form-control dark-input" value="${time}" style="max-width:140px" />
                </div>
                <div class="settings-form-actions">
                    <button class="btn btn-gradient px-4" id="btn-save-notifications">
                        <i class="bi bi-check-lg me-1"></i> Save
                    </button>
                </div>
            </div>
        </div>`;

    const enabledToggle = el.querySelector('#notif-enabled');
    const timeGroup = el.querySelector('#notif-time-group');

    enabledToggle.addEventListener('change', () => {
        timeGroup.style.opacity = enabledToggle.checked ? '1' : '0.4';
        timeGroup.style.pointerEvents = enabledToggle.checked ? '' : 'none';
        markDirty('notifications');
    });

    el.querySelector('#notif-time').addEventListener('change', () => markDirty('notifications'));

    el.querySelector('#btn-save-notifications').addEventListener('click', async () => {
        const newEnabled = el.querySelector('#notif-enabled').checked;
        const newTime = el.querySelector('#notif-time').value || '17:30';
        const current = await window.electronStore.get(NOTIFICATION_KEY) || {};
        await window.electronStore.set(NOTIFICATION_KEY, { ...current, enabled: newEnabled, time: newTime });
        clearDirty();
        showToast('Notification settings saved.', 'success');
    });
}

function renderManagement(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Management</h2>
            <p class="settings-section-desc">Configure ticket types and leave types used across the app.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-mgmt-cards">
                <div class="settings-mgmt-card" data-nav="ticket-types">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-tag-fill"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Ticket Types</div>
                        <div class="settings-mgmt-card-desc">Add, edit or remove ticket type options used in entries</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
                <div class="settings-mgmt-card" data-nav="leave-types">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-calendar-x-fill"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Leave Types</div>
                        <div class="settings-mgmt-card-desc">Configure holiday and leave categories for day cards</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
            </div>
        </div>`;
    el.querySelectorAll('.settings-mgmt-card[data-nav]').forEach(card => {
        card.addEventListener('click', () => navigateTo(card.dataset.nav));
    });
}

function renderTicketTypes(el) {
    renderTicketTypesSection(el, navigateTo);
}

function renderLeaveTypes(el) {
    renderLeaveTypesSection(el, navigateTo);
}

function renderDeveloper(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Developer</h2>
            <p class="settings-section-desc">Diagnostic tools for troubleshooting application issues.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-mgmt-cards">
                <div class="settings-mgmt-card" data-nav="error-logs">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-exclamation-triangle-fill" style="color:var(--danger)"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Error Logs</div>
                        <div class="settings-mgmt-card-desc">View, copy and clear application error logs</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
            </div>
        </div>`;
    el.querySelector('.settings-mgmt-card').addEventListener('click', () => navigateTo('error-logs'));
}

function renderErrorLogs(el) {
    renderErrorLogSection(el, navigateTo);
}

function _renderMarkdown(md) {
    if (!md) return '';
    let h = escHtml(md);
    // Headings
    h = h.replace(/^### (.+)$/gm, '<p class="cl-md-h3">$1</p>');
    h = h.replace(/^## (.+)$/gm,  '<p class="cl-md-h2">$1</p>');
    h = h.replace(/^# (.+)$/gm,   '<p class="cl-md-h1">$1</p>');
    // Bold + italic
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    // Inline code
    h = h.replace(/`([^`]+)`/g, '<code class="cl-md-code">$1</code>');
    // List items
    h = h.replace(/^[-*+] (.+)$/gm, '<div class="cl-md-li">$1</div>');
    // Links (escHtml turns & → &amp; in URLs, which is valid in href)
    h = h.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Strip newlines immediately adjacent to block elements (headings, list items)
    h = h.replace(/\n*(<(?:p class="cl-md-h\d"|div class="cl-md-li")[^>]*>)/g, '$1');
    h = h.replace(/(<\/(?:p|div)>)\n*/g, '$1');
    // Remaining blank lines → single line break, single newlines → <br>
    h = h.replace(/\n{2,}/g, '<br>').replace(/\n/g, '<br>');
    // Collapse consecutive <br> tags
    h = h.replace(/(<br>\s*){2,}/g, '<br>');
    return h;
}

function renderAbout(el) {
    const allChangelog = state.changelog || [];
    const changelog = allChangelog.slice(0, 10);

    const changelogHtml = changelog.length === 0
        ? '<p class="settings-placeholder">No changelog entries yet.</p>'
        : changelog.map((entry, i) => `
            <div class="cl-entry ${i === 0 ? 'open' : ''}">
                <button class="cl-header">
                    <span class="cl-version">v${escHtml(entry.version)}</span>
                    ${entry.date ? `<span class="cl-date">${escHtml(entry.date)}</span>` : ''}
                    <i class="bi bi-chevron-down cl-chevron ms-auto"></i>
                </button>
                <div class="cl-body">
                    <div class="cl-notes">${_renderMarkdown(entry.notes || '')}</div>
                </div>
            </div>`).join('');

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">About</h2>
            <p class="settings-section-desc">App information and release history.</p>
        </div>
        <div class="settings-section-body">
            <div class="about-app-card">
                <img src="${document.querySelector('link[rel=\'icon\']')?.href || 'favicon.png'}" alt="App Logo" class="about-logo">
                <div>
                    <div class="about-app-name">Timesheet Manager</div>
                    <div class="about-version">v${escHtml(APP_VERSION)}</div>
                    <div class="about-built-with">Developed by <strong>Veera Bharath</strong></div>
                    <div class="about-built-with">Built with Electron + Vite</div>
                </div>
            </div>
            <div class="d-flex gap-2 mt-3 mb-4">
                <a href="https://github.com/veera-bharath/Timesheet-Manager" target="_blank"
                   class="btn btn-outline-light btn-sm">
                    <i class="bi bi-github me-1"></i> GitHub
                </a>
                <a href="https://github.com/veera-bharath/Timesheet-Manager/issues/new" target="_blank"
                   class="btn btn-outline-light btn-sm">
                    <i class="bi bi-bug me-1"></i> Report a Bug
                </a>
            </div>
            <h3 class="settings-subsection-title">Changelog</h3>
            <div class="cl-list">${changelogHtml}</div>
            ${allChangelog.length > 10 ? `
            <div class="mt-3">
                <a href="https://github.com/veera-bharath/Timesheet-Manager/releases" target="_blank"
                   class="btn btn-outline-light btn-sm">
                    <i class="bi bi-box-arrow-up-right me-1"></i> View all ${allChangelog.length} releases on GitHub
                </a>
            </div>` : ''}
        </div>`;

    el.querySelectorAll('.cl-header').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.cl-entry').classList.toggle('open');
        });
    });

    // If we have no changelog yet, fetch now and re-render when done
    if (changelog.length === 0) {
        _refreshChangelogFromGitHub().then(() => {
            if (state.changelog.length > 0) renderAbout(el);
        }).catch(() => {});
    }
}

/* ── CLOSE / UNSAVED OVERLAY ────────────────────────────── */
function attemptClose() {
    if (dirtySection) {
        _pendingTarget = '__close__';
        showUnsavedOverlay();
    } else {
        settingsModalInst.hide();
    }
}

function showUnsavedOverlay() {
    const label = SECTION_META[dirtySection]?.label || 'this section';
    document.getElementById('settings-unsaved-msg').textContent =
        `You have unsaved changes in ${label}. Discard them?`;
    document.getElementById('settings-unsaved-overlay').style.display = 'flex';
}

function hideUnsavedOverlay() {
    document.getElementById('settings-unsaved-overlay').style.display = 'none';
    _pendingTarget = null;
}
