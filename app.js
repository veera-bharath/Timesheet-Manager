/* =============================================================
   TIMESHEET MANAGER — app.js
   Weekly Jira & Service Desk Time Tracker
   ============================================================= */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────────── */
const APP_VERSION = '1.3.0';

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
    'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];

const SEPARATOR = '------------------------------------------------------------------------------------------------------------------------------------------------------';

/* ── STATE ─────────────────────────────────────────────── */
let state = {
    reportTitle: 'Booked hours in Jira and Service Desk',
    employeeName: '',
    weekValue: '',   // e.g. "2026-W11"
    allDaysByDate: {}, // Map of 'YYYY-MM-DD' to day object
    days: [],          // array of 5 active day objects mapping to current week
    lastOpenedDateByWeek: {}, // map of 'YYYY-Www' to 'YYYY-MM-DD'
    recurringTasks: [],  // array of recurring task rules
    dailyTargetMins: 480 // daily target in minutes (default 8h)
};

/* day object shape:
{
  date: 'YYYY-MM-DD',
  isHoliday: false,
  holidayLabel: 'Offshore Holiday',
  expanded: true,
  entries: [
    { ticket, hh, mm, type, desc }
  ]
}
*/

/* ── PERSISTENCE (electron-store) ──────────────────────── */
const LS_KEY = 'timesheetState_v1';

function saveState() {
    try {
        state.days.forEach(d => {
            if (d && d.date) state.allDaysByDate[d.date] = d;
        });

        const toSave = {
            reportTitle: state.reportTitle,
            employeeName: state.employeeName,
            weekValue: state.weekValue,
            allDaysByDate: state.allDaysByDate,
            lastOpenedDateByWeek: state.lastOpenedDateByWeek,
            recurringTasks: state.recurringTasks,
            dailyTargetMins: state.dailyTargetMins
        };
        window.electronStore.set(LS_KEY, toSave);
    } catch (e) { console.warn('Could not save state', e); }
}

function loadState() {
    try {
        // One-time migration from localStorage → electron-store
        if (!window.electronStore.has(LS_KEY)) {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    window.electronStore.set(LS_KEY, parsed);
                    localStorage.removeItem(LS_KEY);
                }
            }
        }

        const saved = window.electronStore.get(LS_KEY);
        if (!saved) return false;

        state.reportTitle = saved.reportTitle || 'Booked hours in Jira and Service Desk';
        state.employeeName = saved.employeeName || '';
        state.weekValue = saved.weekValue || '';
        state.allDaysByDate = saved.allDaysByDate || {};
        state.lastOpenedDateByWeek = saved.lastOpenedDateByWeek || {};
        state.recurringTasks = saved.recurringTasks || [];
        state.dailyTargetMins = saved.dailyTargetMins || 480;

        // Backwards compatibility: old format stored days array
        if (saved.days && Array.isArray(saved.days)) {
            saved.days.forEach(d => {
                if (d && d.date) state.allDaysByDate[d.date] = d;
            });
        }
        return true;
    } catch (e) { return false; }
}

/* ── INIT ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.app-version').forEach(el => el.textContent = APP_VERSION);
    initTheme();
    initSidebar();
    initUpdater();
    initSearch();
    initScheduledTasks();
    bindHeaderEvents();
    const restored = loadState();

    // Always apply these inputs if we have them in state, regardless of whether a week was previously saved or not
    document.getElementById('report-title').value = state.reportTitle || '';
    document.getElementById('emp-name').value = state.employeeName || '';
    const tgt = state.dailyTargetMins || 480;
    document.getElementById('target-hh').value = Math.floor(tgt / 60);
    document.getElementById('target-mm').value = tgt % 60;

    if (restored && state.weekValue) {
        // Restore saved week & name into inputs
        document.getElementById('week-picker').value = state.weekValue;
        state.days = buildWeekDays(getDateFromWeek(state.weekValue));
        enforceExpandedState();
        updateWeekDisplay();
    } else {
        setCurrentWeek();   // auto-fill current week on first load
    }
    renderAll();
});

/* ── WEEK HELPERS ──────────────────────────────────────── */
// Convert "2026-W11" to a Date object (Monday of that week)
function getDateFromWeek(weekStr) {
    const [year, week] = weekStr.split('-W').map(Number);
    const d = new Date(year, 0, 1 + (week - 1) * 7);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

// Convert Date object to "2026-W11"
function getWeekStrFromDate(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    const weekNumber = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}
function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay(); // 0=sun
    const diff = (day === 0 ? -6 : 1 - day);
    dt.setDate(dt.getDate() + diff);
    return dt;
}

function getSunday(d) {
    const mon = getMonday(d);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return sun;
}

function fmtDate(dt) {
    // returns YYYY-MM-DD in local time
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function fmtDisplayDate(yyyymmdd) {
    // returns 02-Mar-2026
    const d = new Date(yyyymmdd + 'T00:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function buildWeekDays(monDt) {
    const days = [];
    let currentDt = new Date(monDt);

    for (let i = 0; i < 5; i++) {
        const dStr = fmtDate(currentDt);
        if (state.allDaysByDate[dStr]) {
            days.push(state.allDaysByDate[dStr]);
        } else {
            const newDay = {
                date: dStr,
                isHoliday: false,
                holidayLabel: 'Offshore Holiday',
                expanded: false,
                entries: []
            };
            state.allDaysByDate[dStr] = newDay;
            days.push(newDay);
        }
        currentDt.setDate(currentDt.getDate() + 1);
    }
    populateRecurringForWeek(monDt);
    promoteExpiredScheduled();
    return days;
}

function updateWeekDisplay() {
    if (!state.weekValue) return;
    const mon = getDateFromWeek(state.weekValue);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    const display = `${fmtDisplayDate(fmtDate(mon))} to ${fmtDisplayDate(fmtDate(fri))}`;
    document.getElementById('week-display-label').textContent = display;
}

function enforceExpandedState() {
    if (!state.weekValue || !state.days || state.days.length === 0) return;
    
    const lastOpenedDate = state.lastOpenedDateByWeek[state.weekValue];
    let found = false;
    
    state.days.forEach((day, i) => {
        if (lastOpenedDate && day.date === lastOpenedDate) {
            day.expanded = true;
            found = true;
        } else {
            day.expanded = false;
        }
    });
    
    // Default to today if current week, otherwise Monday
    if (!found) {
        const todayStr = fmtDate(new Date());
        const todayDay = state.days.find(d => d.date === todayStr);
        const defaultDay = todayDay || state.days[0];
        defaultDay.expanded = true;
        state.lastOpenedDateByWeek[state.weekValue] = defaultDay.date;
        saveState();
    }
}

function setCurrentWeek() {
    const today = new Date();
    const weekVal = getWeekStrFromDate(today);

    document.getElementById('week-picker').value = weekVal;
    state.weekValue = weekVal;
    state.days = buildWeekDays(getDateFromWeek(weekVal));
    enforceExpandedState();
    updateWeekDisplay();
}

/* ── BIND HEADER EVENTS ────────────────────────────────── */
function bindHeaderEvents() {
    document.getElementById('report-title').addEventListener('input', e => {
        state.reportTitle = e.target.value;
        saveState();
    });

    document.getElementById('emp-name').addEventListener('input', e => {
        state.employeeName = e.target.value.trim();
        updateSummary();
        saveState();
    });

    document.getElementById('week-picker').addEventListener('change', e => {
        const val = e.target.value;
        if (!val) return;

        state.weekValue = val;
        state.days = buildWeekDays(getDateFromWeek(val));
        enforceExpandedState();
        updateWeekDisplay();
        saveState();
        renderAll();
    });

    document.getElementById('btn-autofill-week').addEventListener('click', () => {
        setCurrentWeek();
        saveState();
        renderAll();
    });

    const updateTarget = () => {
        const hh = parseInt(document.getElementById('target-hh').value) || 0;
        const mm = parseInt(document.getElementById('target-mm').value) || 0;
        const mins = hh * 60 + mm;
        if (mins < 1) return;
        state.dailyTargetMins = mins;
        renderDays();
        saveState();
    };
    document.getElementById('target-hh').addEventListener('change', updateTarget);
    document.getElementById('target-mm').addEventListener('change', updateTarget);

    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-print').addEventListener('click', doPrint);
    document.getElementById('btn-copy-txt').addEventListener('click', copyTxt);
    document.getElementById('btn-download-txt').addEventListener('click', downloadTxt);
    document.getElementById('btn-save-entry').addEventListener('click', saveEntry);
    document.getElementById('btn-delete-entry').addEventListener('click', deleteEntry);
    document.getElementById('btn-make-regular').addEventListener('click', makeRegularEntry);

    // HH → MM auto-advance for all time input pairs
    [
        ['modal-hh',          'modal-mm'],
        ['recurring-hh',      'recurring-mm'],
        ['scheduled-form-hh', 'scheduled-form-mm'],
        ['target-hh',         'target-mm'],
    ].forEach(([hhId, mmId]) => {
        document.getElementById(hhId).addEventListener('input', function () {
            if (this.value.length >= 2) document.getElementById(mmId).focus();
        });
    });

    // Live day total update when HH/MM change in entry modal
    ['modal-hh', 'modal-mm'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateEntryDayTotal);
    });
}

/* ── RENDER ALL ────────────────────────────────────────── */
function renderAll() {
    // Update employee name field (if not yet focused)
    if (state.reportTitle) document.getElementById('report-title').value = state.reportTitle;
    if (state.employeeName) document.getElementById('emp-name').value = state.employeeName;
    renderDays();
    updateSummary();
}

function renderDays() {
    const container = document.getElementById('days-container');
    container.innerHTML = '';
    state.days.forEach((day, i) => {
        container.appendChild(buildDayCard(day, i));
    });
}

