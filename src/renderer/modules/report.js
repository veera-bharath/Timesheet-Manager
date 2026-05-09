import { state, WEEK_DAYS, ROMAN, SEPARATOR } from './state.js';
import { showToast } from './toast.js';
import { escHtml, fmtDate, fmtDisplayDate, padTicket } from './utils.js';
import { getDateFromWeek } from './week.js';
import { calcDayTotalMins } from './summary.js';
import { minsToHHMM } from './utils.js';
import { getTypeById } from './ticket-types.js';
import { getLeaveLabel } from './leave-types.js';
// Circular — resolved at call time
import { buildGroups, renderAll } from './render.js';
import { isFeatureEnabled, ask, refreshSettings } from './ai.js';
import { saveState } from './store.js';

let previewModal;
let dayEntriesModal;
let _enhancedTxt = null;
let _enhancing = false;
let _descMap = null;        // current enhancement map (original → enhanced)
let _undoSnapshot = null;   // [{dayIdx, entryIdx, originalDesc}] for undo

export function initReport() {
    previewModal = new bootstrap.Modal(document.getElementById('previewModal'));
    dayEntriesModal = new bootstrap.Modal(document.getElementById('dayEntriesModal'));
    document.getElementById('btn-copy-day-entries').addEventListener('click', copyDayQuickView);
    document.getElementById('toggle-enhance-ai').addEventListener('change', onEnhanceToggle);
    document.getElementById('btn-apply-enhanced').addEventListener('click', applyEnhancedDescs);

    // Strip HTML from clipboard when manually copying from preview panes.
    // Chromium includes text/html with full styling by default; Teams and
    // other rich-text apps prefer HTML, so they paste with dark backgrounds.
    const forcePlainTextCopy = (e) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        e.clipboardData.setData('text/plain', selection.toString());
        e.preventDefault();
    };
    document.getElementById('txt-preview').addEventListener('copy', forcePlainTextCopy);
    document.getElementById('day-entries-content').addEventListener('copy', forcePlainTextCopy);
}

const DAY_ROMAN_WIDTH = 6; // wide enough for 'viii)' + 1 space

export function generateDayTxt(day, useHHMM = false, descMap = null) {
    const displayDate = fmtDisplayDate(day.date);
    const lines = [];
    const indent = '\t';

    if (day.isHoliday) {
        lines.push(`${displayDate} :   `);
        lines.push(`${indent}${'i)'.padEnd(DAY_ROMAN_WIDTH)}${getLeaveLabel(day)}`);
    } else {
        const totalMins = calcDayTotalMins(day);
        const hrsStr = minsToHHMM(totalMins);
        lines.push(`${displayDate} : ${hrsStr} hrs`);

        if (day.entries && day.entries.length > 0) {
            const groups = buildGroups(day.entries);

            groups.forEach((group, gi) => {
                const roman = (ROMAN[gi] + ')').padEnd(DAY_ROMAN_WIDTH);
                const romanBlank = ' '.repeat(DAY_ROMAN_WIDTH);

                group.items.forEach((e, itemIdx) => {
                    const isFirst = itemIdx === 0;
                    const isLast = itemIdx === group.items.length - 1;
                    const rStr = isFirst ? roman : romanBlank;

                    let tktStr = (e.ticket || '');
                    if (group.type === 'ticket_group' && !isFirst) tktStr = '';
                    const ticket = padTicket(tktStr);

                    const h = parseInt(e.hh) || 0;
                    const m = parseInt(e.mm) || 0;
                    const timeFmt = useHHMM
                        ? `(${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')})`
                        : h === 0 ? `(${m}m)` : m === 0 ? `(${h}h)` : `(${h}h ${m}m)`;
                    const timeStr = timeFmt.padEnd(10);

                    const eTypeObj = getTypeById(e.type);
                    const sdTag = eTypeObj?.prefixText || '';

                    const rawDesc = e.desc || '';
                    let desc = rawDesc;
                    if (descMap && rawDesc) {
                        const key = rawDesc.trim();
                        if (descMap.has(key)) desc = descMap.get(key);
                    }
                    // Legacy: strip manually typed "(Service desk)" prefix from older entries
                    if (e.type === 'servicedesk' && desc.toLowerCase().startsWith('(service desk)')) {
                        desc = desc.substring(15).trim();
                        if (desc.startsWith('-')) desc = desc.substring(1).trim();
                    }

                    const showDesc = !(group.type === 'desc_group' && !isLast);
                    const loggedMark = !useHHMM
                        ? e.loggedUpdated ? '  (updated)' : e.logged ? '  (✓ logged)' : ''
                        : '';

                    if (!showDesc) {
                        lines.push(`${indent}${rStr}${ticket} ${timeStr}${loggedMark}`);
                    } else {
                        const descLines = desc ? desc.split(/\r?\n/) : [];
                        if (descLines.length === 0) {
                            lines.push(`${indent}${rStr}${ticket} ${timeStr}${loggedMark}`);
                        } else {
                            lines.push(`${indent}${rStr}${ticket} ${timeStr}- ${sdTag}${descLines[0]}${loggedMark}`);
                            if (descLines.length > 1) {
                                const indentStr = indent + romanBlank + ' '.repeat(`${ticket} ${timeStr}- ${sdTag}`.length);
                                for (let j = 1; j < descLines.length; j++) {
                                    lines.push(`${indentStr}${descLines[j]}`);
                                }
                            }
                        }
                    }
                });
            });
        }
    }



    return lines.join('\r\n');
}

