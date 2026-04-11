/* =============================================================
   ONBOARDING — first-run setup modal
   ============================================================= */

import { state, MAX_TARGET_MINS } from './state.js';
import { saveState } from './store.js';
import { updateSheetDetailsDisplay } from './settings.js';
import { parseTimeInput, fmtTimeInput, timeInputError } from './utils.js';

let _modalInst = null;

export function needsOnboarding() {
    return !state.employeeName || state.employeeName.trim() === '';
}

export function initOnboarding() {
    const nameInput  = document.getElementById('onb-name');
    const submitBtn  = document.getElementById('btn-onb-submit');
    const timeInput  = document.getElementById('onb-target-time');

    nameInput.addEventListener('input', () => {
        submitBtn.disabled = nameInput.value.trim() === '';
    });

    timeInput.addEventListener('blur', function () {
        const err = this.value.trim() ? timeInputError(this.value, MAX_TARGET_MINS) : null;
        this.classList.toggle('is-invalid', !!err);
        document.getElementById('onb-target-time-error').textContent = err || '';
    });

    submitBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        const title = document.getElementById('onb-report-title').value.trim();
        const timeParsed = parseTimeInput(timeInput.value);
        const hh    = timeParsed ? timeParsed.hh : 8;
        const mm    = timeParsed ? timeParsed.mm : 0;
        const mins  = hh * 60 + mm;

        state.employeeName    = name;
        state.reportTitle     = title || 'Booked hours in Jira and Service Desk';
        state.dailyTargetMins = mins > 0 ? mins : 480;

        await saveState();
        updateSheetDetailsDisplay();

        _modalInst.hide();
    });
}

export function showOnboarding() {
    return new Promise(resolve => {
        const modalEl = document.getElementById('onboardingModal');

        // Pre-fill defaults
        document.getElementById('onb-report-title').value = state.reportTitle || 'Booked hours in Jira and Service Desk';
        const tgt = state.dailyTargetMins || 480;
        document.getElementById('onb-target-time').value = fmtTimeInput(Math.floor(tgt / 60), tgt % 60);
        document.getElementById('onb-name').value = '';
        document.getElementById('btn-onb-submit').disabled = true;

        _modalInst = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });

        _modalInst.show();
    });
}