/* ── BUILD DAY CARD ────────────────────────────────────── */
function buildProgressRing(dayNumber, totalMins, isHoliday) {
    const targetMins = state.dailyTargetMins || 480;
    const r = 16;
    const circ = +(2 * Math.PI * r).toFixed(2); // 100.53
    const pct = isHoliday ? 0 : Math.min(totalMins / targetMins, 1);
    const offset = +(circ * (1 - pct)).toFixed(2);

    let strokeColor, trackColor, textColor;
    if (isHoliday) {
        strokeColor = 'var(--warning)';
        trackColor = 'rgba(251,191,36,0.15)';
        textColor = 'var(--warning)';
    } else if (pct === 0) {
        strokeColor = 'transparent';
        trackColor = 'var(--border)';
        textColor = 'var(--text-secondary)';
    } else if (pct < 0.8) {
        strokeColor = 'var(--warning)';
        trackColor = 'var(--border)';
        textColor = 'var(--text-secondary)';
    } else if (pct < 1) {
        strokeColor = 'var(--success)';
        trackColor = 'var(--border)';
        textColor = 'var(--text-secondary)';
    } else {
        strokeColor = '#4ade80';
        trackColor = 'rgba(74,222,128,0.12)';
        textColor = '#4ade80';
    }

    let tooltip = '';
    if (!isHoliday) {
        const remaining = targetMins - totalMins;
        if (totalMins === 0) {
            const th = Math.floor(targetMins / 60), tm = targetMins % 60;
            tooltip = tm > 0 ? `${th}h ${tm}m remaining` : `${th}h remaining`;
        } else if (remaining > 0) {
            const rh = Math.floor(remaining / 60), rm = remaining % 60;
            tooltip = rm > 0 ? `${rh}h ${rm}m remaining` : `${rh}h remaining`;
        } else if (remaining === 0) {
            tooltip = 'Target met!';
        } else {
            const oh = Math.floor(-remaining / 60), om = (-remaining) % 60;
            tooltip = om > 0 ? `${oh}h ${om}m over target` : `${oh}h over target`;
        }
    }

    return `<div class="day-progress-ring" title="${tooltip}">
      <svg width="38" height="38" viewBox="0 0 38 38">
        <circle cx="19" cy="19" r="${r}" fill="none" style="stroke:${trackColor}" stroke-width="3"/>
        <circle cx="19" cy="19" r="${r}" fill="none" style="stroke:${strokeColor}"
          stroke-width="3" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          stroke-linecap="round" transform="rotate(-90 19 19)"/>
        <text x="19" y="19" text-anchor="middle" dominant-baseline="central"
          style="font-size:11px;font-weight:700;fill:${textColor};font-family:inherit">${dayNumber}</text>
      </svg>
    </div>`;
}

function buildDayCard(day, dayIdx) {
    const dayName = WEEK_DAYS[dayIdx];
    const displayDate = fmtDisplayDate(day.date);
    const isWeekend = false;
    const totalMins = calcDayTotalMins(day);
    const totalHrsStr = minsToHHMM(totalMins);

    const wrap = document.createElement('div');
    wrap.className = 'day-card';
    wrap.id = `day-card-${dayIdx}`;

    // determine holiday label
    let topRightBadge = '';
    if (day.isHoliday) {
        topRightBadge = `<span class="day-holiday-badge"><i class="bi bi-umbrella me-1"></i>${escHtml(day.holidayLabel || 'Offshore Holiday')}</span>`;
    } else if (totalMins > 0) {
        topRightBadge = `<span class="day-hours-total">${totalHrsStr} hrs</span>`;
    } else {
        topRightBadge = `<span class="day-hours-total zero">No entries</span>`;
    }

    wrap.innerHTML = `
    <div class="day-card-header" data-day="${dayIdx}">
      <div class="day-badge">
        ${buildProgressRing(dayIdx + 1, totalMins, day.isHoliday)}
        <div>
          <div class="day-name">${dayName}${isWeekend ? ' <span class="badge bg-secondary" style="font-size:0.6rem">Weekend</span>' : ''}</div>
          <div class="day-date">${displayDate}</div>
        </div>
      </div>
      <div class="d-flex align-items-center gap-3">
        ${topRightBadge}
        <div class="day-controls">
          ${totalMins > 0 && !day.isHoliday ? `<button class="day-quick-view-btn" title="Quick View Entries"><i class="bi bi-eye"></i></button>` : ''}
          <button class="day-toggle-btn" title="${day.expanded ? 'Collapse' : 'Expand'}">
            <i class="bi bi-chevron-${day.expanded ? 'up' : 'down'}"></i>
          </button>
        </div>
      </div>
    </div>
    <div class="day-card-body ${day.expanded ? '' : 'collapsed'}" id="day-body-${dayIdx}">
      <div class="holiday-check-wrap">
        <input type="checkbox" id="holiday-${dayIdx}" ${day.isHoliday ? 'checked' : ''} />
        <label for="holiday-${dayIdx}">Mark as Holiday / Leave</label>
        <select id="holiday-label-${dayIdx}" class="form-select dark-input ms-2"
          style="max-width:200px;display:${day.isHoliday ? 'block' : 'none'}">
          <option value="Offshore Holiday" ${(day.holidayLabel || 'Offshore Holiday') === 'Offshore Holiday' ? 'selected' : ''}>Offshore Holiday</option>
          <option value="Sick Leave"       ${day.holidayLabel === 'Sick Leave' ? 'selected' : ''}>Sick Leave</option>
          <option value="Planned Leave"    ${day.holidayLabel === 'Planned Leave' ? 'selected' : ''}>Planned Leave</option>
        </select>
      </div>
      <div class="entries-list" id="entries-${dayIdx}" ${day.isHoliday ? 'style="opacity:0.4;pointer-events:none"' : ''}>
        ${buildEntriesHTML(day.entries, dayIdx)}
      </div>
      ${day.isHoliday ? '' : `<button class="add-entry-btn" data-day="${dayIdx}">
        <i class="bi bi-plus-circle"></i> Add Entry
      </button>`}
    </div>
  `;

    // Events: header toggle
    wrap.querySelector('.day-card-header').addEventListener('click', (e) => {
        if (e.target.closest('.day-quick-view-btn')) {
            e.stopPropagation();
            openDayQuickView(dayIdx);
        } else if (e.target.closest('.day-controls') || !e.target.closest('.day-controls')) {
            // Either clicked the toggle explicitly, or somewhere on the header
            toggleDay(dayIdx);
        }
    });

    // Holiday checkbox
    const cb = wrap.querySelector(`#holiday-${dayIdx}`);
    const lbl = wrap.querySelector(`#holiday-label-${dayIdx}`);
    cb.addEventListener('change', () => {
        state.days[dayIdx].isHoliday = cb.checked;
        lbl.style.display = cb.checked ? 'block' : 'none';
        if (!cb.checked) state.days[dayIdx].holidayLabel = 'Offshore Holiday';
        rerenderDayCard(dayIdx);
        updateSummary();
        saveState();
    });
    lbl.addEventListener('change', () => {
        state.days[dayIdx].holidayLabel = lbl.value;
        updateSummary();
        saveState();
    });

    // Add entry button
    const addBtn = wrap.querySelector('.add-entry-btn');
    if (addBtn) addBtn.addEventListener('click', () => openEntryModal(dayIdx, -1));

    // Entry row click (edit)
    wrap.querySelectorAll('.entry-row').forEach(row => {
        row.addEventListener('click', e => {
            if (e.target.closest('.drag-handle')) return;
            openEntryModal(parseInt(row.dataset.day), parseInt(row.dataset.entry));
        });
    });

    // Quick-add inline buttons (keep ticket / keep desc)
    wrap.querySelectorAll('.quick-add-inline').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const row = btn.closest('.entry-row');
            openEntryModalPreFilled(parseInt(row.dataset.day), parseInt(row.dataset.entry), btn.dataset.keep);
        });
    });

    // Attach drag-and-drop
    attachDragListeners(dayIdx, wrap);

    return wrap;
}

/* ── BUILD GROUPS HELPER ───────────────────────────────── */
function buildGroups(entries) {
    let groups = [];
    let usedIndices = new Set();

    (entries || []).forEach((e, i) => {
        if (usedIndices.has(i)) return;

        let currGroup = { type: 'normal', items: [e], indices: [i] };
        usedIndices.add(i);

        if (e.groupId) {
            currGroup.type = e.groupType || 'normal';
            for (let j = i + 1; j < entries.length; j++) {
                if (usedIndices.has(j)) continue;
                if (entries[j].groupId === e.groupId) {
                    currGroup.items.push(entries[j]);
                    currGroup.indices.push(j);
                    usedIndices.add(j);
                }
            }
        }

        groups.push(currGroup);
    });
    return groups;
}

function buildEntriesHTML(entries, dayIdx) {
    if (!entries || entries.length === 0) {
        if (state.days[dayIdx] && state.days[dayIdx].isHoliday) return '';
        return `<div class="no-entries-msg">No entries yet. Click "Add Entry" to begin.</div>`;
    }
    
    const groups = buildGroups(entries);

    let htmlFragments = [];
    
    groups.forEach((group, gi) => {
        const roman = ROMAN[gi] + '.';

        group.items.forEach((e, itemIdx) => {
            let actualOriginalIndex = group.indices[itemIdx];
            const isFirst = itemIdx === 0;
            const isLast = itemIdx === group.items.length - 1;
            
            const rStr = isFirst ? roman : '';
            
            let tktStr = (e.ticket || '');
            let ticketHtml = `<span class="entry-ticket ${e.type === 'servicedesk' ? 'servicedesk' : ''}">${escHtml(tktStr || '—')}</span>`;
            if (group.type === 'ticket_group' && !isFirst) {
                ticketHtml = `<span class="entry-ticket text-muted entry-grouped-hint">${escHtml(tktStr || '—')}</span>`;
            }

            const hhmm = `${String(e.hh || 0).padStart(2, '0')}:${String(e.mm || 0).padStart(2, '0')}`;
            const isSd = e.type === 'servicedesk';
            
            let showDesc = true;
            if (group.type === 'desc_group' && !isLast) {
                showDesc = false;
            }
            
            let descHtml = `<span class="entry-desc">${escHtml(e.desc || '')}</span>`;
            if (!showDesc) {
                descHtml = `<span class="entry-desc text-muted entry-grouped-hint">↳ Grouped below</span>`;
            }

            let actTicketHtml = '';
            let actDescHtml = '';

            if (group.type === 'normal') {
                actTicketHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Sub-task (keep ticket)" data-keep="ticket">
                    <i class="bi bi-plus"></i> <i class="bi bi-ticket-detailed"></i>
                </button>`;
                actDescHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Ticket to Group (keep desc)" data-keep="desc">
                    <i class="bi bi-plus"></i> <i class="bi bi-card-text"></i>
                </button>`;
            } else if (group.type === 'ticket_group') {
                actTicketHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Sub-task (keep ticket)" data-keep="ticket">
                    <i class="bi bi-plus"></i> <i class="bi bi-ticket-detailed"></i>
                </button>`;
            } else if (group.type === 'desc_group') {
                actDescHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Ticket to Group (keep desc)" data-keep="desc">
                    <i class="bi bi-plus"></i> <i class="bi bi-card-text"></i>
                </button>`;
            }

            htmlFragments.push(`
    <div class="entry-row${e.isScheduled ? ' entry-scheduled' : ''}" data-day="${dayIdx}" data-entry="${actualOriginalIndex}" data-group-idx="${gi}" data-item-idx="${itemIdx}">
      <span class="drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
      <span class="entry-num entry-num-roman">${rStr}</span>
      ${ticketHtml}
      <span class="entry-hours">${hhmm}</span>
      ${isSd ? '<span class="entry-type-badge">Service Desk</span>' : ''}
      ${e.recurringId ? '<span class="entry-recurring-badge" title="Recurring task"><i class="bi bi-arrow-repeat"></i></span>' : ''}
      ${e.isScheduled ? '<span class="entry-scheduled-badge" title="Scheduled task"><i class="bi bi-clock"></i></span>' : ''}
      ${descHtml}
      <div class="entry-actions ms-auto d-flex align-items-center gap-2">
        ${actTicketHtml}
        ${actDescHtml}
        <span class="entry-edit-hint ms-2"><i class="bi bi-pencil-square"></i></span>
      </div>
    </div>`);
        });
    });

    return htmlFragments.join('');
}

