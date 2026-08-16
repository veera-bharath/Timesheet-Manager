import { state } from './state.js';
import { isFeatureEnabled, ask, getProvider, refreshSettings } from './ai.js';
import { escHtml } from './utils.js';
import { openEntryModal } from './entry-modal.js';
import { getWeekStrFromDate } from './week.js';

let _messages = [];   // { role: 'user'|'assistant', content: string }[]
let _thinking  = false;

/* ── TIME HELPERS ────────────────────────────────────────── */
function minsToStr(mins) {
    if (mins <= 0) return '0h 0min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 && m > 0 ? `${h}h ${m}min`
         : h > 0           ? `${h}h`
                           : `${m}min`;
}

/* Verbose form includes raw minutes so AI can't confuse "7h 15min" with "15min" */
function minsToStrV(mins) {
    const base = minsToStr(mins);
    return mins >= 60 ? `${base} (= ${mins} minutes total)` : `${mins} minutes`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ── HISTORY CONTEXT BUILDER ─────────────────────────────── */
function buildHistoryContext(isLocal) {
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const targetMins = state.dailyTargetMins || 480;
    const targetH    = (targetMins / 60).toFixed(1);

    /* ── current week summary from state.days ── */
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    let weekTotalMins = 0;
    let daysElapsed   = 0;
    const weekLines   = [];

    for (let i = 0; i < (state.days || []).length; i++) {
        const day = state.days[i];
        if (!day) continue;
        const dayName = DAYS[i] || `Day${i + 1}`;
        const dateStr = day.date || '';
        if (dateStr > todayStr) break; // future days not counted yet
        if (day.isHoliday) {
            weekLines.push(`  ${dayName} ${dateStr}: Holiday${day.holidayLabel ? ` (${day.holidayLabel})` : ''} — not counted`);
            continue;
        }
        const dayMins = (day.entries || []).reduce((s, e) =>
            s + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);
        weekTotalMins += dayMins;
        daysElapsed++;
        const dayGap = targetMins - dayMins;
        const dayGapStr = dayGap > 0
            ? `MISSING ${minsToStrV(dayGap)}`
            : dayGap < 0 ? `SURPLUS ${minsToStrV(-dayGap)}` : `COMPLETE`;
        weekLines.push(`  ${dayName} ${dateStr}: logged ${minsToStrV(dayMins)} | daily target ${minsToStrV(targetMins)} | ${dayGapStr}`);
    }

    const weekTargetMins = daysElapsed * targetMins;
    const gapMins        = weekTargetMins - weekTotalMins;

    const lines = [
        `TODAY: ${todayStr}`,
        `DAILY TARGET: ${targetH}h = ${targetMins} minutes per day`,
        ``,
        `THIS WEEK BREAKDOWN:`,
        ...weekLines,
        ``,
        `WEEK TOTALS (days elapsed so far: ${daysElapsed}):`,
        `  Target for ${daysElapsed} day(s): ${minsToStrV(weekTargetMins)}`,
        `  Logged so far:               ${minsToStrV(weekTotalMins)}`,
        `  ${gapMins > 0
            ? `MISSING: ${minsToStrV(gapMins)} (= ${weekTargetMins} target − ${weekTotalMins} logged)`
            : `SURPLUS: ${minsToStrV(-gapMins)} (= ${weekTotalMins} logged − ${weekTargetMins} target)`}`,
        `  Days remaining in week: ${5 - daysElapsed}`,
        `  Remaining target: ${minsToStrV((5 - daysElapsed) * targetMins)}`,
        `  Full week target: ${minsToStrV(5 * targetMins)}`,
    ];

    /* ── for local models: only return the summary (much shorter prompt) ── */
    if (isLocal) {
        return lines.join('\n');
    }

    /* ── for cloud: add recent raw log (last 30 days) ── */
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const allDates  = Object.keys(state.allDaysByDate || {}).sort().reverse();
    const rawLines  = [];
    let olderMins   = 0;
    let olderCount  = 0;

    for (const date of allDates) {
        const day = state.allDaysByDate[date];
        if (!day) continue;
        if (date < cutoffStr) {
            olderMins  += (day.entries || []).reduce((s, e) =>
                s + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);
            olderCount += (day.entries || []).length;
            continue;
        }
        if (day.isHoliday) {
            rawLines.push(`${date}: [${day.holidayLabel || 'Holiday'}]`);
            continue;
        }
        const entries = day.entries || [];
        if (!entries.length) continue;
        const parts = entries.map(e => {
            const t  = e.ticket ? e.ticket.trim() : '(no ticket)';
            const hh = pad2(e.hh || 0);
            const mm = pad2(e.mm || 0);
            const d  = (e.desc || '').trim().slice(0, 50);
            return `${t} ${hh}:${mm}${d ? ' ' + d : ''}`;
        });
        rawLines.push(`${date}: ${parts.join(' | ')}`);
    }

    lines.push('', 'RECENT LOG (last 30 days, newest first):');

    let raw = rawLines.join('\n');
    // Cap total at ~5000 chars
    while (raw.length > 5000 && rawLines.length > 1) {
        rawLines.pop();
        raw = rawLines.join('\n');
    }
    lines.push(raw);

    if (olderCount > 0) {
        lines.push(`OLDER (before last 30 days): ${olderCount} entries, ${minsToStr(olderMins)} total`);
    }

    return lines.join('\n');
}

/* ── INTENT: ADD ENTRY ───────────────────────────────────── */
const ADD_INTENT = /^\s*(add|log|create|record|track|book)\b/i;

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_PAT   = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DAY_NAMES   = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const DAY_PAT     = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun';

/* Resolve a date expression in the message to a YYYY-MM-DD string (or null). */
function extractTargetDate(text) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (/\btoday\b/i.test(text)) return todayStr;

    if (/\byesterday\b/i.test(text)) {
        const d = new Date(now); d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
    }

    // "last monday", "on friday", "this thursday", "monday"
    const dmMatch = /\b(?:(?:last|this|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
    if (dmMatch) {
        const target = DAY_NAMES.indexOf(dmMatch[1].toLowerCase()); // 0=Sun
        const cur    = now.getDay();
        let diff     = cur - target;
        if (diff <= 0) diff += 7; // always go to the most recent past occurrence (or today)
        const d = new Date(now); d.setDate(d.getDate() - diff);
        return d.toISOString().slice(0, 10);
    }

    // "23 april", "23rd april 2026", "april 23"
    const mdRe = new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PAT})(?:\\s+(\\d{4}))?\\b` +
        `|\\b(${MONTH_PAT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`,
        'i'
    );
    const mdMatch = mdRe.exec(text);
    if (mdMatch) {
        let dayNum, monthStr, yearStr;
        if (mdMatch[1]) {
            dayNum   = parseInt(mdMatch[1]);
            monthStr = mdMatch[2];
            yearStr  = mdMatch[3];
        } else {
            monthStr = mdMatch[4];
            dayNum   = parseInt(mdMatch[5]);
            yearStr  = mdMatch[6];
        }
        const fullMonthStr = monthStr.toLowerCase().slice(0, 3);
        const month = MONTH_NAMES.findIndex(m => m.startsWith(fullMonthStr));
        if (month === -1) return null;
        const year = yearStr ? parseInt(yearStr) : now.getFullYear();
        const d = new Date(year, month, dayNum);
        if (isNaN(d.getTime())) return null;
        // If computed date is in the future by >180 days, assume last year
        if (!yearStr && d > now && (d - now) > 180 * 86400000) d.setFullYear(year - 1);
        return d.toISOString().slice(0, 10);
    }

    return null;
}

function tryParseChatEntry(text) {
    let remaining = text.replace(/^\s*(add|log|create|record|track|book)\s*/i, '').trim();

    // Extract target date BEFORE stripping (we need the string for validation)
    const targetDate = extractTargetDate(remaining);

    // Consume hedging words before numbers so they don't bleed into description
    remaining = remaining.replace(/\b(about|around|approximately)\s+(\d)/gi, '$2');

    let hh = 0, mm = 0, timeMatched = false;

    const mH = /(\d+(?:\.\d+)?)\s*h(?:(?:our|rs?)s?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(remaining);
    if (mH) {
        const hrs = parseFloat(mH[1]);
        hh = Math.floor(hrs);
        mm = Math.round((hrs % 1) * 60) + (mH[2] ? parseInt(mH[2]) : 0);
        remaining = remaining.replace(mH[0], ' ');
        timeMatched = true;
    }
    if (!timeMatched) {
        const mM = /(\d+)\s*m(?:in(?:ute)?s?)?\b/i.exec(remaining);
        if (mM) {
            const totalMins = parseInt(mM[1]);
            hh = Math.floor(totalMins / 60);
            mm = totalMins % 60;
            remaining = remaining.replace(mM[0], ' ');
            timeMatched = true;
        }
    }
    if (!timeMatched) {
        const mC = /(\d+):(\d{2})\b/.exec(remaining);
        if (mC) {
            hh = parseInt(mC[1]);
            mm = parseInt(mC[2]);
            remaining = remaining.replace(mC[0], ' ');
            timeMatched = true;
        }
    }

    hh += Math.floor(mm / 60);
    mm  = mm % 60;

    // Extract ticket
    let ticket = '';
    const mT = /\b([A-Z][A-Z0-9]+-\d+|#\d+)\b/.exec(remaining);
    if (mT) { ticket = mT[1]; remaining = remaining.replace(mT[0], ' '); }

    // Clean description — strip date expressions, prepositions, noise
    const dateRe = new RegExp(
        `\\b(?:on|last|this|next)\\s+(?:${DAY_PAT})\\b` +
        `|\\b(?:${DAY_PAT})\\b` +
        `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_PAT})(?:\\s+\\d{4})?\\b` +
        `|\\b(?:${MONTH_PAT})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b` +
        `|\\b(?:today|yesterday)\\b`,
        'gi'
    );
    let desc = remaining.replace(dateRe, ' ');
    desc = desc
        .replace(/\b(on|for|with|about|around|approx(?:imately)?|ticket|ref(?:erence)?)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ').trim();
    desc = desc
        .replace(/^time\s+(for\s+)?(a\s+|the\s+)?/i, '')
        .replace(/^(a|the)\s+/i, '')
        .trim();

    return { ticket, hh, mm, desc, timeMatched, targetDate };
}

function handleAddIntent(text) {
    const parsed = tryParseChatEntry(text);
    const WEEK_DAYS_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    const todayStr = new Date().toISOString().slice(0, 10);

    /* ── Date was specified in the message ── */
    if (parsed.targetDate) {
        const d   = new Date(parsed.targetDate + 'T00:00:00');
        const dow = d.getDay(); // 0=Sun, 6=Sat

        // Weekend
        if (dow === 0 || dow === 6) {
            const label = dow === 0 ? 'Sunday' : 'Saturday';
            return `<strong>${label} ${parsed.targetDate}</strong> is a weekend — entries can only be logged on weekdays (Monday–Friday).`;
        }

        // Future date
        if (parsed.targetDate > todayStr) {
            return `<strong>${WEEK_DAYS_FULL[dow - 1]} ${parsed.targetDate}</strong> is in the future — you can only log time for today or past days.`;
        }

        // If not in current week, auto-switch the week picker
        const targetWeekStr = getWeekStrFromDate(d);
        const didSwitch = targetWeekStr !== state.weekValue;
        if (didSwitch) {
            const picker = document.getElementById('week-picker');
            if (!picker) {
                return `Could not switch weeks automatically. Please navigate to the week containing <strong>${parsed.targetDate}</strong> manually and try again.`;
            }
            picker.value = targetWeekStr;
            picker.dispatchEvent(new Event('change')); // rebuilds state.days synchronously
        }

        // Find the day in the (now updated) state.days
        const dayIdx = (state.days || []).findIndex(day => day.date === parsed.targetDate);
        if (dayIdx === -1) {
            return `Could not find <strong>${parsed.targetDate}</strong> in the timesheet. Please navigate to that week manually and try again.`;
        }

        // Holiday check
        const day = state.days[dayIdx];
        if (day.isHoliday) {
            const label = day.holidayLabel || 'a holiday';
            return `<strong>${WEEK_DAYS_FULL[dayIdx]} ${parsed.targetDate}</strong> is marked as ${escHtml(label)} — entries cannot be logged on holidays.`;
        }

        openModalWithParsed(dayIdx, parsed, text);
        return buildConfirmHtml(WEEK_DAYS_FULL[dayIdx], parsed, didSwitch ? parsed.targetDate : null);
    }

    /* ── No date specified — use expanded day or today ── */
    let dayIdx = (state.days || []).findIndex(d => d.expanded);
    if (dayIdx === -1) {
        dayIdx = (state.days || []).findIndex(d => d.date === todayStr);
    }
    if (dayIdx === -1) dayIdx = 0;

    openModalWithParsed(dayIdx, parsed, text);
    return buildConfirmHtml(WEEK_DAYS_FULL[dayIdx] || `Day ${dayIdx + 1}`, parsed, null);
}

function openModalWithParsed(dayIdx, parsed, rawText) {
    document.getElementById('entryModal').addEventListener('shown.bs.modal', () => {
        const nlInput = document.getElementById('modal-nl-input');
        if (nlInput) nlInput.value = rawText.replace(/^\s*(add|log|create|record|track|book)\s*/i, '').trim();
        if (parsed.timeMatched) {
            const el = document.getElementById('modal-time');
            if (el) el.value = `${pad2(parsed.hh)}:${pad2(parsed.mm)}`;
        }
        if (parsed.ticket) {
            const el = document.getElementById('modal-ticket');
            if (el) el.value = parsed.ticket;
        }
        if (parsed.desc) {
            const el = document.getElementById('modal-desc');
            if (el) el.value = parsed.desc;
        }
    }, { once: true });
    openEntryModal(dayIdx, -1);
}

function buildConfirmHtml(dayName, parsed, switchedToDate) {
    const parts = [];
    if (parsed.ticket)      parts.push(`Ticket: <strong>${escHtml(parsed.ticket)}</strong>`);
    if (parsed.timeMatched) parts.push(`Time: <strong>${pad2(parsed.hh)}:${pad2(parsed.mm)}</strong>`);
    if (parsed.desc)        parts.push(`Description: ${escHtml(parsed.desc)}`);
    const hint = `<span style="font-size:0.75rem;color:var(--text-secondary)">Review and save in the modal.</span>`;
    const switchNote = switchedToDate
        ? `<span style="font-size:0.75rem;color:var(--text-secondary)">Switched to week containing ${escHtml(switchedToDate)}.</span><br>`
        : '';
    return parts.length
        ? `${switchNote}Opening entry for <strong>${escHtml(dayName)}</strong>:<br>${parts.map(p => `&nbsp;• ${p}`).join('<br>')}<br>${hint}`
        : `${switchNote}Opening entry modal for <strong>${escHtml(dayName)}</strong>. Fill in the details and save.`;
}

/* ── MARKDOWN-LITE RENDERER ─────────────────────────────── */
function mdLiteSafe(text) {
    const lines = text.split('\n');
    const out   = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (line.includes('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].includes('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            const dataRows = tableLines.filter(l => !/^\s*[\|\s\-:]+\s*$/.test(l));
            if (dataRows.length > 0) {
                const rows = dataRows.map(r =>
                    r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
                );
                const header = rows[0];
                const body   = rows.slice(1);
                let tableHtml = '<table><thead><tr>';
                tableHtml += header.map(h => `<th>${escHtml(h)}</th>`).join('');
                tableHtml += '</tr></thead><tbody>';
                for (const row of body) {
                    tableHtml += '<tr>' + row.map(c => `<td>${escHtml(c)}</td>`).join('') + '</tr>';
                }
                tableHtml += '</tbody></table>';
                out.push(tableHtml);
            }
            continue;
        }

        let safe = escHtml(line);
        safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
        out.push(safe || '');
        i++;
    }

    return out.join('<br>');
}

/* ── BUBBLE HELPERS ─────────────────────────────────────── */
function renderBubble(role, html, id) {
    const chatMessages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}`;
    if (id) div.id = id;
    div.innerHTML = html;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}

