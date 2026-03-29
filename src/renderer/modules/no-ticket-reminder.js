/* =============================================================
   NO-TICKET REMINDER — persistent banner for unresolved entries
   ============================================================= */

import { state } from './state.js';

let _dismissed = false;

export function initNoTicketBanner() {
    document.getElementById('btn-dismiss-no-ticket')
        .addEventListener('click', () => {
            document.getElementById('no-ticket-banner').style.display = 'none';
            _dismissed = true;
        });
}

export function updateNoTicketBanner() {
    if (_dismissed) return;

    const banner = document.getElementById('no-ticket-banner');
    if (!banner) return;

    const today = new Date().toISOString().slice(0, 10);

    const flaggedDays = Object.values(state.allDaysByDate)
        .filter(d => d.date < today && (d.entries || []).some(e => e.noTicket))
        .sort((a, b) => a.date.localeCompare(b.date));

    if (flaggedDays.length === 0) {
        banner.style.display = 'none';
        return;
    }

    const totalCount = flaggedDays.reduce(
        (sum, d) => sum + (d.entries || []).filter(e => e.noTicket).length, 0
    );

    const dayLabels = flaggedDays.map(d => {
        const date = new Date(d.date + 'T12:00:00');
        return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }).join(', ');

    document.getElementById('no-ticket-banner-msg').textContent =
        `${totalCount} entr${totalCount > 1 ? 'ies' : 'y'} without a ticket number — ${dayLabels}. Open those entries to assign a ticket.`;

    banner.style.display = 'flex';
}
