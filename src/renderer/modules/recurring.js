import { state, RECURRING_DAY_NAMES, DAY_IDX_TO_NAME } from './state.js';
import { saveState } from './store.js';
import { showToast } from './toast.js';
import { escHtml, fmtDate } from './utils.js';
import { getDateFromWeek, getWeekStrFromDate } from './week.js';
// Circular — resolved at call time
import { rerenderDayCard } from './render.js';
import { updateSummary } from './summary.js';

let recurringModal;
let recurringFormModal;

export function populateRecurringForWeek(monDt) {
    if (!state.recurringTasks || state.recurringTasks.length === 0) return;
    for (let i = 0; i < 5; i++) {
        const dt = new Date(monDt);
        dt.setDate(monDt.getDate() + i);
        const dateStr = fmtDate(dt);
        const dayName = RECURRING_DAY_NAMES[i];
        const day = state.allDaysByDate[dateStr];
        if (!day) continue;
        state.recurringTasks.forEach(rule => {
            if (!rule.days.includes(dayName)) return;
            const exists = day.entries.some(e => e.recurringId === rule.id);
            if (!exists) {
                day.entries.push({ ticket: rule.ticket, hh: rule.hh, mm: rule.mm, type: rule.type, desc: rule.desc, recurringId: rule.id });
            }
        });
    }
}

function updateRecurringEntriesFromToday(rule) {
    const todayStr = fmtDate(new Date());
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr < todayStr) return;
        const dt = new Date(dateStr + 'T00:00:00');
        const dayName = DAY_IDX_TO_NAME[dt.getDay()];
        if (!dayName) return;
        const day = state.allDaysByDate[dateStr];
        const idx = day.entries.findIndex(e => e.recurringId === rule.id);
        if (rule.days.includes(dayName)) {
            if (idx !== -1) {
                day.entries[idx] = { ...day.entries[idx], ticket: rule.ticket, hh: rule.hh, mm: rule.mm, type: rule.type, desc: rule.desc };
            }
        } else if (idx !== -1) {
            day.entries.splice(idx, 1);
        }
    });
}

function deleteRecurringEntriesFromToday(ruleId) {
    const rule = state.recurringTasks.find(r => r.id === ruleId);
    const ruleTicket = rule ? rule.ticket : null;
    const currentWeekMonday = fmtDate(getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date())));
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr < currentWeekMonday) return;
        const day = state.allDaysByDate[dateStr];
        day.entries = day.entries.filter(e => {
            if (e.recurringId === ruleId) return false;
            if (e.recurringId && ruleTicket && e.ticket === ruleTicket) return false;
            return true;
        });
    });
}

export function initRecurring() {
    recurringModal = new bootstrap.Modal(document.getElementById('recurringModal'));
    recurringFormModal = new bootstrap.Modal(document.getElementById('recurringFormModal'));

    document.getElementById('menu-recurring').addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('#appSidebar .btn-close')?.click();
        setTimeout(() => {
            renderRecurringList();
            recurringModal.show();
        }, 300);
    });

    document.getElementById('btn-add-recurring').addEventListener('click', () => {
        recurringModal.hide();
        setTimeout(() => openRecurringForm(null), 300);
    });

    document.getElementById('btn-recurring-form-close').addEventListener('click', () => {
        recurringFormModal.hide();
        setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    });

    document.getElementById('btn-recurring-form-cancel').addEventListener('click', () => {
        recurringFormModal.hide();
        setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    });

    document.getElementById('btn-save-recurring').addEventListener('click', saveRecurringRule);

    document.querySelectorAll('.recurring-day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            syncAllDaysCheckbox();
        });
    });

    document.getElementById('recurring-all-days').addEventListener('change', e => {
        document.querySelectorAll('.recurring-day-btn').forEach(btn => {
            btn.classList.toggle('selected', e.target.checked);
        });
    });
}

function syncAllDaysCheckbox() {
    const all = document.querySelectorAll('.recurring-day-btn');
    const selected = document.querySelectorAll('.recurring-day-btn.selected');
    document.getElementById('recurring-all-days').checked = all.length === selected.length;
}

