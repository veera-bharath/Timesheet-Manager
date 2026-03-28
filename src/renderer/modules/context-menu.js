import { state } from './state.js';
import { saveState } from './store.js';
import { escHtml } from './utils.js';
// Circular — resolved at call time
import { rerenderDayCard } from './render.js';
import { openEntryModal, openEntryModalPreFilled, makeRegularEntry, deleteEntry } from './entry-modal.js';
import { toggleEntryStarred } from './star.js';

let ctxTarget = null;

export function showEntryContextMenu(row, x, y) {
    ctxTarget = {
        dayIdx:    parseInt(row.dataset.day),
        entryIdx:  parseInt(row.dataset.entry),
        groupType: row.dataset.groupType,
        row
    };
    const entry = state.days[ctxTarget.dayIdx]?.entries[ctxTarget.entryIdx];
    if (!entry) return;

    const menu = document.getElementById('entry-context-menu');

    document.getElementById('ctx-sub-ticket').style.display =
        (ctxTarget.groupType === 'normal' || ctxTarget.groupType === 'ticket_group') ? 'flex' : 'none';
    document.getElementById('ctx-sub-desc').style.display =
        (ctxTarget.groupType === 'normal' || ctxTarget.groupType === 'desc_group') ? 'flex' : 'none';
    document.getElementById('ctx-make-regular').style.display = entry.isScheduled ? 'flex' : 'none';

    document.getElementById('ctx-star-label').textContent = entry.starred ? 'Unstar' : 'Star';
    document.getElementById('ctx-star').querySelector('i').className = entry.starred ? 'bi bi-star-fill' : 'bi bi-star';

    menu.classList.remove('ctx-open');
    menu.style.display = 'block';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = (x + mw > vw ? x - mw : x) + 'px';
    menu.style.top  = (y + mh > vh ? y - mh : y) + 'px';
    void menu.offsetWidth;
    menu.classList.add('ctx-open');
}

export function hideContextMenu() {
    document.getElementById('entry-context-menu').style.display = 'none';
    ctxTarget = null;
}

export function initContextMenu() {
    document.getElementById('ctx-edit').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        openEntryModal(dayIdx, entryIdx);
    });

    document.getElementById('ctx-duplicate').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        const original = state.days[dayIdx].entries[entryIdx];
        const copy = { ...original, starred: false };
        state.days[dayIdx].entries.splice(entryIdx + 1, 0, copy);
        rerenderDayCard(dayIdx);
        saveState();
    });

    document.getElementById('ctx-copy-to').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        document.getElementById('modal-day-index').value = dayIdx;
        document.getElementById('modal-entry-index').value = entryIdx;
        document.getElementById('btn-copy-to-entry').click();
    });

    document.getElementById('ctx-sub-ticket').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        openEntryModalPreFilled(dayIdx, entryIdx, 'ticket');
    });

    document.getElementById('ctx-sub-desc').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        openEntryModalPreFilled(dayIdx, entryIdx, 'desc');
    });

    document.getElementById('ctx-make-regular').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        document.getElementById('modal-day-index').value = dayIdx;
        document.getElementById('modal-entry-index').value = entryIdx;
        makeRegularEntry();
    });

    document.getElementById('ctx-star').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx, row } = ctxTarget;
        hideContextMenu();
        toggleEntryStarred(dayIdx, entryIdx, row.querySelector('.entry-btn-star'));
    });

    document.getElementById('ctx-delete').addEventListener('click', () => {
        if (!ctxTarget) return;
        const { dayIdx, entryIdx } = ctxTarget;
        hideContextMenu();
        document.getElementById('modal-day-index').value = dayIdx;
        document.getElementById('modal-entry-index').value = entryIdx;
        deleteEntry();
    });

    document.addEventListener('click', (e) => {
        if (!document.getElementById('entry-context-menu').contains(e.target)) hideContextMenu();
        if (!document.getElementById('entry-quick-view').contains(e.target) &&
            !e.target.closest('.entry-btn-eye')) hideQuickView();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hideContextMenu(); hideQuickView(); }
    });
}

/* ── QUICK VIEW (co-located to share the Escape/outside-click handler) ── */
let quickViewVisible = false;

export function showEntryQuickView(dayIdx, entryIdx, btnEl) {
    const qv = document.getElementById('entry-quick-view');
    if (quickViewVisible && qv.dataset.for === `${dayIdx}-${entryIdx}`) {
        qv.style.display = 'none';
        quickViewVisible = false;
        return;
    }
    const entry = state.days[dayIdx]?.entries[entryIdx];
    if (!entry) return;

    const typeLabel = entry.type === 'servicedesk' ? 'Service Desk' : 'Jira';
    const hhmm = `${String(entry.hh || 0).padStart(2,'0')}:${String(entry.mm || 0).padStart(2,'0')}`;

    qv.innerHTML = `
        <div class="qv-row"><span class="qv-label">Ticket</span><span class="qv-value">${escHtml(entry.ticket || '—')}</span></div>
        <div class="qv-row"><span class="qv-label">Type</span><span class="qv-value">${escHtml(typeLabel)}</span></div>
        <div class="qv-row"><span class="qv-label">Time</span><span class="qv-value">${hhmm}</span></div>
        <div class="qv-row"><span class="qv-label">Desc</span><span class="qv-desc">${escHtml(entry.desc || '—')}</span></div>`;
    qv.dataset.for = `${dayIdx}-${entryIdx}`;

    const rect = btnEl.getBoundingClientRect();
    qv.style.display = 'block';
    const qvw = qv.offsetWidth, qvh = qv.offsetHeight;
    const top = rect.bottom + 6 + qvh > window.innerHeight ? rect.top - qvh - 6 : rect.bottom + 6;
    const left = Math.min(rect.left, window.innerWidth - qvw - 8);
    qv.style.top  = top + 'px';
    qv.style.left = left + 'px';
    quickViewVisible = true;
}

export function hideQuickView() {
    document.getElementById('entry-quick-view').style.display = 'none';
    quickViewVisible = false;
}
