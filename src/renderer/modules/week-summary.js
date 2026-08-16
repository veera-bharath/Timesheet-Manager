import { state } from './state.js';
import { isFeatureEnabled, ask, refreshSettings } from './ai.js';
import { showToast } from './toast.js';

/* ── DATA BUILDER ───────────────────────────────────────── */
function buildWeekData() {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const todayStr = new Date().toISOString().slice(0, 10);
    const targetMins = state.dailyTargetMins || 480;

    let weekLabel = '';
    const dayRows = [];
    const ticketMap = {}; // ticket → { mins, descs[] }
    let totalMins = 0;
    let firstDate = '', lastDate = '';

    for (let i = 0; i < (state.days || []).length; i++) {
        const day = state.days[i];
        if (!day) continue;
        const dayName = DAYS[i] || `Day ${i + 1}`;
        const date = day.date || '';

        if (!firstDate) firstDate = date;
        lastDate = date;

        if (day.isHoliday) {
            dayRows.push({ dayName, date, isHoliday: true, label: day.holidayLabel || 'Holiday', mins: 0, entries: [] });
            continue;
        }

        const entries = day.entries || [];
        const dayMins = entries.reduce((s, e) =>
            s + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);

        if (date <= todayStr) totalMins += dayMins;

        for (const e of entries) {
            const ticket = (e.ticket || '').trim() || '(no ticket)';
            const desc   = (e.desc   || '').trim();
            const emins  = (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
            if (!ticketMap[ticket]) ticketMap[ticket] = { mins: 0, descs: [] };
            ticketMap[ticket].mins += emins;
            if (desc && !ticketMap[ticket].descs.includes(desc)) ticketMap[ticket].descs.push(desc);
        }

        dayRows.push({ dayName, date, isHoliday: false, mins: dayMins, entries });
    }

    // Week label e.g. "Apr 21 – Apr 25"
    if (firstDate && lastDate) {
        const fmt = d => {
            const [,m,dd] = d.split('-');
            const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1];
            return `${mon} ${parseInt(dd)}`;
        };
        weekLabel = `${fmt(firstDate)} – ${fmt(lastDate)}`;
    }

    const hh = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    const totalStr = mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;

    return { weekLabel, totalStr, totalMins, dayRows, ticketMap, todayStr, targetMins };
}

