import { state } from './state.js';
import { escHtml, minsToHHMM } from './utils.js';
import { getWeekStrFromDate, getDateFromWeek } from './week.js';

let _statsModal = null;
let _currentRange = 4;
let _currentTab = 'weekly';

export function initStats() {
    _statsModal = new bootstrap.Modal(document.getElementById('statsModal'));

    document.querySelectorAll('.stats-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.stats-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _currentRange = parseInt(btn.dataset.range);
            renderCurrentTab();
        });
    });

    document.querySelectorAll('.stats-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.stats-tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            _currentTab = tab.dataset.tab;
            document.getElementById(`stats-panel-${_currentTab}`)?.classList.add('active');
            renderCurrentTab();
        });
    });
}

export function openStatsModal() {
    _currentRange = 4;
    _currentTab = 'weekly';
    document.querySelectorAll('.stats-filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.stats-filter-btn[data-range="4"]')?.classList.add('active');
    document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.stats-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.stats-tab[data-tab="weekly"]')?.classList.add('active');
    document.getElementById('stats-panel-weekly')?.classList.add('active');
    renderCurrentTab();
    _statsModal.show();
}

function getFilteredDays(rangeWeeks) {
    const allDays = Object.values(state.allDaysByDate).filter(d => d && d.date);
    if (rangeWeeks === 0) return allDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeWeeks * 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return allDays.filter(d => d.date >= cutoffStr);
}

function fmtWeekLabel(weekStr) {
    try {
        const mon = getDateFromWeek(weekStr);
        const fri = new Date(mon);
        fri.setDate(mon.getDate() + 4);
        const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return `${fmt(mon)} – ${fmt(fri)}`;
    } catch {
        return weekStr;
    }
}

function renderCurrentTab() {
    const days = getFilteredDays(_currentRange);
    switch (_currentTab) {
        case 'weekly':   renderWeeklyTable(days); break;
        case 'tickets':  renderTicketsTable(days); break;
        case 'types':    renderTypesBreakdown(days); break;
        case 'holidays': renderHolidays(days); break;
    }
}

function renderWeeklyTable(days) {
    const weekMap = {};
    days.forEach(day => {
        const weekStr = getWeekStrFromDate(new Date(day.date + 'T00:00:00'));
        if (!weekMap[weekStr]) weekMap[weekStr] = { totalMins: 0, daysWorked: 0 };
        const dayMins = (day.entries || []).reduce((s, e) => s + (e.hh || 0) * 60 + (e.mm || 0), 0);
        if (dayMins > 0) weekMap[weekStr].daysWorked++;
        weekMap[weekStr].totalMins += dayMins;
    });

    const weeks = Object.keys(weekMap).sort().reverse();
    const tbody = document.getElementById('stats-weekly-tbody');
    if (!weeks.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="stats-empty">No data for this range</td></tr>';
        return;
    }
    tbody.innerHTML = weeks.map(w => {
        const { totalMins, daysWorked } = weekMap[w];
        return `<tr>
            <td>${escHtml(fmtWeekLabel(w))}</td>
            <td>${daysWorked}</td>
            <td class="stats-mono">${minsToHHMM(totalMins)}</td>
        </tr>`;
    }).join('');
}

function renderTicketsTable(days) {
    const ticketMap = {};
    days.forEach(day => {
        (day.entries || []).forEach(e => {
            const key = e.noTicket ? 'NO TICKET' : (e.ticket || '—');
            if (!ticketMap[key]) ticketMap[key] = { mins: 0, count: 0 };
            ticketMap[key].mins += (e.hh || 0) * 60 + (e.mm || 0);
            ticketMap[key].count++;
        });
    });

    const tickets = Object.entries(ticketMap).sort((a, b) => b[1].mins - a[1].mins).slice(0, 25);
    const tbody = document.getElementById('stats-tickets-tbody');
    if (!tickets.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="stats-empty">No data for this range</td></tr>';
        return;
    }
    tbody.innerHTML = tickets.map(([ticket, { mins, count }], i) => `<tr>
        <td class="stats-rank">${i + 1}</td>
        <td class="stats-mono">${escHtml(ticket)}</td>
        <td>${count}</td>
        <td class="stats-mono">${minsToHHMM(mins)}</td>
    </tr>`).join('');
}

function renderTypesBreakdown(days) {
    const typeMap = {};
    days.forEach(day => {
        (day.entries || []).forEach(e => {
            const key = e.type || 'jira';
            if (!typeMap[key]) typeMap[key] = 0;
            typeMap[key] += (e.hh || 0) * 60 + (e.mm || 0);
        });
    });

    const totalMins = Object.values(typeMap).reduce((s, v) => s + v, 0);
    const types = Object.entries(typeMap).sort((a, b) => b[1] - a[1]);
    const container = document.getElementById('stats-types-list');

    if (!types.length) {
        container.innerHTML = '<div class="stats-empty">No data for this range</div>';
        return;
    }
    container.innerHTML = types.map(([type, mins]) => {
        const pct = totalMins > 0 ? Math.round(mins / totalMins * 100) : 0;
        const typeObj = state.ticketTypes?.find(t => t.id === type);
        const label = typeObj?.label || 'Other';
        const color = typeObj?.color || '#808080';
        return `<div class="stats-type-row">
            <span class="stats-type-label">${escHtml(label)}</span>
            <div class="stats-type-bar-wrap">
                <div class="stats-type-bar" style="width:${pct}%;background:${escHtml(color)}"></div>
            </div>
            <span class="stats-mono">${minsToHHMM(mins)}</span>
            <span class="stats-type-pct">${pct}%</span>
        </div>`;
    }).join('');
}

function renderHolidays(days) {
    const leaveDays = days.filter(d => d.isHoliday).sort((a, b) => b.date.localeCompare(a.date));

    const getLabel = day => {
        const typeObj = state.leaveTypes?.find(t => t.id === day.leaveTypeId);
        return typeObj?.label || day.holidayLabel || 'Holiday';
    };

    // Summary by type
    const leaveMap = {};
    leaveDays.forEach(day => {
        const label = getLabel(day);
        if (!leaveMap[label]) leaveMap[label] = 0;
        leaveMap[label]++;
    });

    const tbody = document.getElementById('stats-holidays-tbody');
    const summaryEntries = Object.entries(leaveMap).sort((a, b) => b[1] - a[1]);

    if (!summaryEntries.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="stats-empty">No leave days in this range</td></tr>';
        document.getElementById('stats-holidays-history-tbody').innerHTML =
            '<tr><td colspan="2" class="stats-empty">No leave days in this range</td></tr>';
        return;
    }

    const total = summaryEntries.reduce((s, [, v]) => s + v, 0);
    tbody.innerHTML = summaryEntries.map(([label, count]) => `<tr>
        <td>${escHtml(label)}</td>
        <td class="stats-mono">${count} day${count !== 1 ? 's' : ''}</td>
    </tr>`).join('') + `<tr class="stats-total-row">
        <td>Total</td>
        <td class="stats-mono">${total} day${total !== 1 ? 's' : ''}</td>
    </tr>`;

    // History list (newest first)
    const historyTbody = document.getElementById('stats-holidays-history-tbody');
    historyTbody.innerHTML = leaveDays.map(day => {
        const date = new Date(day.date + 'T00:00:00');
        const fmtDate = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        return `<tr>
            <td>${escHtml(fmtDate)}</td>
            <td>${escHtml(getLabel(day))}</td>
        </tr>`;
    }).join('');
}
