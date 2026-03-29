import { state, WEEK_DAYS, ROMAN } from './state.js';
import { saveState } from './store.js';
import { escHtml, fmtDisplayDate, minsToHHMM } from './utils.js';
import { calcDayTotalMins, updateSummary } from './summary.js';
// Circular imports — resolved at call time (runtime only, not load time)
import { openEntryModal } from './entry-modal.js';
import { showEntryContextMenu } from './context-menu.js';
import { toggleEntryStarred } from './star.js';
import { openDayQuickView } from './report.js';
import { showEntryQuickView } from './context-menu.js';
import { getTypeById } from './ticket-types.js';
import { getLeaveLabel, resolveLeaveTypeId, populateLeaveSelect } from './leave-types.js';

let weekTransitionDir = null;

export function setWeekTransitionDir(v) { weekTransitionDir = v; }

export function renderAll() {
    renderDays();
    updateSummary();
}

export function renderDays() {
    const container = document.getElementById('days-container');
    container.innerHTML = '';
    state.days.forEach((day, i) => {
        container.appendChild(buildDayCard(day, i));
    });
    if (weekTransitionDir) {
        container.classList.remove('week-slide-left', 'week-slide-right');
        void container.offsetWidth;
        container.classList.add(`week-slide-${weekTransitionDir}`);
        container.addEventListener('animationend', () => {
            container.classList.remove('week-slide-left', 'week-slide-right');
        }, { once: true });
    }
}

