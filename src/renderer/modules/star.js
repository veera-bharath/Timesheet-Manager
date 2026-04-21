import { state } from './state.js';
import { saveState } from './store.js';
import { escHtml, fmtSearchDate, fmtHHMM } from './utils.js';
import { getTypeLabel } from './ticket-types.js';
import { navigateToResult } from './search.js';
import { rerenderDayCard } from './render.js';
import { showToast } from './toast.js';

export function toggleEntryStarred(dayIdx, entryIdx, btnEl) {
    const entry = state.days[dayIdx]?.entries[entryIdx];
    if (!entry) return;
    entry.starred = !entry.starred;
    btnEl.classList.toggle('starred', entry.starred);
    btnEl.querySelector('i').className = entry.starred ? 'bi bi-star-fill' : 'bi bi-star';
    btnEl.title = entry.starred ? 'Unstar' : 'Star';
    btnEl.classList.remove('star-pulse');
    void btnEl.offsetWidth;
    btnEl.classList.add('star-pulse');
    setTimeout(() => btnEl.classList.remove('star-pulse'), 300);
    const dateStr = state.days[dayIdx].date;
    if (state.allDaysByDate[dateStr]) {
        state.allDaysByDate[dateStr].entries[entryIdx] = entry;
    }
    saveState();
}

export function toggleEntryLogged(dayIdx, entryIdx, btnEl) {
    const entry = state.days[dayIdx]?.entries[entryIdx];
    if (!entry) return;
    entry.logged = !entry.logged;
    if (entry.logged) delete entry.loggedUpdated; // re-marking clears the updated flag
    btnEl.classList.toggle('logged', entry.logged);
    btnEl.querySelector('i').className = entry.logged ? 'bi bi-journal-check' : 'bi bi-journal';
    btnEl.title = entry.logged ? 'Logged to timesheet — click to unmark' : 'Mark as logged to timesheet';
    const row = btnEl.closest('.entry-row');
    if (row) row.classList.toggle('entry-logged', entry.logged);
    const dateStr = state.days[dayIdx].date;
    if (state.allDaysByDate[dateStr]) {
        state.allDaysByDate[dateStr].entries[entryIdx] = entry;
    }
    saveState();
}

let _lastBulkLog = null;

export function markDayAllLogged(dayIdx) {
    const day = state.days[dayIdx];
    if (!day?.entries?.length) return;

    const unlogged = day.entries
        .map((e, i) => ({ i, wasLoggedUpdated: !!e.loggedUpdated }))
        .filter((_, idx) => !day.entries[idx].logged);

    if (!unlogged.length) return;

    // Snapshot for undo
    _lastBulkLog = { dayIdx, snapshot: unlogged };

    unlogged.forEach(({ i }) => {
        const entry = day.entries[i];
        entry.logged = true;
        delete entry.loggedUpdated;
    });

    const dateStr = day.date;
    if (state.allDaysByDate[dateStr]) {
        state.allDaysByDate[dateStr].entries = day.entries;
    }

    saveState();
    rerenderDayCard(dayIdx);
    _showBulkLogUndoToast(unlogged.length);
}

function _undoBulkLog() {
    if (!_lastBulkLog) return;
    const { dayIdx, snapshot } = _lastBulkLog;
    _lastBulkLog = null;
    const day = state.days[dayIdx];
    if (!day?.entries) return;

    snapshot.forEach(({ i, wasLoggedUpdated }) => {
        day.entries[i].logged = false;
        if (wasLoggedUpdated) day.entries[i].loggedUpdated = true;
    });

    const dateStr = day.date;
    if (state.allDaysByDate[dateStr]) {
        state.allDaysByDate[dateStr].entries = day.entries;
    }

    saveState();
    rerenderDayCard(dayIdx);
    showToast('Bulk log undone.', 'success');
}

function _showBulkLogUndoToast(count) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const existing = document.getElementById('bulk-log-toast');
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', `
    <div id="bulk-log-toast" class="toast toast-custom show align-items-center" role="alert" style="min-width:280px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-journal-check" style="color:#4ade80"></i>
        <span style="font-size:0.85rem">${count} ${count === 1 ? 'entry' : 'entries'} marked as logged.</span>
        <button type="button" class="btn btn-sm btn-outline-light ms-auto py-0 px-2" style="font-size:0.75rem" id="btn-undo-bulk-log">Undo</button>
      </div>
    </div>`);

    const timerId = setTimeout(() => { document.getElementById('bulk-log-toast')?.remove(); }, 5000);

    document.getElementById('btn-undo-bulk-log').addEventListener('click', () => {
        clearTimeout(timerId);
        document.getElementById('bulk-log-toast')?.remove();
        _undoBulkLog();
    });
}

export function renderStarredList() {
    const container = document.getElementById('starred-list');
    const results = [];
    Object.keys(state.allDaysByDate).sort().forEach(dateStr => {
        const day = state.allDaysByDate[dateStr];
        if (!day?.entries) return;
        day.entries.forEach((entry, entryIdx) => {
            if (entry.starred) results.push({ dateStr, entryIdx, entry });
        });
    });

    if (!results.length) {
        container.innerHTML = '<div class="search-no-results py-4">No starred entries yet.</div>';
        return;
    }

    container.innerHTML = results.map((r, i) => {
        const hhmm = fmtHHMM(r.entry.hh, r.entry.mm);
        const typeLabel = getTypeLabel(r.entry.type);
        return `<div class="adv-result-card" data-sidx="${i}">
            <div class="adv-result-line1">
                <span>${escHtml(fmtSearchDate(r.dateStr))} &middot; ${escHtml(r.entry.ticket || '—')} &middot; ${escHtml(typeLabel)}</span>
                <span class="adv-result-hours">${hhmm}</span>
            </div>
            <div class="adv-result-line2">${escHtml(r.entry.desc || '')}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.adv-result-card').forEach((el, i) => {
        el.addEventListener('click', () => {
            bootstrap.Modal.getInstance(document.getElementById('starredModal'))?.hide();
            navigateToResult(results[i].dateStr, results[i].entryIdx);
        });
    });
}
