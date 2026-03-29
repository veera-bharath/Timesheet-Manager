import { state, WEEK_DAYS } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { updateSummary } from './summary.js';
import { populateTypeSelect } from './ticket-types.js';
// Circular — resolved at call time
import { rerenderDayCard, renderAll } from './render.js';

let entryModal;
export let lastDeleted = null;

export function initEntryModal() {
    entryModal = new bootstrap.Modal(document.getElementById('entryModal'));
}

export function openEntryModal(dayIdx, entryIdx) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = entryIdx;

    const deleteBtn = document.getElementById('btn-delete-entry');
    const copyToBtn = document.getElementById('btn-copy-to-entry');
    const makeRegularBtn = document.getElementById('btn-make-regular');
    const title = document.getElementById('entryModalLabel');

    if (entryIdx === -1) {
        clearEntryModal();
        deleteBtn.style.display = 'none';
        copyToBtn.style.display = 'none';
        makeRegularBtn.style.display = 'none';
        title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Entry — ${WEEK_DAYS[dayIdx]}`;
    } else {
        const e = state.days[dayIdx].entries[entryIdx];
        document.getElementById('modal-ticket').value = e.ticket || '';
        document.getElementById('modal-hh').value = e.hh ?? 0;
        document.getElementById('modal-mm').value = String(e.mm ?? 0).padStart(2, '0');
        populateTypeSelect(document.getElementById('modal-type'), e.type || state.ticketTypes[0]?.id || 'jira');
        document.getElementById('modal-desc').value = e.desc || '';
        document.getElementById('modal-group-id').value = e.groupId || '';
        document.getElementById('modal-group-type-ref').value = e.groupType || '';
        deleteBtn.style.display = 'inline-flex';
        if (e.isScheduled) {
            makeRegularBtn.style.display = 'inline-flex';
            copyToBtn.style.display = 'none';
            title.innerHTML = `<i class="bi bi-clock me-2"></i>Edit Scheduled Entry — ${WEEK_DAYS[dayIdx]}`;
        } else {
            makeRegularBtn.style.display = 'none';
            copyToBtn.style.display = 'inline-flex';
            title.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Edit Entry — ${WEEK_DAYS[dayIdx]}`;
        }
    }

    updateEntryDayTotal();
    entryModal.show();
}

export function updateEntryDayTotal() {
    const indicator = document.getElementById('entry-day-total');
    const dayIdx  = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (isNaN(dayIdx) || dayIdx < 0 || !state.days[dayIdx]) { indicator.style.display = 'none'; return; }

    const entries = state.days[dayIdx].entries || [];
    const baseMins = entries.reduce((sum, e, i) => {
        if (i === entryIdx) return sum;
        return sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
    }, 0);

    const addHH = parseInt(document.getElementById('modal-hh').value) || 0;
    const addMM = parseInt(document.getElementById('modal-mm').value) || 0;
    const addMins = addHH * 60 + addMM;
    const newTotalMins = baseMins + addMins;

    const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const isOver = newTotalMins > (state.dailyTargetMins || 480);

    indicator.style.display = 'flex';
    indicator.innerHTML = `<i class="bi bi-clock"></i>
        <span>${fmt(baseMins)}</span>
        <span class="total-arrow">→</span>
        <span class="total-new ${isOver ? 'over' : 'ok'}">${fmt(newTotalMins)}</span>
        ${isOver ? '<span class="total-arrow">(over target)</span>' : ''}`;
}

