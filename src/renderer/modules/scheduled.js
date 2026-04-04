import { state } from './state.js';
import { saveState } from './store.js';
import { showToast } from './toast.js';
import { escHtml, fmtDate } from './utils.js';
import { getTypeById, populateTypeSelect } from './ticket-types.js';
// Circular — resolved at call time
import { rerenderDayCard } from './render.js';
import { updateSummary } from './summary.js';

let scheduledModal, scheduledFormModal;

export function promoteExpiredScheduled() {
    const todayStr = fmtDate(new Date());
    let changed = false;
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr >= todayStr) return;
        state.allDaysByDate[dateStr].entries.forEach(entry => {
            if (entry.isScheduled) {
                if (!state.scheduledHistory) state.scheduledHistory = [];
                state.scheduledHistory.push({
                    ticket: entry.ticket, hh: entry.hh, mm: entry.mm,
                    type: entry.type, desc: entry.desc,
                    date: dateStr, status: 'completed',
                    actionAt: todayStr
                });
                delete entry.isScheduled;
                changed = true;
            }
        });
    });
    if (changed) saveState();
}

export function initScheduledTasks() {
    scheduledModal = new bootstrap.Modal(document.getElementById('scheduledModal'));
    scheduledFormModal = new bootstrap.Modal(document.getElementById('scheduledFormModal'));

    const menuBtn = document.getElementById('menu-scheduled');
    const sidebarEl = document.getElementById('appSidebar');

    menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const offcanvasInstance = bootstrap.Offcanvas.getInstance(sidebarEl);
        if (offcanvasInstance) offcanvasInstance.hide();
        renderScheduledList();
        scheduledModal.show();
    });

    document.getElementById('btn-add-scheduled').addEventListener('click', () => {
        scheduledModal.hide();
        openScheduledForm();
    });

    document.getElementById('btn-save-scheduled').addEventListener('click', saveScheduledTask);

    const closeForm = () => {
        scheduledFormModal.hide();
        scheduledModal.show();
        renderScheduledList();
    };
    document.getElementById('btn-scheduled-form-close').addEventListener('click', closeForm);
    document.getElementById('btn-scheduled-form-cancel').addEventListener('click', closeForm);
}

