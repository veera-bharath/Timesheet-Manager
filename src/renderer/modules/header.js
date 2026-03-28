import { state } from './state.js';
import { saveState } from './store.js';
import { getWeekStrFromDate, getDateFromWeek, buildWeekDays, enforceExpandedState, updateWeekDisplay, changeWeekBy, setCurrentWeek } from './week.js';
import { updateSummary } from './summary.js';
import { renderAll, renderDays, setWeekTransitionDir } from './render.js';
import { openPreview, doPrint, copyTxt, downloadTxt } from './report.js';
import { saveEntry, deleteEntry, makeRegularEntry, updateEntryDayTotal } from './entry-modal.js';

export function bindHeaderEvents() {
    const weekPicker = document.getElementById('week-picker');
    weekPicker.max = getWeekStrFromDate(new Date());

    document.getElementById('btn-prev-week').addEventListener('click', function() {
        changeWeekBy(-1);
        this.blur();
    });
    document.getElementById('btn-next-week').addEventListener('click', function() {
        changeWeekBy(1);
        this.blur();
    });

    document.getElementById('report-title').addEventListener('input', e => {
        state.reportTitle = e.target.value;
        saveState();
    });

    document.getElementById('emp-name').addEventListener('input', e => {
        state.employeeName = e.target.value.trim();
        updateSummary();
        saveState();
    });

    weekPicker.addEventListener('change', e => {
        const val = e.target.value;
        if (!val) return;

        const prevWeek = state.weekValue;
        const maxWeek = getWeekStrFromDate(new Date());
        const safeVal = val > maxWeek ? maxWeek : val;

        if (safeVal !== val) {
            e.target.value = safeVal;
        }

        document.getElementById('btn-next-week').disabled = (safeVal >= maxWeek);

        if (safeVal === prevWeek) return;

        state.weekValue = safeVal;
        state.days = buildWeekDays(getDateFromWeek(safeVal));
        enforceExpandedState();
        updateWeekDisplay();
        saveState();
        setWeekTransitionDir(prevWeek ? (safeVal > prevWeek ? 'left' : 'right') : null);
        renderAll();
        setWeekTransitionDir(null);
    });

    document.getElementById('btn-autofill-week').addEventListener('click', () => {
        const prevWeek = state.weekValue;
        setCurrentWeek();
        document.getElementById('btn-next-week').disabled = true;
        saveState();
        setWeekTransitionDir(prevWeek ? (state.weekValue > prevWeek ? 'left' : state.weekValue < prevWeek ? 'right' : null) : null);
        renderAll();
        setWeekTransitionDir(null);
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

    ['modal-hh', 'modal-mm'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateEntryDayTotal);
    });
}
