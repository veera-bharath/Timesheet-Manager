/* =============================================================
   TIMESHEET MANAGER — main.js (entry point)
   ============================================================= */

import { APP_VERSION } from './modules/state.js';
import { loadState } from './modules/store.js';
import { initTheme } from './modules/theme.js';
import { initRipple } from './modules/ripple.js';
import { initSidebar, initUpdater, initKeyboard, initSummaryPanel } from './modules/sidebar.js';
import { initContextMenu } from './modules/context-menu.js';
import { initSearch } from './modules/search.js';
import { initScheduledTasks } from './modules/scheduled.js';
import { initRecurring } from './modules/recurring.js';
import { initEntryModal } from './modules/entry-modal.js';
import { initCopyTo } from './modules/copy-to.js';
import { initReport } from './modules/report.js';
import { bindHeaderEvents, openWeekSwitcherModal } from './modules/header.js';
import { updateSheetDetailsDisplay } from './modules/settings.js';
import { loadErrorLog } from './modules/error-log.js';
import { renderAll, initDaysContainer } from './modules/render.js';
import { state } from './modules/state.js';
import { getWeekStrFromDate, getDateFromWeek, buildWeekDays, enforceExpandedState, updateWeekDisplay } from './modules/week.js';
import { updateSummary } from './modules/summary.js';
import { initOnboarding, needsOnboarding, showOnboarding } from './modules/onboarding.js';
import { initNoTicketBanner, updateNoTicketBanner } from './modules/no-ticket-reminder.js';
import { initUnderloggedBanner, updateUnderloggedBanner } from './modules/underlogged-reminder.js';
import { initNotifications } from './modules/notifications.js';
import { setCurrentWeek } from './modules/week.js';
import { refreshSettings } from './modules/ai.js';
import { initAiChat } from './modules/ai-chat.js';
import { initWeekSummary } from './modules/week-summary.js';
import { runAnomalyDetection } from './modules/anomaly-detection.js';
import { runRecurringAdvisor } from './modules/recurring-advisor.js';
import { initTodoNotes } from './modules/todo.js';

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.app-version').forEach(el => el.textContent = APP_VERSION);
    initTheme();
    initRipple();
    initOnboarding();
    initNotifications();
    initNoTicketBanner();
    initUnderloggedBanner();
    initSidebar();
    initSummaryPanel();
    initAiChat();
    initWeekSummary();
    initUpdater();
    initContextMenu();
    initSearch();
    initScheduledTasks();
    initRecurring();
    initTodoNotes();
    initEntryModal();
    initCopyTo();
    initReport();
    bindHeaderEvents();
    initDaysContainer();

    const restored = await loadState();
    refreshSettings();   // cache AI feature flags; fire-and-forget
    await loadErrorLog();

    if (window.tray) {
        window.tray.onNavigateToToday(() => {
            const today = new Date();
            const weekVal = getWeekStrFromDate(today);
            if (state.weekValue !== weekVal) {
                state.weekValue = weekVal;
                document.getElementById('week-picker').value = weekVal;
                const maxWeek = getWeekStrFromDate(new Date());
                document.getElementById('btn-next-week').disabled = (state.weekValue >= maxWeek);
                setCurrentWeek(weekVal);
                updateSummary();
                runAnomalyDetection();
            }
        });
    }

    if (window.app?.onFocusTimer) {
        window.app.onFocusTimer(() => {
            const todayStr = new Date().toLocaleDateString('en-CA');
            const dayIdx = state.days.findIndex(d => d.date === todayStr);
            if (dayIdx !== -1) {
                import('./modules/entry-modal.js').then(module => {
                    module.openEntryModal(dayIdx, -1);
                });
            }
        });
    }

    if (needsOnboarding()) await showOnboarding();

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
    document.getElementById('panel-week-label')?.addEventListener('click', openWeekSwitcherModal);
    initKeyboard();
    updateNoTicketBanner();
    updateUnderloggedBanner();
    runAnomalyDetection();
    if (new Date().getDay() === 1) runRecurringAdvisor();

});
