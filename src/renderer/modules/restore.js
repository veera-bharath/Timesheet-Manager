/* =============================================================
   RESTORE — JSON backup restore with conflict resolution
   ============================================================= */

import { state } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { escHtml } from './utils.js';
import { renderAll } from './render.js';
import { updateSummary } from './summary.js';
import { buildWeekDays, getDateFromWeek } from './week.js';

let _modalInst  = null;
let _cleanDays  = {};
let _resolutions = [];  // [{ date, currentDay, incomingDay, same[], conflicts[], mineOnly[], theirsOnly[] }]

/* ── PUBLIC ENTRY POINTS ────────────────────────────────────── */
export async function openRestoreFromTxt() {
    let parsed;
    try {
        parsed = await window.backup.openTxtFile();
    } catch (e) {
        showToast('Could not read file. Is this a Timesheet Manager report?', 'danger');
        return;
    }
    if (!parsed) return; // user cancelled

    if (parsed.error) {
        showToast(`${parsed.error} Is this a Timesheet Manager report?`, 'danger');
        return;
    }

    const incoming = parsed;
    if (typeof incoming !== 'object' || Object.keys(incoming).length === 0) {
        showToast('No timesheet data found in this file. Is this a Timesheet Manager report?', 'danger');
        return;
    }

    const { cleanDays, conflictDays } = _diffBackup(incoming);
    const totalDays = Object.keys(cleanDays).length + conflictDays.length;

    if (conflictDays.length === 0) {
        showConfirm(
            `Restore ${totalDays} day(s) from TXT report with no conflicts. Existing entries for these days will be overwritten. Proceed?`,
            () => _applyRestore(cleanDays)
        );
        return;
    }

    _cleanDays   = cleanDays;
    _resolutions = conflictDays.map(({ date, current, incoming: inc }) =>
        _buildResolution(date, current, inc));
    _showModal();
}

export async function openRestoreFromJson() {
    let parsed;
    try {
        parsed = await window.backup.openJsonFile();
    } catch (e) {
        showToast('Could not read file. Is this a valid backup?', 'danger');
        return;
    }
    if (!parsed) return; // user cancelled

    if (!parsed.data || typeof parsed.data !== 'object') {
        showToast('Invalid backup file — missing data field.', 'danger');
        return;
    }

    const incoming = parsed.data.allDaysByDate || {};
    if (Object.keys(incoming).length === 0) {
        showToast('Backup file contains no timesheet data.', 'danger');
        return;
    }

    const { cleanDays, conflictDays } = _diffBackup(incoming);
    const totalDays = Object.keys(cleanDays).length + conflictDays.length;

    if (conflictDays.length === 0) {
        showConfirm(
            `Restore ${totalDays} day(s) from backup with no conflicts. Existing entries for these days will be overwritten. Proceed?`,
            () => _applyRestore(cleanDays)
        );
        return;
    }

    _cleanDays   = cleanDays;
    _resolutions = conflictDays.map(({ date, current, incoming: inc }) =>
        _buildResolution(date, current, inc));
    _showModal();
}

/* ── DIFF ───────────────────────────────────────────────────── */
function _diffBackup(incoming) {
    const current     = state.allDaysByDate;
    const cleanDays   = {};
    const conflictDays = [];

    for (const [date, incomingDay] of Object.entries(incoming)) {
        if (!incomingDay) continue;
        const currentDay        = current[date];
        const hasCurrentEntries = currentDay && (currentDay.entries || []).length > 0;

        if (!hasCurrentEntries) {
            cleanDays[date] = incomingDay;
            continue;
        }

        if (_daysIdentical(currentDay, incomingDay)) {
            cleanDays[date] = incomingDay;
        } else {
            conflictDays.push({ date, current: currentDay, incoming: incomingDay });
        }
    }

    conflictDays.sort((a, b) => a.date < b.date ? -1 : 1);
    return { cleanDays, conflictDays };
}