function renderRecurringList() {
    const container = document.getElementById('recurring-list');
    if (!state.recurringTasks || state.recurringTasks.length === 0) {
        container.innerHTML = `<p class="text-muted text-center py-4">No recurring tasks yet. Click "Add Recurring Task" to create one.</p>`;
        return;
    }
    container.innerHTML = state.recurringTasks.map(rule => `
    <div class="recurring-rule-card mb-3">
      <div class="d-flex align-items-start justify-content-between gap-2">
        <div class="flex-fill">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="entry-ticket ${rule.type === 'servicedesk' ? 'servicedesk' : ''}">${escHtml(rule.ticket || '—')}</span>
            <span class="entry-hours">${String(rule.hh || 0).padStart(2,'0')}:${String(rule.mm || 0).padStart(2,'0')}</span>
            ${rule.type === 'servicedesk' ? '<span class="entry-type-badge">Service Desk</span>' : ''}
          </div>
          <div class="text-muted" style="font-size:0.85rem">${escHtml(rule.desc || '')}</div>
          <div class="d-flex gap-1 mt-2">
            ${RECURRING_DAY_NAMES.map(d => `<span class="recurring-day-chip${rule.days.includes(d) ? ' active' : ''}">${d}</span>`).join('')}
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-light" data-rule-id="${rule.id}" data-action="edit" title="Edit">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-rule-id="${rule.id}" data-action="delete" title="Delete">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>`).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const rule = state.recurringTasks.find(r => r.id === btn.dataset.ruleId);
            if (rule) { recurringModal.hide(); setTimeout(() => openRecurringForm(rule), 300); }
        });
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => deleteRecurringRule(btn.dataset.ruleId));
    });
}

function openRecurringForm(rule) {
    document.getElementById('recurring-form-id').value = rule ? rule.id : '';
    document.getElementById('recurring-ticket').value = rule ? rule.ticket : '';
    document.getElementById('recurring-hh').value = rule ? rule.hh : '';
    document.getElementById('recurring-mm').value = rule ? String(rule.mm || 0).padStart(2, '0') : '00';
    document.getElementById('recurring-type').value = rule ? rule.type : 'jira';
    document.getElementById('recurring-desc').value = rule ? rule.desc : '';
    document.getElementById('recurringFormTitle').innerHTML =
        `<i class="bi bi-arrow-repeat me-2"></i>${rule ? 'Edit' : 'Add'} Recurring Task`;

    document.querySelectorAll('.recurring-day-btn').forEach(btn => {
        btn.classList.toggle('selected', rule ? rule.days.includes(btn.dataset.day) : false);
    });
    syncAllDaysCheckbox();

    [document.getElementById('recurring-ticket'), document.getElementById('recurring-desc'),
     document.getElementById('recurring-hh'), document.getElementById('recurring-mm')]
        .forEach(el => el.classList.remove('is-invalid'));

    recurringFormModal.show();
}

function saveRecurringRule() {
    const ticket = document.getElementById('recurring-ticket').value.trim();
    const hh = parseInt(document.getElementById('recurring-hh').value) || 0;
    const mm = parseInt(document.getElementById('recurring-mm').value) || 0;
    const type = document.getElementById('recurring-type').value;
    const desc = document.getElementById('recurring-desc').value.trim();
    const selectedDays = [...document.querySelectorAll('.recurring-day-btn.selected')].map(b => b.dataset.day);

    let hasError = false;
    [document.getElementById('recurring-ticket'), document.getElementById('recurring-desc'),
     document.getElementById('recurring-hh'), document.getElementById('recurring-mm')]
        .forEach(el => el.classList.remove('is-invalid'));

    if (!ticket) { document.getElementById('recurring-ticket').classList.add('is-invalid'); hasError = true; }
    if (!desc) { document.getElementById('recurring-desc').classList.add('is-invalid'); hasError = true; }
    if (hh === 0 && mm === 0) {
        document.getElementById('recurring-hh').classList.add('is-invalid');
        document.getElementById('recurring-mm').classList.add('is-invalid');
        hasError = true;
    }
    if (selectedDays.length === 0) { showToast('Select at least one day.', 'danger'); hasError = true; }
    if (hasError) return;

    const existingId = document.getElementById('recurring-form-id').value;
    if (existingId) {
        const rule = state.recurringTasks.find(r => r.id === existingId);
        if (rule) {
            Object.assign(rule, { ticket, hh, mm, type, desc, days: selectedDays });
            updateRecurringEntriesFromToday(rule);
        }
    } else {
        const rule = { id: 'rec_' + Date.now(), ticket, hh, mm, type, desc, days: selectedDays };
        state.recurringTasks.push(rule);
        populateRecurringForWeek(getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date())));
    }

    saveState();
    state.days.forEach((_, i) => rerenderDayCard(i));
    updateSummary();
    recurringFormModal.hide();
    setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    showToast('Recurring task saved.', 'success');
}

function deleteRecurringRule(ruleId) {
    deleteRecurringEntriesFromToday(ruleId);
    state.recurringTasks = state.recurringTasks.filter(r => r.id !== ruleId);
    saveState();
    state.days.forEach((_, i) => rerenderDayCard(i));
    updateSummary();
    renderRecurringList();
    showToast('Recurring task deleted.', 'success');
}
