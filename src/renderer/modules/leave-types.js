/* =============================================================
   LEAVE TYPES — configurable leave/holiday list, CRUD, helpers
   ============================================================= */

import { state, DEFAULT_LEAVE_TYPES } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { escHtml } from './utils.js';
// Circular — resolved at call time
import { renderAll } from './render.js';

/* ── PUBLIC HELPERS ─────────────────────────────────────────── */

/** Resolve the display label for a day that may use old or new data model. */
export function getLeaveLabel(day) {
    if (day.leaveTypeId) {
        const type = getLeaveTypeById(day.leaveTypeId);
        if (type) return type.label;
    }
    // Fallback for old data (holidayLabel string) or deleted types
    return day.holidayLabel || 'Offshore Holiday';
}

export function getLeaveTypeById(id) {
    return (state.leaveTypes || []).find(t => t.id === id) || null;
}

/**
 * Resolve the effective leave type ID for a day.
 * Handles backward compat with days that only have holidayLabel.
 */
export function resolveLeaveTypeId(day) {
    if (day.leaveTypeId && getLeaveTypeById(day.leaveTypeId)) return day.leaveTypeId;
    // Try to match existing label to a type (old data migration)
    if (day.holidayLabel) {
        const byLabel = (state.leaveTypes || []).find(t => t.label === day.holidayLabel);
        if (byLabel) return byLabel.id;
    }
    return (state.leaveTypes || DEFAULT_LEAVE_TYPES)[0]?.id || 'offshore-holiday';
}

export function populateLeaveSelect(selectEl, selectedId) {
    const types = state.leaveTypes && state.leaveTypes.length
        ? state.leaveTypes
        : DEFAULT_LEAVE_TYPES;
    selectEl.innerHTML = types
        .map(t => `<option value="${escHtml(t.id)}"${t.id === selectedId ? ' selected' : ''}>${escHtml(t.label)}</option>`)
        .join('');
}

/* ── SETTINGS SECTION RENDERER ──────────────────────────────── */

export function renderLeaveTypesSection(el, navigate) {
    _render(el, navigate, undefined);
}

/* formTypeId:
 *   undefined → list + "Add Type" button, no form
 *   null      → show empty add form
 *   'some-id' → show edit form for that type id
 */
function _render(el, navigate, formTypeId) {
    const types = state.leaveTypes || [];
    const BUILT_IN = new Set(['offshore-holiday', 'sick-leave', 'planned-leave']);
    const showForm = formTypeId !== undefined;
    const editingType = showForm && formTypeId !== null
        ? types.find(t => t.id === formTypeId) || null
        : null;

    const listHtml = types.length === 0
        ? '<p class="settings-placeholder">No leave types defined.</p>'
        : types.map(t => `
            <div class="tt-row" data-id="${escHtml(t.id)}">
                <span class="tt-label">${escHtml(t.label)}</span>
                <span class="tt-prefix-hint">${t.paid ? 'Paid' : 'Unpaid'}</span>
                <div class="tt-actions">
                    <button class="btn btn-sm btn-outline-light tt-edit-btn" data-id="${escHtml(t.id)}" title="Edit">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger tt-delete-btn" data-id="${escHtml(t.id)}"${BUILT_IN.has(t.id) ? ' disabled title="Built-in type cannot be deleted"' : ' title="Delete"'}>
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>`).join('');

    el.innerHTML = `
        <div class="settings-section-header">
            <button class="settings-back-btn"><i class="bi bi-arrow-left"></i> Management</button>
            <h2 class="settings-section-title">Leave Types</h2>
            <p class="settings-section-desc">Configure the leave types available when marking a day as holiday or leave.</p>
        </div>
        <div class="settings-section-body">
            <div class="tt-list">${listHtml}</div>
            ${showForm
                ? `<div class="tt-form mt-4">${_buildForm(editingType, formTypeId)}</div>`
                : `<button class="btn btn-outline-light btn-sm mt-3 tt-add-btn">
                       <i class="bi bi-plus-lg me-1"></i> Add Type
                   </button>`
            }
        </div>`;

    el.querySelector('.settings-back-btn')
        .addEventListener('click', () => navigate('management'));

    el.querySelectorAll('.tt-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => _render(el, navigate, btn.dataset.id));
    });

    el.querySelectorAll('.tt-delete-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => _deleteType(btn.dataset.id, el, navigate));
    });

    const addBtn = el.querySelector('.tt-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => _render(el, navigate, null));

    if (showForm) _bindForm(el.querySelector('.tt-form'), editingType, el, navigate);
}