export function openEntryModalPreFilled(dayIdx, fromEntryIdx, keepField) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = -1;

    const deleteBtn = document.getElementById('btn-delete-entry');
    const title = document.getElementById('entryModalLabel');
    deleteBtn.style.display = 'none';
    document.getElementById('btn-make-regular').style.display = 'none';
    title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Sub-Entry — ${WEEK_DAYS[dayIdx]}`;

    clearEntryModal();

    const e = state.days[dayIdx].entries[fromEntryIdx];
    if (!e.groupId) {
        e.groupId = 'grp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        e.groupType = keepField === 'ticket' ? 'ticket_group' : 'desc_group';
        saveState();
    }

    document.getElementById('modal-group-id').value = e.groupId;
    document.getElementById('modal-group-type-ref').value = e.groupType;

    if (keepField === 'ticket') {
        document.getElementById('modal-ticket').value = e.ticket || '';
        populateTypeSelect(document.getElementById('modal-type'), e.type || state.ticketTypes[0]?.id || 'jira');
    } else if (keepField === 'desc') {
        document.getElementById('modal-desc').value = e.desc || '';
    }

    updateEntryDayTotal();
    entryModal.show();
}

export function clearEntryModal() {
    document.getElementById('modal-ticket').value = '';
    document.getElementById('modal-hh').value = '';
    document.getElementById('modal-mm').value = '00';
    populateTypeSelect(document.getElementById('modal-type'), state.ticketTypes[0]?.id || 'jira');
    document.getElementById('modal-desc').value = '';
    document.getElementById('modal-group-id').value = '';
    document.getElementById('modal-group-type-ref').value = '';
}

export function saveEntryInternal() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    const hhInput = document.getElementById('modal-hh');
    const mmInput = document.getElementById('modal-mm');
    const ticketInput = document.getElementById('modal-ticket');
    const descInput = document.getElementById('modal-desc');

    const hh = parseInt(hhInput.value) || 0;
    const mm = parseInt(mmInput.value) || 0;
    const tkt = ticketInput.value.trim();
    const desc = descInput.value.trim();

    let hasError = false;

    [ticketInput, descInput, hhInput, mmInput].forEach(el => el.classList.remove('is-invalid'));

    if (!tkt) { ticketInput.classList.add('is-invalid'); hasError = true; }
    if (!desc) { descInput.classList.add('is-invalid'); hasError = true; }
    if (hh === 0 && mm === 0) {
        hhInput.classList.add('is-invalid');
        mmInput.classList.add('is-invalid');
        hasError = true;
    }

    if (hasError) {
        showToast('Please fill in all required fields (Ticket, Description, Time).', 'danger');
    }

    if (hh > 24) {
        hhInput.classList.add('is-invalid');
        showToast('Hours cannot exceed 24.', 'danger');
        hasError = true;
    }
    if (mm > 59) {
        mmInput.classList.add('is-invalid');
        showToast('Minutes cannot exceed 59.', 'danger');
        hasError = true;
    }

    if (hasError) return false;

    let totalMinsForDay = (hh * 60) + mm;
    const day = state.days[dayIdx];

    if (day && day.entries) {
        day.entries.forEach((existingEntry, idx) => {
            if (idx !== entryIdx) {
                totalMinsForDay += (parseInt(existingEntry.hh) || 0) * 60 + (parseInt(existingEntry.mm) || 0);
            }
        });
    }

    if (totalMinsForDay > state.dailyTargetMins) {
        const totalH = Math.floor(totalMinsForDay / 60);
        const totalM = totalMinsForDay % 60;
        const targetH = Math.floor(state.dailyTargetMins / 60);
        const targetM = state.dailyTargetMins % 60;
        const targetLabel = targetM > 0 ? `${targetH}h ${targetM}m` : `${targetH}h`;
        showConfirm(
            `This entry will bring your total for the day to ${totalH}h ${totalM}m — over the ${targetLabel} target. Continue?`,
            () => commitEntry(dayIdx, entryIdx)
        );
        return false;
    }

    commitEntry(dayIdx, entryIdx);
    return true;
}

export function commitEntry(dayIdx, entryIdx) {
    const groupId = document.getElementById('modal-group-id').value;
    const groupType = document.getElementById('modal-group-type-ref').value;
    const tkt = document.getElementById('modal-ticket').value.trim();
    const hh = parseInt(document.getElementById('modal-hh').value) || 0;
    const mm = parseInt(document.getElementById('modal-mm').value) || 0;
    const type = document.getElementById('modal-type').value;
    const desc = document.getElementById('modal-desc').value.trim();

    const entry = { ticket: tkt, hh, mm, type, desc };
    if (groupId) { entry.groupId = groupId; entry.groupType = groupType; }

    if (entryIdx === -1) {
        state.days[dayIdx].entries.push(entry);
    } else {
        const existing = state.days[dayIdx].entries[entryIdx];
        if (existing && existing.recurringId) entry.recurringId = existing.recurringId;
        if (existing && existing.isScheduled) entry.isScheduled = existing.isScheduled;
        state.days[dayIdx].entries[entryIdx] = entry;
    }

    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    entryModal.hide();
}

export function saveEntry() {
    if (saveEntryInternal()) {
        entryModal.hide();
    }
}

export function deleteEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;

    entryModal.hide();

    if (lastDeleted) {
        clearTimeout(lastDeleted.timerId);
        saveState();
    }

    const deletedEntry = state.days[dayIdx].entries[entryIdx];
    const rowEl = document.querySelector(`.entry-row[data-day="${dayIdx}"][data-entry="${entryIdx}"]`);

    if (rowEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        rowEl.classList.add('entry-removing');
        setTimeout(() => {
            finishDeleteEntry(dayIdx, entryIdx, deletedEntry);
        }, 250);
    } else {
        finishDeleteEntry(dayIdx, entryIdx, deletedEntry);
    }
}

export function finishDeleteEntry(dayIdx, entryIdx, deletedEntry) {
    state.days[dayIdx].entries.splice(entryIdx, 1);
    rerenderDayCard(dayIdx);
    updateSummary();

    const timerId = setTimeout(() => {
        lastDeleted = null;
        saveState();
    }, 5000);

    lastDeleted = { dayIdx, entryIdx, entry: deletedEntry, timerId };
    showUndoToast();
}

export function makeRegularEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;
    const entry = state.days[dayIdx].entries[entryIdx];
    delete entry.isScheduled;
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    entryModal.hide();
    showToast('Entry converted to a regular entry.', 'success');
}

export function undoDelete() {
    if (!lastDeleted) return;
    clearTimeout(lastDeleted.timerId);
    const { dayIdx, entryIdx, entry } = lastDeleted;
    lastDeleted = null;
    state.days[dayIdx].entries.splice(entryIdx, 0, entry);
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    showToast('Entry restored.', 'success');
}

export function showUndoToast() {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const existing = document.getElementById('undo-delete-toast');
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', `
    <div id="undo-delete-toast" class="toast toast-custom show align-items-center" role="alert" style="min-width:280px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-trash-fill" style="color:#f87171"></i>
        <span style="font-size:0.85rem">Entry deleted.</span>
        <button type="button" class="btn btn-sm btn-outline-light ms-auto py-0 px-2" style="font-size:0.75rem" id="btn-undo-delete">Undo</button>
      </div>
    </div>`);

    document.getElementById('btn-undo-delete').addEventListener('click', () => {
        document.getElementById('undo-delete-toast')?.remove();
        undoDelete();
    });

    setTimeout(() => { document.getElementById('undo-delete-toast')?.remove(); }, 5000);
}