export function generateTxt() {
    const lines = [];
    lines.push(state.reportTitle || 'Booked hours in Jira and Service Desk');
    lines.push(SEPARATOR);

    state.days.forEach((day) => {
        lines.push(generateDayTxt(day, true));
        lines.push('');
    });

    return lines.join('\r\n');
}

export async function openPreview() {
    _enhancedTxt = null;
    _descMap = null;

    const toggle   = document.getElementById('toggle-enhance-ai');
    const aiBar    = document.getElementById('report-ai-bar');
    const applyBtn = document.getElementById('btn-apply-enhanced');
    toggle.checked = false;
    applyBtn.style.display = 'none';

    await refreshSettings();
    aiBar.style.display = isFeatureEnabled('reportEnhancement') ? '' : 'none';

    document.getElementById('txt-preview').textContent = generateTxt();
    previewModal.show();
}

export function openDayQuickView(dayIdx) {
    const day = state.days[dayIdx];
    if (!day || (!day.isHoliday && (!day.entries || day.entries.length === 0))) return;

    const displayDate = fmtDisplayDate(day.date);
    document.getElementById('dayEntriesModalLabel').innerHTML = `<i class="bi bi-card-text me-2"></i>Day Preview — ${WEEK_DAYS[dayIdx]}, ${displayDate}`;
    document.getElementById('day-entries-content').textContent = generateDayTxt(day);
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

export function copyTxt() {
    const txt = _enhancedTxt ?? generateTxt();
    navigator.clipboard.writeText(txt).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy.', 'danger');
    });
}

export function downloadTxt() {
    const txt = _enhancedTxt ?? generateTxt();
    const name = state.employeeName.replace(/\s+/g, '_') || 'Employee';
    const monDt = getDateFromWeek(state.weekValue);

    const sunDt = new Date(monDt);
    sunDt.setDate(monDt.getDate() + 6);

    const fmtNumeric = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
    };

    const s = fmtNumeric(monDt);
    const e = fmtNumeric(sunDt);
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

export function doPrint() {
    const txt = generateTxt();
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `<pre>${escHtml(txt)}</pre>`;
    window.print();
}

/* ── AI ENHANCEMENT ─────────────────────────────────────── */

async function onEnhanceToggle(e) {
    if (e.target.checked) {
        await runEnhance();
    } else {
        _enhancedTxt = null;
        _descMap = null;
        document.getElementById('btn-apply-enhanced').style.display = 'none';
        document.getElementById('txt-preview').textContent = generateTxt();
    }
}