function formatDateLabel(dateStr) {
    const dt = new Date(dateStr + 'T00:00:00');
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function buildEntryCard({ dateStr, entry, isPast = false, buttons = '' }) {
    const hhmm = `${String(entry.hh || 0).padStart(2, '0')}:${String(entry.mm || 0).padStart(2, '0')}`;
    const entryTypeObj = getTypeById(entry.type);
    const isSd = entryTypeObj?.hasPrefix === true;
    const sdLabel = isSd ? entryTypeObj.label : '';
    const dateLabel = formatDateLabel(dateStr);
    return `
    <div class="recurring-rule-card mb-2${isPast ? ' opacity-50' : ''}">
      <div class="d-flex align-items-start justify-content-between gap-2">
        <div class="flex-grow-1">
          <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
            <i class="bi bi-clock" style="color:var(--warning);font-size:0.8rem"></i>
            <span style="font-size:0.75rem;color:var(--text-secondary)">${escHtml(dateLabel)}${isPast ? ' <span class="text-danger">(past)</span>' : ''}</span>
          </div>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-semibold" style="font-size:0.9rem">${escHtml(entry.ticket || '—')}</span>
            <span class="text-muted" style="font-size:0.8rem">${hhmm}</span>
            ${isSd ? `<span class="entry-type-badge">${escHtml(sdLabel)}</span>` : ''}
          </div>
          <div class="text-muted mt-1" style="font-size:0.8rem">${escHtml(entry.desc || '')}</div>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">${buttons}</div>
      </div>
    </div>`;
}

function renderScheduledList() {
    const todayStr = fmtDate(new Date());
    if (!state.scheduledHistory) state.scheduledHistory = [];

    // ── Active ───────────────────────────────────────────
    const active = [];
    Object.keys(state.allDaysByDate).sort().forEach(dateStr => {
        state.allDaysByDate[dateStr].entries.forEach((entry, entryIdx) => {
            if (entry.isScheduled) active.push({ dateStr, entry, entryIdx });
        });
    });

    const activeContainer = document.getElementById('scheduled-list-active');
    document.getElementById('badge-scheduled-active').textContent = active.length || '';
    if (active.length === 0) {
        activeContainer.innerHTML = `<p class="text-center py-3" style="font-size:0.9rem;color:var(--text-secondary);">No active scheduled tasks. Click "Add Scheduled Task" to pre-schedule an entry.</p>`;
    } else {
        activeContainer.innerHTML = active.map(({ dateStr, entry, entryIdx }) => {
            const isPast = dateStr <= todayStr;
            const buttons = `
              <button class="btn btn-sm btn-outline-warning py-0 px-2" title="Make Regular" data-make-date="${dateStr}" data-make-idx="${entryIdx}"><i class="bi bi-calendar-check"></i></button>
              <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Cancel" data-cancel-date="${dateStr}" data-cancel-idx="${entryIdx}"><i class="bi bi-x-circle"></i></button>`;
            return buildEntryCard({ dateStr, entry, isPast, buttons });
        }).join('');

        activeContainer.querySelectorAll('[data-make-date]').forEach(btn => {
            btn.addEventListener('click', () => makeScheduledRegular(btn.dataset.makeDate, parseInt(btn.dataset.makeIdx)));
        });
        activeContainer.querySelectorAll('[data-cancel-date]').forEach(btn => {
            btn.addEventListener('click', () => cancelScheduledEntry(btn.dataset.cancelDate, parseInt(btn.dataset.cancelIdx)));
        });
    }

    // ── Completed ────────────────────────────────────────
    const completed = state.scheduledHistory.filter(h => h.status === 'completed')
        .sort((a, b) => b.date.localeCompare(a.date));

    const completedContainer = document.getElementById('scheduled-list-completed');
    document.getElementById('badge-scheduled-completed').textContent = completed.length || '';
    if (completed.length === 0) {
        completedContainer.innerHTML = `<p class="text-center py-3" style="font-size:0.9rem;color:var(--text-secondary);">No completed scheduled tasks yet.</p>`;
    } else {
        completedContainer.innerHTML = completed.map(h =>
            buildEntryCard({ dateStr: h.date, entry: h, isPast: true, buttons: '' })
        ).join('');
    }

    // ── Cancelled ────────────────────────────────────────
    const cancelled = state.scheduledHistory.filter(h => h.status === 'cancelled')
        .sort((a, b) => b.actionAt.localeCompare(a.actionAt));

    const cancelledContainer = document.getElementById('scheduled-list-cancelled');
    document.getElementById('badge-scheduled-cancelled').textContent = cancelled.length || '';
    if (cancelled.length === 0) {
        cancelledContainer.innerHTML = `<p class="text-center py-3" style="font-size:0.9rem;color:var(--text-secondary);">No cancelled scheduled tasks.</p>`;
    } else {
        cancelledContainer.innerHTML = cancelled.map((h, histIdx) => {
            const canReactivate = h.date > todayStr;
            const buttons = canReactivate
                ? `<button class="btn btn-sm btn-outline-success py-0 px-2" title="Reactivate" data-reactivate-idx="${histIdx}"><i class="bi bi-arrow-counterclockwise"></i></button>`
                : '';
            return buildEntryCard({ dateStr: h.date, entry: h, isPast: !canReactivate, buttons });
        }).join('');

        cancelledContainer.querySelectorAll('[data-reactivate-idx]').forEach(btn => {
            btn.addEventListener('click', () => reactivateScheduledEntry(parseInt(btn.dataset.reactivateIdx)));
        });
    }
}

function openScheduledForm() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateInput = document.getElementById('scheduled-form-date');
    dateInput.min = fmtDate(tomorrow);
    dateInput.value = '';
    dateInput.classList.remove('is-invalid');
    document.getElementById('scheduled-form-ticket').value = '';
    document.getElementById('scheduled-form-ticket').classList.remove('is-invalid');
    document.getElementById('scheduled-form-hh').value = '';
    document.getElementById('scheduled-form-mm').value = '00';
    populateTypeSelect(document.getElementById('scheduled-form-type'), state.ticketTypes[0]?.id || 'jira');
    document.getElementById('scheduled-form-desc').value = '';
    document.getElementById('scheduled-form-desc').classList.remove('is-invalid');
    scheduledFormModal.show();
}