function _daysIdentical(a, b) {
    const sort = arr => [...(arr || [])].sort((x, y) =>
        JSON.stringify(x) < JSON.stringify(y) ? -1 : 1);
    return JSON.stringify(sort(a.entries)) === JSON.stringify(sort(b.entries)) &&
           !!a.isHoliday === !!b.isHoliday &&
           (a.holidayLabel || '') === (b.holidayLabel || '');
}

function _entryKey(e) {
    return `${(e.ticket || '').toLowerCase()}|${e.type || ''}`;
}

function _entriesIdentical(a, b) {
    return a.ticket === b.ticket && a.hh === b.hh && a.mm === b.mm &&
           a.type  === b.type   && (a.desc || '') === (b.desc || '');
}

function _buildResolution(date, currentDay, incomingDay) {
    const currentEntries  = currentDay.entries  || [];
    const incomingEntries = incomingDay.entries || [];

    const same       = [];
    const conflicts  = [];
    const mineOnly   = [];
    const theirsOnly = [];

    const usedCurrentIdx  = new Set();
    const usedIncomingIdx = new Set();

    // Pass 1: exact matches → same (auto-kept)
    incomingEntries.forEach((theirs, i) => {
        const j = currentEntries.findIndex((mine, idx) =>
            !usedCurrentIdx.has(idx) && _entriesIdentical(mine, theirs));
        if (j >= 0) {
            same.push(theirs);
            usedCurrentIdx.add(j);
            usedIncomingIdx.add(i);
        }
    });

    // Pass 2: same ticket+type but different values → conflict
    incomingEntries.forEach((theirs, i) => {
        if (usedIncomingIdx.has(i)) return;
        const key = _entryKey(theirs);
        const j   = currentEntries.findIndex((mine, idx) =>
            !usedCurrentIdx.has(idx) && _entryKey(mine) === key);
        if (j >= 0) {
            conflicts.push({ mine: currentEntries[j], theirs, choice: 'theirs' });
            usedCurrentIdx.add(j);
            usedIncomingIdx.add(i);
        }
    });

    // Pass 3: remaining incoming → theirs-only (new in backup)
    incomingEntries.forEach((entry, i) => {
        if (!usedIncomingIdx.has(i)) theirsOnly.push({ entry, keep: true });
    });

    // Pass 4: remaining current → mine-only (removed in backup)
    currentEntries.forEach((entry, j) => {
        if (!usedCurrentIdx.has(j)) mineOnly.push({ entry, keep: false });
    });

    return { date, currentDay, incomingDay, same, conflicts, mineOnly, theirsOnly };
}

/* ── MODAL LIFECYCLE ────────────────────────────────────────── */
function _showModal() {
    const modalEl = document.getElementById('restoreConflictModal');
    if (!_modalInst) {
        _modalInst = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
        document.getElementById('btn-rc-close').addEventListener('click',   () => _modalInst.hide());
        document.getElementById('btn-rc-cancel').addEventListener('click',  () => _modalInst.hide());
        document.getElementById('btn-rc-back').addEventListener('click',    _showConflictView);
        document.getElementById('btn-rc-preview').addEventListener('click', _showPreviewView);
        document.getElementById('btn-rc-confirm').addEventListener('click', _confirmRestore);
    }
    _showConflictView();
    _modalInst.show();
}

function _showConflictView() {
    const cleanCount    = Object.keys(_cleanDays).length;
    const conflictCount = _resolutions.length;
    document.getElementById('rc-modal-title').textContent    = 'Restore — Review Conflicts';
    document.getElementById('rc-modal-subtitle').textContent =
        `${conflictCount} day(s) need review · ${cleanCount} day(s) will merge automatically`;
    document.getElementById('btn-rc-preview').style.display = '';
    document.getElementById('btn-rc-confirm').style.display = 'none';
    document.getElementById('btn-rc-back').style.display    = 'none';
    _renderConflictBody();
}

