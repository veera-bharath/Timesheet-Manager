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

    state.days.forEach(day => {
        if (day.isHoliday) {
            holidayCount++;
        } else {
            const m = calcDayTotalMins(day);
            if (m > 0) workingDays++;
            totalMins += m;
            totalEntries += (day.entries || []).length;
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
}