function rerenderDayCard(dayIdx) {
    const existing = document.getElementById(`day-card-${dayIdx}`);
    const newCard = buildDayCard(state.days[dayIdx], dayIdx);
    existing.replaceWith(newCard);
}

/* ── DRAG AND DROP (pointer-event based, no HTML5 drag API) ── */
function attachDragListeners(dayIdx, container) {
    const entriesList = (container || document).querySelector(`#entries-${dayIdx}`);
    if (!entriesList) return;

    const rows = entriesList.querySelectorAll('.entry-row');

    let draggingRow     = null;
    let ghost           = null;
    let dropIndicator   = null;
    let dragSrcGroupIdx = null;
    let dragSrcItemIdx  = null;
    let offsetX = 0, offsetY = 0;

    // Removes the draggability of the old code from the elements so it doesn't conflict
    rows.forEach(r => r.removeAttribute('draggable'));

    function getRowAt(clientX, clientY) {
        let found = null;
        let minDist = Infinity;
        entriesList.querySelectorAll('.entry-row').forEach(r => {
            if (r === draggingRow) return;
            const rect = r.getBoundingClientRect();
            // Check if directly over
            if (clientY >= rect.top && clientY <= rect.bottom) {
                found = r;
                return;
            }
            // Increase gravity buffer to 20px to handle gaps and margins better
            const dist = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
            if (dist < 20 && dist < minDist) {
                minDist = dist;
                found = r;
            }
        });
        return found;
    }

    function cleanup() {
        if (ghost) { ghost.remove(); ghost = null; }
        if (draggingRow) { draggingRow.classList.remove('dragging'); }
        entriesList.querySelectorAll('.entry-row').forEach(r => r.classList.remove('drag-over', 'drag-over-invalid'));
        draggingRow = null;
        dragSrcGroupIdx = null;
        dragSrcItemIdx  = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);
    }

    function onMouseMove(e) {
        if (!ghost) return;
        ghost.style.left = (e.clientX - offsetX) + 'px';
        ghost.style.top  = (e.clientY - offsetY) + 'px';

        // Clear all previous highlights
        entriesList.querySelectorAll('.entry-row').forEach(r => r.classList.remove('drag-over', 'drag-over-invalid'));

        const target = getRowAt(e.clientX, e.clientY);
        if (!target) return;

        const toGroupIdx = parseInt(target.dataset.groupIdx);
        const toItemIdx  = parseInt(target.dataset.itemIdx);

        // Check if move is basic valid
        let isValid = true;
        if (dragSrcItemIdx > 0 && toGroupIdx !== dragSrcGroupIdx) isValid = false;
        // Group leader moves are now valid anywhere in another group

        if (isValid) {
            // Highlight target row OR entire group if dragging a leader/normal entry
            if (dragSrcItemIdx === 0) {
                // Dragging a leader -> highlight the whole target group
                entriesList.querySelectorAll(`.entry-row[data-group-idx="${toGroupIdx}"]`).forEach(r => r.classList.add('drag-over'));
            } else {
                // Dragging a sub-entry -> highlight only the target row (since it stays in group)
                target.classList.add('drag-over');
            }
        } else {
            target.classList.add('drag-over-invalid');
        }
    }

    function onMouseUp(e) {
        if (!draggingRow) { cleanup(); return; }

        const target = getRowAt(e.clientX, e.clientY);
        const srcGrpIdx = dragSrcGroupIdx;
        const srcItmIdx = dragSrcItemIdx;
        
        let toGrpIdx = null;
        let toItmIdx = null;
        if (target) {
            toGrpIdx = parseInt(target.getAttribute('data-group-idx'));
            toItmIdx = parseInt(target.getAttribute('data-item-idx'));
        }

        cleanup();

        // If no valid target or same position, just stop
        if (target === null || srcGrpIdx === null) return;
        if (srcGrpIdx === toGrpIdx && srcItmIdx === toItmIdx) return;

        // Constraint check - sub-entries must stay in their group
        if (srcItmIdx > 0 && toGrpIdx !== srcGrpIdx) return;
        // Group leaders (srcItmIdx === 0) can move anywhere, 
        // but can only land on other group leaders (toItmIdx === 0).
        // Actually, let's make it even more forgiving: 
        // if a group leader is dropped on ANY entry of another group, just move the whole group there.
        const groups = buildGroups(state.days[dayIdx].entries);

        if (srcGrpIdx === toGrpIdx) {
            // Internal group move: any item can move to any position within the same group
            const grp = groups[srcGrpIdx];
            const [movedItem] = grp.items.splice(srcItmIdx, 1);
            const [movedIdx]  = grp.indices.splice(srcItmIdx, 1);
            
            grp.items.splice(toItmIdx, 0, movedItem);
            grp.indices.splice(toItmIdx, 0, movedIdx);
        } else {
            // Between group move: only leaders can move the whole group unit
            if (srcItmIdx > 0) return; // sub-entries stay in their group
            
            const [movedGroup] = groups.splice(srcGrpIdx, 1);
            groups.splice(toGrpIdx, 0, movedGroup);
        }

        const newEntries = [];
        groups.forEach(grp => grp.items.forEach(item => newEntries.push(item)));
        state.days[dayIdx].entries = newEntries;

        saveState();
        if (typeof rerenderDayCard === 'function') {
            rerenderDayCard(dayIdx);
        }
    }

    rows.forEach(row => {
        const handle = row.querySelector('.drag-handle');
        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return; // Only left click
            e.preventDefault(); // Prevent text selection/native drag

            draggingRow     = row;
            dragSrcGroupIdx = parseInt(row.dataset.groupIdx);
            dragSrcItemIdx  = parseInt(row.dataset.itemIdx);

            const rect = row.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            ghost = row.cloneNode(true);
            // remove dragging class from ghost just in case
            ghost.classList.remove('dragging');
            
            ghost.style.cssText = [
                'position:fixed',
                'pointer-events:none',
                'z-index:99999',
                'width:' + rect.width + 'px',
                'left:' + (e.clientX - offsetX) + 'px',
                'top:' + (e.clientY - offsetY) + 'px',
                'opacity:0.95',
                'background:var(--bg-card)',
                'border:1.5px solid var(--border-accent)',
                'border-radius:8px',
                'box-shadow:0 10px 32px rgba(0,0,0,0.6)',
                'transition:none',
                'cursor:grabbing'
            ].join(';');
            document.body.appendChild(ghost);

            row.classList.add('dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup',   onMouseUp);
        });
    });
}

/* ── TOGGLE DAY ────────────────────────────────────────── */
function toggleDay(dayIdx) {
    if (!state.days[dayIdx].expanded) {
        // Open the day, auto-collapse others
        state.days.forEach((d, i) => {
            if (i !== dayIdx && d.expanded) {
                d.expanded = false;
                rerenderDayCard(i);
            }
        });
        state.days[dayIdx].expanded = true;
        state.lastOpenedDateByWeek[state.weekValue] = state.days[dayIdx].date;
        saveState();
        rerenderDayCard(dayIdx);
    } else {
        // Close the day
        state.days[dayIdx].expanded = false;
        rerenderDayCard(dayIdx);
    }
}

/* ── ENTRY MODAL ───────────────────────────────────────── */
let entryModal;
document.addEventListener('DOMContentLoaded', () => {
    entryModal = new bootstrap.Modal(document.getElementById('entryModal'));
});

