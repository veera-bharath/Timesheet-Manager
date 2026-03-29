/* =============================================================
   TICKET TYPES — configurable type list, CRUD, select helpers
   ============================================================= */

import { state, DEFAULT_TICKET_TYPES } from './state.js';
import { saveState } from './store.js';
import { showToast, showConfirm } from './toast.js';
import { escHtml } from './utils.js';
// Circular — resolved at call time
import { renderAll } from './render.js';

/* ── PUBLIC HELPERS ─────────────────────────────────────────── */

export function getTypeLabel(typeId) {
    const type = (state.ticketTypes || []).find(t => t.id === typeId);
    if (type) return type.label;
    // Fallbacks for built-in IDs (in case ticketTypes hasn't loaded yet)
    if (typeId === 'servicedesk') return 'Service Desk';
    if (typeId === 'jira') return 'Jira';
    // Deleted / unrecognised type
    return typeId ? `Unknown (${typeId})` : 'Unknown';
}

export function getTypeById(typeId) {
    return (state.ticketTypes || []).find(t => t.id === typeId) || null;
}

export function populateTypeSelect(selectEl, selectedId) {
    const types = state.ticketTypes && state.ticketTypes.length
        ? state.ticketTypes
        : DEFAULT_TICKET_TYPES;
    selectEl.innerHTML = types
        .map(t => `<option value="${escHtml(t.id)}"${t.id === selectedId ? ' selected' : ''}>${escHtml(t.label)}</option>`)
        .join('');
}

/* ── SETTINGS SECTION RENDERER ──────────────────────────────── */

export function renderTicketTypesSection(el, navigate) {
    _render(el, navigate, undefined);
}

/* formTypeId:
 *   undefined → list + "Add Type" button, no form
 *   null      → show empty add form
 *   'some-id' → show edit form for that type id
 */
