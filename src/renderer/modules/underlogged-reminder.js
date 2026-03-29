/* =============================================================
   UNDERLOGGED REMINDER — banner for past days below daily target
   ============================================================= */

import { state, WEEK_DAYS } from './state.js';
import { fmtDate } from './utils.js';

let _dismissed = false;

export function initUnderloggedBanner() {
    document.getElementById('btn-dismiss-underlogged')
        .addEventListener('click', () => {
            document.getElementById('underlogged-banner').style.display = 'none';
            _dismissed = true;
        });
}

export function updateUnderloggedBanner() {
    if (_dismissed) return;

    const banner = document.getElementById('underlogged-banner');
    if (!banner) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = fmtDate(today);

    // Monday of the current real week
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));

    const flagged = [];

    for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = fmtDate(d);

        if (dateStr >= todayStr) break; // only past days

        const dayData = state.days.find(day => day.date === dateStr) || state.allDaysByDate[dateStr];
        if (dayData?.isHoliday || dayData?.leaveTypeId) continue; // skip holidays and leave days

        const totalMins = (dayData?.entries || [])
            .reduce((sum, e) => sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);

        if (totalMins < (state.dailyTargetMins || 480)) {
            flagged.push(WEEK_DAYS[i]);
        }
    }

    if (flagged.length === 0) {
        banner.style.display = 'none';
        return;
    }

    document.getElementById('underlogged-banner-msg').textContent =
        `Incomplete time logs this week: ${flagged.join(', ')}. Hours logged are below your daily target.`;

    banner.style.display = 'flex';
}