function openEntryModal(dayIdx, entryIdx) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = entryIdx;

    const deleteBtn = document.getElementById('btn-delete-entry');
    const copyToBtn = document.getElementById('btn-copy-to-entry');
    const makeRegularBtn = document.getElementById('btn-make-regular');
    const title = document.getElementById('entryModalLabel');

    if (entryIdx === -1) {
        // Add mode
        clearEntryModal();
        deleteBtn.style.display = 'none';
        copyToBtn.style.display = 'none';
        makeRegularBtn.style.display = 'none';
        title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Entry — ${WEEK_DAYS[dayIdx]}`;
    } else {
        // Edit mode
        const e = state.days[dayIdx].entries[entryIdx];
        document.getElementById('modal-ticket').value = e.ticket || '';
        document.getElementById('modal-hh').value = e.hh ?? 0;
        document.getElementById('modal-mm').value = String(e.mm ?? 0).padStart(2, '0');
        document.getElementById('modal-type').value = e.type || 'jira';
        document.getElementById('modal-desc').value = e.desc || '';
        document.getElementById('modal-group-id').value = e.groupId || '';
        document.getElementById('modal-group-type-ref').value = e.groupType || '';
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

function updateEntryDayTotal() {
    const indicator = document.getElementById('entry-day-total');
    const dayIdx  = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (isNaN(dayIdx) || dayIdx < 0 || !state.days[dayIdx]) { indicator.style.display = 'none'; return; }

    const entries = state.days[dayIdx].entries || [];
    const baseMins = entries.reduce((sum, e, i) => {
        if (i === entryIdx) return sum; // exclude entry being edited
        return sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0);
    }, 0);

    const addHH = parseInt(document.getElementById('modal-hh').value) || 0;
    const addMM = parseInt(document.getElementById('modal-mm').value) || 0;
    const addMins = addHH * 60 + addMM;
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

function openEntryModalPreFilled(dayIdx, fromEntryIdx, keepField) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = -1; // Force Add mode

    const deleteBtn = document.getElementById('btn-delete-entry');
    const title = document.getElementById('entryModalLabel');
    deleteBtn.style.display = 'none';
    document.getElementById('btn-make-regular').style.display = 'none';
    title.innerHTML = `<i class="bi bi-plus-circle me-2"></i>Add Sub-Entry — ${WEEK_DAYS[dayIdx]}`;
    
    clearEntryModal();
    
    // Assign a group ID to parent if it doesn't have one, so they form a proper link
    const e = state.days[dayIdx].entries[fromEntryIdx];
    if (!e.groupId) {
        e.groupId = 'grp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        e.groupType = keepField === 'ticket' ? 'ticket_group' : 'desc_group';
        saveState(); // persist the parent's new group identity
    }
    
    document.getElementById('modal-group-id').value = e.groupId;
    document.getElementById('modal-group-type-ref').value = e.groupType;

    if (keepField === 'ticket') {
        document.getElementById('modal-ticket').value = e.ticket || '';
        document.getElementById('modal-type').value = e.type || 'jira';
    } else if (keepField === 'desc') {
        document.getElementById('modal-desc').value = e.desc || '';
    }

    updateEntryDayTotal();
    entryModal.show();
}

function clearEntryModal() {
    document.getElementById('modal-ticket').value = '';
    document.getElementById('modal-hh').value = '';
    document.getElementById('modal-mm').value = '00';
    document.getElementById('modal-type').value = 'jira';
    document.getElementById('modal-desc').value = '';
    document.getElementById('modal-group-id').value = '';
    document.getElementById('modal-group-type-ref').value = '';
}

function saveEntryInternal() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    const hhInput = document.getElementById('modal-hh');
    const mmInput = document.getElementById('modal-mm');
    const ticketInput = document.getElementById('modal-ticket');
    const descInput = document.getElementById('modal-desc');

    const hh = parseInt(hhInput.value) || 0;
    const mm = parseInt(mmInput.value) || 0;
    const type = document.getElementById('modal-type').value;
    const tkt = ticketInput.value.trim();
    const desc = descInput.value.trim();

    let hasError = false;

    // Reset validations
    [ticketInput, descInput, hhInput, mmInput].forEach(el => el.classList.remove('is-invalid'));

    if (!tkt) {
        ticketInput.classList.add('is-invalid');
        hasError = true;
    }
    if (!desc) {
        descInput.classList.add('is-invalid');
        hasError = true;
    }
    
    // Time validation: Cannot be 0 hours and 0 minutes
    if (hh === 0 && mm === 0) {
        hhInput.classList.add('is-invalid');
        mmInput.classList.add('is-invalid');
        hasError = true;
    }
    
    if (hasError) {
        showToast('Please fill in all required fields (Ticket, Description, Time).', 'danger');
    }

    // Constraints
    if (hh > 24) {
        hhInput.classList.add('is-invalid');
        showToast('Hours cannot exceed 24.', 'danger');
        hasError = true;
    }
    if (mm > 59) {
        mmInput.classList.add('is-invalid');
        showToast('Minutes cannot exceed 59.', 'danger');
        hasError = true;
    }

    if (hasError) return false;

    // Warning for > 8 hours total for the day
    let totalMinsForDay = (hh * 60) + mm;
    const day = state.days[dayIdx];
    
    if (day && day.entries) {
        day.entries.forEach((existingEntry, idx) => {
            // If we are editing an existing entry, skip it in the sum so we don't double count
            if (idx !== entryIdx) {
                totalMinsForDay += (parseInt(existingEntry.hh) || 0) * 60 + (parseInt(existingEntry.mm) || 0);
            }
        });
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
        return false; // halt here; commitEntry will handle the rest if confirmed
    }

    commitEntry(dayIdx, entryIdx);
    return true;
}

function commitEntry(dayIdx, entryIdx) {
    const groupId = document.getElementById('modal-group-id').value;
    const groupType = document.getElementById('modal-group-type-ref').value;
    const tkt = document.getElementById('modal-ticket').value.trim();
    const hh = parseInt(document.getElementById('modal-hh').value) || 0;
    const mm = parseInt(document.getElementById('modal-mm').value) || 0;
    const type = document.getElementById('modal-type').value;
    const desc = document.getElementById('modal-desc').value.trim();

    const entry = { ticket: tkt, hh, mm, type, desc };
    if (groupId) { entry.groupId = groupId; entry.groupType = groupType; }

    if (entryIdx === -1) {
        state.days[dayIdx].entries.push(entry);
    } else {
        const existing = state.days[dayIdx].entries[entryIdx];
        if (existing && existing.recurringId) entry.recurringId = existing.recurringId;
        if (existing && existing.isScheduled) entry.isScheduled = existing.isScheduled;
        state.days[dayIdx].entries[entryIdx] = entry;
    }

    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    entryModal.hide();
}

function saveEntry() {
    if (saveEntryInternal()) {
        entryModal.hide();
    }
}

let lastDeleted = null;

function deleteEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;

    // If there's a pending undo from a previous delete, commit it first
    if (lastDeleted) {
        clearTimeout(lastDeleted.timerId);
        saveState();
    }

    const deletedEntry = state.days[dayIdx].entries[entryIdx];
    state.days[dayIdx].entries.splice(entryIdx, 1);
    entryModal.hide();
    rerenderDayCard(dayIdx);
    updateSummary();
    // Defer saveState — give the user a chance to undo

    const timerId = setTimeout(() => {
        lastDeleted = null;
        saveState();
    }, 5000);

    lastDeleted = { dayIdx, entryIdx, entry: deletedEntry, timerId };
    showUndoToast();
}

function makeRegularEntry() {
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

function undoDelete() {
    if (!lastDeleted) return;
    clearTimeout(lastDeleted.timerId);
    const { dayIdx, entryIdx, entry } = lastDeleted;
    lastDeleted = null;
    state.days[dayIdx].entries.splice(entryIdx, 0, entry);
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    showToast('Entry restored.', 'success');
}

function showUndoToast() {
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

/* ── COPY TO ───────────────────────────────────────────── */
let copyToModal;
let copyToWeekMonday = null;
let copyToSelectedDates = [];

document.addEventListener('DOMContentLoaded', () => {
    copyToModal = new bootstrap.Modal(document.getElementById('copyToModal'));

    document.getElementById('btn-copy-to-entry').addEventListener('click', () => {
        entryModal.hide();
        copyToWeekMonday = getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date()));
        copyToSelectedDates = [];
        renderCopyToWeek();
        copyToModal.show();
    });

    document.getElementById('copy-to-prev-week').addEventListener('click', () => {
        copyToWeekMonday = new Date(copyToWeekMonday);
        copyToWeekMonday.setDate(copyToWeekMonday.getDate() - 7);
        renderCopyToWeek();
    });

    document.getElementById('copy-to-next-week').addEventListener('click', () => {
        copyToWeekMonday = new Date(copyToWeekMonday);
        copyToWeekMonday.setDate(copyToWeekMonday.getDate() + 7);
        renderCopyToWeek();
    });

    document.getElementById('btn-confirm-copy-to').addEventListener('click', executeCopyTo);
});

function renderCopyToWeek() {
    const mon = new Date(copyToWeekMonday);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    document.getElementById('copy-to-week-label').textContent =
        `${fmtDisplayDate(fmtDate(mon))} — ${fmtDisplayDate(fmtDate(fri))}`;

    const container = document.getElementById('copy-to-days');
    container.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const dt = new Date(mon);
        dt.setDate(mon.getDate() + i);
        const dateStr = fmtDate(dt);
        const dayName = WEEK_DAYS[i].slice(0, 3);
        const dayNum = dt.getDate();
        const isSelected = copyToSelectedDates.includes(dateStr);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn copy-to-day-btn${isSelected ? ' selected' : ''}`;
        btn.dataset.date = dateStr;
        btn.innerHTML = `<span class="copy-day-name">${dayName}</span><span class="copy-day-num">${dayNum}</span>`;
        btn.addEventListener('click', () => {
            if (copyToSelectedDates.includes(dateStr)) {
                copyToSelectedDates = copyToSelectedDates.filter(d => d !== dateStr);
            } else {
                copyToSelectedDates.push(dateStr);
            }
            renderCopyToWeek();
        });
        container.appendChild(btn);
    }
}

function executeCopyTo() {
    if (copyToSelectedDates.length === 0) {
        showToast('Select at least one day to copy to.', 'danger');
        return;
    }

    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    const src = state.days[dayIdx].entries[entryIdx];
    const entryCopy = { ticket: src.ticket, hh: src.hh, mm: src.mm, type: src.type, desc: src.desc };

    copyToSelectedDates.forEach(dateStr => {
        if (!state.allDaysByDate[dateStr]) {
            state.allDaysByDate[dateStr] = {
                date: dateStr, isHoliday: false,
                holidayLabel: 'Offshore Holiday', expanded: false, entries: []
            };
        }
        state.allDaysByDate[dateStr].entries.push({ ...entryCopy });

        const dayInWeek = state.days.findIndex(d => d.date === dateStr);
        if (dayInWeek !== -1) {
            state.days[dayInWeek] = state.allDaysByDate[dateStr];
            rerenderDayCard(dayInWeek);
        }
    });

    saveState();
    updateSummary();
    copyToModal.hide();
    showToast(`Copied to ${copyToSelectedDates.length} day${copyToSelectedDates.length > 1 ? 's' : ''}.`, 'success');
    copyToSelectedDates = [];
}

/* ── RECURRING TASKS ───────────────────────────────────── */
const RECURRING_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_IDX_TO_NAME = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

