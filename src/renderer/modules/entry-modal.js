import { state, WEEK_DAYS, MAX_DAY_MINS } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { updateSummary } from './summary.js';
import { populateTypeSelect } from './ticket-types.js';
import { parseTimeInput, fmtTimeInput, timeInputError } from './utils.js';
// Circular — resolved at call time
import { rerenderDayCard, renderAll } from './render.js';
import { updateNoTicketBanner } from './no-ticket-reminder.js';
import { updateUnderloggedBanner } from './underlogged-reminder.js';
import { isFeatureEnabled, ask, askWithModel, getProvider } from './ai.js';

let entryModal;
export let lastDeleted = null;

/* ── NATURAL LANGUAGE PARSING ───────────────────────────── */

function tryRegexParse(text) {
    let remaining = text.trim();
    let hh = 0, mm = 0, timeMatched = false;

    // 2h30m / 2 h 30 m / 1.5h / 2h
    const mH = /(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?/i.exec(remaining);
    if (mH) {
        const hrs = parseFloat(mH[1]);
        hh = Math.floor(hrs);
        mm = Math.round((hrs % 1) * 60) + (mH[2] ? parseInt(mH[2]) : 0);
        remaining = remaining.replace(mH[0], ' ');
        timeMatched = true;
    }

    if (!timeMatched) {
        // 30m / 90min
        const mM = /(\d+)\s*m(?:in)?\b/i.exec(remaining);
        if (mM) {
            const totalMins = parseInt(mM[1]);
            hh = Math.floor(totalMins / 60);
            mm = totalMins % 60;
            remaining = remaining.replace(mM[0], ' ');
            timeMatched = true;
        }
    }

    if (!timeMatched) {
        // 2:30 clock format
        const mC = /(\d+):(\d{2})\b/.exec(remaining);
        if (mC) {
            hh = parseInt(mC[1]);
            mm = parseInt(mC[2]);
            remaining = remaining.replace(mC[0], ' ');
            timeMatched = true;
        }
    }

    if (!timeMatched) return null;

    // Normalise mm overflow (e.g. 1.5h30m → mm=60 → hh+1)
    hh += Math.floor(mm / 60);
    mm = mm % 60;

    // Extract ticket
    let ticket = '';
    const mT = /\b([A-Z][A-Z0-9]+-\d+|#\d+)\b/.exec(remaining);
    if (mT) {
        ticket = mT[1];
        remaining = remaining.replace(mT[0], ' ');
    }

    // Clean up filler words and excess whitespace
    const desc = remaining.replace(/\bon\b|\bfor\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();

    return { ticket, hh, mm, desc };
}

async function parseNaturalEntry(text) {
    if (!text.trim()) return null;

    const regex = tryRegexParse(text);
    if (regex && (regex.hh > 0 || regex.mm > 0)) return regex;

    // AI fallback — structured prompt tuned for local models (Ollama/llama3)
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const prompt = `TASK: Parse a timesheet entry into JSON.
Output ONLY raw JSON. No explanation, no markdown, no code fences.
JSON format: {"ticket":"","hh":0,"mm":0,"desc":""}

FIELD RULES:
- ticket: ticket ID like TM-123, JIRA-45, ABC-7, or #99. Empty string if none.
- hh: whole hours as integer.
- mm: remaining minutes as integer, 0-59.
- desc: ONLY the activity or work done. Strip ALL time expressions (durations, hours, minutes, "about X hours", "for X hours", "X min", etc.) and the ticket ID. desc must never contain a number referring to time.

TIME PHRASE REFERENCE:
"15 minutes" or "quarter hour" → hh:0, mm:15
"half an hour" or "30 minutes" → hh:0, mm:30
"an hour" or "one hour"       → hh:1, mm:0
"an hour and a half"          → hh:1, mm:30
"two hours" or "couple hours" → hh:2, mm:0
"few hours" or "a few hours"  → hh:3, mm:0
"the morning" or "half a day" → hh:4, mm:0

EXAMPLES:
Entry: "meet with client for about 2 hours (ABC-10)"
JSON: {"ticket":"ABC-10","hh":2,"mm":0,"desc":"meet with client"}

Entry: "spent half an hour reviewing PR for #45"
JSON: {"ticket":"#45","hh":0,"mm":30,"desc":"reviewing PR"}

Entry: "quick standup 15 minutes"
JSON: {"ticket":"","hh":0,"mm":15,"desc":"standup"}

Entry: "morning session on XY-88 fixing auth bug"
JSON: {"ticket":"XY-88","hh":4,"mm":0,"desc":"fixing auth bug"}

NOW PARSE ONLY THIS ENTRY (ignore the examples above):
Entry: "${escaped}"
JSON:`;

    try {
        const raw = await ask(prompt, null);
        if (!raw) return null;
        const match = /\{[\s\S]*?\}/.exec(raw);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.hh !== 'number' || typeof parsed.mm !== 'number') return null;
        parsed.hh = Math.max(0, Math.floor(parsed.hh));
        parsed.mm = Math.max(0, Math.min(59, Math.floor(parsed.mm)));
        return parsed;
    } catch (_) {
        return null;
    }
}

function applyParsedEntry(parsed) {
    if (!parsed) return;

    if (parsed.ticket) {
        document.getElementById('modal-no-ticket').checked = false;
        document.getElementById('modal-ticket-wrap').style.display = '';
        document.getElementById('modal-ticket').value = parsed.ticket;
    }
    if (parsed.hh > 0 || parsed.mm > 0) {
        const timeEl = document.getElementById('modal-time');
        timeEl.value = fmtTimeInput(parsed.hh, parsed.mm);
        timeEl.classList.remove('is-invalid');
        document.getElementById('modal-time-error').textContent = '';
    }
    if (parsed.desc) {
        document.getElementById('modal-desc').value = parsed.desc;
    }
    updateEntryDayTotal();
}

/* ── SMART SUGGESTIONS ──────────────────────────────────── */

let _history = {};   // rebuilt each time the modal opens

function buildEntryHistory() {
    const byTicket = {};
    for (const day of Object.values(state.allDaysByDate || {})) {
        for (const entry of (day.entries || [])) {
            const t = (entry.ticket || '').trim().toUpperCase();
            if (!t) continue;
            if (!byTicket[t]) byTicket[t] = { count: 0, lastDate: '', descs: {}, totalMins: 0, timeSamples: 0 };
            const r = byTicket[t];
            r.count++;
            if ((day.date || '') > r.lastDate) r.lastDate = day.date || '';
            const d = (entry.desc || '').trim();
            if (d) {
                r.descs[d] = (r.descs[d] || 0) + 1;
                const mins = (parseInt(entry.hh) || 0) * 60 + (parseInt(entry.mm) || 0);
                if (mins > 0) { r.totalMins += mins; r.timeSamples++; }
            }
        }
    }
    return byTicket;
}

function refreshDescSuggestions(ticket) {
    const container = document.getElementById('desc-suggestions');
    container.innerHTML = '';
    const rec = _history[(ticket || '').toUpperCase()];
    if (!rec) return;
    const top3 = Object.entries(rec.descs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([d]) => d);
    for (const d of top3) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'suggestion-chip';
        chip.textContent = d;
        chip.addEventListener('click', () => {
            document.getElementById('modal-desc').value = d;
            container.innerHTML = '';
        });
        container.appendChild(chip);
    }
}

function refreshTimeHint(ticket) {
    const hint = document.getElementById('time-hint');
    const rec = _history[(ticket || '').toUpperCase()];
    if (rec && rec.timeSamples >= 1) {
        const avgMins = Math.round(rec.totalMins / rec.timeSamples);
        const hh = Math.floor(avgMins / 60);
        const mm = avgMins % 60;
        hint.textContent = `avg ${fmtTimeInput(hh, mm)} for this ticket`;
        hint.classList.add('show');
    } else {
        hint.classList.remove('show');
    }
}

function stripAiPreamble(text) {
    // Remove common local-model preamble lines ("Sure, here is...", "Here is...", etc.)
    const lines = text.trim().split('\n');
    const preambleRe = /^(sure[,.]|here is|here's|certainly|of course|below is|the improved|improved version)/i;
    const cleaned = lines.filter(l => !preambleRe.test(l.trim()) && l.trim() !== '');
    return cleaned.join(' ').trim();
}

function initTicketAutocomplete() {
    const input = document.getElementById('modal-ticket');
    const dropdown = document.getElementById('ticket-suggestions');
    let debounceTimer = null;
    let activeIdx = -1;

    function getItems() { return dropdown.querySelectorAll('.suggestion-item'); }

    function setActive(idx) {
        const items = getItems();
        items.forEach((el, i) => el.classList.toggle('active', i === idx));
        activeIdx = idx;
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
        dropdown.innerHTML = '';
        activeIdx = -1;
    }

    function acceptItem(value) {
        input.value = value;
        closeDropdown();
        refreshDescSuggestions(value);
        refreshTimeHint(value);
    }

    function renderDropdown(query) {
        const q = query.toUpperCase();
        if (!q) { closeDropdown(); return; }

        const today = new Date().toISOString().slice(0, 10);
        const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const matches = Object.entries(_history)
            .filter(([t]) => t.startsWith(q))
            .map(([t, r]) => {
                const recency = r.lastDate >= today.slice(0, 7) ? 2 : r.lastDate >= oneMonthAgo ? 1 : 0;
                return { ticket: t, score: r.count + recency * 5 };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);

        if (!matches.length) { closeDropdown(); return; }

        dropdown.innerHTML = '';
        for (const { ticket } of matches) {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.textContent = ticket;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();   // prevent input blur before click fires
                acceptItem(ticket);
            });
            dropdown.appendChild(item);
        }
        dropdown.classList.add('open');
        activeIdx = -1;
    }

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => renderDropdown(input.value.trim()), 300);
    });

    input.addEventListener('keydown', (e) => {
        const items = getItems();
        if (!dropdown.classList.contains('open')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(activeIdx + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(activeIdx - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (activeIdx >= 0 && items[activeIdx]) {
                e.preventDefault();
                acceptItem(items[activeIdx].textContent);
            } else {
                closeDropdown();
            }
        } else if (e.key === 'Escape') {
            closeDropdown();
        }
    });

    input.addEventListener('blur', () => {
        // Small delay so mousedown on a suggestion item fires first
        setTimeout(() => {
            closeDropdown();
            refreshDescSuggestions(input.value.trim());
            refreshTimeHint(input.value.trim());
        }, 150);
    });
}

export function initEntryModal() {
    entryModal = new bootstrap.Modal(document.getElementById('entryModal'));

    document.getElementById('modal-no-ticket').addEventListener('change', function () {
        document.getElementById('modal-ticket-wrap').style.display = this.checked ? 'none' : '';
        if (!this.checked) document.getElementById('modal-ticket').value = '';
    });

    // Validate time field on blur — no rewrite, preserve what user typed
    document.getElementById('modal-time').addEventListener('blur', function () {
        const err = this.value.trim() ? timeInputError(this.value) : null;
        this.classList.toggle('is-invalid', !!err);
        document.getElementById('modal-time-error').textContent = err || '';
        updateEntryDayTotal();
    });

    // Natural language parse button
    const nlBtn = document.getElementById('btn-nl-parse');
    const nlInput = document.getElementById('modal-nl-input');

    async function runNlParse() {
        const text = nlInput.value.trim();
        if (!text) return;
        const icon = nlBtn.querySelector('i');
        nlBtn.disabled = true;
        icon.className = 'bi bi-hourglass-split me-1';
        const parsed = await parseNaturalEntry(text);
        applyParsedEntry(parsed);
        icon.className = 'bi bi-magic me-1';
        nlBtn.disabled = false;
    }

    nlBtn.addEventListener('click', runNlParse);
    nlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runNlParse(); } });

    // Description improve button
    const descEl = document.getElementById('modal-desc');
    const improveBtn = document.getElementById('btn-improve-desc');

    function updateImproveBtnVisibility() {
        improveBtn.style.display =
            isFeatureEnabled('suggestions') && descEl.value.trim() ? '' : 'none';
    }

    descEl.addEventListener('input', updateImproveBtnVisibility);

    improveBtn.addEventListener('click', async () => {
        const current = descEl.value.trim();
        if (!current) return;
        const icon = improveBtn.querySelector('i');
        improveBtn.disabled = true;
        icon.className = 'bi bi-hourglass-split me-1';

        const improvePrompt =
            `Improve the grammar and wording of this timesheet description. ` +
            `Rules: keep ALL activities mentioned, keep all names exactly as written, do not add or remove any work items, do not summarise. ` +
            `Output the improved text ONLY — no introduction, no explanation, no "Here is", no quotes.\n\n` +
            `Input: ${current}\nOutput:`;

        // Local provider: prefer qwen2.5:0.5b (small, fast); falls back to configured model if unavailable.
        // Cloud provider: use the configured cloud provider directly.
        const raw = getProvider() === 'local'
            ? await askWithModel(improvePrompt, null, 'qwen2.5:0.5b')
            : await ask(improvePrompt, null);

        const improved = raw ? stripAiPreamble(raw) : null;
        if (improved) descEl.value = improved;
        icon.className = 'bi bi-stars me-1';
        improveBtn.disabled = false;
    });

    initTicketAutocomplete();
}