function _showPreviewView() {
    document.getElementById('rc-modal-title').textContent    = 'Restore — Preview';
    document.getElementById('rc-modal-subtitle').textContent = 'Review the final result before applying.';
    document.getElementById('btn-rc-preview').style.display = 'none';
    document.getElementById('btn-rc-confirm').style.display = '';
    document.getElementById('btn-rc-back').style.display    = '';
    _renderPreviewBody();
}

/* ── CONFLICT BODY ──────────────────────────────────────────── */
function _renderConflictBody() {
    const body = document.getElementById('rc-modal-body');
    const cleanCount = Object.keys(_cleanDays).length;

    const daysHtml = _resolutions.map((res, dayIdx) => {
        const hasChoices = res.conflicts.length > 0 || res.mineOnly.length > 0 || res.theirsOnly.length > 0;
        return `
        <div class="rc-day-block">
            <div class="rc-day-header">
                <span class="rc-day-label">${escHtml(_fmtDate(res.date))}</span>
                ${hasChoices ? `
                <div class="rc-day-shortcuts">
                    <button class="btn btn-sm btn-outline-light rc-use-mine" data-day="${dayIdx}">Use all mine</button>
                    <button class="btn btn-sm btn-outline-light rc-use-theirs" data-day="${dayIdx}">Use all theirs</button>
                </div>` : ''}
            </div>
            <div class="rc-entries">
                ${_renderSameEntries(res.same)}
                ${res.conflicts.map((c, ci) => _renderConflictEntry(dayIdx, ci, c)).join('')}
                ${res.mineOnly.map((m, mi) => _renderMineOnlyEntry(dayIdx, mi, m)).join('')}
                ${res.theirsOnly.map((t, ti) => _renderTheirsOnlyEntry(dayIdx, ti, t)).join('')}
            </div>
        </div>`;
    }).join('');

    const cleanNote = cleanCount > 0 ? `
        <div class="rc-clean-note">
            <i class="bi bi-check-circle-fill me-2" style="color:var(--success)"></i>
            ${cleanCount} additional day(s) will be merged automatically with no conflicts.
        </div>` : '';

    body.innerHTML = daysHtml + cleanNote;
    _bindConflictEvents(body);
}

function _renderSameEntries(entries) {
    return entries.map(e => `
        <div class="rc-entry rc-entry-same">
            <i class="bi bi-check2 rc-entry-icon" style="color:var(--success)"></i>
            <span class="rc-entry-ticket">${escHtml(e.ticket || '—')}</span>
            <span class="rc-entry-time">${escHtml(e.hh || '0')}h ${escHtml(e.mm || '00')}m</span>
            <span class="rc-entry-type">${escHtml(e.type || '')}</span>
            <span class="rc-entry-desc">${escHtml(e.desc || '')}</span>
            <span class="rc-entry-badge rc-badge-same">Unchanged</span>
        </div>`).join('');
}

function _renderConflictEntry(dayIdx, ci, { mine, theirs, choice }) {
    return `
    <div class="rc-entry-conflict">
        <div class="rc-conflict-label">
            <i class="bi bi-exclamation-triangle-fill me-1" style="color:var(--warning)"></i>
            Conflict — ${escHtml(theirs.ticket || mine.ticket || '—')}
        </div>
        <div class="rc-conflict-sides">
            <div class="rc-conflict-side ${choice === 'mine' || choice === 'both' ? 'rc-side-selected' : 'rc-side-dim'}">
                <div class="rc-side-header">Current (mine)</div>
                <div class="rc-side-entry">
                    <span class="rc-entry-time">${escHtml(mine.hh || '0')}h ${escHtml(mine.mm || '00')}m</span>
                    <span class="rc-entry-type">${escHtml(mine.type || '')}</span>
                    <span class="rc-entry-desc">${escHtml(mine.desc || '')}</span>
                </div>
            </div>
            <div class="rc-conflict-side ${choice === 'theirs' || choice === 'both' ? 'rc-side-selected' : 'rc-side-dim'}">
                <div class="rc-side-header">Backup (theirs)</div>
                <div class="rc-side-entry">
                    <span class="rc-entry-time">${escHtml(theirs.hh || '0')}h ${escHtml(theirs.mm || '00')}m</span>
                    <span class="rc-entry-type">${escHtml(theirs.type || '')}</span>
                    <span class="rc-entry-desc">${escHtml(theirs.desc || '')}</span>
                </div>
            </div>
        </div>
        <div class="rc-conflict-actions">
            <button class="btn btn-sm rc-choice-btn ${choice === 'mine'   ? 'active' : ''}" data-day="${dayIdx}" data-ci="${ci}" data-choice="mine">Keep Mine</button>
            <button class="btn btn-sm rc-choice-btn ${choice === 'theirs' ? 'active' : ''}" data-day="${dayIdx}" data-ci="${ci}" data-choice="theirs">Keep Theirs</button>
            <button class="btn btn-sm rc-choice-btn ${choice === 'both'   ? 'active' : ''}" data-day="${dayIdx}" data-ci="${ci}" data-choice="both">Keep Both</button>
        </div>
    </div>`;
}

