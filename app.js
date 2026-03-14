/* =============================================================
   TIMESHEET MANAGER — app.js
   Weekly Jira & Service Desk Time Tracker
   ============================================================= */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────────── */
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
    days: []           // array of 5 active day objects mapping to current week
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

/* ── LOCALSTORAGE ──────────────────────────────────────── */
const LS_KEY = 'timesheetState_v1';

function saveState() {
    try {
        state.days.forEach(d => {
            if (d && d.date) {
                state.allDaysByDate[d.date] = d;
            }
        });

        // Prune data older than 4 weeks (28 days) to persist only recent data
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 28);
        cutoffDate.setHours(0, 0, 0, 0);

        Object.keys(state.allDaysByDate).forEach(dateStr => {
            const entryDate = new Date(dateStr + 'T00:00:00');
            if (entryDate < cutoffDate) {
                delete state.allDaysByDate[dateStr];
            }
        });

        const toSave = {
            reportTitle: state.reportTitle,
            employeeName: state.employeeName,
            weekValue: state.weekValue,
            allDaysByDate: state.allDaysByDate
        };
        localStorage.setItem(LS_KEY, JSON.stringify(toSave));
    } catch (e) { console.warn('Could not save to localStorage', e); }
}

function loadState() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (!saved) return false;

        state.reportTitle = saved.reportTitle || 'Booked hours in Jira and Service Desk';
        state.employeeName = saved.employeeName || '';
        state.weekValue = saved.weekValue || '';
        state.allDaysByDate = saved.allDaysByDate || {};

        // Backwards compatibility migration
        if (saved.days && Array.isArray(saved.days)) {
            saved.days.forEach(d => {
                if (d && d.date) {
                    state.allDaysByDate[d.date] = d;
                }
            });
        }
        return true;
    } catch (e) { return false; }
}

