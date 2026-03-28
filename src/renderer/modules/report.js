import { state, WEEK_DAYS, ROMAN, SEPARATOR } from './state.js';
import { showToast } from './toast.js';
import { escHtml, fmtDate, fmtDisplayDate, padTicket } from './utils.js';
import { getDateFromWeek } from './week.js';
import { calcDayTotalMins } from './summary.js';
import { minsToHHMM } from './utils.js';
// Circular — resolved at call time
import { buildGroups } from './render.js';

let previewModal;
let dayEntriesModal;

export function initReport() {
    previewModal = new bootstrap.Modal(document.getElementById('previewModal'));
    dayEntriesModal = new bootstrap.Modal(document.getElementById('dayEntriesModal'));
    document.getElementById('btn-copy-day-entries').addEventListener('click', copyDayQuickView);
}

export function generateTxt() {
    const monDt = getDateFromWeek(state.weekValue);

    let lines = [];
    lines.push(state.reportTitle || 'Booked hours in Jira and Service Desk');
    lines.push(SEPARATOR);

    state.days.forEach((day) => {
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

export function openPreview() {
    const txt = generateTxt();
    document.getElementById('txt-preview').textContent = txt;
    previewModal.show();
}

export function openDayQuickView(dayIdx) {
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
