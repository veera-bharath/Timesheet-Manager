/* =============================================================
   SETTINGS — full-screen modal shell, nav routing, dirty state
   ============================================================= */

import { state } from './state.js';
import { saveState } from './store.js';
import { showToast } from './toast.js';
import { updateSummary } from './summary.js';
import { renderDays } from './render.js';
import { escHtml } from './utils.js';
import { applyTheme } from './theme.js';

/* ── SECTION METADATA ───────────────────────────────────── */
const SECTION_META = {
    'general':      { parent: null,         label: 'General',      isParent: false },
    'appearance':   { parent: null,         label: 'Appearance',   isParent: false },
    'management':   { parent: null,         label: 'Management',   isParent: true  },
    'ticket-types': { parent: 'management', label: 'Ticket Types', isParent: false },
    'leave-types':  { parent: 'management', label: 'Leave Types',  isParent: false },
    'developer':    { parent: null,         label: 'Developer',    isParent: true  },
    'error-logs':   { parent: 'developer',  label: 'Error Logs',   isParent: false },
    'about':        { parent: null,         label: 'About',        isParent: false },
};

/* ── STATE ──────────────────────────────────────────────── */
let currentSection = 'general';
let dirtySection   = null;
let _pendingTarget = null;   // section key or '__close__'
let settingsModalInst = null;

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
        case 'general':      return renderGeneral(el);
        case 'appearance':   return renderAppearance(el);
        case 'management':   return renderManagement(el);
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
                    <button class="settings-theme-btn ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">
                        <i class="bi bi-moon-fill"></i>
                        <span>Dark</span>
                    </button>
                    <button class="settings-theme-btn ${currentTheme === 'light' ? 'active' : ''}" data-theme="light">
                        <i class="bi bi-sun-fill"></i>
                        <span>Light</span>
                    </button>
                </div>
                <p class="form-text mt-2">Changes apply immediately.</p>
            </div>
        </div>`;

    el.querySelectorAll('.settings-theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyTheme(btn.dataset.theme);
            localStorage.setItem('theme', btn.dataset.theme);
        });
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
    el.innerHTML = `
        <div class="settings-section-header">
            <button class="settings-back-btn"><i class="bi bi-arrow-left"></i> Management</button>
            <h2 class="settings-section-title">Ticket Types</h2>
            <p class="settings-section-desc">Configure the ticket types available when adding or editing entries.</p>
        </div>
        <div class="settings-section-body">
            <p class="settings-placeholder">Ticket Types — coming soon.</p>
        </div>`;
    el.querySelector('.settings-back-btn').addEventListener('click', () => navigateTo('management'));
}

function renderLeaveTypes(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <button class="settings-back-btn"><i class="bi bi-arrow-left"></i> Management</button>
            <h2 class="settings-section-title">Leave Types</h2>
            <p class="settings-section-desc">Configure leave and holiday categories for marking days.</p>
        </div>
        <div class="settings-section-body">
            <p class="settings-placeholder">Leave Types — coming soon.</p>
        </div>`;
    el.querySelector('.settings-back-btn').addEventListener('click', () => navigateTo('management'));
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
    el.innerHTML = `
        <div class="settings-section-header">
            <button class="settings-back-btn"><i class="bi bi-arrow-left"></i> Developer</button>
            <h2 class="settings-section-title">Error Logs</h2>
            <p class="settings-section-desc">Application error log for troubleshooting.</p>
        </div>
        <div class="settings-section-body">
            <p class="settings-placeholder">Error Logs — coming soon.</p>
        </div>`;
    el.querySelector('.settings-back-btn').addEventListener('click', () => navigateTo('developer'));
}

function renderAbout(el) {
    el.innerHTML = `
        <div class="settings-section-header">
            <h2 class="settings-section-title">About</h2>
            <p class="settings-section-desc">App information and release history.</p>
        </div>
        <div class="settings-section-body">
            <p class="settings-placeholder">About & Changelog — coming soon.</p>
        </div>`;
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