function populateRecurringForWeek(monDt) {
    if (!state.recurringTasks || state.recurringTasks.length === 0) return;
    for (let i = 0; i < 5; i++) {
        const dt = new Date(monDt);
        dt.setDate(monDt.getDate() + i);
        const dateStr = fmtDate(dt);
        const dayName = RECURRING_DAY_NAMES[i];
        const day = state.allDaysByDate[dateStr];
        if (!day) continue;
        state.recurringTasks.forEach(rule => {
            if (!rule.days.includes(dayName)) return;
            const exists = day.entries.some(e => e.recurringId === rule.id);
            if (!exists) {
                day.entries.push({ ticket: rule.ticket, hh: rule.hh, mm: rule.mm, type: rule.type, desc: rule.desc, recurringId: rule.id });
            }
        });
    }
}

function updateRecurringEntriesFromToday(rule) {
    const todayStr = fmtDate(new Date());
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr < todayStr) return;
        const dt = new Date(dateStr + 'T00:00:00');
        const dayName = DAY_IDX_TO_NAME[dt.getDay()];
        if (!dayName) return;
        const day = state.allDaysByDate[dateStr];
        const idx = day.entries.findIndex(e => e.recurringId === rule.id);
        if (rule.days.includes(dayName)) {
            if (idx !== -1) {
                day.entries[idx] = { ...day.entries[idx], ticket: rule.ticket, hh: rule.hh, mm: rule.mm, type: rule.type, desc: rule.desc };
            }
        } else if (idx !== -1) {
            day.entries.splice(idx, 1);
        }
    });
}

function deleteRecurringEntriesFromToday(ruleId) {
    const rule = state.recurringTasks.find(r => r.id === ruleId);
    const ruleTicket = rule ? rule.ticket : null;
    const currentWeekMonday = fmtDate(getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date())));
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr < currentWeekMonday) return;
        const day = state.allDaysByDate[dateStr];
        day.entries = day.entries.filter(e => {
            if (e.recurringId === ruleId) return false;
            if (e.recurringId && ruleTicket && e.ticket === ruleTicket) return false;
            return true;
        });
    });
}

let recurringModal;
let recurringFormModal;

document.addEventListener('DOMContentLoaded', () => {
    recurringModal = new bootstrap.Modal(document.getElementById('recurringModal'));
    recurringFormModal = new bootstrap.Modal(document.getElementById('recurringFormModal'));

    document.getElementById('menu-recurring').addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('#appSidebar .btn-close')?.click();
        setTimeout(() => {
            renderRecurringList();
            recurringModal.show();
        }, 300);
    });

    document.getElementById('btn-add-recurring').addEventListener('click', () => {
        recurringModal.hide();
        setTimeout(() => openRecurringForm(null), 300);
    });

    document.getElementById('btn-recurring-form-close').addEventListener('click', () => {
        recurringFormModal.hide();
        setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    });

    document.getElementById('btn-recurring-form-cancel').addEventListener('click', () => {
        recurringFormModal.hide();
        setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    });

    document.getElementById('btn-save-recurring').addEventListener('click', saveRecurringRule);

    // Day toggle buttons
    document.querySelectorAll('.recurring-day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            syncAllDaysCheckbox();
        });
    });

    document.getElementById('recurring-all-days').addEventListener('change', e => {
        document.querySelectorAll('.recurring-day-btn').forEach(btn => {
            btn.classList.toggle('selected', e.target.checked);
        });
    });
});

function syncAllDaysCheckbox() {
    const all = document.querySelectorAll('.recurring-day-btn');
    const selected = document.querySelectorAll('.recurring-day-btn.selected');
    document.getElementById('recurring-all-days').checked = all.length === selected.length;
}

function renderRecurringList() {
    const container = document.getElementById('recurring-list');
    if (!state.recurringTasks || state.recurringTasks.length === 0) {
        container.innerHTML = `<p class="text-muted text-center py-4">No recurring tasks yet. Click "Add Recurring Task" to create one.</p>`;
        return;
    }
    container.innerHTML = state.recurringTasks.map(rule => `
    <div class="recurring-rule-card mb-3">
      <div class="d-flex align-items-start justify-content-between gap-2">
        <div class="flex-fill">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="entry-ticket ${rule.type === 'servicedesk' ? 'servicedesk' : ''}">${escHtml(rule.ticket || '—')}</span>
            <span class="entry-hours">${String(rule.hh || 0).padStart(2,'0')}:${String(rule.mm || 0).padStart(2,'0')}</span>
            ${rule.type === 'servicedesk' ? '<span class="entry-type-badge">Service Desk</span>' : ''}
          </div>
          <div class="text-muted" style="font-size:0.85rem">${escHtml(rule.desc || '')}</div>
          <div class="d-flex gap-1 mt-2">
            ${RECURRING_DAY_NAMES.map(d => `<span class="recurring-day-chip${rule.days.includes(d) ? ' active' : ''}">${d}</span>`).join('')}
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-light" data-rule-id="${rule.id}" data-action="edit" title="Edit">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-rule-id="${rule.id}" data-action="delete" title="Delete">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>`).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const rule = state.recurringTasks.find(r => r.id === btn.dataset.ruleId);
            if (rule) { recurringModal.hide(); setTimeout(() => openRecurringForm(rule), 300); }
        });
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => deleteRecurringRule(btn.dataset.ruleId));
    });
}

function openRecurringForm(rule) {
    document.getElementById('recurring-form-id').value = rule ? rule.id : '';
    document.getElementById('recurring-ticket').value = rule ? rule.ticket : '';
    document.getElementById('recurring-hh').value = rule ? rule.hh : '';
    document.getElementById('recurring-mm').value = rule ? String(rule.mm || 0).padStart(2, '0') : '00';
    document.getElementById('recurring-type').value = rule ? rule.type : 'jira';
    document.getElementById('recurring-desc').value = rule ? rule.desc : '';
    document.getElementById('recurringFormTitle').innerHTML =
        `<i class="bi bi-arrow-repeat me-2"></i>${rule ? 'Edit' : 'Add'} Recurring Task`;

    document.querySelectorAll('.recurring-day-btn').forEach(btn => {
        btn.classList.toggle('selected', rule ? rule.days.includes(btn.dataset.day) : false);
    });
    syncAllDaysCheckbox();

    [document.getElementById('recurring-ticket'), document.getElementById('recurring-desc'),
     document.getElementById('recurring-hh'), document.getElementById('recurring-mm')]
        .forEach(el => el.classList.remove('is-invalid'));

    recurringFormModal.show();
}

function saveRecurringRule() {
    const ticket = document.getElementById('recurring-ticket').value.trim();
    const hh = parseInt(document.getElementById('recurring-hh').value) || 0;
    const mm = parseInt(document.getElementById('recurring-mm').value) || 0;
    const type = document.getElementById('recurring-type').value;
    const desc = document.getElementById('recurring-desc').value.trim();
    const selectedDays = [...document.querySelectorAll('.recurring-day-btn.selected')].map(b => b.dataset.day);

    let hasError = false;
    [document.getElementById('recurring-ticket'), document.getElementById('recurring-desc'),
     document.getElementById('recurring-hh'), document.getElementById('recurring-mm')]
        .forEach(el => el.classList.remove('is-invalid'));

    if (!ticket) { document.getElementById('recurring-ticket').classList.add('is-invalid'); hasError = true; }
    if (!desc) { document.getElementById('recurring-desc').classList.add('is-invalid'); hasError = true; }
    if (hh === 0 && mm === 0) {
        document.getElementById('recurring-hh').classList.add('is-invalid');
        document.getElementById('recurring-mm').classList.add('is-invalid');
        hasError = true;
    }
    if (selectedDays.length === 0) { showToast('Select at least one day.', 'danger'); hasError = true; }
    if (hasError) return;

    const existingId = document.getElementById('recurring-form-id').value;
    if (existingId) {
        const rule = state.recurringTasks.find(r => r.id === existingId);
        if (rule) {
            Object.assign(rule, { ticket, hh, mm, type, desc, days: selectedDays });
            updateRecurringEntriesFromToday(rule);
        }
    } else {
        const rule = { id: 'rec_' + Date.now(), ticket, hh, mm, type, desc, days: selectedDays };
        state.recurringTasks.push(rule);
        populateRecurringForWeek(getDateFromWeek(state.weekValue || getWeekStrFromDate(new Date())));
    }

    saveState();
    state.days.forEach((_, i) => rerenderDayCard(i));
    updateSummary();
    recurringFormModal.hide();
    setTimeout(() => { renderRecurringList(); recurringModal.show(); }, 300);
    showToast('Recurring task saved.', 'success');
}

function deleteRecurringRule(ruleId) {
    deleteRecurringEntriesFromToday(ruleId);
    state.recurringTasks = state.recurringTasks.filter(r => r.id !== ruleId);
    saveState();
    state.days.forEach((_, i) => rerenderDayCard(i));
    updateSummary();
    renderRecurringList();
    showToast('Recurring task deleted.', 'success');
}

/* ── SUMMARY TOTALS ────────────────────────────────────── */
function calcDayTotalMins(day) {
    if (day.isHoliday) return 0;
    return (day.entries || []).reduce((sum, e) => sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);
}