function _buildForm(editingType, formTypeId) {
    const isNew = formTypeId === null || !editingType;
    const t = editingType;
    return `
        <div class="settings-form">
            <div class="tt-form-title">${isNew ? 'Add Leave Type' : `Edit — ${escHtml(t.label)}`}</div>
            <div class="settings-form-group">
                <label class="label-text" for="lt-form-label">Label</label>
                <input type="text" id="lt-form-label" class="form-control dark-input"
                    placeholder="e.g. Bank Holiday" value="${escHtml(t?.label || '')}" maxlength="60" />
            </div>
            <div class="settings-form-group">
                <div class="d-flex align-items-center gap-2">
                    <input type="checkbox" id="lt-form-paid" class="form-check-input" ${t?.paid ? 'checked' : ''} />
                    <label class="label-text mb-0" for="lt-form-paid">Paid leave</label>
                </div>
            </div>
            <div class="settings-form-actions d-flex gap-2">
                <button class="btn btn-gradient px-4" id="lt-form-save">
                    <i class="bi bi-check-lg me-1"></i>${isNew ? 'Add' : 'Save'}
                </button>
                <button class="btn btn-outline-light px-4" id="lt-form-cancel">Cancel</button>
            </div>
        </div>`;
}

function _bindForm(formEl, editingType, el, navigate) {
    formEl.querySelector('#lt-form-save').addEventListener('click', () => {
        const labelInput = formEl.querySelector('#lt-form-label');
        const label = labelInput.value.trim();
        if (!label) { labelInput.classList.add('is-invalid'); return; }
        labelInput.classList.remove('is-invalid');

        const paid = formEl.querySelector('#lt-form-paid').checked;

        if (editingType) {
            const type = state.leaveTypes.find(t => t.id === editingType.id);
            if (type) { type.label = label; type.paid = paid; }
        } else {
            state.leaveTypes.push({ id: 'lt_' + Date.now(), label, paid });
        }

        saveState();
        _syncLeaveSelects();
        renderAll();
        showToast(editingType ? 'Leave type updated.' : 'Leave type added.', 'success');
        _render(el, navigate, undefined);
    });

    formEl.querySelector('#lt-form-cancel').addEventListener('click', () => {
        _render(el, navigate, undefined);
    });
}

function _deleteType(id, el, navigate) {
    const type = state.leaveTypes.find(t => t.id === id);
    if (!type) return;

    const inUse = Object.values(state.allDaysByDate).some(day => day.leaveTypeId === id)
        || (state.days || []).some(day => day && day.leaveTypeId === id);

    const doDelete = async () => {
        state.leaveTypes = state.leaveTypes.filter(t => t.id !== id);
        await saveState();
        _syncLeaveSelects();
        renderAll();
        showToast('Leave type deleted.', 'success');
        _render(el, navigate, undefined);
    };

    if (inUse) {
        showConfirm(
            `Days using "${type.label}" will fall back to their saved label or "Offshore Holiday".`,
            doDelete
        );
    } else {
        showConfirm(`Delete leave type "${type.label}"?`, doDelete);
    }
}

function _syncLeaveSelects() {
    document.querySelectorAll('[id^="holiday-label-"]').forEach(sel => {
        const current = sel.value;
        populateLeaveSelect(sel, current);
        if (!state.leaveTypes.find(t => t.id === sel.value)) {
            sel.value = state.leaveTypes[0]?.id || 'offshore-holiday';
        }
    });
}