/* ── SEND MESSAGE ───────────────────────────────────────── */
async function sendMessage() {
    if (_thinking) return;

    const inputEl  = document.getElementById('chat-input');
    const sendBtn  = document.getElementById('btn-chat-send');
    const text     = (inputEl.value || '').trim();
    if (!text) return;

    const hint = document.getElementById('chat-empty-hint');
    if (hint) hint.style.display = 'none';

    inputEl.value = '';
    inputEl.style.height = 'auto';
    _thinking = true;
    sendBtn.disabled = true;

    renderBubble('user', escHtml(text).replace(/\n/g, '<br>'));
    _messages.push({ role: 'user', content: text });

    // ── Handle add-entry intent locally (no AI call) ──
    if (ADD_INTENT.test(text)) {
        const html = handleAddIntent(text);
        renderBubble('ai', html);
        _messages.push({ role: 'assistant', content: text });
        _thinking = false;
        sendBtn.disabled = false;
        inputEl.focus();
        return;
    }

    const thinkingBubble = renderBubble('thinking', 'Thinking…', 'chat-thinking-bubble');

    // Build prompt
    const isLocal = getProvider() === 'local';
    const today   = new Date().toISOString().slice(0, 10);
    const history = buildHistoryContext(isLocal);

    const lastTurns = _messages.slice(-11, -1);
    const convoStr  = lastTurns.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n');

    const systemNote = isLocal
        ? `You are a timesheet assistant. Answer using ONLY the data in TIMESHEET DATA. Be brief. For per-day questions, read that day's line in THIS WEEK BREAKDOWN — each line shows logged time, daily target, and the gap for that day. Never confuse the gap (MISSING/SURPLUS) with the logged time.`
        : `You are a timesheet assistant. Answer questions about the user's work log accurately and concisely. Rules: (1) For questions about a specific day, read that day's line in THIS WEEK BREAKDOWN — it already contains logged time, daily target, and gap for that day. (2) For week-level questions, use WEEK TOTALS. (3) Never use the full-week target for a single-day question. (4) Never confuse the MISSING amount with the logged amount — they are different numbers on each day's line.`;

    const prompt = [
        systemNote,
        ``,
        `TIMESHEET DATA:`,
        history,
        ``,
        convoStr ? `CONVERSATION SO FAR:\n${convoStr}\n` : null,
        `USER QUESTION: ${text}`,
    ].filter(l => l != null).join('\n');

    let response = await ask(prompt, null);
    if (!response) {
        response = "Sorry, I couldn’t reach the AI. Check your settings.";
    }

    thinkingBubble?.remove();

    renderBubble('ai', mdLiteSafe(response));
    _messages.push({ role: 'assistant', content: response });

    _thinking = false;
    sendBtn.disabled = false;
    inputEl.focus();
}

/* ── INIT ────────────────────────────────────────────────── */
export function initAiChat() {
    const btnOpen  = document.getElementById('btn-ai-chat');
    const btnClear = document.getElementById('btn-chat-clear');
    const btnSend  = document.getElementById('btn-chat-send');
    const inputEl  = document.getElementById('chat-input');
    const panel    = document.getElementById('aiChatPanel');

    if (!btnOpen || !panel) return;

    refreshSettings().then(() => {
        btnOpen.style.display = isFeatureEnabled('chat') ? '' : 'none';
    });
    
    window.addEventListener('ai-settings-changed', () => {
        btnOpen.style.display = isFeatureEnabled('chat') ? '' : 'none';
    });

    btnOpen.addEventListener('click', () => new bootstrap.Offcanvas(panel).show());

    btnClear?.addEventListener('click', () => {
        _messages = [];
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        const hint = document.getElementById('chat-empty-hint');
        if (hint) hint.style.display = '';
    });

    btnSend?.addEventListener('click', () => sendMessage());

    inputEl?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    inputEl?.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    });

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            if (isFeatureEnabled('chat')) new bootstrap.Offcanvas(panel).show();
        }
    });
}
