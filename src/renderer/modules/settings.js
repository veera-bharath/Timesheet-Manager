/* =============================================================
   SETTINGS — full-screen modal shell, nav routing, dirty state
   ============================================================= */

import { state, APP_VERSION, MAX_TARGET_MINS } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { updateSummary } from './summary.js';
import { renderDays } from './render.js';
import { escHtml } from './utils.js';
import { applyTheme } from './theme.js';
import { renderTicketTypesSection } from './ticket-types.js';
import { renderLeaveTypesSection } from './leave-types.js';
import { renderErrorLogSection } from './error-log.js';
import { openRestoreFromJson, openRestoreFromTxt } from './restore.js';
import { parseTimeInput, fmtTimeInput, timeInputError } from './utils.js';
import { refreshSettings, testConnection } from './ai.js';

/* ── SECTION METADATA ───────────────────────────────────── */
const SECTION_META = {
    'general':        { parent: null,             label: 'General',           isParent: false },
    'appearance':     { parent: null,             label: 'Appearance',        isParent: false },
    'notifications':  { parent: null,             label: 'Notifications',     isParent: false },
    'management':     { parent: null,             label: 'Management',        isParent: true  },
    'ticket-types':   { parent: 'management',     label: 'Ticket Types',      isParent: false },
    'leave-types':    { parent: 'management',     label: 'Leave Types',       isParent: false },
    'developer':      { parent: null,             label: 'Developer',         isParent: true  },
    'error-logs':     { parent: 'developer',      label: 'Error Logs',        isParent: false },
    'backup-restore': { parent: null,             label: 'Backup & Restore',  isParent: true  },
    'backup':         { parent: 'backup-restore', label: 'Backup',            isParent: false },
    'restore':        { parent: 'backup-restore', label: 'Restore',           isParent: false },
    'ai':             { parent: null,  label: 'AI',       isParent: true  },
    'ai-provider':    { parent: 'ai', label: 'Provider', isParent: false },
    'ai-features':    { parent: 'ai', label: 'Features', isParent: false },
    'about':          { parent: null,             label: 'About',             isParent: false },
};

const NOTIFICATION_KEY   = 'notificationSettings';
const BACKUP_SETTINGS_KEY = 'backupSettings';

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
        case 'developer':      return renderDeveloper(el);
        case 'error-logs':     return renderErrorLogs(el);
        case 'backup-restore': return renderBackupRestore(el);
        case 'backup':         return renderBackup(el);
        case 'restore':        return renderRestore(el);
        case 'ai':             return renderAI(el);
        case 'ai-provider':    return renderAIProvider(el);
        case 'ai-features':    return renderAIFeatures(el);
        case 'about':          return renderAbout(el);
    }
}