function _render(el, navigate, formTypeId) {
    const types = state.ticketTypes || [];
    const BUILT_IN = new Set(['jira', 'servicedesk']);
    const showForm = formTypeId !== undefined;
    const editingType = showForm && formTypeId !== null
        ? types.find(t => t.id === formTypeId) || null
        : null;

    const listHtml = types.length === 0
        ? '<p class="settings-placeholder">No ticket types defined.</p>'
        : types.map(t => `
            <div class="tt-row" data-id="${escHtml(t.id)}">
                <span class="tt-color-dot" style="background:${escHtml(t.color)}"></span>
                <span class="tt-label">${escHtml(t.label)}</span>
                <span class="tt-prefix-hint">${t.hasPrefix ? escHtml(t.prefixText) : ''}</span>
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
            <h2 class="settings-section-title">Ticket Types</h2>
            <p class="settings-section-desc">Configure the ticket types available when adding entries.</p>
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
    if (addBtn) {
        addBtn.addEventListener('click', () => _render(el, navigate, null));
    }

    if (showForm) {
        _bindForm(el.querySelector('.tt-form'), editingType, el, navigate);
    }
}

function _buildForm(editingType, formTypeId) {
    const isNew = formTypeId === null || !editingType;
    const t = editingType;
    return `
        <div class="settings-form">
            <div class="tt-form-title">${isNew ? 'Add Ticket Type' : `Edit — ${escHtml(t.label)}`}</div>
            <div class="settings-form-group">
                <label class="label-text" for="tt-form-label">Label</label>
                <input type="text" id="tt-form-label" class="form-control dark-input"
                    placeholder="e.g. Service Desk" value="${escHtml(t?.label || '')}" maxlength="50" />
            </div>
            <div class="settings-form-group">
                <label class="label-text">Color</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" id="tt-form-color" class="tt-color-input" value="${escHtml(t?.color || '#aaaaaa')}" />
                    <span class="label-text" id="tt-form-color-val">${escHtml(t?.color || '#aaaaaa')}</span>
                </div>
            </div>
            <div class="settings-form-group">
                <div class="d-flex align-items-center gap-2">
                    <input type="checkbox" id="tt-form-hasprefix" class="form-check-input" ${t?.hasPrefix ? 'checked' : ''} />
                    <label class="label-text mb-0" for="tt-form-hasprefix">Add prefix text to report entries</label>
                </div>
            </div>
            <div class="settings-form-group" id="tt-form-prefix-row" style="${t?.hasPrefix ? '' : 'display:none'}">
                <label class="label-text" for="tt-form-prefixtext">Prefix Text</label>
                <input type="text" id="tt-form-prefixtext" class="form-control dark-input"
                    placeholder="e.g. (Service desk) " value="${escHtml(t?.prefixText || '')}" maxlength="100" />
            </div>
            <div class="settings-form-actions d-flex gap-2">
                <button class="btn btn-gradient px-4" id="tt-form-save">
                    <i class="bi bi-check-lg me-1"></i>${isNew ? 'Add' : 'Save'}
                </button>
                <button class="btn btn-outline-light px-4" id="tt-form-cancel">Cancel</button>
            </div>
        </div>`;
}

function _bindForm(formEl, editingType, el, navigate) {
    const colorInput  = formEl.querySelector('#tt-form-color');
    const colorVal    = formEl.querySelector('#tt-form-color-val');
    const hasPrefixCb = formEl.querySelector('#tt-form-hasprefix');
    const prefixRow   = formEl.querySelector('#tt-form-prefix-row');

    colorInput.addEventListener('input', () => { colorVal.textContent = colorInput.value; });
    hasPrefixCb.addEventListener('change', () => {
        prefixRow.style.display = hasPrefixCb.checked ? '' : 'none';
    });

    formEl.querySelector('#tt-form-save').addEventListener('click', () => {
        const labelInput = formEl.querySelector('#tt-form-label');
        const label = labelInput.value.trim();
        if (!label) { labelInput.classList.add('is-invalid'); return; }
        labelInput.classList.remove('is-invalid');

        const color      = colorInput.value;
        const hasPrefix  = hasPrefixCb.checked;
        const prefixText = hasPrefix ? (formEl.querySelector('#tt-form-prefixtext').value) : '';

        if (editingType) {
            const type = state.ticketTypes.find(t => t.id === editingType.id);
            if (type) { type.label = label; type.color = color; type.hasPrefix = hasPrefix; type.prefixText = prefixText; }
        } else {
            const id = 'type_' + Date.now();
            state.ticketTypes.push({ id, label, color, hasPrefix, prefixText });
        }

        saveState();
        _syncTypeSelects();
        renderAll();
        showToast(editingType ? 'Ticket type updated.' : 'Ticket type added.', 'success');
        _render(el, navigate, undefined);
    });

    formEl.querySelector('#tt-form-cancel').addEventListener('click', () => {
        _render(el, navigate, undefined);
    });
}

function _deleteType(id, el, navigate) {
    const type = state.ticketTypes.find(t => t.id === id);
    if (!type) return;

    const inUse = Object.values(state.allDaysByDate).some(day =>
        day.entries && day.entries.some(e => e.type === id)
    ) || (state.days || []).some(day =>
        day && day.entries && day.entries.some(e => e.type === id)
    );

    const doDelete = async () => {
        state.ticketTypes = state.ticketTypes.filter(t => t.id !== id);
        await saveState();
        _syncTypeSelects();
        renderAll();
        showToast('Ticket type deleted.', 'success');
        _render(el, navigate, undefined);
    };

    if (inUse) {
        let warning = `Entries using "${type.label}" will show as unknown type with grey colour.`;
        if (type.hasPrefix && type.prefixText) {
            warning += ` The prefix "${type.prefixText}" will no longer appear in reports.`;
        }
        showConfirm(warning, doDelete);
    } else {
        showConfirm(`Delete ticket type "${type.label}"?`, doDelete);
    }
}

function _syncTypeSelects() {
    ['modal-type', 'recurring-type', 'scheduled-form-type'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        populateTypeSelect(sel, current);
        // If the previously selected type was deleted, fall back to first type
        if (!state.ticketTypes.find(t => t.id === sel.value)) {
            sel.value = state.ticketTypes[0]?.id || 'jira';
        }
    });
}
