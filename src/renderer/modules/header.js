import { state } from './state.js';
import { saveState } from './store.js';
import { getWeekStrFromDate, getDateFromWeek, buildWeekDays, enforceExpandedState, updateWeekDisplay, changeWeekBy, setCurrentWeek } from './week.js';
import { updateSummary } from './summary.js';
import { renderAll, renderDays, setWeekTransitionDir } from './render.js';
import { openPreview, doPrint, copyTxt, downloadTxt } from './report.js';
import { saveEntry, deleteEntry, makeRegularEntry, updateEntryDayTotal } from './entry-modal.js';
import { openSettings } from './settings.js';
import { runAnomalyDetection } from './anomaly-detection.js';

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

    document.getElementById('btn-edit-sheet-details').addEventListener('click', () => {
        openSettings('general');
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
        runAnomalyDetection();
    });

    document.getElementById('btn-autofill-week').addEventListener('click', () => {
        const prevWeek = state.weekValue;
        setCurrentWeek();
        document.getElementById('btn-next-week').disabled = true;
        saveState();
        setWeekTransitionDir(prevWeek ? (state.weekValue > prevWeek ? 'left' : state.weekValue < prevWeek ? 'right' : null) : null);
        renderAll();
        setWeekTransitionDir(null);
        runAnomalyDetection();
    });

    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-print').addEventListener('click', doPrint);
    document.getElementById('btn-copy-txt').addEventListener('click', copyTxt);
    document.getElementById('btn-download-txt').addEventListener('click', downloadTxt);
    document.getElementById('btn-save-entry').addEventListener('click', saveEntry);
    document.getElementById('btn-delete-entry').addEventListener('click', deleteEntry);
    document.getElementById('btn-make-regular').addEventListener('click', makeRegularEntry);

    document.getElementById('modal-time').addEventListener('input', updateEntryDayTotal);
}

export function openWeekSwitcherModal() {
    const modalEl = document.getElementById('weekSwitcherModal');
    if (!modalEl) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    const modalPicker = document.getElementById('modal-week-picker');
    const modalLabel = document.getElementById('modal-week-display-label');
    const maxWeek = getWeekStrFromDate(new Date());

    function fmt(d) {
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function syncLabel(weekStr) {
        const mon = getDateFromWeek(weekStr);
        const fri = new Date(mon);
        fri.setDate(mon.getDate() + 4);
        modalLabel.textContent = `${fmt(mon)} to ${fmt(fri)}`;
        document.getElementById('modal-btn-next-week').disabled = weekStr >= maxWeek;
    }

    modalPicker.max = maxWeek;
    modalPicker.value = state.weekValue || maxWeek;
    syncLabel(modalPicker.value);

    modalPicker.onchange = () => syncLabel(modalPicker.value);

    document.getElementById('modal-btn-prev-week').onclick = () => {
        const mon = getDateFromWeek(modalPicker.value);
        mon.setDate(mon.getDate() - 7);
        const w = getWeekStrFromDate(mon);
        modalPicker.value = w;
        syncLabel(w);
    };

    document.getElementById('modal-btn-next-week').onclick = () => {
        const mon = getDateFromWeek(modalPicker.value);
        mon.setDate(mon.getDate() + 7);
        const w = getWeekStrFromDate(mon);
        if (w > maxWeek) return;
        modalPicker.value = w;
        syncLabel(w);
    };

    document.getElementById('modal-btn-current-week').onclick = () => {
        modal.hide();
        const prevWeek = state.weekValue;
        setCurrentWeek();
        saveState();
        setWeekTransitionDir(prevWeek ? (state.weekValue > prevWeek ? 'left' : state.weekValue < prevWeek ? 'right' : null) : null);
        renderAll();
        setWeekTransitionDir(null);
        updateSummary();
    };

    document.getElementById('modal-btn-switch-week').onclick = () => {
        const selected = modalPicker.value;
        if (!selected) return;
        modal.hide();
        const picker = document.getElementById('week-picker');
        picker.value = selected;
        picker.dispatchEvent(new Event('change'));
    };

    modal.show();
}