function saveScheduledTask() {
    const dateInput = document.getElementById('scheduled-form-date');
    const ticketInput = document.getElementById('scheduled-form-ticket');
    const descInput = document.getElementById('scheduled-form-desc');
    const scheduledDate = dateInput.value;
    const tkt = ticketInput.value.trim();
    const desc = descInput.value.trim();
    const hh = parseInt(document.getElementById('scheduled-form-hh').value) || 0;
    const mm = parseInt(document.getElementById('scheduled-form-mm').value) || 0;
    const type = document.getElementById('scheduled-form-type').value;

    let hasError = false;
    [dateInput, ticketInput, descInput].forEach(el => el.classList.remove('is-invalid'));

    if (!scheduledDate) { dateInput.classList.add('is-invalid'); hasError = true; }
    if (!tkt) { ticketInput.classList.add('is-invalid'); hasError = true; }
    if (!desc) { descInput.classList.add('is-invalid'); hasError = true; }
    if (hh === 0 && mm === 0) { hasError = true; }

    if (hasError) { showToast('Please fill in all required fields.', 'danger'); return; }

    const dt = new Date(scheduledDate + 'T00:00:00');
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) {
        dateInput.classList.add('is-invalid');
        showToast('Scheduled date must be a weekday (Mon–Fri).', 'danger');
        return;
    }
    const todayStr = fmtDate(new Date());
    if (scheduledDate <= todayStr) {
        dateInput.classList.add('is-invalid');
        showToast('Scheduled date must be in the future.', 'danger');
        return;
    }

    const existingDay = state.allDaysByDate[scheduledDate];
    if (existingDay && existingDay.entries.some(e => e.isScheduled && e.ticket.toLowerCase() === tkt.toLowerCase())) {
        ticketInput.classList.add('is-invalid');
        showToast(`"${tkt}" is already scheduled for this date.`, 'danger');
        return;
    }

    if (!state.allDaysByDate[scheduledDate]) {
        state.allDaysByDate[scheduledDate] = {
            date: scheduledDate, isHoliday: false,
            leaveTypeId: '', holidayLabel: 'Offshore Holiday', expanded: false, entries: []
        };
    }
    state.allDaysByDate[scheduledDate].entries.push({ ticket: tkt, hh, mm, type, desc, isScheduled: true });

    const dayInWeek = state.days.findIndex(d => d.date === scheduledDate);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[scheduledDate];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();

    const dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    showToast(`Scheduled for ${dateLabel}.`, 'success');
    scheduledFormModal.hide();
    renderScheduledList();
    scheduledModal.show();
}

function makeScheduledRegular(dateStr, entryIdx) {
    const day = state.allDaysByDate[dateStr];
    if (!day || !day.entries[entryIdx]) return;
    delete day.entries[entryIdx].isScheduled;

    const dayInWeek = state.days.findIndex(d => d.date === dateStr);
    if (dayInWeek !== -1) rerenderDayCard(dayInWeek);

    saveState();
    updateSummary();
    renderScheduledList();
    showToast('Entry converted to a regular entry.', 'success');
}

export function cancelScheduledEntry(dateStr, entryIdx) {
    const day = state.allDaysByDate[dateStr];
    if (!day || !day.entries[entryIdx]) return;

    const entry = day.entries[entryIdx];
    if (!state.scheduledHistory) state.scheduledHistory = [];
    state.scheduledHistory.push({
        ticket: entry.ticket, hh: entry.hh, mm: entry.mm,
        type: entry.type, desc: entry.desc,
        date: dateStr, status: 'cancelled',
        actionAt: fmtDate(new Date())
    });

    day.entries.splice(entryIdx, 1);

    const dayInWeek = state.days.findIndex(d => d.date === dateStr);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[dateStr];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();
    renderScheduledList();
    showToast('Scheduled task cancelled.', 'success');
}

function reactivateScheduledEntry(historyIdx) {
    if (!state.scheduledHistory) return;
    const cancelled = state.scheduledHistory.filter(h => h.status === 'cancelled');
    const record = cancelled[historyIdx];
    if (!record) return;

    // Remove from history
    const globalIdx = state.scheduledHistory.indexOf(record);
    state.scheduledHistory.splice(globalIdx, 1);

    // Restore as scheduled entry
    if (!state.allDaysByDate[record.date]) {
        state.allDaysByDate[record.date] = {
            date: record.date, isHoliday: false,
            leaveTypeId: '', holidayLabel: 'Offshore Holiday', expanded: false, entries: []
        };
    }
    state.allDaysByDate[record.date].entries.push({
        ticket: record.ticket, hh: record.hh, mm: record.mm,
        type: record.type, desc: record.desc, isScheduled: true
    });

    const dayInWeek = state.days.findIndex(d => d.date === record.date);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[record.date];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();

    // Switch to Active tab
    document.getElementById('tab-btn-active')?.click();
    renderScheduledList();
    showToast('Scheduled task reactivated.', 'success');
}
