import { state } from './state.js';
import { saveState } from './store.js';
import { fmtDate, fmtDisplayDate } from './utils.js';
import { populateRecurringForWeek } from './recurring.js';
import { promoteExpiredScheduled } from './scheduled.js';

export function getDateFromWeek(weekStr) {
    const [year, week] = weekStr.split('-W').map(Number);
    const d = new Date(year, 0, 1 + (week - 1) * 7);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

export function getWeekStrFromDate(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    const weekNumber = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

export function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    dt.setDate(dt.getDate() + diff);
    return dt;
}

export function getSunday(d) {
    const mon = getMonday(d);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return sun;
}

export function buildWeekDays(monDt) {
    const days = [];
    let currentDt = new Date(monDt);

    for (let i = 0; i < 5; i++) {
        const dStr = fmtDate(currentDt);
        if (state.allDaysByDate[dStr]) {
            days.push(state.allDaysByDate[dStr]);
        } else {
            const newDay = {
                date: dStr,
                isHoliday: false,
                leaveTypeId: '',
                holidayLabel: 'Offshore Holiday',
                expanded: false,
                entries: []
            };
            state.allDaysByDate[dStr] = newDay;
            days.push(newDay);
        }
        currentDt.setDate(currentDt.getDate() + 1);
    }
    populateRecurringForWeek(monDt);
    promoteExpiredScheduled();
    return days;
}

export function updateWeekDisplay() {
    if (!state.weekValue) return;
    const mon = getDateFromWeek(state.weekValue);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    const display = `${fmtDisplayDate(fmtDate(mon))} to ${fmtDisplayDate(fmtDate(fri))}`;
    document.getElementById('week-display-label').textContent = display;
}

export function enforceExpandedState() {
    if (!state.weekValue || !state.days || state.days.length === 0) return;

    const lastOpenedDate = state.lastOpenedDateByWeek[state.weekValue];
    let found = false;

    state.days.forEach((day) => {
        if (lastOpenedDate && day.date === lastOpenedDate) {
            day.expanded = true;
            found = true;
        } else {
            day.expanded = false;
        }
    });

    if (!found) {
        const todayStr = fmtDate(new Date());
        const todayDay = state.days.find(d => d.date === todayStr);
        const defaultDay = todayDay || state.days[0];
        defaultDay.expanded = true;
        state.lastOpenedDateByWeek[state.weekValue] = defaultDay.date;
        saveState();
    }
}

export function changeWeekBy(delta) {
    const picker = document.getElementById('week-picker');
    if (!picker.value) return;

    const mon = getDateFromWeek(picker.value);
    mon.setDate(mon.getDate() + (delta * 7));

    const newWeekStr = getWeekStrFromDate(mon);
    const maxWeekStr = getWeekStrFromDate(new Date());

    if (newWeekStr > maxWeekStr) return;

    picker.value = newWeekStr;
    picker.dispatchEvent(new Event('change'));
}

export function setCurrentWeek() {
    const today = new Date();
    const weekVal = getWeekStrFromDate(today);

    document.getElementById('week-picker').value = weekVal;
    state.weekValue = weekVal;
    document.getElementById('btn-next-week').disabled = true;
    state.days = buildWeekDays(getDateFromWeek(weekVal));
    enforceExpandedState();
    updateWeekDisplay();
}
