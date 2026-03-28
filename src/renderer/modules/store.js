import { state, LS_KEY } from './state.js';

export async function saveState() {
    try {
        state.days.forEach(d => {
            if (d && d.date) state.allDaysByDate[d.date] = d;
        });

        const toSave = {
            reportTitle: state.reportTitle,
            employeeName: state.employeeName,
            weekValue: state.weekValue,
            allDaysByDate: state.allDaysByDate,
            lastOpenedDateByWeek: state.lastOpenedDateByWeek,
            recurringTasks: state.recurringTasks,
            dailyTargetMins: state.dailyTargetMins
        };
        await window.electronStore.set(LS_KEY, toSave);
    } catch (e) { console.warn('Could not save state', e); }
}

export async function loadState() {
    try {
        if (!await window.electronStore.has(LS_KEY)) {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    await window.electronStore.set(LS_KEY, parsed);
                    localStorage.removeItem(LS_KEY);
                }
            }
        }

        const saved = await window.electronStore.get(LS_KEY);
        if (!saved) return false;

        state.reportTitle = saved.reportTitle || 'Booked hours in Jira and Service Desk';
        state.employeeName = saved.employeeName || '';
        state.weekValue = saved.weekValue || '';
        state.allDaysByDate = saved.allDaysByDate || {};
        state.lastOpenedDateByWeek = saved.lastOpenedDateByWeek || {};
        state.recurringTasks = saved.recurringTasks || [];
        state.dailyTargetMins = saved.dailyTargetMins || 480;

        if (saved.days && Array.isArray(saved.days)) {
            saved.days.forEach(d => {
                if (d && d.date) state.allDaysByDate[d.date] = d;
            });
        }
        return true;
    } catch (e) { return false; }
}
