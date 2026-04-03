import { state, WEEK_DAYS, ROMAN, SEPARATOR } from './state.js';
import { showToast } from './toast.js';
import { escHtml, fmtDate, fmtDisplayDate, padTicket } from './utils.js';
import { getDateFromWeek } from './week.js';
import { calcDayTotalMins } from './summary.js';
import { minsToHHMM } from './utils.js';
import { getTypeById } from './ticket-types.js';
import { getLeaveLabel } from './leave-types.js';
// Circular — resolved at call time
import { buildGroups } from './render.js';

let previewModal;
let dayEntriesModal;

export function initReport() {
    previewModal = new bootstrap.Modal(document.getElementById('previewModal'));
    dayEntriesModal = new bootstrap.Modal(document.getElementById('dayEntriesModal'));
    document.getElementById('btn-copy-day-entries').addEventListener('click', copyDayQuickView);

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

export function generateDayTxt(day) {
    const displayDate = fmtDisplayDate(day.date);
    const lines = [];
    const indent = '  '; // 2-space initial indent, no tabs

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
                    const timeFmt = h === 0 ? `(${m}m)` : m === 0 ? `(${h}h)` : `(${h}h ${m}m)`;
                    const timeStr = timeFmt.padEnd(10);

                    const eTypeObj = getTypeById(e.type);
                    const sdTag = eTypeObj?.prefixText || '';

                    let desc = e.desc || '';
                    // Legacy: strip manually typed "(Service desk)" prefix from older entries
                    if (e.type === 'servicedesk' && desc.toLowerCase().startsWith('(service desk)')) {
                        desc = desc.substring(15).trim();
                        if (desc.startsWith('-')) desc = desc.substring(1).trim();
                    }

                    const showDesc = !(group.type === 'desc_group' && !isLast);
                    const loggedMark = e.logged ? '  (✓ logged)' : '';

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
        lines.push(generateDayTxt(day));
        lines.push('');
    });

    return lines.join('\r\n');
}

export function openPreview() {
    const txt = generateTxt();
    document.getElementById('txt-preview').textContent = txt;
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
    const txt = generateTxt();
    navigator.clipboard.writeText(txt).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy.', 'danger');
    });
}

export function downloadTxt() {
    const txt = generateTxt();
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
