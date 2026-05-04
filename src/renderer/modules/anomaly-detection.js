/* =============================================================
   ANOMALY DETECTION — passive logging pattern analysis
   Runs on: app load, week change, after saving/deleting an entry.
   All rule-based except duplicate detection which optionally uses AI.
   ============================================================= */

import { state } from './state.js';
import { isFeatureEnabled, ask } from './ai.js';
import { pushNotification } from './notifications.js';
import { fmtDate } from './utils.js';

/* ── helpers ── */

function dayEntryMins(dayData) {
    return (dayData?.entries || []).reduce(
        (sum, e) => sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0
    );
}

function isWorkday(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay();
    return dow >= 1 && dow <= 5;
}

function pastWorkdaysInRange(fromDateStr, toDateStr) {
    const days = [];
    const cur = new Date(fromDateStr + 'T12:00:00');
    const end = new Date(toDateStr + 'T12:00:00');
    while (cur <= end) {
        const dow = cur.getDay();
        if (dow >= 1 && dow <= 5) days.push(fmtDate(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

/* ── public entry point ── */

export async function runAnomalyDetection() {
    if (!isFeatureEnabled('anomalyDetection')) return;

    detectUnloggedDays();
    detectUnusualTicketHours();
    detectUnderloggedWeek();
    detectTicketGaps();
    await detectDuplicateEntries();
}

/* ── 1. Unlogged workdays ── */

function detectUnloggedDays() {
    const today = fmtDate(new Date());

    // Look back at the last 14 calendar days (excluding today)
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 14);
    const startStr = fmtDate(lookbackStart);

    // Build yesterday's date string as upper bound
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = fmtDate(yesterday);

    const workdays = pastWorkdaysInRange(startStr, yesterdayStr);

    const unlogged = workdays.filter(dateStr => {
        const day = state.allDaysByDate[dateStr];
        if (!day) return true;                              // no record at all
        if (day.isHoliday || day.leaveTypeId) return false; // holiday/leave — skip
        return (day.entries || []).length === 0;
    });

    if (unlogged.length === 0) return;

    const labels = unlogged.map(d => {
        const dt = new Date(d + 'T12:00:00');
        return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    });

    const msg = unlogged.length === 1
        ? `${labels[0]} has no entries — did you forget to log?`
        : `${unlogged.length} days have no entries (${labels.join(', ')}) — did you forget to log?`;

    pushNotification('unlogged-day', msg);
}

/* ── 2. Unusually high hours on a ticket (rule-based) ── */

function detectUnusualTicketHours() {
    const today = fmtDate(new Date());
    const todayData = state.days.find(d => d.date === today) || state.allDaysByDate[today];
    if (!todayData || (todayData.entries || []).length === 0) return;

    // Build per-ticket daily totals from the last 28 days (excluding today)
    const historyCutoff = new Date();
    historyCutoff.setDate(historyCutoff.getDate() - 28);
    const cutoffStr = fmtDate(historyCutoff);

    const ticketHistory = {}; // ticket → [mins per day it appeared]
    for (const [dateStr, day] of Object.entries(state.allDaysByDate)) {
        if (dateStr >= today || dateStr < cutoffStr) continue;
        const byTicket = {};
        (day.entries || []).forEach(e => {
            if (!e.ticket) return;
            byTicket[e.ticket] = (byTicket[e.ticket] || 0) + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
        });
        Object.entries(byTicket).forEach(([t, m]) => {
            if (!ticketHistory[t]) ticketHistory[t] = [];
            ticketHistory[t].push(m);
        });
    }

    // Per-ticket total today
    const todayByTicket = {};
    todayData.entries.forEach(e => {
        if (!e.ticket) return;
        todayByTicket[e.ticket] = (todayByTicket[e.ticket] || 0) + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
    });

    // Need at least 3 historical days per ticket to compute a meaningful average
    const MIN_HISTORY = 3;
    let anomalous = null;
    let worstRatio = 2; // threshold: 2× average

    for (const [ticket, todayMins] of Object.entries(todayByTicket)) {
        const hist = ticketHistory[ticket];
        if (!hist || hist.length < MIN_HISTORY) continue;
        const avg = hist.reduce((s, m) => s + m, 0) / hist.length;
        if (avg < 30) continue; // ignore tickets with trivial average (< 30 min)
        const ratio = todayMins / avg;
        if (ratio > worstRatio) {
            worstRatio = ratio;
            anomalous = { ticket, todayMins, avg };
        }
    }

    if (!anomalous) return;

    const todayHrs = (anomalous.todayMins / 60).toFixed(1);
    const avgHrs   = (anomalous.avg / 60).toFixed(1);
    pushNotification('high-hours',
        `${anomalous.ticket} has ${todayHrs}h today — your usual average is ${avgHrs}h`);
}

/* ── 3. Week under-logged vs usual pace ── */

function detectUnderloggedWeek() {
    const today = new Date();
    const todayStr = fmtDate(today);
    const dow = today.getDay(); // 1=Mon … 5=Fri (or 0/6 for weekend)

    // Only run Mon–Fri
    if (dow === 0 || dow === 6) return;

    // Days elapsed this week (Mon = day 1, …, today = day N)
    const daysElapsed = dow; // getDay() Mon=1 … Fri=5, which equals elapsed workdays Mon–today

    // Remaining workdays after today (not counting today)
    const daysRemaining = 5 - daysElapsed;
    if (daysRemaining === 0) return; // Friday — no point warning with no days left

    // Current week total (Mon–yesterday)
    const monday = new Date(today);
    monday.setDate(today.getDate() - (daysElapsed - 1));

    let weekMins = 0;
    for (let i = 0; i < daysElapsed; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const ds = fmtDate(d);
        const day = state.days.find(x => x.date === ds) || state.allDaysByDate[ds];
        if (day && !day.isHoliday && !day.leaveTypeId) weekMins += dayEntryMins(day);
    }

    // Historical weekly totals (last 4 complete weeks — need ≥ 3 to fire)
    const weekTotals = [];
    for (let w = 1; w <= 4; w++) {
        const wMon = new Date(monday);
        wMon.setDate(monday.getDate() - w * 7);
        let wTotal = 0;
        for (let i = 0; i < 5; i++) {
            const d = new Date(wMon);
            d.setDate(wMon.getDate() + i);
            const ds = fmtDate(d);
            const day = state.allDaysByDate[ds];
            if (day && !day.isHoliday && !day.leaveTypeId) wTotal += dayEntryMins(day);
        }
        if (wTotal > 0) weekTotals.push(wTotal);
    }

    if (weekTotals.length < 3) return; // not enough history

    const avgWeekMins = weekTotals.reduce((s, m) => s + m, 0) / weekTotals.length;

    // Extrapolate: project current pace to end of week
    const projectedMins = daysElapsed > 0 ? (weekMins / daysElapsed) * 5 : 0;
    const shortfallRatio = (avgWeekMins - projectedMins) / avgWeekMins;

    if (shortfallRatio < 0.15) return; // within 15% — no alert

    const shortHrs = ((avgWeekMins - weekMins) / 60).toFixed(1);
    pushNotification('underlogged-week',
        `You're ${shortHrs}h below your usual weekly total with ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} left`);
}

/* ── 4. Long streak without a specific ticket ── */

function detectTicketGaps() {
    const today = fmtDate(new Date());

    // Build frequency + last-seen for tickets active in the last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = fmtDate(cutoff);

    const ticketInfo = {}; // ticket → { count, lastSeen }
    for (const [dateStr, day] of Object.entries(state.allDaysByDate)) {
        if (dateStr > today || dateStr < cutoffStr) continue;
        (day.entries || []).forEach(e => {
            if (!e.ticket) return;
            if (!ticketInfo[e.ticket]) ticketInfo[e.ticket] = { count: 0, lastSeen: dateStr };
            ticketInfo[e.ticket].count++;
            if (dateStr > ticketInfo[e.ticket].lastSeen) ticketInfo[e.ticket].lastSeen = dateStr;
        });
    }

    // Also scan current week's days (state.days) which may not be in allDaysByDate yet
    state.days.forEach(day => {
        const dateStr = day.date;
        (day.entries || []).forEach(e => {
            if (!e.ticket) return;
            if (!ticketInfo[e.ticket]) ticketInfo[e.ticket] = { count: 0, lastSeen: dateStr };
            ticketInfo[e.ticket].count++;
            if (dateStr > ticketInfo[e.ticket].lastSeen) ticketInfo[e.ticket].lastSeen = dateStr;
        });
    });

    const GAP_DAYS = 5;
    const MIN_FREQUENCY = 5;
    const MAX_ALERTS = 2;

    // Compute days since last seen relative to today
    const stale = Object.entries(ticketInfo)
        .filter(([, info]) => {
            if (info.count < MIN_FREQUENCY) return false;
            const last = new Date(info.lastSeen + 'T12:00:00');
            const todayDate = new Date(today + 'T12:00:00');
            const diffDays = Math.round((todayDate - last) / 86400000);
            return diffDays > GAP_DAYS;
        })
        .sort((a, b) => a[1].lastSeen.localeCompare(b[1].lastSeen)) // oldest first
        .slice(0, MAX_ALERTS);

    stale.forEach(([ticket, info]) => {
        const last = new Date(info.lastSeen + 'T12:00:00');
        const todayDate = new Date(today + 'T12:00:00');
        const diffDays = Math.round((todayDate - last) / 86400000);
        pushNotification(`ticket-gap-${ticket}`,
            `${ticket} hasn't been logged in ${diffDays} days — still active?`);
    });
}

/* ── 5. Duplicate-looking entries ── */

async function detectDuplicateEntries() {
    const today = fmtDate(new Date());
    const todayData = state.days.find(d => d.date === today) || state.allDaysByDate[today];
    if (!todayData || (todayData.entries || []).length < 2) return;

    const entries = todayData.entries;

    // Rule-based: same ticket + description normalises to the same string
    const normalize = str => (str || '').toLowerCase().trim().replace(/\s+/g, ' ');

    const seen = new Set();
    let hasDupe = false;
    for (const e of entries) {
        const key = `${(e.ticket || '').toLowerCase()}|${normalize(e.desc)}`;
        if (seen.has(key)) { hasDupe = true; break; }
        seen.add(key);
    }

    if (!hasDupe) {
        // AI fuzzy check — only if AI available and rule-based passed
        const enabled = isFeatureEnabled('anomalyDetection');
        if (!enabled) return;
        try {
            const snippets = entries.map((e, i) =>
                `${i + 1}. [${e.ticket || 'no-ticket'}] ${e.desc || ''} (${e.hh || 0}h${e.mm || 0}m)`
            ).join('\n');
            const prompt = `These are today's timesheet entries:\n${snippets}\n\nAre any of these likely duplicates of each other? Reply with only "yes" or "no".`;
            const reply = await ask(prompt, null);
            if (!reply || reply.trim().toLowerCase() !== 'yes') return;
        } catch { return; }
    }

    pushNotification('duplicate-entries',
        `${entries.length} entries today look similar — possible duplicate?`);
}
