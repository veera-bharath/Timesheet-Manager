/* =============================================================
   ONBOARDING — first-run setup modal
   ============================================================= */

import { state } from './state.js';
import { saveState } from './store.js';
import { updateSheetDetailsDisplay } from './settings.js';

let _modalInst = null;

export function needsOnboarding() {
    return !state.employeeName || state.employeeName.trim() === '';
}

export function initOnboarding() {
    const nameInput  = document.getElementById('onb-name');
    const submitBtn  = document.getElementById('btn-onb-submit');
    const hhInput    = document.getElementById('onb-target-hh');
    const mmInput    = document.getElementById('onb-target-mm');

    nameInput.addEventListener('input', () => {
        submitBtn.disabled = nameInput.value.trim() === '';
    });

    hhInput.addEventListener('input', function () {
        if (this.value.length >= 2) mmInput.focus();
    });

    submitBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        const title = document.getElementById('onb-report-title').value.trim();
        const hh    = parseInt(hhInput.value) || 8;
        const mm    = parseInt(mmInput.value) || 0;
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
        document.getElementById('onb-target-hh').value = Math.floor(tgt / 60);
        document.getElementById('onb-target-mm').value = tgt % 60;
        document.getElementById('onb-name').value = '';
        document.getElementById('btn-onb-submit').disabled = true;

        _modalInst = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });

        _modalInst.show();
    });
}