/* ── CLIPBOARD TICKET DETECTION ─────────────────────────── */
export async function readClipboardTicket() {
    try {
        const text = await window.nativeClipboard.readText();
        if (!text) return null;

        const types = state.ticketTypes || [];

        // Try each type's configured ticketPattern first
        for (const type of types) {
            if (!type.ticketPattern) continue;
            try {
                const m = new RegExp(type.ticketPattern).exec(text);
                if (m) return { ticket: m[0], typeId: type.id };
            } catch (_) { /* skip invalid stored pattern */ }
        }

        // Generic fallback: Jira-style KEY-123
        const generic = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(text);
        if (generic) return { ticket: generic[1], typeId: null };

        return null;
    } catch (_) {
        return null;
    }
}

export function openEntryModal(dayIdx, entryIdx) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = entryIdx;

    const nlBar = document.getElementById('modal-nl-bar');
    const suggestionsOn = isFeatureEnabled('suggestions');
    nlBar.style.display = suggestionsOn ? '' : 'none';
    document.getElementById('modal-nl-input').value = '';

    // Rebuild history and reset suggestion UIs on each open
    if (suggestionsOn) {
        _history = buildEntryHistory();
    } else {
        _history = {};
    }
    document.getElementById('ticket-suggestions').innerHTML = '';
    document.getElementById('desc-suggestions').innerHTML = '';
    document.getElementById('time-hint').classList.remove('show');
    document.getElementById('btn-improve-desc').style.display = 'none';

    const deleteBtn = document.getElementById('btn-delete-entry');
    const copyToBtn = document.getElementById('btn-copy-to-entry');
    const makeRegularBtn = document.getElementById('btn-make-regular');
    const title = document.getElementById('entryModalLabel');

    if (entryIdx === -1) {
        clearEntryModal();
        deleteBtn.style.display = 'none';
        copyToBtn.style.display = 'none';
        makeRegularBtn.style.display = 'none';
        title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Entry — ${WEEK_DAYS[dayIdx]}`;

    } else {
        const e = state.days[dayIdx].entries[entryIdx];
        const noTicketToggle = document.getElementById('modal-no-ticket');
        noTicketToggle.checked = !!e.noTicket;
        document.getElementById('modal-ticket-wrap').style.display = e.noTicket ? 'none' : '';
        document.getElementById('modal-ticket').value = e.noTicket ? '' : (e.ticket || '');
        document.getElementById('modal-time').value = e.timeRaw || fmtTimeInput(e.hh ?? 0, e.mm ?? 0);
        populateTypeSelect(document.getElementById('modal-type'), e.type || state.ticketTypes[0]?.id || 'jira');
        document.getElementById('modal-desc').value = e.desc || '';
        document.getElementById('modal-group-id').value = e.groupId || '';
        document.getElementById('modal-group-type-ref').value = e.groupType || '';
        // Auto-unmark logged when editing — entry may change and need re-logging
        document.getElementById('modal-logged').checked = false;
        deleteBtn.style.display = 'inline-flex';
        if (e.isScheduled) {
            makeRegularBtn.style.display = 'inline-flex';
            copyToBtn.style.display = 'none';
            title.innerHTML = `<i class="bi bi-clock me-2"></i>Edit Scheduled Entry — ${WEEK_DAYS[dayIdx]}`;
        } else {
            makeRegularBtn.style.display = 'none';
            copyToBtn.style.display = 'inline-flex';
            title.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Edit Entry — ${WEEK_DAYS[dayIdx]}`;
        }
    }

    updateEntryDayTotal();
    entryModal.show();
}

