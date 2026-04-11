import { state } from './state.js';
import { minsToHHMM, animateCountUp } from './utils.js';

export function calcDayTotalMins(day) {
    if (day.isHoliday) return 0;
    return (day.entries || []).reduce((sum, e) => sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);
}

export function updateSummary() {
    let totalMins = 0;
    let workingDays = 0;
    let totalEntries = 0;
    let holidayCount = 0;
    let loggedMins = 0;
    let loggedCount = 0;
    let unloggedMins = 0;
    let unloggedCount = 0;

    state.days.forEach(day => {
        if (day.isHoliday) {
            holidayCount++;
        } else {
            const m = calcDayTotalMins(day);
            if (m > 0) workingDays++;
            totalMins += m;
            totalEntries += (day.entries || []).length;
            (day.entries || []).forEach(e => {
                const mins = (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
                if (e.logged) { loggedMins += mins; loggedCount++; }
                else          { unloggedMins += mins; unloggedCount++; }
            });
        }
    });

    animateCountUp(document.getElementById('total-hours'), totalMins, true);
    animateCountUp(document.getElementById('total-days'), workingDays, false);
    animateCountUp(document.getElementById('total-entries'), totalEntries, false);

    const fill = document.getElementById('week-progress-fill');
    if (fill) {
        const activeDays = 5 - holidayCount;
        if (activeDays <= 0) {
            fill.style.width = '0%';
            fill.classList.remove('over');
        } else {
            const weeklyTarget = activeDays * (state.dailyTargetMins || 480);
            const pct = Math.min(totalMins / weeklyTarget, 1) * 100;
            const isOver = totalMins > weeklyTarget;
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                fill.style.transition = 'none';
            }
            fill.style.width = pct.toFixed(1) + '%';
            fill.classList.toggle('over', isOver);
        }
    }

    // Logged / unlogged breakdown
    const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    const breakdown = document.getElementById('logged-breakdown');
    if (breakdown) {
        breakdown.style.display = totalEntries > 0 ? '' : 'none';
        document.getElementById('lb-logged-hours').textContent   = fmt(loggedMins);
        document.getElementById('lb-logged-entries').textContent = `${loggedCount} ${loggedCount === 1 ? 'entry' : 'entries'}`;
        document.getElementById('lb-unlogged-hours').textContent   = fmt(unloggedMins);
        document.getElementById('lb-unlogged-entries').textContent = `${unloggedCount} ${unloggedCount === 1 ? 'entry' : 'entries'}`;
    }
}
