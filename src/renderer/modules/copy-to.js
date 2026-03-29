import { state, WEEK_DAYS } from './state.js';
import { saveState } from './store.js';
import { showToast } from './toast.js';
import { fmtDate, fmtDisplayDate } from './utils.js';
import { getDateFromWeek, getWeekStrFromDate } from './week.js';
// Circular — resolved at call time
import { rerenderDayCard } from './render.js';
import { updateSummary } from './summary.js';

let copyToModal;
let copyToWeekMonday = null;
let copyToSelectedDates = [];

export function initCopyTo() {
    copyToModal = new bootstrap.Modal(document.getElementById('copyToModal'));

    document.getElementById('btn-copy-to-entry').addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('entryModal'))?.hide();
        copyToWeekMonday = getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date()));
        copyToSelectedDates = [];
        renderCopyToWeek();
        copyToModal.show();
    });

    document.getElementById('copy-to-prev-week').addEventListener('click', () => {
        copyToWeekMonday = new Date(copyToWeekMonday);
        copyToWeekMonday.setDate(copyToWeekMonday.getDate() - 7);
        renderCopyToWeek();
    });

    document.getElementById('copy-to-next-week').addEventListener('click', () => {
        copyToWeekMonday = new Date(copyToWeekMonday);
        copyToWeekMonday.setDate(copyToWeekMonday.getDate() + 7);
        renderCopyToWeek();
    });

    document.getElementById('btn-confirm-copy-to').addEventListener('click', executeCopyTo);
}

function renderCopyToWeek() {
    const mon = new Date(copyToWeekMonday);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    document.getElementById('copy-to-week-label').textContent =
        `${fmtDisplayDate(fmtDate(mon))} — ${fmtDisplayDate(fmtDate(fri))}`;

    const container = document.getElementById('copy-to-days');
    container.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const dt = new Date(mon);
        dt.setDate(mon.getDate() + i);
        const dateStr = fmtDate(dt);
        const dayName = WEEK_DAYS[i].slice(0, 3);
        const dayNum = dt.getDate();
        const isSelected = copyToSelectedDates.includes(dateStr);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn copy-to-day-btn${isSelected ? ' selected' : ''}`;
        btn.dataset.date = dateStr;
        btn.innerHTML = `<span class="copy-day-name">${dayName}</span><span class="copy-day-num">${dayNum}</span>`;
        btn.addEventListener('click', () => {
            const idx = copyToSelectedDates.indexOf(dateStr);
            if (idx > -1) {
                copyToSelectedDates.splice(idx, 1);
                btn.classList.remove('selected');
            } else {
                copyToSelectedDates.push(dateStr);
                btn.classList.add('selected');
            }

            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                btn.classList.remove('copy-day-pop');
                void btn.offsetWidth;
                btn.classList.add('copy-day-pop');
            }
        });
        container.appendChild(btn);
    }
}

function executeCopyTo() {
    if (copyToSelectedDates.length === 0) {
        showToast('Select at least one day to copy to.', 'danger');
        return;
    }

    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    const src = state.days[dayIdx].entries[entryIdx];
    const entryCopy = { ticket: src.ticket, hh: src.hh, mm: src.mm, type: src.type, desc: src.desc };

    copyToSelectedDates.forEach(dateStr => {
        if (!state.allDaysByDate[dateStr]) {
            state.allDaysByDate[dateStr] = {
                date: dateStr, isHoliday: false,
                leaveTypeId: '', holidayLabel: 'Offshore Holiday', expanded: false, entries: []
            };
        }
        state.allDaysByDate[dateStr].entries.push({ ...entryCopy });

        const dayInWeek = state.days.findIndex(d => d.date === dateStr);
        if (dayInWeek !== -1) {
            state.days[dayInWeek] = state.allDaysByDate[dateStr];
            rerenderDayCard(dayInWeek);
        }
    });

    saveState();
    updateSummary();
    copyToModal.hide();
    showToast(`Copied to ${copyToSelectedDates.length} day${copyToSelectedDates.length > 1 ? 's' : ''}.`, 'success');
    copyToSelectedDates = [];
}
