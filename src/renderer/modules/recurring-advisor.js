/* =============================================================
   RECURRING TASK ADVISOR
   Detects manual logging patterns and suggests converting them
   to recurring tasks. Runs on Monday app load only.
   ============================================================= */

import { state, RECURRING_DAY_NAMES } from './state.js';
import { isFeatureEnabled, ask } from './ai.js';
import { pushActionableNotification, loadDismissedRecurring } from './notifications.js';
import { fmtDate } from './utils.js';

const MAX_SUGGESTIONS = 3;

/* ── helpers ── */

function normaliseDesc(str) {
    return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Returns "YYYY-Www" ISO week string for a date string
function isoWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const weekNum = Math.floor((d - startOfWeek1) / 604800000) + 1;
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Returns the Mon–Fri day name ('Mon'…'Fri') for a date string, or null for weekends
function weekdayName(dateStr) {
    const dow = new Date(dateStr + 'T12:00:00').getDay(); // 0=Sun…6=Sat
    return RECURRING_DAY_NAMES[dow - 1] || null; // RECURRING_DAY_NAMES is [Mon,Tue,Wed,Thu,Fri]
}

// Checks whether an array of ISO week strings contains N consecutive weeks
function hasConsecutiveWeeks(weeks, n) {
    const sorted = [...new Set(weeks)].sort();
    if (sorted.length < n) return false;
    for (let i = 0; i <= sorted.length - n; i++) {
        let streak = 1;
        for (let j = i + 1; j < sorted.length; j++) {
            const prev = sorted[j - 1].split('-W');
            const cur  = sorted[j].split('-W');
            const prevYear = parseInt(prev[0]), prevWk = parseInt(prev[1]);
            const curYear  = parseInt(cur[0]),  curWk  = parseInt(cur[1]);
            const diff = (curYear - prevYear) * 52 + (curWk - prevWk);
            if (diff === 1) { streak++; if (streak >= n) return true; }
            else break;
        }
    }
    return false;
}

// Checks whether an array of date strings contains N consecutive working days
function hasConsecutiveWorkdays(dates, n) {
    const sorted = [...new Set(dates)].sort();
    if (sorted.length < n) return false;
    for (let i = 0; i <= sorted.length - n; i++) {
        let streak = 1;
        for (let j = i + 1; j < sorted.length; j++) {
            const prev = new Date(sorted[j - 1] + 'T12:00:00');
            const cur  = new Date(sorted[j]     + 'T12:00:00');
            const diffDays = Math.round((cur - prev) / 86400000);
            // Allow Mon after Fri (3 calendar days)
            const isContinuous = diffDays === 1 || (diffDays === 3 && prev.getDay() === 5);
            if (isContinuous) { streak++; if (streak >= n) return true; }
            else break;
        }
    }
    return false;
}

/* ── pattern index ── */

function buildPatternIndex() {
    // key → { ticket, normDesc, rawDescs, type, hh, mm, dates: [], weeksByDay: {Mon:[weeks], ...} }
    const index = {};

    const allDays = { ...state.allDaysByDate };
    // Merge current week days (may not be in allDaysByDate yet)
    state.days.forEach(d => { if (d.date && !allDays[d.date]) allDays[d.date] = d; });

    for (const [dateStr, day] of Object.entries(allDays)) {
        const dayName = weekdayName(dateStr);
        if (!dayName) continue; // skip weekends
        const week = isoWeek(dateStr);

        (day.entries || []).forEach(e => {
            const ticket    = (e.ticket || '').trim();
            const normDesc  = normaliseDesc(e.desc);
            if (!ticket && !normDesc) return;

            const key = `${ticket}|${normDesc}`;
            if (!index[key]) {
                index[key] = {
                    ticket,
                    normDesc,
                    rawDescs: new Set(),
                    type: e.type || '',
                    hh: e.hh || 0,
                    mm: e.mm || 0,
                    dates: [],
                    weeksByDay: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] },
                };
            }
            const rec = index[key];
            rec.rawDescs.add(e.desc || '');
            rec.dates.push(dateStr);
            if (rec.weeksByDay[dayName]) rec.weeksByDay[dayName].push(week);
        });
    }

    return index;
}

/* ── pattern detection ── */