function minsToHHMM(totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function updateSummary() {
    let totalMins = 0;
    let workingDays = 0;
    let totalEntries = 0;

    state.days.forEach(day => {
        if (!day.isHoliday) {
            const m = calcDayTotalMins(day);
            if (m > 0) workingDays++;
            totalMins += m;
            totalEntries += (day.entries || []).length;
        }
    });

    document.getElementById('total-hours').textContent = minsToHHMM(totalMins);
    document.getElementById('total-days').textContent = workingDays;
    document.getElementById('total-entries').textContent = totalEntries;
}

/* ── TXT GENERATION ────────────────────────────────────── */
function generateTxt() {
    const monDt = getDateFromWeek(state.weekValue);
    const friDt = new Date(monDt);
    friDt.setDate(monDt.getDate() + 4);

    let lines = [];
    lines.push(state.reportTitle || 'Booked hours in Jira and Service Desk');
    lines.push(SEPARATOR);

    state.days.forEach((day, i) => {
        const displayDate = fmtDisplayDate(day.date);

        if (day.isHoliday) {
            lines.push(`${displayDate} :   `);
            lines.push(`\ti)\t${day.holidayLabel || 'Offshore Holiday'}`);
            lines.push('');
        } else {
            const totalMins = calcDayTotalMins(day);
            const hrsStr = minsToHHMM(totalMins);
            lines.push(`${displayDate} : ${hrsStr} hrs`);

            if (!day.entries || day.entries.length === 0) {
                lines.push('');
            } else {
                const groups = buildGroups(day.entries);

                groups.forEach((group, gi) => {
                    const roman = ROMAN[gi] + ')';
                    const romanBlank = ' '.repeat(roman.length);

                    group.items.forEach((e, itemIdx) => {
                        const isFirst = itemIdx === 0;
                        const isLast = itemIdx === group.items.length - 1;
                        
                        const rStr = isFirst ? roman : romanBlank;
                        
                        let tktStr = (e.ticket || '');
                        if (group.type === 'ticket_group' && !isFirst) {
                            tktStr = '';
                        }
                        const ticket = padTicket(tktStr);

                        const hhmm = `${String(e.hh || 0).padStart(2, '0')}:${String(e.mm || 0).padStart(2, '0')}`;
                        const sdTag = e.type === 'servicedesk' ? '(Service desk) ' : '';

                        let desc = e.desc || '';
                        if (sdTag && desc.toLowerCase().startsWith('(service desk)')) {
                            desc = desc.substring(15).trim();
                            if (desc.startsWith('-')) desc = desc.substring(1).trim();
                        }
                        
                        let showDesc = true;
                        if (group.type === 'desc_group' && !isLast) {
                            showDesc = false;
                        }

                        if (!showDesc) {
                            lines.push(`\t${rStr}\t${ticket} (hrs: ${hhmm}) `);
                        } else {
                            const descLines = desc ? desc.split(/\r?\n/) : [];
                            if (descLines.length === 0) {
                                lines.push(`\t${rStr}\t${ticket} (hrs: ${hhmm})`);
                            } else {
                                lines.push(`\t${rStr}\t${ticket} (hrs: ${hhmm}) - ${sdTag}${descLines[0]}`);
                                if (descLines.length > 1) {
                                    const indentStr = '\t' + ' '.repeat(rStr.length) + '\t' + ' '.repeat(`${ticket} (hrs: ${hhmm}) - ${sdTag}`.length);
                                    for (let j = 1; j < descLines.length; j++) {
                                        lines.push(`${indentStr}${descLines[j]}`);
                                    }
                                }
                            }
                        }
                    });
                });
                lines.push('');
            }
        }
    });

    return lines.join('\r\n');
}

function padTicket(ticket) {
    // Pad to ~12 chars for alignment (matching the example)
    const target = 11;
    if (ticket.length < target) return ticket + ' '.repeat(target - ticket.length);
    return ticket;
}

/* ── PREVIEW ───────────────────────────────────────────── */
let previewModal;
let dayEntriesModal;
document.addEventListener('DOMContentLoaded', () => {
    previewModal = new bootstrap.Modal(document.getElementById('previewModal'));
    dayEntriesModal = new bootstrap.Modal(document.getElementById('dayEntriesModal'));
    
    document.getElementById('btn-copy-day-entries').addEventListener('click', copyDayQuickView);
});

function openPreview() {
    const txt = generateTxt();
    document.getElementById('txt-preview').textContent = txt;
    previewModal.show();
}

function openDayQuickView(dayIdx) {
    const day = state.days[dayIdx];
    if (!day || !day.entries || day.entries.length === 0) return;

    const displayDate = fmtDisplayDate(day.date);
    document.getElementById('dayEntriesModalLabel').innerHTML = `<i class="bi bi-card-text me-2"></i>Day Entries — ${WEEK_DAYS[dayIdx]}, ${displayDate}`;

    let contentStr = '';
    day.entries.forEach((e, idx) => {
        const h = parseInt(e.hh) || 0;
        const m = parseInt(e.mm) || 0;
        
        let timeParts = [];
        if (h > 0) timeParts.push(`${h}h`);
        if (m > 0) timeParts.push(`${m}m`);
        const formattedTime = timeParts.join(' ');
        
        const tkt = e.ticket ? e.ticket.trim() : 'No Ticket';
        const desc = e.desc ? e.desc.trim() : 'No description provided';
        
        contentStr += `${tkt} (${formattedTime})\n${desc}`;
        if (idx < day.entries.length - 1) {
            contentStr += '\n\n';
        }
    });

    document.getElementById('day-entries-content').textContent = contentStr;
    dayEntriesModal.show();
}

function copyDayQuickView() {
    const content = document.getElementById('day-entries-content').textContent;
    navigator.clipboard.writeText(content).then(() => {
        showToast('Copied day entries to clipboard!', 'success');
        dayEntriesModal.hide();
    }).catch(() => {
        showToast('Failed to copy.', 'danger');
    });
}

/* ── COPY ──────────────────────────────────────────────── */
function copyTxt() {
    const txt = generateTxt();
    navigator.clipboard.writeText(txt).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy.', 'danger');
    });
}

/* ── DOWNLOAD ──────────────────────────────────────────── */
function downloadTxt() {
    const txt = generateTxt();
    const name = state.employeeName.replace(/\s+/g, '_') || 'Employee';
    const monDt = getDateFromWeek(state.weekValue);

    // As per the example, the file name covers the full week Monday to Sunday
    const sunDt = new Date(monDt);
    sunDt.setDate(monDt.getDate() + 6); // Add 6 days to get Sunday

    // Format strictly as DD-MM-YYYY (numbers only)
    const fmtNumeric = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
    };

    const s = fmtNumeric(monDt); // 02-03-2026
    const e = fmtNumeric(sunDt); // 08-03-2026

    const filename = `Jira_TimeSheet_${name}_${s}_to_${e}.txt`;

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ── PRINT ─────────────────────────────────────────────── */
function doPrint() {
    const txt = generateTxt();
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `<pre>${escHtml(txt)}</pre>`;
    window.print();
}

/* ── TOAST ─────────────────────────────────────────────── */
let confirmModal;
function showConfirm(message, onYes) {
    if (!confirmModal) confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    document.getElementById('confirm-modal-message').textContent = message;
    const yesBtn = document.getElementById('btn-confirm-yes');
    const noBtn = document.getElementById('btn-confirm-no');
    const cleanup = () => { yesBtn.onclick = null; noBtn.onclick = null; };
    yesBtn.onclick = () => { confirmModal.hide(); cleanup(); onYes(); };
    noBtn.onclick = () => { confirmModal.hide(); cleanup(); };
    confirmModal.show();
}

