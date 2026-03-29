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

function renderScheduledList() {
    const container = document.getElementById('scheduled-list');

    const scheduled = [];
    Object.keys(state.allDaysByDate).sort().forEach(dateStr => {
        const day = state.allDaysByDate[dateStr];
        day.entries.forEach((entry, entryIdx) => {
            if (entry.isScheduled) {
                scheduled.push({ dateStr, entry, entryIdx });
            }
        });
    });

    if (scheduled.length === 0) {
        container.innerHTML = `<p class="text-muted text-center py-3" style="font-size:0.9rem;">No scheduled tasks. Click "Add Scheduled Task" to pre-schedule an entry for a future date.</p>`;
        return;
    }

    let html = '';
    scheduled.forEach(({ dateStr, entry, entryIdx }) => {
        const dt = new Date(dateStr + 'T00:00:00');
        const dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const hhmm = `${String(entry.hh || 0).padStart(2, '0')}:${String(entry.mm || 0).padStart(2, '0')}`;
        const entryTypeObj = getTypeById(entry.type);
        const isSd = entryTypeObj?.hasPrefix === true;
        const sdLabel = isSd ? entryTypeObj.label : '';
        const isPast = dateStr <= fmtDate(new Date());
        html += `
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
            <div class="d-flex gap-1 flex-shrink-0">
              <button class="btn btn-sm btn-outline-warning py-0 px-2" title="Make Regular" data-scheduled-date="${dateStr}" data-scheduled-idx="${entryIdx}">
                <i class="bi bi-calendar-check"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Delete" data-delete-scheduled-date="${dateStr}" data-delete-scheduled-idx="${entryIdx}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('[data-scheduled-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            makeScheduledRegular(btn.dataset.scheduledDate, parseInt(btn.dataset.scheduledIdx));
        });
    });

    container.querySelectorAll('[data-delete-scheduled-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteScheduledEntry(btn.dataset.deleteScheduledDate, parseInt(btn.dataset.deleteScheduledIdx));
        });
    });
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
            holidayLabel: 'Offshore Holiday', expanded: false, entries: []
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

function deleteScheduledEntry(dateStr, entryIdx) {
    const day = state.allDaysByDate[dateStr];
    if (!day) return;
    day.entries.splice(entryIdx, 1);

    const dayInWeek = state.days.findIndex(d => d.date === dateStr);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[dateStr];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();
    renderScheduledList();
}