/* ── INIT ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    bindHeaderEvents();
    const restored = loadState();

    // Always apply these inputs if we have them in state, regardless of whether a week was previously saved or not
    document.getElementById('report-title').value = state.reportTitle || '';
    document.getElementById('emp-name').value = state.employeeName || '';

    if (restored && state.weekValue) {
        // Restore saved week & name into inputs
        document.getElementById('week-picker').value = state.weekValue;
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
                expanded: true,
                entries: []
            };
            state.allDaysByDate[dStr] = newDay;
            days.push(newDay);
        }
        currentDt.setDate(currentDt.getDate() + 1);
    }
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

function setCurrentWeek() {
    const today = new Date();
    const weekVal = getWeekStrFromDate(today);

    document.getElementById('week-picker').value = weekVal;
    state.weekValue = weekVal;
    state.days = buildWeekDays(getDateFromWeek(weekVal));
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
        updateWeekDisplay();
        saveState();
        renderAll();
    });

    document.getElementById('btn-autofill-week').addEventListener('click', () => {
        setCurrentWeek();
        saveState();
        renderAll();
    });

    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-print').addEventListener('click', doPrint);
    document.getElementById('btn-copy-txt').addEventListener('click', copyTxt);
    document.getElementById('btn-download-txt').addEventListener('click', downloadTxt);
    document.getElementById('btn-save-entry').addEventListener('click', saveEntry);
    document.getElementById('btn-delete-entry').addEventListener('click', deleteEntry);
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
        <div class="day-number${day.isHoliday ? ' holiday' : ''}">${dayIdx + 1}</div>
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
                ticketHtml = `<span class="entry-ticket text-muted" style="opacity:0.3">${escHtml(tktStr || '—')}</span>`;
            }

            const hhmm = `${String(e.hh || 0).padStart(2, '0')}:${String(e.mm || 0).padStart(2, '0')}`;
            const isSd = e.type === 'servicedesk';
            
            let showDesc = true;
            if (group.type === 'desc_group' && !isLast) {
                showDesc = false;
            }
            
            let descHtml = `<span class="entry-desc">${escHtml(e.desc || '')}</span>`;
            if (!showDesc) {
                descHtml = `<span class="entry-desc text-muted" style="opacity:0.3">↳ Grouped below</span>`;
            }

            let actTicketHtml = '';
            let actDescHtml = '';

            if (group.type === 'normal') {
                actTicketHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Sub-task (keep ticket)" onclick="event.stopPropagation(); openEntryModalPreFilled(${dayIdx}, ${actualOriginalIndex}, 'ticket')">
                    <i class="bi bi-plus"></i> <i class="bi bi-ticket-detailed"></i>
                </button>`;
                actDescHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Ticket to Group (keep desc)" onclick="event.stopPropagation(); openEntryModalPreFilled(${dayIdx}, ${actualOriginalIndex}, 'desc')">
                    <i class="bi bi-plus"></i> <i class="bi bi-card-text"></i>
                </button>`;
            } else if (group.type === 'ticket_group') {
                actTicketHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Sub-task (keep ticket)" onclick="event.stopPropagation(); openEntryModalPreFilled(${dayIdx}, ${actualOriginalIndex}, 'ticket')">
                    <i class="bi bi-plus"></i> <i class="bi bi-ticket-detailed"></i>
                </button>`;
            } else if (group.type === 'desc_group') {
                actDescHtml = `<button type="button" class="btn btn-sm py-0 px-2 quick-add-inline" title="Add Ticket to Group (keep desc)" onclick="event.stopPropagation(); openEntryModalPreFilled(${dayIdx}, ${actualOriginalIndex}, 'desc')">
                    <i class="bi bi-plus"></i> <i class="bi bi-card-text"></i>
                </button>`;
            }

            htmlFragments.push(`
    <div class="entry-row" data-day="${dayIdx}" data-entry="${actualOriginalIndex}" data-group-idx="${gi}" data-item-idx="${itemIdx}">
      <span class="drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
      <span class="entry-num entry-num-roman">${rStr}</span>
      ${ticketHtml}
      <span class="entry-hours">${hhmm}</span>
      ${isSd ? '<span class="entry-type-badge">Service Desk</span>' : ''}
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
    state.days[dayIdx].expanded = !state.days[dayIdx].expanded;
    rerenderDayCard(dayIdx);
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
    const title = document.getElementById('entryModalLabel');

    if (entryIdx === -1) {
        // Add mode
        clearEntryModal();
        deleteBtn.style.display = 'none';
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
        title.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Edit Entry — ${WEEK_DAYS[dayIdx]}`;
    }

    entryModal.show();
}

function openEntryModalPreFilled(dayIdx, fromEntryIdx, keepField) {
    document.getElementById('modal-day-index').value = dayIdx;
    document.getElementById('modal-entry-index').value = -1; // Force Add mode
    
    const deleteBtn = document.getElementById('btn-delete-entry');
    const title = document.getElementById('entryModalLabel');
    deleteBtn.style.display = 'none';
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

    if (totalMinsForDay > 8 * 60) {
        const totalH = Math.floor(totalMinsForDay / 60);
        const totalM = totalMinsForDay % 60;
        const confirmHigh = confirm(`This entry will bring your total logged time for the day to over 8 hours (${totalH}h ${totalM}m). Are you sure you want to log this much time?`);
        if (!confirmHigh) return false;
    }

    const groupId = document.getElementById('modal-group-id').value;
    const groupType = document.getElementById('modal-group-type-ref').value;
    
    const entry = { ticket: tkt, hh, mm, type, desc };
    
    if (groupId) {
        entry.groupId = groupId;
        entry.groupType = groupType;
    }

    if (entryIdx === -1) {
        state.days[dayIdx].entries.push(entry);
    } else {
        state.days[dayIdx].entries[entryIdx] = entry;
    }
    
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
    return true;
}

function saveEntry() {
    if (saveEntryInternal()) {
        entryModal.hide();
    }
}

function deleteEntry() {
    const dayIdx = parseInt(document.getElementById('modal-day-index').value);
    const entryIdx = parseInt(document.getElementById('modal-entry-index').value);
    if (entryIdx < 0) return;
    state.days[dayIdx].entries.splice(entryIdx, 1);
    entryModal.hide();
    rerenderDayCard(dayIdx);
    updateSummary();
    saveState();
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

    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    });
    
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
    if (theme === 'light') {
        icon.classList.remove('bi-moon-fill');
        icon.classList.add('bi-sun-fill');
    } else {
        icon.classList.remove('bi-sun-fill');
        icon.classList.add('bi-moon-fill');
    }
}

/* ── SIDEBAR & ABOUT ───────────────────────────────────── */
function initSidebar() {
    const aboutBtn = document.getElementById('menu-about');
    const sidebarEl = document.getElementById('appSidebar');
    const aboutModalEl = document.getElementById('aboutModal');

    if (aboutBtn && sidebarEl && aboutModalEl) {
        const aboutModal = new bootstrap.Modal(aboutModalEl);
        
        aboutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Close sidebar
            const offcanvasInstance = bootstrap.Offcanvas.getInstance(sidebarEl);
            if (offcanvasInstance) {
                offcanvasInstance.hide();
            } else {
                // fallback if instance not found (though it should be)
                const oc = new bootstrap.Offcanvas(sidebarEl);
                oc.hide();
            }
            
            // Show About Modal
            aboutModal.show();
        });
    }
}