export function buildProgressRing(dayNumber, totalMins, isHoliday) {
    const targetMins = state.dailyTargetMins || 480;
    const r = 16;
    const circ = +(2 * Math.PI * r).toFixed(2);
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
        <circle cx="19" cy="19" r="${r}" fill="none" class="progress-ring-circle" style="stroke:${strokeColor}; --circ:${circ}; --offset:${offset};"
          stroke-width="3" stroke-linecap="round" transform="rotate(-90 19 19)"/>
        <text x="19" y="19" text-anchor="middle" dominant-baseline="central"
          style="font-size:11px;font-weight:700;fill:${textColor};font-family:inherit">${dayNumber}</text>
      </svg>
    </div>`;
}

export function buildGroups(entries) {
    const groups = [];
    const visited = new Set();

    entries.forEach((e, i) => {
        if (visited.has(i)) return;

        if (!e.groupId) {
            groups.push({ type: 'normal', items: [e], indices: [i] });
            visited.add(i);
        } else {
            const grpEntries = [];
            const grpIndices = [];
            entries.forEach((e2, j) => {
                if (e2.groupId === e.groupId) {
                    grpEntries.push(e2);
                    grpIndices.push(j);
                    visited.add(j);
                }
            });
            groups.push({ type: e.groupType || 'normal', items: grpEntries, indices: grpIndices });
        }
    });

    return groups;
}

export function buildEntriesHTML(entries, dayIdx) {
    if (!entries || entries.length === 0) {
        if (state.days[dayIdx] && state.days[dayIdx].isHoliday) return '';
        return `<div class="no-entries-msg">No entries yet. Click "Add Entry" to begin.</div>`;
    }

    const groups = buildGroups(entries);
    let htmlFragments = [];
    let rowIndex = 0;

    groups.forEach((group, gi) => {
        const roman = ROMAN[gi] + '.';
        const isMulti = group.items.length > 1;

        const groupTotalMins = group.items.reduce((sum, e) => sum + (e.hh || 0) * 60 + (e.mm || 0), 0);
        const groupTotalStr = minsToHHMM(groupTotalMins);

        const rowsHtml = group.items.map((e, itemIdx) => {
            const actualOriginalIndex = group.indices[itemIdx];
            const isFirst = itemIdx === 0;
            const isLast = itemIdx === group.items.length - 1;

            const rStr = isFirst ? roman : '';

            let tktStr = (e.ticket || '');
            const typeObj = getTypeById(e.type);
            const ticketColor = typeObj ? typeObj.color : '#c8c8c8';
            let ticketHtml;
            if (e.noTicket) {
                ticketHtml = `<span class="entry-ticket entry-no-ticket-label">NO TICKET</span>`;
            } else {
                ticketHtml = `<span class="entry-ticket" style="color:${ticketColor}">${escHtml(tktStr || '—')}</span>`;
                if (group.type === 'ticket_group' && !isFirst) {
                    ticketHtml = `<span class="entry-ticket text-muted entry-grouped-hint">${escHtml(tktStr || '—')}</span>`;
                }
            }

            const hhmm = `${String(e.hh || 0).padStart(2, '0')}:${String(e.mm || 0).padStart(2, '0')}`;
            const showBadge = typeObj?.hasPrefix === true;
            const badgeLabel = showBadge ? typeObj.label : '';

            let showDesc = true;
            if (group.type === 'desc_group' && !isLast) {
                showDesc = false;
            }

            let descHtml = `<span class="entry-desc">${escHtml(e.desc || '')}</span>`;
            if (!showDesc) {
                descHtml = `<span class="entry-desc text-muted entry-grouped-hint">↳ Grouped below</span>`;
            }

            const starClass = e.starred ? 'starred' : '';
            const starIcon  = e.starred ? 'bi-star-fill' : 'bi-star';

            const rowI = rowIndex++;
            return `
    <div class="entry-row${e.isScheduled ? ' entry-scheduled' : ''}${e.noTicket ? ' entry-no-ticket' : ''}" style="--i:${rowI}" data-day="${dayIdx}" data-entry="${actualOriginalIndex}" data-group-idx="${gi}" data-item-idx="${itemIdx}" data-group-type="${group.type}">
      <span class="drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
      <span class="entry-num entry-num-roman">${rStr}</span>
      ${ticketHtml}
      <span class="entry-hours">${hhmm}</span>
      ${showBadge ? `<span class="entry-type-badge">${escHtml(badgeLabel)}</span>` : ''}
      ${e.recurringId ? '<span class="entry-recurring-badge" title="Recurring task"><i class="bi bi-arrow-repeat"></i></span>' : ''}
      ${e.isScheduled ? '<span class="entry-scheduled-badge" title="Scheduled task"><i class="bi bi-clock"></i></span>' : ''}
      ${descHtml}
      <div class="ms-auto d-flex align-items-center gap-1">
        <button class="entry-btn-star ${starClass}" title="${e.starred ? 'Unstar' : 'Star'}"><i class="bi ${starIcon}"></i></button>
      </div>
    </div>`;
        }).join('');

        htmlFragments.push(`<div class="entry-group${isMulti ? ' entry-group-multi' : ''}" data-group-idx="${gi}">
  ${rowsHtml}
  <div class="entry-group-total" title="${isMulti ? 'Group total' : 'Time'}">${groupTotalStr}</div>
</div>`);
    });

    return htmlFragments.join('');
}

export function buildDayCard(day, dayIdx) {
    const dayName = WEEK_DAYS[dayIdx];
    const displayDate = fmtDisplayDate(day.date);
    const totalMins = calcDayTotalMins(day);
    const totalHrsStr = minsToHHMM(totalMins);

    const wrap = document.createElement('div');
    wrap.className = 'day-card';
    wrap.id = `day-card-${dayIdx}`;

    let topRightBadge = '';
    if (day.isHoliday) {
        topRightBadge = `<span class="day-holiday-badge"><i class="bi bi-umbrella me-1"></i>${escHtml(getLeaveLabel(day))}</span>`;
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
          <div class="day-name">${dayName}</div>
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
        </select>
      </div>
      <div class="entries-list${day.entries && day.entries.length > 0 ? ' has-entries' : ''}" id="entries-${dayIdx}" ${day.isHoliday ? 'style="opacity:0.4;pointer-events:none"' : ''}>
        ${day.isHoliday ? '' : `<button class="add-entry-btn" data-day="${dayIdx}">
          <i class="bi bi-plus-circle"></i> Add Entry
        </button>`}
        ${buildEntriesHTML(day.entries, dayIdx)}
      </div>
    </div>
  `;

    wrap.querySelector('.day-card-header').addEventListener('click', (e) => {
        if (e.target.closest('.day-quick-view-btn')) {
            e.stopPropagation();
            openDayQuickView(dayIdx);
        } else {
            toggleDay(dayIdx);
        }
    });

    const cb = wrap.querySelector(`#holiday-${dayIdx}`);
    const lbl = wrap.querySelector(`#holiday-label-${dayIdx}`);

    // Populate leave type select dynamically
    populateLeaveSelect(lbl, resolveLeaveTypeId(day));

    cb.addEventListener('change', () => {
        state.days[dayIdx].isHoliday = cb.checked;
        lbl.style.display = cb.checked ? 'block' : 'none';
        if (!cb.checked) {
            state.days[dayIdx].leaveTypeId = '';
        } else {
            state.days[dayIdx].leaveTypeId = resolveLeaveTypeId(state.days[dayIdx]);
        }
        rerenderDayCard(dayIdx);
        updateSummary();
        saveState();
    });
    lbl.addEventListener('change', () => {
        state.days[dayIdx].leaveTypeId = lbl.value;
        // Keep holidayLabel in sync for backward compat fallback
        const leaveType = state.leaveTypes?.find(t => t.id === lbl.value);
        if (leaveType) state.days[dayIdx].holidayLabel = leaveType.label;
        rerenderDayCard(dayIdx);
        updateSummary();
        saveState();
    });

    const addBtn = wrap.querySelector('.add-entry-btn');
    if (addBtn) addBtn.addEventListener('click', () => openEntryModal(dayIdx, -1));

    wrap.querySelectorAll('.entry-row').forEach(row => {
        row.addEventListener('dblclick', e => {
            if (e.target.closest('.drag-handle') || e.target.closest('.entry-btn-eye') || e.target.closest('.entry-btn-star')) return;
            openEntryModal(parseInt(row.dataset.day), parseInt(row.dataset.entry));
        });

        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            showEntryContextMenu(row, e.clientX, e.clientY);
        });

        row.querySelector('.entry-btn-star').addEventListener('click', e => {
            e.stopPropagation();
            toggleEntryStarred(parseInt(row.dataset.day), parseInt(row.dataset.entry), e.currentTarget);
        });
    });

    attachDragListeners(dayIdx, wrap);

    return wrap;
}