function _renderMineOnlyEntry(dayIdx, mi, { entry, keep }) {
    return `
    <div class="rc-entry ${keep ? 'rc-entry-kept' : 'rc-entry-discarded'}">
        <i class="bi bi-dash-circle rc-entry-icon" style="color:var(--text-muted)"></i>
        <span class="rc-entry-ticket">${escHtml(entry.ticket || '—')}</span>
        <span class="rc-entry-time">${escHtml(entry.hh || '0')}h ${escHtml(entry.mm || '00')}m</span>
        <span class="rc-entry-type">${escHtml(entry.type || '')}</span>
        <span class="rc-entry-desc">${escHtml(entry.desc || '')}</span>
        <span class="rc-entry-badge rc-badge-mine">Mine only</span>
        <button class="btn btn-sm rc-toggle-mine ${keep ? 'active' : ''}" data-day="${dayIdx}" data-mi="${mi}">
            ${keep ? 'Keep' : 'Discard'}
        </button>
    </div>`;
}

function _renderTheirsOnlyEntry(dayIdx, ti, { entry, keep }) {
    return `
    <div class="rc-entry ${keep ? 'rc-entry-kept' : 'rc-entry-discarded'}">
        <i class="bi bi-plus-circle rc-entry-icon" style="color:var(--accent-light)"></i>
        <span class="rc-entry-ticket">${escHtml(entry.ticket || '—')}</span>
        <span class="rc-entry-time">${escHtml(entry.hh || '0')}h ${escHtml(entry.mm || '00')}m</span>
        <span class="rc-entry-type">${escHtml(entry.type || '')}</span>
        <span class="rc-entry-desc">${escHtml(entry.desc || '')}</span>
        <span class="rc-entry-badge rc-badge-theirs">New in backup</span>
        <button class="btn btn-sm rc-toggle-theirs ${keep ? 'active' : ''}" data-day="${dayIdx}" data-ti="${ti}">
            ${keep ? 'Include' : 'Skip'}
        </button>
    </div>`;
}

function _bindConflictEvents(body) {
    body.querySelectorAll('.rc-use-mine').forEach(btn => {
        btn.addEventListener('click', () => {
            const res = _resolutions[+btn.dataset.day];
            res.conflicts.forEach(c  => { c.choice = 'mine'; });
            res.mineOnly.forEach(m   => { m.keep   = true;   });
            res.theirsOnly.forEach(t => { t.keep   = false;  });
            _renderConflictBody();
        });
    });

    body.querySelectorAll('.rc-use-theirs').forEach(btn => {
        btn.addEventListener('click', () => {
            const res = _resolutions[+btn.dataset.day];
            res.conflicts.forEach(c  => { c.choice = 'theirs'; });
            res.mineOnly.forEach(m   => { m.keep   = false;    });
            res.theirsOnly.forEach(t => { t.keep   = true;     });
            _renderConflictBody();
        });
    });

    body.querySelectorAll('.rc-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _resolutions[+btn.dataset.day].conflicts[+btn.dataset.ci].choice = btn.dataset.choice;
            _renderConflictBody();
        });
    });

    body.querySelectorAll('.rc-toggle-mine').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = _resolutions[+btn.dataset.day].mineOnly[+btn.dataset.mi];
            m.keep = !m.keep;
            _renderConflictBody();
        });
    });

    body.querySelectorAll('.rc-toggle-theirs').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = _resolutions[+btn.dataset.day].theirsOnly[+btn.dataset.ti];
            t.keep = !t.keep;
            _renderConflictBody();
        });
    });
}

