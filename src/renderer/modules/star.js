import { state } from './state.js';
import { saveState } from './store.js';
import { escHtml, fmtSearchDate, fmtHHMM } from './utils.js';
import { getTypeLabel } from './ticket-types.js';
import { navigateToResult } from './search.js';

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