function showToast(msg, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-' + Date.now();
    const colors = { success: '#22d3a0', danger: '#f87171', info: '#818cf8' };
    const icons = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:220px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi ${icons[type] || icons.info}" style="color:${colors[type] || colors.info}"></i>
        <span style="font-size:0.85rem">${msg}</span>
        <button type="button" class="btn-close btn-close-white ms-auto" style="font-size:0.6rem" onclick="document.getElementById('${id}').remove()"></button>
      </div>
    </div>`);
    setTimeout(() => { const el = document.getElementById(id); if (el) el.remove(); }, 3000);
}

/* ── UTILS ─────────────────────────────────────────────── */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ── KEYBOARD SHORTCUTS ────────────────────────────────── */
document.addEventListener('keydown', e => {
    // Do nothing when typing inside an input, textarea or select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Do nothing when a modal is open (except Enter to save entry)
    const modalOpen = document.querySelector('.modal.show');

    if (modalOpen) {
        if (e.key === 'Enter' && modalOpen.id === 'entryModal') {
            e.preventDefault();
            saveEntry();
        }
        return;
    }

    const expandedIdx = state.days.findIndex(d => d.expanded);

    switch (e.key) {
        case 'n':
        case 'N':
            if (expandedIdx !== -1) openEntryModal(expandedIdx, -1);
            break;

        case 'ArrowLeft':
            if (expandedIdx > 0) toggleDay(expandedIdx - 1);
            break;

        case 'ArrowRight':
            if (expandedIdx < state.days.length - 1) toggleDay(expandedIdx + 1);
            break;

        case 'p':
        case 'P':
            if (!e.ctrlKey) openPreview();
            break;

        case 'q':
        case 'Q':
            if (expandedIdx !== -1) {
                const day = state.days[expandedIdx];
                if (day.entries && day.entries.length > 0) openDayQuickView(expandedIdx);
            }
            break;
    }

    // Ctrl+P → print
    if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        doPrint();
    }
});

/* ── SCHEDULED TASKS ───────────────────────────────────── */
function promoteExpiredScheduled() {
    const todayStr = fmtDate(new Date());
    let changed = false;
    Object.keys(state.allDaysByDate).forEach(dateStr => {
        if (dateStr >= todayStr) return;
        state.allDaysByDate[dateStr].entries.forEach(entry => {
            if (entry.isScheduled) {
                delete entry.isScheduled;
                changed = true;
            }
        });
    });
    if (changed) saveState();
}

let scheduledModal, scheduledFormModal;

function initScheduledTasks() {
    scheduledModal = new bootstrap.Modal(document.getElementById('scheduledModal'));
    scheduledFormModal = new bootstrap.Modal(document.getElementById('scheduledFormModal'));

    const menuBtn = document.getElementById('menu-scheduled');
    const sidebarEl = document.getElementById('appSidebar');

    menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const offcanvasInstance = bootstrap.Offcanvas.getInstance(sidebarEl);
        if (offcanvasInstance) offcanvasInstance.hide();
        renderScheduledList();
        scheduledModal.show();
    });

    document.getElementById('btn-add-scheduled').addEventListener('click', () => {
        scheduledModal.hide();
        openScheduledForm();
    });

    document.getElementById('btn-save-scheduled').addEventListener('click', saveScheduledTask);

    const closeForm = () => {
        scheduledFormModal.hide();
        scheduledModal.show();
        renderScheduledList();
    };
    document.getElementById('btn-scheduled-form-close').addEventListener('click', closeForm);
    document.getElementById('btn-scheduled-form-cancel').addEventListener('click', closeForm);
}

function renderScheduledList() {
    const container = document.getElementById('scheduled-list');

    // Collect all scheduled entries from allDaysByDate
    const scheduled = [];
    Object.keys(state.allDaysByDate).sort().forEach(dateStr => {
        const day = state.allDaysByDate[dateStr];
        day.entries.forEach((entry, entryIdx) => {
            if (entry.isScheduled) {
                scheduled.push({ dateStr, entry, entryIdx });
            }
        });
    });

    if (scheduled.length === 0) {
        container.innerHTML = `<p class="text-muted text-center py-3" style="font-size:0.9rem;">No scheduled tasks. Click "Add Scheduled Task" to pre-schedule an entry for a future date.</p>`;
        return;
    }

    let html = '';
    scheduled.forEach(({ dateStr, entry, entryIdx }) => {
        const dt = new Date(dateStr + 'T00:00:00');
        const dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const hhmm = `${String(entry.hh || 0).padStart(2, '0')}:${String(entry.mm || 0).padStart(2, '0')}`;
        const isSd = entry.type === 'servicedesk';
        const isPast = dateStr <= fmtDate(new Date());
        html += `
        <div class="recurring-rule-card mb-2${isPast ? ' opacity-50' : ''}">
          <div class="d-flex align-items-start justify-content-between gap-2">
            <div class="flex-grow-1">
              <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <i class="bi bi-clock" style="color:var(--warning);font-size:0.8rem"></i>
                <span style="font-size:0.75rem;color:var(--text-secondary)">${escHtml(dateLabel)}${isPast ? ' <span class="text-danger">(past)</span>' : ''}</span>
              </div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="fw-semibold" style="font-size:0.9rem">${escHtml(entry.ticket || '—')}</span>
                <span class="text-muted" style="font-size:0.8rem">${hhmm}</span>
                ${isSd ? '<span class="entry-type-badge">Service Desk</span>' : ''}
              </div>
              <div class="text-muted mt-1" style="font-size:0.8rem">${escHtml(entry.desc || '')}</div>
            </div>
            <div class="d-flex gap-1 flex-shrink-0">
              <button class="btn btn-sm btn-outline-warning py-0 px-2" title="Make Regular" data-scheduled-date="${dateStr}" data-scheduled-idx="${entryIdx}">
                <i class="bi bi-calendar-check"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Delete" data-delete-scheduled-date="${dateStr}" data-delete-scheduled-idx="${entryIdx}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>`;
    });

    container.innerHTML = html;

    // Wire up Make Regular buttons
    container.querySelectorAll('[data-scheduled-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            makeScheduledRegular(btn.dataset.scheduledDate, parseInt(btn.dataset.scheduledIdx));
        });
    });

    // Wire up Delete buttons
    container.querySelectorAll('[data-delete-scheduled-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteScheduledEntry(btn.dataset.deleteScheduledDate, parseInt(btn.dataset.deleteScheduledIdx));
        });
    });
}

function openScheduledForm() {
    // Reset form
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateInput = document.getElementById('scheduled-form-date');
    dateInput.min = fmtDate(tomorrow);
    dateInput.value = '';
    dateInput.classList.remove('is-invalid');
    document.getElementById('scheduled-form-ticket').value = '';
    document.getElementById('scheduled-form-ticket').classList.remove('is-invalid');
    document.getElementById('scheduled-form-hh').value = '';
    document.getElementById('scheduled-form-mm').value = '00';
    document.getElementById('scheduled-form-type').value = 'jira';
    document.getElementById('scheduled-form-desc').value = '';
    document.getElementById('scheduled-form-desc').classList.remove('is-invalid');
    scheduledFormModal.show();
}

function saveScheduledTask() {
    const dateInput = document.getElementById('scheduled-form-date');
    const ticketInput = document.getElementById('scheduled-form-ticket');
    const descInput = document.getElementById('scheduled-form-desc');
    const scheduledDate = dateInput.value;
    const tkt = ticketInput.value.trim();
    const desc = descInput.value.trim();
    const hh = parseInt(document.getElementById('scheduled-form-hh').value) || 0;
    const mm = parseInt(document.getElementById('scheduled-form-mm').value) || 0;
    const type = document.getElementById('scheduled-form-type').value;

    let hasError = false;
    [dateInput, ticketInput, descInput].forEach(el => el.classList.remove('is-invalid'));

    if (!scheduledDate) { dateInput.classList.add('is-invalid'); hasError = true; }
    if (!tkt) { ticketInput.classList.add('is-invalid'); hasError = true; }
    if (!desc) { descInput.classList.add('is-invalid'); hasError = true; }
    if (hh === 0 && mm === 0) { hasError = true; }

    if (hasError) { showToast('Please fill in all required fields.', 'danger'); return; }

    const dt = new Date(scheduledDate + 'T00:00:00');
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) {
        dateInput.classList.add('is-invalid');
        showToast('Scheduled date must be a weekday (Mon–Fri).', 'danger');
        return;
    }
    const todayStr = fmtDate(new Date());
    if (scheduledDate <= todayStr) {
        dateInput.classList.add('is-invalid');
        showToast('Scheduled date must be in the future.', 'danger');
        return;
    }

    // Duplicate check: same ticket already scheduled for this date
    const existingDay = state.allDaysByDate[scheduledDate];
    if (existingDay && existingDay.entries.some(e => e.isScheduled && e.ticket.toLowerCase() === tkt.toLowerCase())) {
        ticketInput.classList.add('is-invalid');
        showToast(`"${tkt}" is already scheduled for this date.`, 'danger');
        return;
    }

    if (!state.allDaysByDate[scheduledDate]) {
        state.allDaysByDate[scheduledDate] = {
            date: scheduledDate, isHoliday: false,
            holidayLabel: 'Offshore Holiday', expanded: false, entries: []
        };
    }
    state.allDaysByDate[scheduledDate].entries.push({ ticket: tkt, hh, mm, type, desc, isScheduled: true });

    // Rerender if this date is in the current week
    const dayInWeek = state.days.findIndex(d => d.date === scheduledDate);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[scheduledDate];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();

    const dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    showToast(`Scheduled for ${dateLabel}.`, 'success');
    scheduledFormModal.hide();
    renderScheduledList();
    scheduledModal.show();
}

function makeScheduledRegular(dateStr, entryIdx) {
    const day = state.allDaysByDate[dateStr];
    if (!day || !day.entries[entryIdx]) return;
    delete day.entries[entryIdx].isScheduled;

    const dayInWeek = state.days.findIndex(d => d.date === dateStr);
    if (dayInWeek !== -1) rerenderDayCard(dayInWeek);

    saveState();
    updateSummary();
    renderScheduledList();
    showToast('Entry converted to a regular entry.', 'success');
}

function deleteScheduledEntry(dateStr, entryIdx) {
    const day = state.allDaysByDate[dateStr];
    if (!day) return;
    day.entries.splice(entryIdx, 1);

    const dayInWeek = state.days.findIndex(d => d.date === dateStr);
    if (dayInWeek !== -1) {
        state.days[dayInWeek] = state.allDaysByDate[dateStr];
        rerenderDayCard(dayInWeek);
    }

    saveState();
    updateSummary();
    renderScheduledList();
}

/* ── THEME ─────────────────────────────────────────────── */
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let themeToApply = 'dark';
    if (savedTheme) {
        themeToApply = savedTheme;
    } else if (!systemPrefersDark) {
        themeToApply = 'light';
    }

    applyTheme(themeToApply);

    const toggleBtn = document.getElementById('btn-theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent # jump/reload for <a> tag
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
    
    // Listen for system theme changes if no saved preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    const toggleBtn = document.getElementById('btn-theme-toggle');
    
    if (theme === 'light') {
        if (icon) {
            icon.classList.remove('bi-moon-fill', 'bi-moon');
            icon.classList.add('bi-sun-fill');
        }
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Switch to Dark Mode';
        }
    } else {
        if (icon) {
            icon.classList.remove('bi-sun-fill', 'bi-sun');
            icon.classList.add('bi-moon-fill');
        }
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Switch to Light Mode';
        }
    }
}

/* ── SEARCH ─────────────────────────────────────────────── */
const SEARCH_PAGE_SIZE = 10;
let advSearchResults = [];
let advSearchPage = 0;
let advSelectedRange = 'all';

function fmtSearchDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function fmtTypeLabel(type) {
    return type === 'servicedesk' ? 'Service Desk' : 'Jira';
}

function fmtHHMM(hh, mm) {
    return `${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`;
}

function searchCurrentWeek(query) {
    const q = query.toLowerCase();
    const results = [];
    state.days.forEach((day, dayIdx) => {
        if (!day || !day.entries) return;
        day.entries.forEach((entry, entryIdx) => {
            const matchTicket = entry.ticket && entry.ticket.toLowerCase().includes(q);
            const matchType   = fmtTypeLabel(entry.type).toLowerCase().includes(q);
            const matchDesc   = entry.desc && entry.desc.toLowerCase().includes(q);
            if (matchTicket || matchType || matchDesc) {
                results.push({ dateStr: day.date, dayIdx, entryIdx, entry });
            }
        });
    });
    return results;
}

function navigateToResult(dateStr, entryIdx) {
    const weekStr = getWeekStrFromDate(new Date(dateStr + 'T00:00:00'));
    if (weekStr !== state.weekValue) {
        state.weekValue = weekStr;
        document.getElementById('week-picker').value = weekStr;
        state.days = buildWeekDays(getDateFromWeek(weekStr));
        enforceExpandedState();
        updateWeekDisplay();
        saveState();
    }
    // Find day index for this date
    const dayIdx = state.days.findIndex(d => d && d.date === dateStr);
    if (dayIdx === -1) return;
    // Expand that day
    state.days.forEach((d, i) => { if (d) d.expanded = (i === dayIdx); });
    state.lastOpenedDateByWeek[state.weekValue] = dateStr;
    renderAll();
    // After render, scroll + flash
    setTimeout(() => {
        const el = document.querySelector(`.entry-row[data-day="${dayIdx}"][data-entry="${entryIdx}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('entry-highlight-flash');
        el.addEventListener('animationend', () => el.classList.remove('entry-highlight-flash'), { once: true });
    }, 80);
}