function detectPatterns(index) {
    const dismissed = loadDismissedRecurring();
    const existingKeys = new Set(
        (state.recurringTasks || []).map(r => `${r.ticket}|${normaliseDesc(r.desc)}`)
    );

    const hits = [];

    for (const [key, rec] of Object.entries(index)) {
        if (existingKeys.has(key)) continue; // already a recurring task
        if (dismissed.has(key)) continue;    // user permanently dismissed

        let matchedDays = [];
        let reason = '';

        // Rule 1: same weekday for 3+ consecutive weeks
        for (const day of RECURRING_DAY_NAMES) {
            if (hasConsecutiveWeeks(rec.weeksByDay[day], 3)) {
                matchedDays.push(day);
            }
        }
        if (matchedDays.length > 0) reason = 'weekly';

        // Rule 2: daily for 5+ consecutive working days
        if (!reason && hasConsecutiveWorkdays(rec.dates, 5)) {
            matchedDays = [...RECURRING_DAY_NAMES];
            reason = 'daily';
        }

        // Rule 3: every Monday for 2+ consecutive weeks
        if (!reason && hasConsecutiveWeeks(rec.weeksByDay['Mon'], 2)) {
            matchedDays = ['Mon'];
            reason = 'monday';
        }

        if (!reason) continue;

        hits.push({ key, rec, matchedDays, reason });
    }

    return hits;
}

/* ── AI fuzzy grouping (optional) ── */

async function fuzzyGroupHits(hits) {
    if (hits.length < 2) return hits;

    const snippets = hits.map((h, i) =>
        `${i + 1}. [${h.rec.ticket || 'no-ticket'}] "${[...h.rec.rawDescs][0] || ''}"`
    ).join('\n');

    const prompt =
        `These are timesheet entry patterns detected as likely recurring:\n${snippets}\n\n` +
        `Which entries (by number) describe the same task but with slightly different wording? ` +
        `Reply with only groups like "1,3" or "2,4" on separate lines, one group per line. ` +
        `If no duplicates, reply "none".`;

    try {
        const reply = await ask(prompt, null);
        if (!reply || reply.trim().toLowerCase() === 'none') return hits;

        // Parse groups and merge: keep the first hit, mark others as duplicates
        const merged = new Set();
        reply.trim().split('\n').forEach(line => {
            const idxs = line.split(',').map(s => parseInt(s.trim()) - 1).filter(i => !isNaN(i) && i < hits.length);
            if (idxs.length < 2) return;
            idxs.slice(1).forEach(i => merged.add(i));
        });

        return hits.filter((_, i) => !merged.has(i));
    } catch {
        return hits;
    }
}

/* ── message builder ── */

function buildMessage(hit) {
    const { rec, reason } = hit;
    const label = [...rec.rawDescs][0] || rec.normDesc || rec.ticket;
    const ticket = rec.ticket ? `'${rec.ticket}'` : `'${label}'`;

    if (reason === 'daily') {
        return `You've logged ${ticket} every day — want to make it a recurring task?`;
    }
    if (reason === 'monday') {
        return `You've logged ${ticket} every Monday — want to make it a recurring task?`;
    }
    // weekly — list matched days
    const dayList = hit.matchedDays.join('/');
    return `You've logged ${ticket} every ${dayList} for several weeks — want to make it a recurring task?`;
}

/* ── public entry point ── */

export async function runRecurringAdvisor() {
    if (!isFeatureEnabled('recurringAdvisor')) return;

    const index = buildPatternIndex();
    let hits = detectPatterns(index);
    if (hits.length === 0) return;

    hits = await fuzzyGroupHits(hits);
    hits = hits.slice(0, MAX_SUGGESTIONS);

    hits.forEach(hit => {
        const { key, rec, matchedDays } = hit;
        const desc = [...rec.rawDescs][0] || rec.normDesc;
        const message = buildMessage(hit);

        // actionPayload is serialisable — openRecurringForm accepts this shape
        const actionPayload = {
            id: '',           // empty = new rule
            ticket: rec.ticket,
            hh: rec.hh,
            mm: rec.mm,
            type: rec.type,
            desc,
            days: matchedDays,
            dismissKey: key,  // used for permanent dismissal on "X"
        };

        pushActionableNotification(
            `recurring-advisor-${key.slice(0, 40)}`,
            message,
            'make-recurring',
            actionPayload
        );
    });
}
