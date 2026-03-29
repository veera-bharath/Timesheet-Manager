/* =============================================================
   ERROR LOG — persistent error capture, pruning, settings UI
   ============================================================= */

import { state } from './state.js';
import { escHtml } from './utils.js';
import { showToast } from './toast.js';

const ERRORLOG_KEY = 'errorLog_v1';
const MAX_ENTRIES  = 500;

/* ── PERSISTENCE ────────────────────────────────────────────── */

export async function loadErrorLog() {
    try {
        const saved = await window.electronStore.get(ERRORLOG_KEY);
        if (saved) {
            state.errorLog             = saved.logs || [];
            state.errorLogRetentionDays = saved.retentionDays || 30;
        }
        _prune();
    } catch (e) { /* silent — don't log errors about the error log */ }
}

async function _saveErrorLog() {
    try {
        await window.electronStore.set(ERRORLOG_KEY, {
            logs: state.errorLog,
            retentionDays: state.errorLogRetentionDays,
        });
    } catch (e) { /* silent */ }
}

function _prune() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (state.errorLogRetentionDays || 30));
    state.errorLog = (state.errorLog || []).filter(e => new Date(e.timestamp) >= cutoff);
    if (state.errorLog.length > MAX_ENTRIES) state.errorLog = state.errorLog.slice(-MAX_ENTRIES);
}

/* ── PUBLIC HELPER ──────────────────────────────────────────── */

export function logError(context, error) {
    const entry = {
        timestamp: new Date().toISOString(),
        context:   context || 'unknown',
        message:   error?.message || String(error),
        stack:     error?.stack   || '',
    };
    if (!Array.isArray(state.errorLog)) state.errorLog = [];
    state.errorLog.push(entry);
    if (state.errorLog.length > MAX_ENTRIES) state.errorLog = state.errorLog.slice(-MAX_ENTRIES);
    _saveErrorLog();
}

/* ── SETTINGS SECTION RENDERER ──────────────────────────────── */

export function renderErrorLogSection(el, navigate) {
    _render(el, navigate);
}

function _render(el, navigate) {
    const logs = state.errorLog || [];
    const retention = state.errorLogRetentionDays || 30;
    const retentionOptions = [7, 14, 30, 60, 90]
        .map(d => `<option value="${d}"${d === retention ? ' selected' : ''}>${d} days</option>`)
        .join('');

    const logsHtml = logs.length === 0
        ? '<p class="settings-placeholder">No errors logged.</p>'
        : [...logs].reverse().map(e => `
            <div class="el-row">
                <div class="el-meta">
                    <span class="el-timestamp">${escHtml(_fmtTs(e.timestamp))}</span>
                    <span class="el-context-badge">${escHtml(e.context)}</span>
                </div>
                <div class="el-message">${escHtml(e.message)}</div>
                ${e.stack ? `<div class="el-stack">${escHtml(e.stack)}</div>` : ''}
            </div>`).join('');

    el.innerHTML = `
        <div class="settings-section-header">
            <button class="settings-back-btn"><i class="bi bi-arrow-left"></i> Developer</button>
            <h2 class="settings-section-title">Error Logs</h2>
            <p class="settings-section-desc">Application errors captured at runtime. Logs are pruned automatically.</p>
        </div>
        <div class="settings-section-body">
            <div class="el-toolbar">
                <div class="d-flex align-items-center gap-2">
                    <label class="label-text mb-0">Retention</label>
                    <select id="el-retention" class="form-select dark-input" style="width:auto">${retentionOptions}</select>
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-light" id="el-copy-btn" ${logs.length === 0 ? 'disabled' : ''}>
                        <i class="bi bi-clipboard me-1"></i>Copy All
                    </button>
                    <button class="btn btn-sm btn-outline-danger" id="el-clear-btn" ${logs.length === 0 ? 'disabled' : ''}>
                        <i class="bi bi-trash me-1"></i>Clear All
                    </button>
                </div>
            </div>
            <div class="el-list">${logsHtml}</div>
        </div>`;

    el.querySelector('.settings-back-btn')
        .addEventListener('click', () => navigate('developer'));

    el.querySelector('#el-retention').addEventListener('change', e => {
        state.errorLogRetentionDays = parseInt(e.target.value);
        _prune();
        _saveErrorLog();
        _render(el, navigate);
    });

    const clearBtn = el.querySelector('#el-clear-btn');
    if (clearBtn && !clearBtn.disabled) {
        clearBtn.addEventListener('click', () => {
            state.errorLog = [];
            _saveErrorLog();
            showToast('Error log cleared.', 'success');
            _render(el, navigate);
        });
    }

    const copyBtn = el.querySelector('#el-copy-btn');
    if (copyBtn && !copyBtn.disabled) {
        copyBtn.addEventListener('click', () => {
            const text = (state.errorLog || []).map(e =>
                `[${e.timestamp}] [${e.context}] ${e.message}${e.stack ? '\n' + e.stack : ''}`
            ).join('\n\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast('Copied to clipboard.', 'success'))
                .catch(() => showToast('Copy failed.', 'danger'));
        });
    }
}

function _fmtTs(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
}