function renderSearchDropdown(results, query, showAll) {
    const dropdown = document.getElementById('search-dropdown');
    if (!results.length) {
        dropdown.innerHTML = '<div class="search-no-results">No results found</div>';
        dropdown.style.display = 'block';
        return;
    }
    const visible = showAll ? results : results.slice(0, 5);
    const remaining = results.length - 5;
    let html = '';
    visible.forEach((r, i) => {
        const line1 = `${escHtml(fmtSearchDate(r.dateStr))} &middot; ${escHtml(r.entry.ticket || '—')} &middot; ${escHtml(fmtTypeLabel(r.entry.type))}`;
        const desc = r.entry.desc || '';
        html += `<div class="search-result-item" data-idx="${i}" tabindex="-1">
            <div class="search-result-line1">${line1}</div>
            <div class="search-result-line2">${escHtml(desc)}</div>
        </div>`;
    });
    if (!showAll && remaining > 0) {
        html += `<div class="search-show-more" id="search-show-more">Show ${remaining} more…</div>`;
    }
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-result-item').forEach((el, i) => {
        el.addEventListener('click', () => {
            const r = visible[i];
            closeSearchDropdown();
            document.getElementById('search-input').value = '';
            navigateToResult(r.dateStr, r.entryIdx);
        });
    });
    const showMoreEl = document.getElementById('search-show-more');
    if (showMoreEl) {
        showMoreEl.addEventListener('click', () => renderSearchDropdown(results, query, true));
    }
}

function closeSearchDropdown() {
    const dropdown = document.getElementById('search-dropdown');
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
}

function initSearch() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');
    let activeIdx = -1;
    let lastResults = [];
    let showingAll = false;

    input.addEventListener('input', () => {
        const q = input.value.trim();
        activeIdx = -1;
        showingAll = false;
        if (q.length < 3) { closeSearchDropdown(); return; }
        lastResults = searchCurrentWeek(q);
        renderSearchDropdown(lastResults, q, false);
    });

    // Keyboard nav
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].click();
        } else if (e.key === 'Escape') {
            closeSearchDropdown();
            input.blur();
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!document.getElementById('search-wrap').contains(e.target)) {
            closeSearchDropdown();
        }
    });

    // Ctrl+F
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
            e.preventDefault();
            input.focus();
            input.select();
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            openAdvancedSearch();
        }
    });

    // Advanced search button
    document.getElementById('btn-adv-search').addEventListener('click', () => openAdvancedSearch());

    // Advanced search modal wiring
    document.querySelectorAll('.adv-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.adv-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            advSelectedRange = btn.dataset.range;
            const customRow = document.getElementById('adv-custom-range');
            customRow.style.display = advSelectedRange === 'custom' ? 'flex' : 'none';
        });
    });

    document.getElementById('btn-run-adv-search').addEventListener('click', () => {
        advSearchPage = 0;
        advSearchResults = runAdvancedSearch();
        renderAdvancedResults();
    });
}

function openAdvancedSearch() {
    // Pre-fill from basic search bar
    const basicVal = document.getElementById('search-input').value.trim();
    document.getElementById('adv-search-input').value = basicVal;
    document.getElementById('adv-search-results').innerHTML = '';
    document.getElementById('adv-search-pagination').innerHTML = '';
    advSearchResults = [];
    advSearchPage = 0;
    const modal = new bootstrap.Modal(document.getElementById('advSearchModal'));
    modal.show();
    setTimeout(() => document.getElementById('adv-search-input').focus(), 300);
}

function runAdvancedSearch() {
    const q = document.getElementById('adv-search-input').value.trim().toLowerCase();
    const fieldTicket = document.getElementById('adv-field-ticket').checked;
    const fieldType   = document.getElementById('adv-field-type').checked;
    const fieldDesc   = document.getElementById('adv-field-desc').checked;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = fmtDate(today);

    let fromStr = null, toStr = null;
    if (advSelectedRange === 'today') {
        fromStr = toStr = todayStr;
    } else if (advSelectedRange === 'lastweek') {
        const from = new Date(today); from.setDate(today.getDate() - 7);
        fromStr = fmtDate(from); toStr = todayStr;
    } else if (advSelectedRange === 'lastmonth') {
        const from = new Date(today); from.setDate(today.getDate() - 30);
        fromStr = fmtDate(from); toStr = todayStr;
    } else if (advSelectedRange === 'custom') {
        fromStr = document.getElementById('adv-from-date').value || null;
        toStr   = document.getElementById('adv-to-date').value || null;
    }

    const results = [];
    const allDates = Object.keys(state.allDaysByDate).sort();
    allDates.forEach(dateStr => {
        if (fromStr && dateStr < fromStr) return;
        if (toStr && dateStr > toStr) return;
        const day = state.allDaysByDate[dateStr];
        if (!day || !day.entries) return;
        day.entries.forEach((entry, entryIdx) => {
            if (q) {
                const mTicket = fieldTicket && entry.ticket && entry.ticket.toLowerCase().includes(q);
                const mType   = fieldType   && fmtTypeLabel(entry.type).toLowerCase().includes(q);
                const mDesc   = fieldDesc   && entry.desc && entry.desc.toLowerCase().includes(q);
                if (!mTicket && !mType && !mDesc) return;
            }
            results.push({ dateStr, entryIdx, entry });
        });
    });
    return results;
}

function renderAdvancedResults() {
    const container = document.getElementById('adv-search-results');
    const pagEl     = document.getElementById('adv-search-pagination');

    if (!advSearchResults.length) {
        container.innerHTML = '<div class="search-no-results py-3">No results found</div>';
        pagEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(advSearchResults.length / SEARCH_PAGE_SIZE);
    const pageItems  = advSearchResults.slice(advSearchPage * SEARCH_PAGE_SIZE, (advSearchPage + 1) * SEARCH_PAGE_SIZE);

    container.innerHTML = pageItems.map((r, i) => {
        const hhmm = fmtHHMM(r.entry.hh, r.entry.mm);
        const line1Left = `${escHtml(fmtSearchDate(r.dateStr))} &middot; ${escHtml(r.entry.ticket || '—')} &middot; ${escHtml(fmtTypeLabel(r.entry.type))}`;
        const desc = r.entry.desc || '';
        return `<div class="adv-result-card" data-pidx="${i}">
            <div class="adv-result-line1">
                <span>${line1Left}</span>
                <span class="adv-result-hours">${hhmm}</span>
            </div>
            <div class="adv-result-line2">${escHtml(desc)}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.adv-result-card').forEach((el, i) => {
        el.addEventListener('click', () => {
            const r = pageItems[i];
            bootstrap.Modal.getInstance(document.getElementById('advSearchModal')).hide();
            navigateToResult(r.dateStr, r.entryIdx);
        });
    });

    // Pagination
    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
    let pagHtml = '';
    for (let p = 0; p < totalPages; p++) {
        pagHtml += `<button class="adv-pagination-btn${p === advSearchPage ? ' active' : ''}" data-page="${p}">${p + 1}</button>`;
    }
    pagEl.innerHTML = pagHtml;
    pagEl.querySelectorAll('.adv-pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            advSearchPage = parseInt(btn.dataset.page);
            renderAdvancedResults();
        });
    });
}

/* ── SIDEBAR & ABOUT ───────────────────────────────────── */
function initSidebar() {
    const aboutBtn = document.getElementById('menu-about');
    const sidebarEl = document.getElementById('appSidebar');
    const aboutModalEl = document.getElementById('aboutModal');

    const closeSidebar = () => {
        const oc = bootstrap.Offcanvas.getInstance(sidebarEl);
        if (oc) oc.hide(); else new bootstrap.Offcanvas(sidebarEl).hide();
    };

    if (aboutBtn && sidebarEl && aboutModalEl) {
        const aboutModal = new bootstrap.Modal(aboutModalEl);
        aboutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            aboutModal.show();
        });
    }

    // Check for Updates
    const updateBtn = document.getElementById('menu-check-updates');
    if (updateBtn) {
        updateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            showToast('Checking for updates…', 'info');
            manualUpdateCheck = true;
            window.updater.checkForUpdates();
        });
    }
}

/* ── AUTO-UPDATER ───────────────────────────────────────── */
let manualUpdateCheck = false;

function initUpdater() {
    if (!window.updater) return;

    let downloadToastId = null;

    window.updater.onUpdateAvailable((info) => {
        manualUpdateCheck = false;
        showUpdateToast(
            `v${info.version} is available.`,
            'Download',
            () => {
                downloadToastId = showProgressToast('Downloading update… 0%');
                window.updater.downloadUpdate();
            }
        );
    });

    window.updater.onUpdateNotAvailable(() => {
        if (manualUpdateCheck) showToast('You\'re on the latest version.', 'success');
        manualUpdateCheck = false;
    });

    window.updater.onDownloadProgress((progress) => {
        const pct = Math.round(progress.percent);
        if (downloadToastId) {
            const el = document.getElementById(downloadToastId + '-msg');
            if (el) el.textContent = `Downloading update… ${pct}%`;
        }
    });

    window.updater.onUpdateDownloaded((info) => {
        if (downloadToastId) {
            document.getElementById(downloadToastId)?.remove();
            downloadToastId = null;
        }
        showUpdateToast(
            `v${info.version} ready to install.`,
            'Restart & Install',
            () => window.updater.installUpdate()
        );
    });

    window.updater.onError(() => {
        showToast('Failed to download update.', 'danger');
    });
}

function showUpdateToast(message, actionLabel, onAction) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-update-' + Date.now();
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:300px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-cloud-arrow-down" style="color:var(--success)"></i>
        <span style="font-size:0.85rem;flex:1">${escHtml(message)}</span>
        <button type="button" class="btn btn-sm btn-gradient ms-auto py-0 px-2" style="font-size:0.75rem" id="${id}-action">${escHtml(actionLabel)}</button>
        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" style="font-size:0.75rem" id="${id}-dismiss">✕</button>
      </div>
    </div>`);
    document.getElementById(`${id}-action`).addEventListener('click', () => {
        document.getElementById(id)?.remove();
        onAction();
    });
    document.getElementById(`${id}-dismiss`).addEventListener('click', () => {
        document.getElementById(id)?.remove();
    });
}

function showProgressToast(initialMessage) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-progress-' + Date.now();
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:300px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-cloud-arrow-down" style="color:var(--info)"></i>
        <span id="${id}-msg" style="font-size:0.85rem;flex:1">${escHtml(initialMessage)}</span>
      </div>
    </div>`);
    return id;
}
