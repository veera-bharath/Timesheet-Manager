/* =============================================================
   TIMESHEET MANAGER — main.js (entry point)
   ============================================================= */

import { APP_VERSION } from './modules/state.js';
import { loadState } from './modules/store.js';
import { initTheme } from './modules/theme.js';
import { initRipple } from './modules/ripple.js';
import { initSidebar, initUpdater, initKeyboard } from './modules/sidebar.js';
import { initContextMenu } from './modules/context-menu.js';
import { initSearch } from './modules/search.js';
import { initScheduledTasks } from './modules/scheduled.js';
import { initRecurring } from './modules/recurring.js';
import { initEntryModal } from './modules/entry-modal.js';
import { initCopyTo } from './modules/copy-to.js';
import { initReport } from './modules/report.js';
import { bindHeaderEvents } from './modules/header.js';
import { initSettings, updateSheetDetailsDisplay } from './modules/settings.js';
import { renderAll } from './modules/render.js';
import { state } from './modules/state.js';
import { getWeekStrFromDate, getDateFromWeek, buildWeekDays, enforceExpandedState, updateWeekDisplay } from './modules/week.js';
import { updateSummary } from './modules/summary.js';

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.app-version').forEach(el => el.textContent = APP_VERSION);
    initTheme();
    initRipple();
    initSettings();
    initSidebar();
    initUpdater();
    initContextMenu();
    initSearch();
    initScheduledTasks();
    initRecurring();
    initEntryModal();
    initCopyTo();
    initReport();
    bindHeaderEvents();

    const restored = await loadState();

    updateSheetDetailsDisplay();

    if (restored && state.weekValue) {
        document.getElementById('week-picker').value = state.weekValue;

        const maxWeek = getWeekStrFromDate(new Date());
        document.getElementById('btn-next-week').disabled = (state.weekValue >= maxWeek);

        state.days = buildWeekDays(getDateFromWeek(state.weekValue));
        enforceExpandedState();
        updateWeekDisplay();
        renderAll();
    } else {
        const today = new Date();
        const weekVal = getWeekStrFromDate(today);
        document.getElementById('week-picker').value = weekVal;
        document.getElementById('btn-next-week').disabled = true;
        state.weekValue = weekVal;
        state.days = buildWeekDays(getDateFromWeek(weekVal));
        enforceExpandedState();
        updateWeekDisplay();
        renderAll();
    }

    updateSummary();
    initKeyboard();
});