export function updateEntryDayTotal() {
    const indicator = document.getElementById('entry-day-total');
    const dayIdx  = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (isNaN(dayIdx) || dayIdx < 0 || !state.days[dayIdx]) { indicator.style.display = 'none'; return; }

    const entries = state.days[dayIdx].entries || [];
    const baseMins = entries.reduce((sum, e, i) => {
        if (i === entryIdx) return sum;
        return sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
    }, 0);

    const timeParsed = parseTimeInput(document.getElementById('modal-time').value);
    const addMins = timeParsed ? timeParsed.hh * 60 + timeParsed.mm : 0;
    const newTotalMins = baseMins + addMins;

    const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const isOver = newTotalMins > (state.dailyTargetMins || 480);

    indicator.style.display = 'flex';
    indicator.innerHTML = `<i class="bi bi-clock"></i>
        <span>${fmt(baseMins)}</span>
        <span class="total-arrow">→</span>
        <span class="total-new ${isOver ? 'over' : 'ok'}">${fmt(newTotalMins)}</span>
        ${isOver ? '<span class="total-arrow">(over target)</span>' : ''}`;
}

export function openEntryModalPreFilled(dayIdx, fromEntryIdx, keepField) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = -1;

    const deleteBtn = document.getElementById('btn-delete-entry');
    const title = document.getElementById('entryModalLabel');
    deleteBtn.style.display = 'none';
    document.getElementById('btn-make-regular').style.display = 'none';
    title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Sub-Entry — ${WEEK_DAYS[dayIdx]}`;

    clearEntryModal();

    const e = state.days[dayIdx].entries[fromEntryIdx];
    if (!e.groupId) {
        e.groupId = 'grp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        e.groupType = keepField === 'ticket' ? 'ticket_group' : 'desc_group';
        saveState();
    }

    document.getElementById('modal-group-id').value = e.groupId;
    document.getElementById('modal-group-type-ref').value = e.groupType;

    if (keepField === 'ticket') {
        document.getElementById('modal-ticket').value = e.ticket || '';
        populateTypeSelect(document.getElementById('modal-type'), e.type || state.ticketTypes[0]?.id || 'jira');
    } else if (keepField === 'desc') {
        document.getElementById('modal-desc').value = e.desc || '';
    }

    updateEntryDayTotal();
    entryModal.show();
}

export function clearEntryModal() {
    document.getElementById('modal-no-ticket').checked = false;
    document.getElementById('modal-logged').checked = false;
    document.getElementById('modal-ticket-wrap').style.display = '';
    document.getElementById('modal-ticket').value = '';
    document.getElementById('modal-time').value = '';
    document.getElementById('modal-time').classList.remove('is-invalid');
    populateTypeSelect(document.getElementById('modal-type'), state.ticketTypes[0]?.id || 'jira');
    document.getElementById('modal-desc').value = '';
    document.getElementById('modal-group-id').value = '';
    document.getElementById('modal-group-type-ref').value = '';
}

export function saveEntryInternal() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    const timeInput = document.getElementById('modal-time');
    const ticketInput = document.getElementById('modal-ticket');
    const descInput = document.getElementById('modal-desc');

    const timeParsed = parseTimeInput(timeInput.value);
    const hh = timeParsed ? timeParsed.hh : 0;
    const mm = timeParsed ? timeParsed.mm : 0;
    const tkt = ticketInput.value.trim();
    const desc = descInput.value.trim();

    const isNoTicket = document.getElementById('modal-no-ticket').checked;
    let hasError = false;

    [ticketInput, descInput, timeInput].forEach(el => el.classList.remove('is-invalid'));

    if (!isNoTicket && !tkt) { ticketInput.classList.add('is-invalid'); hasError = true; }
    if (!desc) { descInput.classList.add('is-invalid'); hasError = true; }
    if (!timeParsed || (hh === 0 && mm === 0)) {
        timeInput.classList.add('is-invalid');
        hasError = true;
    }

    if (hasError) {
        showToast('Please fill in all required fields (Ticket, Description, Time).', 'danger');
        return false;
    }

    let totalMinsForDay = (hh * 60) + mm;
    const day = state.days[dayIdx];

    if (day && day.entries) {
        day.entries.forEach((existingEntry, idx) => {
            if (idx !== entryIdx) {
                totalMinsForDay += (parseInt(existingEntry.hh) || 0) * 60 + (parseInt(existingEntry.mm) || 0);
            }
        });
    }

    if (totalMinsForDay > MAX_DAY_MINS) {
        const maxH = Math.floor(MAX_DAY_MINS / 60);
        const totalH = Math.floor(totalMinsForDay / 60);
        const totalM = totalMinsForDay % 60;
        showToast(`Cannot log more than ${maxH}h in a single day. Total would be ${totalH}h ${totalM}m.`, 'danger');
        return false;
    }

    if (totalMinsForDay > state.dailyTargetMins) {
        const totalH = Math.floor(totalMinsForDay / 60);
        const totalM = totalMinsForDay % 60;
        const targetH = Math.floor(state.dailyTargetMins / 60);
        const targetM = state.dailyTargetMins % 60;
        const targetLabel = targetM > 0 ? `${targetH}h ${targetM}m` : `${targetH}h`;
        showConfirm(
            `This entry will bring your total for the day to ${totalH}h ${totalM}m — over the ${targetLabel} target. Continue?`,
            () => commitEntry(dayIdx, entryIdx)
        );
        return false;
    }

    commitEntry(dayIdx, entryIdx);
    return true;
}

export function commitEntry(dayIdx, entryIdx) {
    const groupId = document.getElementById('modal-group-id').value;
    const groupType = document.getElementById('modal-group-type-ref').value;
    const isNoTicket = document.getElementById('modal-no-ticket').checked;
    const tkt = isNoTicket ? 'NO-TICKET' : document.getElementById('modal-ticket').value.trim();
    const timeRaw = document.getElementById('modal-time').value.trim();
    const timeParsed = parseTimeInput(timeRaw);
    const hh = timeParsed ? timeParsed.hh : 0;
    const mm = timeParsed ? timeParsed.mm : 0;
    const type = document.getElementById('modal-type').value;
    const desc = document.getElementById('modal-desc').value.trim();

    const isLogged = document.getElementById('modal-logged').checked;
    const entry = { ticket: tkt, hh, mm, timeRaw, type, desc };
    if (isNoTicket) entry.noTicket = true;
    if (isLogged) entry.logged = true;
    if (groupId) { entry.groupId = groupId; entry.groupType = groupType; }

    if (entryIdx === -1) {
        state.days[dayIdx].entries.push(entry);
    } else {
        const existing = state.days[dayIdx].entries[entryIdx];
        if (existing && existing.recurringId) entry.recurringId = existing.recurringId;
        if (existing && existing.isScheduled) entry.isScheduled = existing.isScheduled;
        // If it was logged before but not re-marked logged now, flag it as updated
        if (existing && existing.logged && !isLogged) entry.loggedUpdated = true;
        // logged is NOT carried over from existing — modal already pre-unchecked it (auto-unmark on edit)
        state.days[dayIdx].entries[entryIdx] = entry;
    }

    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    updateNoTicketBanner();
    updateUnderloggedBanner();
    entryModal.hide();
}

export function saveEntry() {
    if (saveEntryInternal()) {
        entryModal.hide();
    }
}

export function deleteEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;

    entryModal.hide();

    if (lastDeleted) {
        clearTimeout(lastDeleted.timerId);
        saveState();
    }

    const deletedEntry = state.days[dayIdx].entries[entryIdx];
    const rowEl = document.querySelector(`.entry-row[data-day="${dayIdx}"][data-entry="${entryIdx}"]`);

    if (rowEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        rowEl.classList.add('entry-removing');
        setTimeout(() => {
            finishDeleteEntry(dayIdx, entryIdx, deletedEntry);
        }, 250);
    } else {
        finishDeleteEntry(dayIdx, entryIdx, deletedEntry);
    }
}

export function finishDeleteEntry(dayIdx, entryIdx, deletedEntry) {
    if (deletedEntry.recurringId) {
        const dateStr = state.days[dayIdx].date;
        const rule = state.recurringTasks?.find(r => r.id === deletedEntry.recurringId);
        if (rule) {
            if (!rule.skippedDates) rule.skippedDates = [];
            if (!rule.skippedDates.includes(dateStr)) rule.skippedDates.push(dateStr);
        }
    }
    state.days[dayIdx].entries.splice(entryIdx, 1);
    rerenderDayCard(dayIdx);
    updateSummary();
    updateNoTicketBanner();
    updateUnderloggedBanner();

    const timerId = setTimeout(() => {
        lastDeleted = null;
        saveState();
    }, 5000);

    lastDeleted = { dayIdx, entryIdx, entry: deletedEntry, timerId };
    showUndoToast();
}

export function makeRegularEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;
    const entry = state.days[dayIdx].entries[entryIdx];
    delete entry.isScheduled;
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    entryModal.hide();
    showToast('Entry converted to a regular entry.', 'success');
}

export function undoDelete() {
    if (!lastDeleted) return;
    clearTimeout(lastDeleted.timerId);
    const { dayIdx, entryIdx, entry } = lastDeleted;
    lastDeleted = null;
    if (entry.recurringId) {
        const dateStr = state.days[dayIdx].date;
        const rule = state.recurringTasks?.find(r => r.id === entry.recurringId);
        if (rule && rule.skippedDates) {
            rule.skippedDates = rule.skippedDates.filter(d => d !== dateStr);
        }
    }
    state.days[dayIdx].entries.splice(entryIdx, 0, entry);
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    showToast('Entry restored.', 'success');
}

export function showUndoToast() {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const existing = document.getElementById('undo-delete-toast');
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', `
    <div id="undo-delete-toast" class="toast toast-custom show align-items-center" role="alert" style="min-width:280px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-trash-fill" style="color:#f87171"></i>
        <span style="font-size:0.85rem">Entry deleted.</span>
        <button type="button" class="btn btn-sm btn-outline-light ms-auto py-0 px-2" style="font-size:0.75rem" id="btn-undo-delete">Undo</button>
      </div>
    </div>`);

    document.getElementById('btn-undo-delete').addEventListener('click', () => {
        document.getElementById('undo-delete-toast')?.remove();
        undoDelete();
    });

    setTimeout(() => { document.getElementById('undo-delete-toast')?.remove(); }, 5000);
}