function renderGeneral(el) {
    const tgt = state.dailyTargetMins || 480;

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
                    <label class="label-text" for="settings-target-time">Daily Target</label>
                    <input type="text" id="settings-target-time" class="form-control dark-input"
                        placeholder="e.g. 8h, 7:30, 450m"
                        value="${escHtml(fmtTimeInput(Math.floor(tgt / 60), tgt % 60))}" style="max-width:160px" />
                    <div class="invalid-feedback" id="settings-target-time-error"></div>
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
    el.querySelector('#settings-target-time').addEventListener('input', markGeneralDirty);

    // Validate on blur — no rewrite
    el.querySelector('#settings-target-time').addEventListener('blur', function () {
        const err = this.value.trim() ? timeInputError(this.value, MAX_TARGET_MINS) : null;
        this.classList.toggle('is-invalid', !!err);
        el.querySelector('#settings-target-time-error').textContent = err || '';
    });

    // Save
    el.querySelector('#btn-save-general').addEventListener('click', () => {
        const title = el.querySelector('#settings-report-title').value.trim();
        const name  = el.querySelector('#settings-emp-name').value.trim();
        const timeEl = el.querySelector('#settings-target-time');
        const timeParsed = parseTimeInput(timeEl.value);
        const mins  = timeParsed ? timeParsed.hh * 60 + timeParsed.mm : 0;
        const timeErr = timeEl.value.trim() ? timeInputError(timeEl.value, MAX_TARGET_MINS) : null;

        if (timeErr) {
            timeEl.classList.add('is-invalid');
            el.querySelector('#settings-target-time-error').textContent = timeErr;
            showToast(timeErr, 'danger');
            return;
        }

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

    const headerEmp = document.getElementById('header-emp-name');
    const headerChip = document.getElementById('header-user-chip');
    if (headerEmp) headerEmp.textContent = state.employeeName || '';
    if (headerChip) headerChip.style.display = state.employeeName ? '' : 'none';

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

/* ── BACKUP & RESTORE ────────────────────────────────────── */

function renderBackupRestore(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Backup &amp; Restore</h2>
            <p class="settings-section-desc">Protect your data and recover from a backup when needed.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-mgmt-cards">
                <div class="settings-mgmt-card" data-nav="backup">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-cloud-arrow-up-fill"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Backup</div>
                        <div class="settings-mgmt-card-desc">Manually back up your data or configure automatic scheduled backups</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
                <div class="settings-mgmt-card" data-nav="restore">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-cloud-arrow-down-fill"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Restore</div>
                        <div class="settings-mgmt-card-desc">Restore timesheet data from a JSON backup or a downloaded TXT report</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
            </div>
        </div>`;
    el.querySelectorAll('.settings-mgmt-card[data-nav]').forEach(card => {
        card.addEventListener('click', () => navigateTo(card.dataset.nav));
    });
}

async function renderBackup(el) {
    const saved          = await window.electronStore.get(BACKUP_SETTINGS_KEY) || {};
    const enabled        = saved.enabled !== false;
    const frequency      = saved.frequency || 'weekly';
    const dayOfWeek      = saved.dayOfWeek ?? 1;
    const hour           = saved.hour ?? 9;
    const minute         = saved.minute ?? 0;
    const retentionDays  = saved.retentionDays ?? 30;
    const lastBackupAt   = saved.lastBackupAt || null;
    const folder         = saved.folder || '';
    const timeVal        = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Backup</h2>
            <p class="settings-section-desc">Save a copy of all your timesheet data to a local file.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form">
                <div class="settings-form-group">
                    <label class="label-text">Manual Backup</label>
                    <button class="btn btn-gradient px-4" id="btn-backup-now">
                        <i class="bi bi-cloud-arrow-up me-1"></i> Backup Now
                    </button>
                    <p class="form-text mt-1" id="backup-last-info" style="color:var(--text-secondary)">
                        ${lastBackupAt
                            ? `Last backup: ${new Date(lastBackupAt).toLocaleString()}`
                            : 'No backups created yet.'}
                    </p>
                </div>
                <hr class="settings-divider">
                <div class="settings-form-group">
                    <label class="label-text">Auto-backup</label>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="backup-enabled" ${enabled ? 'checked' : ''} />
                        <label class="form-check-label label-text" for="backup-enabled">
                            Automatically back up on app launch
                        </label>
                    </div>
                </div>
                <div id="backup-auto-config" style="${enabled ? '' : 'opacity:0.4;pointer-events:none'}">
                    <div class="settings-form d-flex flex-column gap-4">
                        <div class="settings-form-group">
                            <label class="label-text" for="backup-frequency">Frequency</label>
                            <select id="backup-frequency" class="form-control dark-input" style="max-width:180px">
                                <option value="daily"   ${frequency === 'daily'   ? 'selected' : ''}>Daily</option>
                                <option value="weekly"  ${frequency === 'weekly'  ? 'selected' : ''}>Weekly</option>
                                <option value="monthly" ${frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                            </select>
                        </div>
                        <div class="settings-form-group" id="backup-dow-group" style="${frequency === 'weekly' ? '' : 'display:none'}">
                            <label class="label-text" for="backup-dow">Day of Week</label>
                            <select id="backup-dow" class="form-control dark-input" style="max-width:180px">
                                <option value="1" ${dayOfWeek === 1 ? 'selected' : ''}>Monday</option>
                                <option value="2" ${dayOfWeek === 2 ? 'selected' : ''}>Tuesday</option>
                                <option value="3" ${dayOfWeek === 3 ? 'selected' : ''}>Wednesday</option>
                                <option value="4" ${dayOfWeek === 4 ? 'selected' : ''}>Thursday</option>
                                <option value="5" ${dayOfWeek === 5 ? 'selected' : ''}>Friday</option>
                            </select>
                        </div>
                        <div class="settings-form-group">
                            <label class="label-text" for="backup-time">Check Time (on app launch)</label>
                            <input type="time" id="backup-time" class="form-control dark-input" value="${timeVal}" style="max-width:140px" />
                            <p class="form-text" style="color:var(--text-secondary)">
                                Auto-backup runs when the app is launched at or after this time on the scheduled day.
                            </p>
                        </div>
                        <div class="settings-form-group">
                            <label class="label-text" for="backup-retention">Retain backups for</label>
                            <div class="d-flex align-items-center gap-2">
                                <input type="number" id="backup-retention" class="form-control dark-input text-center"
                                    min="1" max="30" value="${retentionDays}" style="max-width:72px" />
                                <span class="label-text">days &nbsp;<span style="color:var(--text-muted);font-size:0.8rem">(max 30)</span></span>
                            </div>
                        </div>
                        <div class="settings-form-group">
                            <label class="label-text">Backup Folder</label>
                            <div class="d-flex align-items-center gap-2 flex-wrap">
                                <span id="backup-folder-display" style="color:var(--text-secondary);font-size:0.82rem;word-break:break-all">
                                    ${folder || 'Default: Documents/TimesheetBackups'}
                                </span>
                                <button class="btn btn-sm btn-outline-light" id="btn-backup-folder">
                                    <i class="bi bi-folder me-1"></i> Change
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-form-actions">
                    <button class="btn btn-gradient px-4" id="btn-save-backup">
                        <i class="bi bi-check-lg me-1"></i> Save
                    </button>
                </div>
            </div>
        </div>`;

    const enabledToggle = el.querySelector('#backup-enabled');
    const autoConfig    = el.querySelector('#backup-auto-config');
    const freqSelect    = el.querySelector('#backup-frequency');
    const dowGroup      = el.querySelector('#backup-dow-group');

    enabledToggle.addEventListener('change', () => {
        autoConfig.style.opacity       = enabledToggle.checked ? '1' : '0.4';
        autoConfig.style.pointerEvents = enabledToggle.checked ? '' : 'none';
        markDirty('backup');
    });

    freqSelect.addEventListener('change', () => {
        dowGroup.style.display = freqSelect.value === 'weekly' ? '' : 'none';
        markDirty('backup');
    });

    el.querySelector('#backup-time').addEventListener('change', () => markDirty('backup'));
    el.querySelector('#backup-retention').addEventListener('input', () => markDirty('backup'));

    el.querySelector('#btn-backup-now').addEventListener('click', async () => {
        const btn = el.querySelector('#btn-backup-now');
        btn.disabled = true;
        try {
            const result = await window.backup.export();
            el.querySelector('#backup-last-info').textContent =
                `Last backup: ${new Date(result.exportedAt).toLocaleString()}`;
            showToast(`Backup saved to ${result.filePath}`, 'success');
        } catch (e) {
            showToast('Backup failed. Check error logs.', 'error');
        } finally {
            btn.disabled = false;
        }
    });

    el.querySelector('#btn-backup-folder').addEventListener('click', async () => {
        const chosen = await window.backup.chooseFolder();
        if (!chosen) return;
        const current = await window.electronStore.get(BACKUP_SETTINGS_KEY) || {};
        await window.electronStore.set(BACKUP_SETTINGS_KEY, { ...current, folder: chosen });
        el.querySelector('#backup-folder-display').textContent = chosen;
    });

    el.querySelector('#btn-save-backup').addEventListener('click', async () => {
        const [hh, mm]   = (el.querySelector('#backup-time').value || '09:00').split(':').map(Number);
        const retention  = Math.min(30, Math.max(1, parseInt(el.querySelector('#backup-retention').value) || 30));
        const dowEl      = el.querySelector('#backup-dow');
        const current    = await window.electronStore.get(BACKUP_SETTINGS_KEY) || {};
        await window.electronStore.set(BACKUP_SETTINGS_KEY, {
            ...current,
            enabled:        el.querySelector('#backup-enabled').checked,
            frequency:      freqSelect.value,
            dayOfWeek:      dowEl ? parseInt(dowEl.value) : 1,
            hour:           hh || 9,
            minute:         mm || 0,
            retentionDays:  retention,
        });
        clearDirty();
        showToast('Backup settings saved.', 'success');
    });
}

function renderRestore(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">Restore</h2>
            <p class="settings-section-desc">Restore your timesheet data from a previously exported file.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form">
                <div class="settings-form-group">
                    <label class="label-text">Restore from Backup File</label>
                    <p class="form-text" style="color:var(--text-secondary)">
                        Import a <code>.json</code> backup file exported by this app.
                        If the backup contains weeks you already have data for, you'll be shown a side-by-side merge review before anything is applied.
                    </p>
                    <button class="btn btn-gradient px-4 mt-1" id="btn-restore-json">
                        <i class="bi bi-file-earmark-code me-1"></i> Choose Backup File (.json)
                    </button>
                </div>
                <hr class="settings-divider">
                <div class="settings-form-group">
                    <label class="label-text">Restore from TXT Report</label>
                    <p class="form-text" style="color:var(--text-secondary)">
                        Import a <code>.txt</code> timesheet report downloaded from this app.
                        Conflicting weeks will go through the same merge review as a JSON restore.
                    </p>
                    <button class="btn btn-gradient px-4 mt-1" id="btn-restore-txt">
                        <i class="bi bi-file-earmark-text me-1"></i> Choose Report File (.txt)
                    </button>
                </div>
            </div>
        </div>`;

    el.querySelector('#btn-restore-json').addEventListener('click', () => openRestoreFromJson());
    el.querySelector('#btn-restore-txt').addEventListener('click', () => openRestoreFromTxt());
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
            <p class="settings-section-desc">Track weekly billable hours across Jira and Service Desk tickets — with AI-powered logging, querying, and week summaries.</p>
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

/* ── AI ─────────────────────────────────────────────────── */

function renderAI(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">AI</h2>
            <p class="settings-section-desc">Configure AI providers and manage intelligent features across the app.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-mgmt-cards">
                <div class="settings-mgmt-card" data-nav="ai-provider">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-cpu"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Provider</div>
                        <div class="settings-mgmt-card-desc">Configure AI provider, API keys, and memory</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
                <div class="settings-mgmt-card" data-nav="ai-features">
                    <div class="settings-mgmt-card-icon">
                        <i class="bi bi-toggles"></i>
                    </div>
                    <div class="settings-mgmt-card-body">
                        <div class="settings-mgmt-card-title">Features</div>
                        <div class="settings-mgmt-card-desc">Enable or disable individual AI capabilities</div>
                    </div>
                    <i class="bi bi-chevron-right settings-mgmt-card-arrow"></i>
                </div>
            </div>
        </div>`;
    el.querySelectorAll('.settings-mgmt-card[data-nav]').forEach(card => {
        card.addEventListener('click', () => navigateTo(card.dataset.nav));
    });
}

async function renderAIProvider(el) {
    const s = await window.ai.getSettings();
    const isLocal = s.provider !== 'cloud';
    const ollamaUrl = s.ollamaUrl || 'http://localhost:11434';
    const savedModel = s.ollamaModel || 'llama3';

    // Fetch available models up-front so the select is populated on first render
    let ollamaModels = [];
    if (isLocal) {
        try { ollamaModels = await window.ai.getOllamaModels(ollamaUrl); } catch (e) { /* offline */ }
    }

    const buildModelOptions = (models, current) => {
        if (!models.length) return `<option value="${escHtml(current)}">${escHtml(current)}</option>`;
        const has = models.includes(current);
        return (has ? '' : `<option value="${escHtml(current)}">${escHtml(current)}</option>`) +
            models.map(m => `<option value="${escHtml(m)}" ${m === current ? 'selected' : ''}>${escHtml(m)}</option>`).join('');
    };

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">AI Provider</h2>
            <p class="settings-section-desc">Select your AI provider and configure connection details.</p>
        </div>
        <div class="settings-section-body">
            <div class="settings-form">
                <div class="settings-form-group">
                    <label class="label-text">Enable AI Features</label>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="ai-enabled" ${s.enabled ? 'checked' : ''} />
                        <label class="form-check-label label-text" for="ai-enabled">
                            Enable AI features globally
                        </label>
                    </div>
                </div>
                <div class="settings-form-group">
                    <label class="label-text">Provider</label>
                    <select id="ai-provider-select" class="form-control dark-input" style="max-width:220px">
                        <option value="local"  ${isLocal   ? 'selected' : ''}>Local (Ollama)</option>
                        <option value="cloud"  ${!isLocal  ? 'selected' : ''}>Cloud</option>
                    </select>
                </div>

                <div id="ai-ollama-block" style="${isLocal ? '' : 'display:none'}">
                    <div class="settings-form-group">
                        <label class="label-text" for="ai-ollama-url">Ollama URL</label>
                        <input type="text" id="ai-ollama-url" class="form-control dark-input"
                            style="max-width:300px"
                            value="${escHtml(ollamaUrl)}" />
                    </div>
                    <div class="settings-form-group">
                        <label class="label-text" for="ai-ollama-model">Model</label>
                        <div class="d-flex align-items-center gap-2">
                            <select id="ai-ollama-model" class="form-control dark-input" style="max-width:260px">
                                ${buildModelOptions(ollamaModels, savedModel)}
                            </select>
                            <button class="btn btn-sm btn-outline-light flex-shrink-0" id="btn-refresh-models" title="Refresh model list">
                                <i class="bi bi-arrow-clockwise"></i>
                            </button>
                        </div>
                        ${ollamaModels.length === 0
                            ? `<p class="form-text mt-1" style="color:var(--text-secondary)">Could not load models — make sure Ollama is running.</p>`
                            : `<p class="form-text mt-1" style="color:var(--text-secondary)">${ollamaModels.length} model${ollamaModels.length > 1 ? 's' : ''} available.</p>`}
                    </div>
                    <div class="settings-form-group">
                        <button class="btn btn-outline-light btn-sm" id="btn-ai-test-local" style="align-self:flex-start">
                            <i class="bi bi-plug me-1"></i> Test Connection
                        </button>
                    </div>
                </div>

                <div id="ai-cloud-block" style="${!isLocal ? '' : 'display:none'}">
                    <div class="settings-form-group">
                        <label class="label-text" for="ai-cloud-provider">Cloud Provider</label>
                        <select id="ai-cloud-provider" class="form-control dark-input" style="max-width:220px">
                            <option value="claude" ${s.cloudProvider === 'claude'  ? 'selected' : ''}>Claude (Anthropic)</option>
                            <option value="openai" ${s.cloudProvider === 'openai'  ? 'selected' : ''}>OpenAI (GPT)</option>
                            <option value="gemini" ${s.cloudProvider === 'gemini'  ? 'selected' : ''}>Google Gemini</option>
                        </select>
                    </div>
                    <div class="settings-form-group">
                        <label class="label-text" for="ai-api-key">API Key</label>
                        <div class="d-flex align-items-center gap-2" style="max-width:400px">
                            <input type="password" id="ai-api-key" class="form-control dark-input"
                                placeholder="Enter API key" />
                            <button type="button" class="btn btn-sm btn-outline-light flex-shrink-0" id="btn-ai-key-toggle"
                                title="Show / hide key" style="width:38px">
                                <i class="bi bi-eye" id="ai-key-eye"></i>
                            </button>
                        </div>
                        <p class="form-text mt-1" id="ai-key-hint" style="color:var(--text-secondary)">Stored securely in the main process. Never visible after saving.</p>
                        <p class="form-text mt-1" id="ai-key-saved-indicator" style="color:var(--success);display:none">
                            <i class="bi bi-check-circle-fill me-1"></i>Key saved — leave blank to keep current key, or enter a new one to replace it.
                        </p>
                    </div>
                    <div class="settings-form-group" id="ai-gemini-model-group" style="${s.cloudProvider === 'gemini' ? '' : 'display:none'}">
                        <label class="label-text" for="ai-gemini-model">Gemini Model</label>
                        <div class="d-flex align-items-center gap-2">
                            <select id="ai-gemini-model" class="form-control dark-input" style="max-width:260px">
                                <option value="${escHtml(s.geminiModel || 'gemini-2.5-flash-lite')}">${escHtml(s.geminiModel || 'gemini-2.5-flash-lite')}</option>
                            </select>
                            <button class="btn btn-sm btn-outline-light flex-shrink-0" id="btn-fetch-gemini-models" title="Fetch available models">
                                <i class="bi bi-arrow-clockwise"></i>
                            </button>
                        </div>
                        <p class="form-text mt-1" style="color:var(--text-secondary)">Enter your API key and click ↺ to load available models.</p>
                    </div>
                    <div class="settings-form-group">
                        <button class="btn btn-outline-light btn-sm" id="btn-ai-test-cloud" style="align-self:flex-start">
                            <i class="bi bi-plug me-1"></i> Test Connection
                        </button>
                    </div>
                </div>

                <hr class="settings-divider">

                <div class="settings-form-group">
                    <label class="label-text">AI Memory</label>
                    <p class="form-text" style="color:var(--text-secondary)">Shared rolling context used across all providers. Cleared entries cannot be recovered.</p>
                    <button class="btn btn-sm mt-1" id="btn-ai-clear-memory"
                        style="border:1px solid var(--danger);color:var(--danger);background:transparent;align-self:flex-start">
                        <i class="bi bi-trash me-1"></i> Clear Memory
                    </button>
                </div>

                <div class="settings-form-actions">
                    <button class="btn btn-gradient px-4" id="btn-save-ai-provider">
                        <i class="bi bi-check-lg me-1"></i> Save
                    </button>
                </div>
            </div>
        </div>`;

    const providerSelect  = el.querySelector('#ai-provider-select');
    const ollamaBlock     = el.querySelector('#ai-ollama-block');
    const cloudBlock      = el.querySelector('#ai-cloud-block');
    const keyInput        = el.querySelector('#ai-api-key');
    const keyEye          = el.querySelector('#ai-key-eye');

    const hasKeyMap = { claude: s.hasClaudeKey, openai: s.hasOpenAIKey, gemini: s.hasGeminiKey };
    const updateKeyIndicator = (cp) => {
        const saved = hasKeyMap[cp];
        el.querySelector('#ai-key-saved-indicator').style.display = saved ? '' : 'none';
        el.querySelector('#ai-key-hint').style.display            = saved ? 'none' : '';
    };
    updateKeyIndicator(s.cloudProvider || 'claude');

    const markDirtyAI = () => markDirty('ai-provider');

    providerSelect.addEventListener('change', async () => {
        const local = providerSelect.value === 'local';
        ollamaBlock.style.display = local ? '' : 'none';
        cloudBlock.style.display  = local ? 'none' : '';
        markDirtyAI();
        // Auto-load models when switching to local
        if (local) {
            const url = el.querySelector('#ai-ollama-url').value.trim() || 'http://localhost:11434';
            const currentModel = el.querySelector('#ai-ollama-model').value;
            let models = [];
            try { models = await window.ai.getOllamaModels(url); } catch (e) { /* offline */ }
            el.querySelector('#ai-ollama-model').innerHTML = buildModelOptions(models, currentModel);
        }
    });

    el.querySelector('#ai-enabled').addEventListener('change', markDirtyAI);
    el.querySelector('#ai-ollama-url').addEventListener('input', markDirtyAI);
    el.querySelector('#ai-ollama-model').addEventListener('change', markDirtyAI);
    el.querySelector('#ai-gemini-model').addEventListener('change', markDirtyAI);
    el.querySelector('#ai-cloud-provider').addEventListener('change', () => {
        const cp = el.querySelector('#ai-cloud-provider').value;
        el.querySelector('#ai-gemini-model-group').style.display = cp === 'gemini' ? '' : 'none';
        // Clear key input and update saved indicator for the newly selected provider
        keyInput.value = '';
        updateKeyIndicator(cp);
        markDirtyAI();
    });

    el.querySelector('#btn-fetch-gemini-models').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.querySelector('i').className = 'bi bi-hourglass-split';
        const apiKey = keyInput.value;
        const currentModel = el.querySelector('#ai-gemini-model').value;
        const models = apiKey ? await window.ai.getGeminiModels(apiKey).catch(() => []) : [];
        const select = el.querySelector('#ai-gemini-model');
        if (models.length) {
            const has = models.includes(currentModel);
            select.innerHTML = (has ? '' : `<option value="${escHtml(currentModel)}">${escHtml(currentModel)}</option>`) +
                models.map(m => `<option value="${escHtml(m)}" ${m === currentModel ? 'selected' : ''}>${escHtml(m)}</option>`).join('');
            el.querySelector('#ai-gemini-model-group .form-text').textContent = `${models.length} model${models.length > 1 ? 's' : ''} available.`;
        } else {
            el.querySelector('#ai-gemini-model-group .form-text').textContent = 'Could not load models. Enter your API key first.';
        }
        btn.disabled = false;
        btn.querySelector('i').className = 'bi bi-arrow-clockwise';
    });

    // Refresh model list from Ollama using the current URL input value
    el.querySelector('#btn-refresh-models').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.querySelector('i').className = 'bi bi-hourglass-split';
        const url = el.querySelector('#ai-ollama-url').value.trim() || 'http://localhost:11434';
        const currentModel = el.querySelector('#ai-ollama-model').value;
        let models = [];
        try { models = await window.ai.getOllamaModels(url); } catch (e) { /* offline */ }
        const select = el.querySelector('#ai-ollama-model');
        select.innerHTML = buildModelOptions(models, currentModel);
        const hint = select.closest('.settings-form-group').querySelector('.form-text');
        if (hint) hint.textContent = models.length
            ? `${models.length} model${models.length > 1 ? 's' : ''} available.`
            : 'Could not load models — make sure Ollama is running.';
        btn.disabled = false;
        btn.querySelector('i').className = 'bi bi-arrow-clockwise';
    });
    keyInput.addEventListener('input', markDirtyAI);

    el.querySelector('#btn-ai-key-toggle').addEventListener('click', () => {
        const isPassword = keyInput.type === 'password';
        keyInput.type = isPassword ? 'text' : 'password';
        keyEye.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
    });

    const runTest = async (btn) => {
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        // Pass current form values so the test reflects what's in the UI, not stale stored settings
        const overrides = {
            provider:      providerSelect.value,
            ollamaUrl:     el.querySelector('#ai-ollama-url').value.trim(),
            ollamaModel:   el.querySelector('#ai-ollama-model').value,
            cloudProvider: el.querySelector('#ai-cloud-provider').value,
            geminiModel:   el.querySelector('#ai-gemini-model').value,
        };
        const apiKeyVal = keyInput.value;
        if (apiKeyVal) {
            const cp = overrides.cloudProvider;
            if (cp === 'claude')  overrides.claudeApiKey  = apiKeyVal;
            if (cp === 'openai')  overrides.openaiApiKey  = apiKeyVal;
            if (cp === 'gemini')  overrides.geminiApiKey  = apiKeyVal;
        }

        const result = await testConnection(overrides);
        btn.disabled = false;
        btn.innerHTML = orig;
        if (result?.ok) {
            showToast('Connection successful.', 'success');
        } else {
            showToast(result?.error || 'Connection failed. Check your settings.', 'danger');
        }
    };

    el.querySelector('#btn-ai-test-local').addEventListener('click', (e) => runTest(e.currentTarget));
    el.querySelector('#btn-ai-test-cloud').addEventListener('click', (e) => runTest(e.currentTarget));

    el.querySelector('#btn-ai-clear-memory').addEventListener('click', () => {
        showConfirm('Clear all AI memory? This cannot be undone.', async () => {
            await window.ai.clearMemory();
            showToast('AI memory cleared.', 'success');
        });
    });

    el.querySelector('#btn-save-ai-provider').addEventListener('click', async () => {
        const patch = {
            enabled:       el.querySelector('#ai-enabled').checked,
            provider:      providerSelect.value,
            ollamaUrl:     el.querySelector('#ai-ollama-url').value.trim(),
            ollamaModel:   el.querySelector('#ai-ollama-model').value.trim(),
            cloudProvider: el.querySelector('#ai-cloud-provider').value,
            geminiModel:   el.querySelector('#ai-gemini-model').value,
        };
        const apiKeyVal = keyInput.value;
        if (apiKeyVal) {
            const cloudProv = patch.cloudProvider;
            if (cloudProv === 'claude')  patch.claudeApiKey  = apiKeyVal;
            if (cloudProv === 'openai')  patch.openaiApiKey  = apiKeyVal;
            if (cloudProv === 'gemini')  patch.geminiApiKey  = apiKeyVal;
        }
        await window.ai.setSettings(patch);
        await refreshSettings();
        // Update hasKeyMap so the indicator reflects the newly saved key
        if (patch.claudeApiKey) hasKeyMap.claude = true;
        if (patch.openaiApiKey) hasKeyMap.openai = true;
        if (patch.geminiApiKey) hasKeyMap.gemini = true;
        keyInput.value = '';
        updateKeyIndicator(patch.cloudProvider);
        clearDirty();
        showToast('AI provider settings saved.', 'success');
    });
}

async function renderAIFeatures(el) {
    const s = await window.ai.getSettings();
    const f = s.features || {};
    const masterOff = !s.enabled;

    const features = [
        { id: 'ai-feat-suggestions', key: 'suggestions',       label: 'Smart suggestions in entry modal',  desc: 'Autocomplete ticket, description, and time estimate as you type.' },
        { id: 'ai-feat-chat',        key: 'chat',              label: 'AI chat sidebar',                   desc: 'Ask questions about your log history in plain English.' },
        { id: 'ai-feat-anomaly',     key: 'anomalyDetection',  label: 'Anomaly & gap detection',           desc: 'Flag unlogged days, unusual hours, and duplicate-looking entries.' },
        { id: 'ai-feat-summary',     key: 'weeklySummary',     label: 'Week summary generator',            desc: 'One-click AI narrative of weekly activity for standups.' },
        { id: 'ai-feat-recurring',   key: 'recurringAdvisor',  label: 'Recurring task advisor',            desc: 'Detect logging patterns and suggest converting them to recurring tasks.' },
        { id: 'ai-feat-report',      key: 'reportEnhancement', label: 'Report enhancement',                desc: 'Optional AI rewrite of entry descriptions in exported reports.' },
    ];

    const togglesHtml = features.map(ft => `
        <div class="settings-form-group">
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="${ft.id}"
                    ${f[ft.key] !== false ? 'checked' : ''} />
                <label class="form-check-label label-text" for="${ft.id}">${escHtml(ft.label)}</label>
            </div>
            <p class="form-text ms-4 ps-1" style="color:var(--text-secondary)">${escHtml(ft.desc)}</p>
        </div>`).join('');

    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">AI Features</h2>
            <p class="settings-section-desc">Enable or disable individual AI capabilities.</p>
        </div>
        <div class="settings-section-body">
            ${masterOff ? `
            <div class="d-flex align-items-center gap-2 mb-4 p-3"
                style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:var(--radius-sm)">
                <i class="bi bi-exclamation-triangle" style="color:var(--warning);flex-shrink:0"></i>
                <span style="font-size:0.85rem;color:var(--text-secondary)">
                    AI features are currently disabled. Enable AI in
                    <button class="btn btn-link p-0 align-baseline" id="btn-goto-provider"
                        style="font-size:0.85rem;color:var(--accent-light);text-decoration:none">Provider settings</button>
                    first.
                </span>
            </div>` : ''}
            <div class="settings-form">
                ${togglesHtml}
                <div class="settings-form-actions">
                    <button class="btn btn-gradient px-4" id="btn-save-ai-features">
                        <i class="bi bi-check-lg me-1"></i> Save
                    </button>
                </div>
            </div>
        </div>`;

    if (masterOff) {
        el.querySelector('#btn-goto-provider')?.addEventListener('click', () => navigateTo('ai-provider'));
    }

    features.forEach(ft => {
        el.querySelector(`#${ft.id}`).addEventListener('change', () => markDirty('ai-features'));
    });

    el.querySelector('#btn-save-ai-features').addEventListener('click', async () => {
        const featPatch = {};
        features.forEach(ft => {
            featPatch[ft.key] = el.querySelector(`#${ft.id}`).checked;
        });
        await window.ai.setSettings({ features: featPatch });
        await refreshSettings();
        clearDirty();
        showToast('AI feature settings saved.', 'success');
    });
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
