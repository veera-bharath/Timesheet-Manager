import { state } from './state.js';
import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import { renderStarredList } from './star.js';
import { saveEntry, openEntryModal } from './entry-modal.js';
import { toggleDay, renderAll } from './render.js';
import { changeWeekBy } from './week.js';
import { openPreview, openDayQuickView, doPrint } from './report.js';
import { openSettings, addChangelogEntry } from './settings.js';
import { logError } from './error-log.js';

/* ── SIDEBAR & ABOUT ────────────────────────────────────── */
export function initSidebar() {
    const sidebarEl = document.getElementById('appSidebar');

    const closeSidebar = () => {
        const oc = bootstrap.Offcanvas.getInstance(sidebarEl);
        if (oc) oc.hide(); else new bootstrap.Offcanvas(sidebarEl).hide();
    };

    const settingsBtn = document.getElementById('menu-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            openSettings();
        });
    }


    const starredBtn = document.getElementById('menu-starred');
    if (starredBtn) {
        starredBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            renderStarredList();
            new bootstrap.Modal(document.getElementById('starredModal')).show();
        });
    }

    const cheatsheetBtn = document.getElementById('menu-cheatsheet');
    if (cheatsheetBtn) {
        cheatsheetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            new bootstrap.Modal(document.getElementById('cheatsheetModal')).show();
        });
    }

    const updateBtn = document.getElementById('menu-check-updates');
    if (updateBtn) {
        updateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            showToast('Checking for updates…', 'info');
            setManualUpdateCheck(true);
            window.updater.checkForUpdates();
        });
    }
}

/* ── AUTO-UPDATER ───────────────────────────────────────── */
let manualUpdateCheck = false;

function setManualUpdateCheck(v) { manualUpdateCheck = v; }

export function initUpdater() {
    if (!window.updater) return;

    let downloadToastId = null;

    window.updater.onUpdateAvailable((info) => {
        manualUpdateCheck = false;
        showUpdateToast(
            `v${info.version} is available.`,
            'Download',
            () => {
                downloadToastId = showProgressToast('Downloading update… 0%');
                window.updater.downloadUpdate();
            }
        );
    });

    window.updater.onUpdateNotAvailable(() => {
        if (manualUpdateCheck) showToast('You\'re on the latest version.', 'success');
        manualUpdateCheck = false;
    });

    window.updater.onDownloadProgress((progress) => {
        const pct = Math.round(progress.percent);
        if (downloadToastId) {
            const el = document.getElementById(downloadToastId + '-msg');
            if (el) el.textContent = `Downloading update… ${pct}%`;
        }
    });

    window.updater.onUpdateDownloaded((info) => {
        if (downloadToastId) {
            document.getElementById(downloadToastId)?.remove();
            downloadToastId = null;
        }
        addChangelogEntry(info.version, info.releaseNotes || '');
        showUpdateToast(
            `v${info.version} ready to install.`,
            'Restart & Install',
            () => window.updater.installUpdate()
        );
    });

    window.updater.onError((err) => {
        logError('update', err || new Error('Updater error'));
        if (manualUpdateCheck) {
            showToast('Update check failed.', 'danger');
            manualUpdateCheck = false;
        } else if (downloadToastId) {
            document.getElementById(downloadToastId)?.remove();
            downloadToastId = null;
            showToast('Failed to download update.', 'danger');
        }
    });
}

function showUpdateToast(message, actionLabel, onAction) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-update-' + Date.now();
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:300px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-cloud-arrow-down" style="color:var(--success)"></i>
        <span style="font-size:0.85rem;flex:1">${escHtml(message)}</span>
        <button type="button" class="btn btn-sm btn-gradient ms-auto py-0 px-2" style="font-size:0.75rem" id="${id}-action">${escHtml(actionLabel)}</button>
        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" style="font-size:0.75rem" id="${id}-dismiss">✕</button>
      </div>
    </div>`);
    document.getElementById(`${id}-action`).addEventListener('click', () => {
        document.getElementById(id)?.remove();
        onAction();
    });
    document.getElementById(`${id}-dismiss`).addEventListener('click', () => {
        document.getElementById(id)?.remove();
    });
}

function showProgressToast(initialMessage) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-progress-' + Date.now();
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:300px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-cloud-arrow-down" style="color:var(--info)"></i>
        <span id="${id}-msg" style="font-size:0.85rem;flex:1">${escHtml(initialMessage)}</span>
      </div>
    </div>`);
    return id;
}

/* ── KEYBOARD SHORTCUTS ─────────────────────────────────── */
export function initKeyboard() {
    document.addEventListener('keydown', e => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const modalOpen = document.querySelector('.modal.show');

        if (modalOpen) {
            if (e.key === 'Enter' && modalOpen.id === 'entryModal') {
                e.preventDefault();
                saveEntry();
            }
            return;
        }

        const expandedIdx = state.days.findIndex(d => d.expanded);

        switch (e.key) {
            case 'n':
            case 'N':
                if (expandedIdx !== -1) openEntryModal(expandedIdx, -1);
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (expandedIdx > 0) toggleDay(expandedIdx - 1);
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (expandedIdx < state.days.length - 1) toggleDay(expandedIdx + 1);
                break;

            case 'ArrowLeft':
                e.preventDefault();
                changeWeekBy(-1);
                break;

            case 'ArrowRight':
                e.preventDefault();
                changeWeekBy(1);
                break;

            case 'p':
            case 'P':
                if (!e.ctrlKey) openPreview();
                break;

            case 'q':
            case 'Q':
                if (expandedIdx !== -1) {
                    const day = state.days[expandedIdx];
                    if (day.entries && day.entries.length > 0) openDayQuickView(expandedIdx);
                }
                break;

            case '?':
                new bootstrap.Modal(document.getElementById('cheatsheetModal')).show();
                break;
        }

        if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            doPrint();
        }
    });
}
