import { state, SEARCH_PAGE_SIZE } from './state.js';
import { saveState } from './store.js';
import { escHtml, fmtDate, fmtSearchDate, fmtTypeLabel, fmtHHMM } from './utils.js';
import { getWeekStrFromDate, getDateFromWeek, buildWeekDays, updateWeekDisplay, enforceExpandedState } from './week.js';
// Circular — resolved at call time
import { renderAll } from './render.js';

let advSearchResults = [];
let advSearchPage = 0;
let advSelectedRange = 'all';

function searchCurrentWeek(query) {
    const q = query.toLowerCase();
    const results = [];
    state.days.forEach((day, dayIdx) => {
        if (!day || !day.entries) return;
        day.entries.forEach((entry, entryIdx) => {
            const matchTicket = entry.ticket && entry.ticket.toLowerCase().includes(q);
            const matchType   = fmtTypeLabel(entry.type).toLowerCase().includes(q);
            const matchDesc   = entry.desc && entry.desc.toLowerCase().includes(q);
            if (matchTicket || matchType || matchDesc) {
                results.push({ dateStr: day.date, dayIdx, entryIdx, entry });
            }
        });
    });
    return results;
}

export function navigateToResult(dateStr, entryIdx) {
    const weekStr = getWeekStrFromDate(new Date(dateStr + 'T00:00:00'));
    if (weekStr !== state.weekValue) {
        state.weekValue = weekStr;
        document.getElementById('week-picker').value = weekStr;
        state.days = buildWeekDays(getDateFromWeek(weekStr));
        enforceExpandedState();
        updateWeekDisplay();
        saveState();
    }
    const dayIdx = state.days.findIndex(d => d && d.date === dateStr);
    if (dayIdx === -1) return;
    state.days.forEach((d, i) => { if (d) d.expanded = (i === dayIdx); });
    state.lastOpenedDateByWeek[state.weekValue] = dateStr;
    renderAll();
    setTimeout(() => {
        const el = document.querySelector(`.entry-row[data-day="${dayIdx}"][data-entry="${entryIdx}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('entry-highlight-flash');
        el.addEventListener('animationend', () => el.classList.remove('entry-highlight-flash'), { once: true });
    }, 80);
}

function renderSearchDropdown(results, query, showAll) {
    const dropdown = document.getElementById('search-dropdown');
    if (!results.length) {
        dropdown.innerHTML = '<div class="search-no-results">No results found</div>';
        dropdown.style.display = 'block';
        return;
    }
    const visible = showAll ? results : results.slice(0, 5);
    const remaining = results.length - 5;
    let html = '';
    visible.forEach((r, i) => {
        const line1 = `${escHtml(fmtSearchDate(r.dateStr))} &middot; ${escHtml(r.entry.ticket || '—')} &middot; ${escHtml(fmtTypeLabel(r.entry.type))}`;
        const desc = r.entry.desc || '';
        html += `<div class="search-result-item" data-idx="${i}" tabindex="-1">
            <div class="search-result-line1">${line1}</div>
            <div class="search-result-line2">${escHtml(desc)}</div>
        </div>`;
    });
    if (!showAll && remaining > 0) {
        html += `<div class="search-show-more" id="search-show-more">Show ${remaining} more…</div>`;
    }
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-result-item').forEach((el, i) => {
        el.addEventListener('click', () => {
            const r = visible[i];
            closeSearchDropdown();
            document.getElementById('search-input').value = '';
            navigateToResult(r.dateStr, r.entryIdx);
        });
    });
    const showMoreEl = document.getElementById('search-show-more');
    if (showMoreEl) {
        showMoreEl.addEventListener('click', () => renderSearchDropdown(results, query, true));
    }
}

function closeSearchDropdown() {
    const dropdown = document.getElementById('search-dropdown');
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
}

export function initSearch() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');
    let activeIdx = -1;
    let lastResults = [];
    let showingAll = false;

    input.addEventListener('input', () => {
        const q = input.value.trim();
        activeIdx = -1;
        showingAll = false;
        if (q.length < 3) { closeSearchDropdown(); return; }
        lastResults = searchCurrentWeek(q);
        renderSearchDropdown(lastResults, q, false);
    });

    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].click();
        } else if (e.key === 'Escape') {
            closeSearchDropdown();
            input.blur();
        }
    });

    document.addEventListener('click', (e) => {
        if (!document.getElementById('search-wrap').contains(e.target)) {
            closeSearchDropdown();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
            e.preventDefault();
            input.focus();
            input.select();
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            openAdvancedSearch();
        }
    });

    document.getElementById('btn-adv-search').addEventListener('click', () => openAdvancedSearch());

    document.querySelectorAll('.adv-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.adv-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            advSelectedRange = btn.dataset.range;
            const customRow = document.getElementById('adv-custom-range');
            customRow.style.display = advSelectedRange === 'custom' ? 'flex' : 'none';
        });
    });

    document.getElementById('btn-run-adv-search').addEventListener('click', () => {
        advSearchPage = 0;
        advSearchResults = runAdvancedSearch();
        renderAdvancedResults();
    });
}

function openAdvancedSearch() {
    const basicVal = document.getElementById('search-input').value.trim();
    document.getElementById('adv-search-input').value = basicVal;
    document.getElementById('adv-search-results').innerHTML = '';
    document.getElementById('adv-search-pagination').innerHTML = '';
    advSearchResults = [];
    advSearchPage = 0;
    const modal = new bootstrap.Modal(document.getElementById('advSearchModal'));
    modal.show();
    setTimeout(() => document.getElementById('adv-search-input').focus(), 300);
}

function runAdvancedSearch() {
    const q = document.getElementById('adv-search-input').value.trim().toLowerCase();
    const fieldTicket = document.getElementById('adv-field-ticket').checked;
    const fieldType   = document.getElementById('adv-field-type').checked;
    const fieldDesc   = document.getElementById('adv-field-desc').checked;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = fmtDate(today);

    let fromStr = null, toStr = null;
    if (advSelectedRange === 'today') {
        fromStr = toStr = todayStr;
    } else if (advSelectedRange === 'lastweek') {
        const from = new Date(today); from.setDate(today.getDate() - 7);
        fromStr = fmtDate(from); toStr = todayStr;
    } else if (advSelectedRange === 'lastmonth') {
        const from = new Date(today); from.setDate(today.getDate() - 30);
        fromStr = fmtDate(from); toStr = todayStr;
    } else if (advSelectedRange === 'custom') {
        fromStr = document.getElementById('adv-from-date').value || null;
        toStr   = document.getElementById('adv-to-date').value || null;
    }

    const results = [];
    const allDates = Object.keys(state.allDaysByDate).sort();
    allDates.forEach(dateStr => {
        if (fromStr && dateStr < fromStr) return;
        if (toStr && dateStr > toStr) return;
        const day = state.allDaysByDate[dateStr];
        if (!day || !day.entries) return;
        day.entries.forEach((entry, entryIdx) => {
            if (q) {
                const mTicket = fieldTicket && entry.ticket && entry.ticket.toLowerCase().includes(q);
                const mType   = fieldType   && fmtTypeLabel(entry.type).toLowerCase().includes(q);
                const mDesc   = fieldDesc   && entry.desc && entry.desc.toLowerCase().includes(q);
                if (!mTicket && !mType && !mDesc) return;
            }
            results.push({ dateStr, entryIdx, entry });
        });
    });
    return results;
}

function renderAdvancedResults() {
    const container = document.getElementById('adv-search-results');
    const pagEl     = document.getElementById('adv-search-pagination');

    if (!advSearchResults.length) {
        container.innerHTML = '<div class="search-no-results py-3">No results found</div>';
        pagEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(advSearchResults.length / SEARCH_PAGE_SIZE);
    const pageItems  = advSearchResults.slice(advSearchPage * SEARCH_PAGE_SIZE, (advSearchPage + 1) * SEARCH_PAGE_SIZE);

    container.innerHTML = pageItems.map((r, i) => {
        const hhmm = fmtHHMM(r.entry.hh, r.entry.mm);
        const line1Left = `${escHtml(fmtSearchDate(r.dateStr))} &middot; ${escHtml(r.entry.ticket || '—')} &middot; ${escHtml(fmtTypeLabel(r.entry.type))}`;
        const desc = r.entry.desc || '';
        return `<div class="adv-result-card" data-pidx="${i}">
            <div class="adv-result-line1">
                <span>${line1Left}</span>
                <span class="adv-result-hours">${hhmm}</span>
            </div>
            <div class="adv-result-line2">${escHtml(desc)}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.adv-result-card').forEach((el, i) => {
        el.addEventListener('click', () => {
            const r = pageItems[i];
            bootstrap.Modal.getInstance(document.getElementById('advSearchModal')).hide();
            navigateToResult(r.dateStr, r.entryIdx);
        });
    });

    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
    let pagHtml = '';
    for (let p = 0; p < totalPages; p++) {
        pagHtml += `<button class="adv-pagination-btn${p === advSearchPage ? ' active' : ''}" data-page="${p}">${p + 1}</button>`;
    }
    pagEl.innerHTML = pagHtml;
    pagEl.querySelectorAll('.adv-pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            advSearchPage = parseInt(btn.dataset.page);
            renderAdvancedResults();
        });
    });
}