function fmtMins(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

/* ── PROMPT BUILDER ─────────────────────────────────────── */
function buildPrompt(format, data) {
    const { weekLabel, totalStr, dayRows, ticketMap, todayStr, targetMins } = data;

    // Compact per-day block
    const DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri'];
    const dayBlock = dayRows.map((d, i) => {
        if (d.isHoliday) return `  ${DAYS_SHORT[i] || d.dayName} ${d.date}: [${d.label}]`;
        const gap = targetMins - d.mins;
        const status = d.date > todayStr ? '(future)' : gap > 0 ? `MISSING ${fmtMins(gap)}` : 'COMPLETE';
        return `  ${DAYS_SHORT[i] || d.dayName} ${d.date}: logged ${fmtMins(d.mins)} | ${status}`;
    }).join('\n');

    // Per-ticket block
    const ticketBlock = Object.entries(ticketMap)
        .sort((a, b) => b[1].mins - a[1].mins)
        .map(([ticket, { mins, descs }]) => {
            const descStr = descs.slice(0, 3).join('; ');
            return `  ${ticket}: ${fmtMins(mins)}${descStr ? ' — ' + descStr : ''}`;
        }).join('\n');

    const dataSection = [
        `Week: ${weekLabel}`,
        `Total logged: ${totalStr}`,
        `Daily target: ${fmtMins(targetMins)}`,
        ``,
        `DAY BREAKDOWN:`,
        dayBlock || '  (no days)',
        ``,
        `BY TICKET:`,
        ticketBlock || '  (no entries)',
    ].join('\n');

    const formatInstructions = {
        bullet: `Generate a bullet-list week summary. Start with "Week of ${weekLabel} (${totalStr} logged)" then one bullet per ticket/theme with hours and a short description of the work done. Keep each bullet to one line. Do not add extra sections.`,
        paragraph: `Write a short 2–3 sentence paragraph summarising this week's work. Suitable for a status update email to a manager. Mention the main tickets and themes worked on and total time. Do not use bullet points.`,
        standup: `Generate a standup-style summary with three sections: "Yesterday:" (most recent logged day's work), "Today:" (today's planned or logged work — if today has no entries, write "Continuing work on [main ticket]"), and "Blockers:" (write "None." unless you can infer one). Keep each section to 1–2 lines.`,
    };

    return [
        `You are a timesheet assistant. Generate a work summary from the data below. Be concise and professional. Do not invent work that is not in the data.`,
        ``,
        `TIMESHEET DATA:`,
        dataSection,
        ``,
        `INSTRUCTION: ${formatInstructions[format]}`,
    ].join('\n');
}

/* ── MODAL LOGIC ────────────────────────────────────────── */
let _modal = null;
let _generating = false;
let _currentFormat = 'bullet';

function showGenerating() {
    const out = document.getElementById('week-summary-output');
    if (!out) return;
    out.innerHTML = '';
    const wrap = out.parentElement;
    let spinner = wrap.querySelector('.summary-generating');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'summary-generating';
        spinner.innerHTML = `<div class="summary-generating-dot"></div><div class="summary-generating-dot"></div><div class="summary-generating-dot"></div><span>Generating…</span>`;
        wrap.insertBefore(spinner, out);
    }
    spinner.style.display = 'flex';
    out.style.display = 'none';
}

function showOutput(text) {
    const out = document.getElementById('week-summary-output');
    if (!out) return;
    const wrap = out.parentElement;
    const spinner = wrap.querySelector('.summary-generating');
    if (spinner) spinner.style.display = 'none';
    out.style.display = '';
    out.textContent = text;
}

async function runGenerate() {
    if (_generating) return;
    _generating = true;

    const genBtn  = document.getElementById('btn-generate-summary');
    const regenBtn = document.getElementById('btn-regenerate-summary');
    if (genBtn)  genBtn.disabled = true;
    if (regenBtn) regenBtn.disabled = true;

    if (!_modal) _modal = new bootstrap.Modal(document.getElementById('weekSummaryModal'));
    _modal.show();
    showGenerating();

    const data   = buildWeekData();
    const prompt = buildPrompt(_currentFormat, data);
    const result = await ask(prompt, null);

    if (!result) {
        showOutput('Could not reach the AI. Please check your AI settings and try again.');
    } else {
        showOutput(result);
    }

    _generating = false;
    if (genBtn)  genBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
}

/* ── INIT ────────────────────────────────────────────────── */
export function initWeekSummary() {
    const section = document.getElementById('week-summary-section');
    const genBtn  = document.getElementById('btn-generate-summary');

    if (!section || !genBtn) return;

    // Show section only when feature is enabled
    refreshSettings().then(() => {
        section.style.display = isFeatureEnabled('weeklySummary') ? '' : 'none';
    });
    
    window.addEventListener('ai-settings-changed', () => {
        section.style.display = isFeatureEnabled('weeklySummary') ? '' : 'none';
    });

    // Format chip selection
    section.querySelectorAll('.summary-format-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            section.querySelectorAll('.summary-format-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            _currentFormat = chip.dataset.format;
        });
    });

    // Generate button
    genBtn.addEventListener('click', () => runGenerate());

    // Regenerate button (inside modal)
    document.getElementById('btn-regenerate-summary')?.addEventListener('click', () => runGenerate());

    // Copy button
    document.getElementById('btn-copy-summary')?.addEventListener('click', () => {
        const text = document.getElementById('week-summary-output')?.textContent || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => showToast('Summary copied to clipboard.', 'success'));
    });
}