async function runEnhance() {
    if (_enhancing) return;
    _enhancing = true;

    const toggle  = document.getElementById('toggle-enhance-ai');
    const loading = document.getElementById('report-ai-loading');
    toggle.disabled = true;
    loading.classList.remove('d-none');
    loading.classList.add('d-flex');

    try {
        const descMap = await buildDescMap();
        if (!descMap) {
            showToast('AI enhancement failed. Check your AI settings.', 'danger');
            toggle.checked = false;
            _enhancedTxt = null;
            _descMap = null;
        } else {
            _descMap = descMap;
            _enhancedTxt = generateEnhancedTxt(descMap);
            document.getElementById('txt-preview').textContent = _enhancedTxt;
            document.getElementById('btn-apply-enhanced').style.display = '';
        }
    } finally {
        _enhancing = false;
        toggle.disabled = false;
        loading.classList.add('d-none');
        loading.classList.remove('d-flex');
    }
}

async function buildDescMap() {
    const descs = [];
    const seen  = new Set();

    for (const day of state.days) {
        if (!day.entries) continue;
        for (const e of day.entries) {
            const desc = (e.desc || '').trim();
            if (desc && !seen.has(desc)) {
                seen.add(desc);
                descs.push(desc);
            }
        }
    }

    if (descs.length === 0) return new Map();

    const numbered = descs.map((d, i) => `${i + 1}. ${d}`).join('\n');
    const prompt = [
        'You are a professional work log editor. Rewrite each numbered timesheet description into professional, concise language (under 10 words). Preserve the meaning — do not invent details. Output ONLY the numbered rewrites in the exact same format (e.g. "1. Resolved the issue"). No preamble, no extra text.',
        '',
        numbered,
    ].join('\n');

    const result = await ask(prompt, null);
    if (!result) return null;

    // Parse by number so preamble lines are safely ignored
    const rewrittenByNum = {};
    result.trim().split(/\r?\n/).forEach(l => {
        const m = l.trim().match(/^(\d+)\.\s+(.+)/);
        if (m) rewrittenByNum[parseInt(m[1])] = m[2].trim();
    });

    const map = new Map();
    descs.forEach((d, i) => {
        const enhanced = rewrittenByNum[i + 1];
        if (enhanced) map.set(d, enhanced);
    });
    return map;
}

function generateEnhancedTxt(descMap) {
    const lines = [];
    lines.push(state.reportTitle || 'Booked hours in Jira and Service Desk');
    lines.push(SEPARATOR);
    state.days.forEach((day) => {
        lines.push(generateDayTxt(day, true, descMap));
        lines.push('');
    });
    return lines.join('\r\n');
}

function applyEnhancedDescs() {
    if (!_descMap || _descMap.size === 0) return;

    _undoSnapshot = [];
    state.days.forEach((day, dayIdx) => {
        if (!day.entries) return;
        day.entries.forEach((e, entryIdx) => {
            const key = (e.desc || '').trim();
            if (key && _descMap.has(key)) {
                _undoSnapshot.push({ dayIdx, entryIdx, originalDesc: e.desc });
                e.desc = _descMap.get(key);
            }
        });
    });

    saveState();
    previewModal.hide();
    renderAll();
    _showApplyUndoToast(_undoSnapshot.length);
}

function undoEnhancedDescs() {
    if (!_undoSnapshot) return;
    const snapshot = _undoSnapshot;
    _undoSnapshot = null;

    snapshot.forEach(({ dayIdx, entryIdx, originalDesc }) => {
        const entry = state.days[dayIdx]?.entries?.[entryIdx];
        if (entry) entry.desc = originalDesc;
    });

    saveState();
    renderAll();
    showToast('Descriptions restored.', 'success');
}

function _showApplyUndoToast(count) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const existing = document.getElementById('apply-enhanced-toast');
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', `
    <div id="apply-enhanced-toast" class="toast toast-custom show align-items-center" role="alert" style="min-width:280px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi bi-stars" style="color:#4ade80"></i>
        <span style="font-size:0.85rem">${count} ${count === 1 ? 'description' : 'descriptions'} updated.</span>
        <button type="button" class="btn btn-sm btn-outline-light ms-auto py-0 px-2" style="font-size:0.75rem" id="btn-undo-enhanced">Undo</button>
      </div>
    </div>`);

    const timerId = setTimeout(() => { document.getElementById('apply-enhanced-toast')?.remove(); }, 5000);

    document.getElementById('btn-undo-enhanced').addEventListener('click', () => {
        clearTimeout(timerId);
        document.getElementById('apply-enhanced-toast')?.remove();
        undoEnhancedDescs();
    });
}