/* ── PREVIEW BODY ───────────────────────────────────────────── */
function _renderPreviewBody() {
    const body       = document.getElementById('rc-modal-body');
    const merged     = _buildMergedDays();
    const cleanCount = Object.keys(_cleanDays).length;

    const resolvedHtml = _resolutions.map(res => {
        const entries = merged[res.date]?.entries || [];
        return `
        <div class="rc-preview-day">
            <div class="rc-preview-day-header">${escHtml(_fmtDate(res.date))}</div>
            ${entries.length === 0
                ? '<div class="rc-preview-entry rc-preview-empty">No entries</div>'
                : entries.map(e => `
                    <div class="rc-preview-entry">
                        <span class="rc-entry-ticket">${escHtml(e.ticket || '—')}</span>
                        <span class="rc-entry-time">${escHtml(e.hh || '0')}h ${escHtml(e.mm || '00')}m</span>
                        <span class="rc-entry-type">${escHtml(e.type || '')}</span>
                        <span class="rc-entry-desc">${escHtml(e.desc || '')}</span>
                    </div>`).join('')}
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="rc-preview-summary">
            <i class="bi bi-check2-all me-2" style="color:var(--success)"></i>
            <strong>${_resolutions.length}</strong> conflict day(s) resolved &nbsp;·&nbsp;
            <strong>${cleanCount}</strong> day(s) auto-merged &nbsp;·&nbsp;
            <strong>${_resolutions.length + cleanCount}</strong> total days ready to restore
        </div>
        <p class="rc-preview-section-title">Resolved days — final entries</p>
        ${resolvedHtml}
        ${cleanCount > 0 ? `<div class="rc-clean-note mt-3"><i class="bi bi-check-circle-fill me-2" style="color:var(--success)"></i>${cleanCount} additional day(s) merged automatically.</div>` : ''}`;
}

/* ── MERGE & APPLY ──────────────────────────────────────────── */
function _buildMergedDays() {
    const merged = { ..._cleanDays };

    for (const res of _resolutions) {
        const entries = [
            ...res.same,
            ...res.conflicts.flatMap(c => {
                if (c.choice === 'mine')   return [c.mine];
                if (c.choice === 'theirs') return [c.theirs];
                return [c.mine, c.theirs]; // both
            }),
            ...res.mineOnly.filter(m  => m.keep).map(m  => m.entry),
            ...res.theirsOnly.filter(t => t.keep).map(t => t.entry),
        ];
        merged[res.date] = { ...res.incomingDay, entries };
    }

    return merged;
}

async function _confirmRestore() {
    _modalInst.hide();
    await _applyRestore(_buildMergedDays());
}

async function _applyRestore(mergedDays) {
    try {
        state.allDaysByDate = { ...state.allDaysByDate, ...mergedDays };
        // Rebuild state.days so renderAll picks up the restored day objects
        // for the currently displayed week (spread creates new objects, old
        // references in state.days would otherwise still point to stale data).
        if (state.weekValue) {
            state.days = buildWeekDays(getDateFromWeek(state.weekValue));
        }
        await saveState();
        renderAll();
        updateSummary();
        showToast('Restore complete.', 'success');
    } catch (e) {
        showToast('Restore failed. Check error logs.', 'danger');
    }
}

/* ── UTILS ──────────────────────────────────────────────────── */
function _fmtDate(dateStr) {
    try {
        return new Date(dateStr + 'T00:00:00')
            .toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { return dateStr; }
}