export function rerenderDayCard(dayIdx) {
    const existing = document.getElementById(`day-card-${dayIdx}`);
    const oldChipText = existing?.querySelector('.day-hours-total')?.textContent;
    const newCard = buildDayCard(state.days[dayIdx], dayIdx);
    existing.replaceWith(newCard);
    const newChip = newCard.querySelector('.day-hours-total');
    if (newChip && newChip.textContent !== oldChipText) {
        newChip.classList.add('chip-bounce');
        newChip.addEventListener('animationend', () => newChip.classList.remove('chip-bounce'), { once: true });
    }
}

export function toggleDay(dayIdx) {
    if (!state.days[dayIdx].expanded) {
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
        const body = document.getElementById(`day-body-${dayIdx}`);
        if (body) {
            body.classList.add('collapsing');
            setTimeout(() => {
                state.days[dayIdx].expanded = false;
                rerenderDayCard(dayIdx);
            }, 200);
        } else {
            state.days[dayIdx].expanded = false;
            rerenderDayCard(dayIdx);
        }
        saveState();
    }
}

export function attachDragListeners(dayIdx, container) {
    const entriesList = (container || document).querySelector(`#entries-${dayIdx}`);
    if (!entriesList) return;

    const rows = entriesList.querySelectorAll('.entry-row');

    let draggingRow     = null;
    let ghost           = null;
    let dragSrcGroupIdx = null;
    let dragSrcItemIdx  = null;
    let offsetX = 0, offsetY = 0;

    rows.forEach(r => r.removeAttribute('draggable'));

    function getRowAt(clientX, clientY) {
        let found = null;
        let minDist = Infinity;
        entriesList.querySelectorAll('.entry-row').forEach(r => {
            if (r === draggingRow) return;
            const rect = r.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                found = r;
                return;
            }
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

        entriesList.querySelectorAll('.entry-row').forEach(r => r.classList.remove('drag-over', 'drag-over-invalid'));

        const target = getRowAt(e.clientX, e.clientY);
        if (!target) return;

        const toGroupIdx = parseInt(target.dataset.groupIdx);
        const toItemIdx  = parseInt(target.dataset.itemIdx);

        let isValid = true;
        if (dragSrcItemIdx > 0 && toGroupIdx !== dragSrcGroupIdx) isValid = false;

        if (isValid) {
            if (dragSrcItemIdx === 0) {
                entriesList.querySelectorAll(`.entry-row[data-group-idx="${toGroupIdx}"]`).forEach(r => r.classList.add('drag-over'));
            } else {
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

        if (target === null || srcGrpIdx === null) return;
        if (srcGrpIdx === toGrpIdx && srcItmIdx === toItmIdx) return;

        if (srcItmIdx > 0 && toGrpIdx !== srcGrpIdx) return;

        const groups = buildGroups(state.days[dayIdx].entries);

        if (srcGrpIdx === toGrpIdx) {
            const grp = groups[srcGrpIdx];
            const [movedItem] = grp.items.splice(srcItmIdx, 1);
            const [movedIdx]  = grp.indices.splice(srcItmIdx, 1);
            grp.items.splice(toItmIdx, 0, movedItem);
            grp.indices.splice(toItmIdx, 0, movedIdx);
        } else {
            if (srcItmIdx > 0) return;
            const [movedGroup] = groups.splice(srcGrpIdx, 1);
            groups.splice(toGrpIdx, 0, movedGroup);
        }

        const newEntries = [];
        groups.forEach(grp => grp.items.forEach(item => newEntries.push(item)));
        state.days[dayIdx].entries = newEntries;

        saveState();
        rerenderDayCard(dayIdx);
    }

    rows.forEach(row => {
        const handle = row.querySelector('.drag-handle');
        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();

            draggingRow     = row;
            dragSrcGroupIdx = parseInt(row.dataset.groupIdx);
            dragSrcItemIdx  = parseInt(row.dataset.itemIdx);

            const rect = row.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            ghost = row.cloneNode(true);
            ghost.classList.remove('dragging');
            ghost.style.cssText = [
                'position:fixed',
                'pointer-events:none',
                'z-index:99999',
                'width:' + rect.width + 'px',
                'left:' + (e.clientX - offsetX) + 'px',
                'top:' + (e.clientY - offsetY) + 'px',
                'opacity:0.92',
                'background:var(--bg-card)',
                'border:1.5px solid var(--border-accent)',
                'border-radius:8px',
                'box-shadow:0 16px 40px rgba(0,0,0,0.7)',
                'transition:none',
                'cursor:grabbing',
                'transform:rotate(3deg) scale(1.03)'
            ].join(';');
            document.body.appendChild(ghost);

            row.classList.add('dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup',   onMouseUp);
        });
    });
}
