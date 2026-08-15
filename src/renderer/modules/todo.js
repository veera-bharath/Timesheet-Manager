/* =============================================================
   TODO NOTES & REMINDERS SYSTEM
   ============================================================= */

import { state } from './state.js';
import { saveState } from './store.js';
import { pushNotification } from './notifications.js';

let offcanvas = null;
let bentoModal = null;
let editorModal = null;

let currentNoteId = null;
let tempTasks = [];
let tempNoteAlarm = null;
let reminderDaemonTimer = null;

export function initTodoNotes() {
    const sidebarEl = document.getElementById('todoSidebar');
    if (sidebarEl) offcanvas = new bootstrap.Offcanvas(sidebarEl);
    
    const bentoEl = document.getElementById('todoBentoModal');
    if (bentoEl) bentoModal = new bootstrap.Modal(bentoEl);

    const editorEl = document.getElementById('todoEditorModal');
    if (editorEl) editorModal = new bootstrap.Modal(editorEl);

    // Triggers
    document.getElementById('btn-todo-expand')?.addEventListener('click', () => {
        offcanvas?.hide();
        bentoModal?.show();
    });

    document.getElementById('btn-add-todo')?.addEventListener('click', () => openEditor());
    document.getElementById('btn-bento-add-todo')?.addEventListener('click', () => openEditor());

    // Search & Tabs
    document.getElementById('todo-search-input')?.addEventListener('input', renderSidebar);
    document.getElementById('todo-bento-search')?.addEventListener('input', renderBentoGrid);
    document.querySelectorAll('[data-bento-tab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-bento-tab]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderBentoGrid();
        });
    });

    document.getElementById('todoTabs')?.addEventListener('shown.bs.tab', renderSidebar);

    // Editor Actions
    document.getElementById('btn-todo-save')?.addEventListener('click', saveNote);
    document.getElementById('btn-todo-archive')?.addEventListener('click', archiveNote);
    document.getElementById('btn-todo-unarchive')?.addEventListener('click', unarchiveNote);
    document.getElementById('btn-todo-add-task')?.addEventListener('click', () => addTaskField());
    document.getElementById('todo-editor-reminder-btn')?.addEventListener('click', () => openAlarmModal('note'));

    // Global shortcut Ctrl+Shift+N
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
            e.preventDefault();
            bentoModal?.hide();
            offcanvas?.toggle();
        }
    });

    // Reminder Daemon
    startReminderDaemon();
    
    // Auto cleanup archived notes > 30 days
    cleanupArchivedNotes();

    // Refresh when opening
    sidebarEl?.addEventListener('show.bs.offcanvas', renderSidebar);
    bentoEl?.addEventListener('show.bs.modal', renderBentoGrid);

    // Event delegation for opening notes (double click)
    document.body.addEventListener('dblclick', (e) => {
        const card = e.target.closest('.todo-card');
        if (card && !e.target.closest('.todo-task-checkbox') && !e.target.closest('.todo-card-actions')) {
            openEditor(card.dataset.id);
        }
    });

    // Event delegation for tasks (single click)
    document.body.addEventListener('click', (e) => {
        const taskCheck = e.target.closest('.todo-task-checkbox');
        if (taskCheck) {
            toggleTaskComplete(taskCheck.dataset.noteId, taskCheck.dataset.taskId, taskCheck.checked);
        }
    });

    renderSidebar();
    renderBentoGrid();

    // Listen for global shortcuts
    if (window.app?.onOpenNewTodo) {
        window.app.onOpenNewTodo(() => {
            if (!todoEditorModal || !todoEditorModal._element?.classList.contains('show')) {
                openEditor();
            }
        });
    }
}

function generateId() {
    return 'todo-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── UI Rendering ── */

function getNotesByTab(tab, query = '') {
    if (!state.todoNotes) state.todoNotes = [];
    let list = state.todoNotes;
    
    // Filter by tab
    if (tab === 'archived') {
        list = list.filter(n => n.archived);
    } else if (tab === 'reminders') {
        list = list.filter(n => !n.archived && (!!n.alarm || (n.tasks && n.tasks.some(t => !!t.alarm))));
    } else {
        list = list.filter(n => !n.archived);
    }

    // Filter by search
    if (query) {
        const q = query.toLowerCase();
        list = list.filter(n => 
            (n.title && n.title.toLowerCase().includes(q)) || 
            (n.desc && n.desc.toLowerCase().includes(q))
        );
    }

    // Sort: pinned first, then newest
    list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
    });

    return list;
}

function renderSidebar() {
    const activeTabEl = document.querySelector('#todoTabs .nav-link.active');
    const tabStr = activeTabEl ? activeTabEl.getAttribute('data-bs-target').replace('#todo-tab-', '') : 'active';
    const query = document.getElementById('todo-search-input').value;
    
    const container = document.getElementById(`todo-list-${tabStr}`);
    if (!container) return;

    if (tabStr === 'tasks') {
        let list = state.todoNotes.filter(n => !n.archived && n.tasks && n.tasks.length > 0);
        if (query) {
            const q = query.toLowerCase();
            list = list.filter(n => (n.title && n.title.toLowerCase().includes(q)) || (n.desc && n.desc.toLowerCase().includes(q)));
        }
        list.sort((a, b) => b.createdAt - a.createdAt);

        const pending = list.filter(n => n.tasks.some(t => !t.completed));
        const done = list.filter(n => n.tasks.every(t => t.completed));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-secondary text-center mt-5 pt-4" style="opacity:0.7">No tasks found</div>`;
        } else {
            container.innerHTML = `
                <div class="mb-4">
                    <button class="btn btn-sm w-100 text-start d-flex justify-content-between align-items-center shadow-none text-light p-2 rounded mb-2" style="background: rgba(255,255,255,0.05);" data-bs-toggle="collapse" data-bs-target="#sidebar-tasks-pending">
                        <span class="fw-semibold text-uppercase" style="font-size:0.75rem; letter-spacing:0.5px;">Pending <span class="badge bg-secondary ms-2">${pending.length}</span></span>
                        <i class="bi bi-chevron-down opacity-50"></i>
                    </button>
                    <div class="collapse show mt-2" id="sidebar-tasks-pending">
                        <div class="d-flex flex-column gap-2">
                            ${pending.map(buildNoteCard).join('')}
                        </div>
                    </div>
                </div>
                <div class="mb-4">
                    <button class="btn btn-sm w-100 text-start d-flex justify-content-between align-items-center shadow-none text-light p-2 rounded mb-2" style="background: rgba(255,255,255,0.05);" data-bs-toggle="collapse" data-bs-target="#sidebar-tasks-done">
                        <span class="fw-semibold text-uppercase" style="font-size:0.75rem; letter-spacing:0.5px;">Done <span class="badge bg-secondary ms-2">${done.length}</span></span>
                        <i class="bi bi-chevron-down opacity-50"></i>
                    </button>
                    <div class="collapse mt-2" id="sidebar-tasks-done">
                        <div class="d-flex flex-column gap-2">
                            ${done.map(buildNoteCard).join('')}
                        </div>
                    </div>
                </div>
            `;
        }
        return;
    }

    const notes = getNotesByTab(tabStr, query);
    container.innerHTML = notes.length ? notes.map(buildNoteCard).join('') : `<div class="text-secondary text-center mt-5 pt-4" style="opacity:0.7">No notes found</div>`;
}

function renderBentoGrid() {
    const activeTabEl = document.querySelector('[data-bento-tab].active');
    const tabStr = activeTabEl ? activeTabEl.dataset.bentoTab : 'active';
    const query = document.getElementById('todo-bento-search').value;
    
    const container = document.getElementById('todo-bento-grid');
    if (!container) return;

    if (tabStr === 'tasks') {
        let list = state.todoNotes.filter(n => !n.archived && n.tasks && n.tasks.length > 0);
        if (query) {
            const q = query.toLowerCase();
            list = list.filter(n => (n.title && n.title.toLowerCase().includes(q)) || (n.desc && n.desc.toLowerCase().includes(q)));
        }
        list.sort((a, b) => b.createdAt - a.createdAt);

        const pending = list.filter(n => n.tasks.some(t => !t.completed));
        const done = list.filter(n => n.tasks.every(t => t.completed));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-secondary text-center mt-5 w-100" style="grid-column: 1 / -1; opacity:0.7">No tasks found</div>`;
        } else {
            container.innerHTML = `
                <div style="grid-column: 1 / -1;">
                    <div class="mb-5">
                        <button class="btn btn-sm w-100 text-start d-flex justify-content-between align-items-center shadow-none text-light p-3 rounded mb-3" style="background: rgba(255,255,255,0.05);" data-bs-toggle="collapse" data-bs-target="#bento-tasks-pending">
                            <span class="fw-semibold text-uppercase" style="font-size:0.85rem; letter-spacing:0.5px;">Pending <span class="badge bg-secondary ms-2">${pending.length}</span></span>
                            <i class="bi bi-chevron-down opacity-50"></i>
                        </button>
                        <div class="collapse show mt-3" id="bento-tasks-pending">
                            <div class="todo-bento-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                                ${pending.map(buildNoteCard).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="mb-5">
                        <button class="btn btn-sm w-100 text-start d-flex justify-content-between align-items-center shadow-none text-light p-3 rounded mb-3" style="background: rgba(255,255,255,0.05);" data-bs-toggle="collapse" data-bs-target="#bento-tasks-done">
                            <span class="fw-semibold text-uppercase" style="font-size:0.85rem; letter-spacing:0.5px;">Done <span class="badge bg-secondary ms-2">${done.length}</span></span>
                            <i class="bi bi-chevron-down opacity-50"></i>
                        </button>
                        <div class="collapse mt-3" id="bento-tasks-done">
                            <div class="todo-bento-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                                ${done.map(buildNoteCard).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        return;
    }

    const notes = getNotesByTab(tabStr, query);
    container.innerHTML = notes.length ? notes.map(buildNoteCard).join('') : `<div class="text-secondary text-center mt-5 w-100" style="grid-column: 1 / -1; opacity:0.7">No notes found</div>`;
}

function buildNoteCard(note) {
    const total = note.tasks ? note.tasks.length : 0;
    const completed = total ? note.tasks.filter(t => t.completed).length : 0;
    const progress = total ? (completed / total) * 100 : 0;
    
    let tasksHtml = '';
    if (total > 0) {
        tasksHtml = `<div class="todo-card-tasks">
            ${note.tasks.slice(0, 3).map(t => {
                let badge = '';
                if (t.alarm) {
                    const isRecurring = t.alarm.type !== 'once';
                    const icon = isRecurring ? 'bi-arrow-repeat' : 'bi-bell';
                    badge = `<span class="badge bg-secondary bg-opacity-25 text-light ms-2 fw-normal" style="font-size: 0.75em; padding: 0.25em 0.5em;"><i class="bi ${icon} me-1"></i>${formatAlarmLabel(t.alarm)}</span>`;
                }
                return `
                <div class="todo-task-item ${t.completed ? 'completed' : ''}">
                    <input type="checkbox" class="form-check-input todo-task-checkbox" data-note-id="${note.id}" data-task-id="${t.id}" ${t.completed ? 'checked' : ''}>
                    <span class="text-truncate flex-grow-1">${escHtml(t.text)}${badge}</span>
                </div>
                `;
            }).join('')}
            ${total > 3 ? `<div style="font-size:0.75rem; color:var(--text-muted)">+ ${total - 3} more tasks</div>` : ''}
            <div class="d-flex align-items-center mt-3">
                <div class="todo-progress flex-grow-1 m-0" style="height: 6px;">
                    <div class="todo-progress-bar" style="width: ${progress}%"></div>
                </div>
                <span class="ms-3 text-light" style="font-size: 0.75rem; white-space: nowrap; opacity: 0.8;">${completed} / ${total}</span>
            </div>
        </div>`;
    }

    let footerHtml = '';
    if (note.alarm) {
        let reminderHtml = `<div class="todo-reminder"><i class="bi bi-bell"></i> ${formatAlarmLabel(note.alarm)}</div>`;
        footerHtml = `<div class="todo-card-footer">${reminderHtml}</div>`;
    }

    const titleIcon = note.pinned ? `<i class="bi bi-pin-angle-fill pin-icon pinned me-2"></i>` : '';
    const colorAttr = note.color !== 'default' ? `data-color="${note.color}"` : '';

    return `
    <div class="todo-card" data-id="${note.id}" ${colorAttr}>
        <div class="todo-card-header">
            <h6 class="todo-card-title">${titleIcon}${escHtml(note.title || 'Untitled Note')}</h6>
        </div>
        ${note.desc ? `<p class="todo-card-desc">${escHtml(note.desc)}</p>` : ''}
        ${tasksHtml}
        ${footerHtml}
    </div>`;
}

let alarmModalInstance = null;
let currentAlarmTarget = { type: null, index: null };



function openEditor(id = null) {
    if (!alarmModalInstance) {
        alarmModalInstance = new bootstrap.Modal(document.getElementById('todo-alarm-modal'));
        setupAlarmModal();
    }
    
    currentNoteId = id;
    const btnArchive = document.getElementById('btn-todo-archive');
    const btnUnarchive = document.getElementById('btn-todo-unarchive');

    if (id) {
        const note = state.todoNotes.find(n => n.id === id);
        if (!note) return;
        
        let changed = false;
        const now = Date.now();
        
        if (note.alarm && note.alarm.type === 'once' && note.alarm.datetime <= now) {
            note.alarm = null;
            note.notified = false;
            changed = true;
        }
        
        if (note.tasks) {
            note.tasks.forEach(t => {
                if (t.alarm && t.alarm.type === 'once' && t.alarm.datetime <= now) {
                    t.alarm = null;
                    t.notified = false;
                    changed = true;
                }
            });
        }
        
        if (changed) {
            saveState();
            renderSidebar();
            renderBentoGrid();
        }

        document.getElementById('todo-editor-title').value = note.title || '';
        document.getElementById('todo-editor-desc').value = note.desc || '';
        document.getElementById('todo-editor-color').value = note.color || 'default';
        document.getElementById('todo-editor-pinned').checked = !!note.pinned;
        
        tempNoteAlarm = note.alarm ? JSON.parse(JSON.stringify(note.alarm)) : null;
        updateNoteAlarmUI();

        tempTasks = note.tasks ? JSON.parse(JSON.stringify(note.tasks)) : [];
        
        btnArchive.style.display = note.archived ? 'none' : '';
        btnUnarchive.style.display = note.archived ? '' : 'none';
    } else {
        document.getElementById('todo-editor-title').value = '';
        document.getElementById('todo-editor-desc').value = '';
        document.getElementById('todo-editor-color').value = 'default';
        document.getElementById('todo-editor-pinned').checked = false;
        
        tempNoteAlarm = null;
        updateNoteAlarmUI();
        
        tempTasks = [];
        
        btnArchive.style.display = 'none';
        btnUnarchive.style.display = 'none';
    }

    renderEditorTasks();
    editorModal?.show();
    setTimeout(() => document.getElementById('todo-editor-title').focus(), 150);
}

function addTaskField(text = '', completed = false, id = null) {
    if (tempTasks.length > 0 && tempTasks[tempTasks.length - 1].text.trim() === '') return;
    tempTasks.push({
        id: id || generateId(),
        text: text,
        completed: completed,
        alarm: null
    });
    renderEditorTasks();
}

let draggedTaskIndex = null;

function setupAlarmModal() {
    const typeSelect = document.getElementById('todo-alarm-type');
    const dtGroup = document.getElementById('todo-alarm-datetime-group');
    const timeGroup = document.getElementById('todo-alarm-time-group');
    const daysGroup = document.getElementById('todo-alarm-days-group');
    
    typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'once') {
            dtGroup.classList.remove('d-none');
            timeGroup.classList.add('d-none');
            daysGroup.classList.add('d-none');
        } else if (typeSelect.value === 'everyday') {
            dtGroup.classList.add('d-none');
            timeGroup.classList.remove('d-none');
            daysGroup.classList.add('d-none');
        } else {
            dtGroup.classList.add('d-none');
            timeGroup.classList.remove('d-none');
            daysGroup.classList.remove('d-none');
        }
    });

    document.getElementById('btn-todo-alarm-remove').addEventListener('click', () => {
        saveAlarmToTarget(null);
        alarmModalInstance.hide();
    });
    document.getElementById('btn-todo-alarm-save').addEventListener('click', () => {
        const type = typeSelect.value;
        const alarm = { type, lastNotified: null };
        if (type === 'once') {
            const dtVal = document.getElementById('todo-alarm-datetime').value;
            if (!dtVal) return;
            const targetTime = new Date(dtVal).getTime();
            if (targetTime <= Date.now()) {
                alert("Please select a future date and time.");
                return;
            }
            alarm.datetime = targetTime;
        } else {
            const timeVal = document.getElementById('todo-alarm-time').value;
            if (!timeVal) return;
            alarm.time = timeVal;
            if (type === 'specific_days') {
                const checked = Array.from(document.querySelectorAll('#todo-alarm-days input:checked')).map(el => Number(el.value));
                if (checked.length === 0) {
                    alert("Please select at least one day.");
                    return;
                }
                alarm.days = checked;
            }
        }
        saveAlarmToTarget(alarm);
        alarmModalInstance.hide();
    });
}

function openAlarmModal(targetType, index = null) {
    currentAlarmTarget = { type: targetType, index };
    const alarm = targetType === 'note' ? tempNoteAlarm : tempTasks[index].alarm;
    
    const typeSelect = document.getElementById('todo-alarm-type');
    const dtInput = document.getElementById('todo-alarm-datetime');
    const timeInput = document.getElementById('todo-alarm-time');
    const dayCheckboxes = document.querySelectorAll('#todo-alarm-days input');
    
    const now = new Date();
    const minStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dtInput.min = minStr;
    
    if (alarm) {
        typeSelect.value = alarm.type;
        if (alarm.type === 'once') {
            const d = new Date(alarm.datetime);
            dtInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
            timeInput.value = '';
            dayCheckboxes.forEach(cb => cb.checked = false);
        } else {
            dtInput.value = '';
            timeInput.value = alarm.time;
            if (alarm.type === 'specific_days') {
                const days = alarm.days || [];
                dayCheckboxes.forEach(cb => cb.checked = days.includes(Number(cb.value)));
            } else {
                dayCheckboxes.forEach(cb => cb.checked = false);
            }
        }
    } else {
        typeSelect.value = 'once';
        dtInput.value = '';
        timeInput.value = '';
        dayCheckboxes.forEach(cb => cb.checked = false);
    }
    
    typeSelect.dispatchEvent(new Event('change'));
    alarmModalInstance.show();
}

function saveAlarmToTarget(alarm) {
    if (currentAlarmTarget.type === 'note') {
        tempNoteAlarm = alarm;
        updateNoteAlarmUI();
    } else if (currentAlarmTarget.type === 'task') {
        tempTasks[currentAlarmTarget.index].alarm = alarm;
        renderEditorTasks();
    }
}

function formatAlarmLabel(alarm) {
    if (!alarm) return 'Not set';
    if (alarm.type === 'once') {
        return new Date(alarm.datetime).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
    } else if (alarm.type === 'everyday') {
        return `Everyday at ${alarm.time}`;
    } else if (alarm.type === 'specific_days') {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const selected = (alarm.days || []).map(d => days[d]).join(', ');
        return `${selected || 'No days'} at ${alarm.time}`;
    }
    return 'Not set';
}

function updateNoteAlarmUI() {
    const label = document.getElementById('todo-editor-reminder-label');
    const btn = document.getElementById('todo-editor-reminder-btn');
    if (!label || !btn) return;
    label.innerText = formatAlarmLabel(tempNoteAlarm);
    if (tempNoteAlarm) {
        btn.classList.add('text-accent');
        btn.querySelector('i').className = 'bi bi-bell-fill';
    } else {
        btn.classList.remove('text-accent');
        btn.querySelector('i').className = 'bi bi-bell';
    }
}

function renderEditorTasks() {
    const container = document.getElementById('todo-editor-tasks');
    container.innerHTML = '';
    tempTasks.forEach((t, i) => {
        const row = document.createElement('div');
        row.className = 'editor-task-row';
        row.draggable = true;
        
        const hasAlarm = !!t.alarm;
        const bellClass = hasAlarm ? 'bi-bell-fill text-accent' : 'bi-bell text-secondary';
        const titleAttr = hasAlarm ? formatAlarmLabel(t.alarm) : 'Add Alarm';

        row.innerHTML = `
            <i class="bi bi-grip-vertical editor-task-drag me-1" style="cursor:grab"></i>
            <input type="checkbox" class="form-check-input mt-0" ${t.completed ? 'checked' : ''}>
            <input type="text" class="form-control dark-input form-control-sm flex-grow-1" value="${escHtml(t.text)}" placeholder="Task...">
            <button type="button" class="btn btn-sm px-2 border-0 task-reminder-btn ms-1" title="${titleAttr}">
                <i class="bi ${bellClass}"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger px-2 border-0 ms-1"><i class="bi bi-trash"></i></button>
        `;
        
        row.querySelector('input[type="text"]').addEventListener('input', (e) => tempTasks[i].text = e.target.value);
        row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => tempTasks[i].completed = e.target.checked);
        row.querySelector('.task-reminder-btn').addEventListener('click', () => openAlarmModal('task', i));
        row.querySelector('button.btn-outline-danger').addEventListener('click', () => {
            tempTasks.splice(i, 1);
            renderEditorTasks();
        });

        // Drag and drop events
        row.addEventListener('dragstart', (e) => {
            draggedTaskIndex = i;
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('opacity-50');
        });
        row.addEventListener('dragend', () => {
            draggedTaskIndex = null;
            row.classList.remove('opacity-50');
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedTaskIndex === null || draggedTaskIndex === i) return;
            const item = tempTasks.splice(draggedTaskIndex, 1)[0];
            tempTasks.splice(i, 0, item);
            renderEditorTasks();
        });

        container.appendChild(row);
    });
}

function saveNote() {
    const title = document.getElementById('todo-editor-title').value.trim();
    const desc = document.getElementById('todo-editor-desc').value.trim();
    const color = document.getElementById('todo-editor-color').value;
    const pinned = document.getElementById('todo-editor-pinned').checked;
    
    if (!title && !desc) return; // Prevent empty

    const tasks = tempTasks.filter(t => t.text.trim().length > 0).map(t => ({...t, text: t.text.trim()}));

    if (currentNoteId) {
        const note = state.todoNotes.find(n => n.id === currentNoteId);
        if (note) {
            note.title = title;
            note.desc = desc;
            note.color = color;
            note.pinned = pinned;
            
            // Reset notified if reminder changed
            if (JSON.stringify(note.alarm || null) !== JSON.stringify(tempNoteAlarm || null)) {
                note.notified = false;
            }
            note.alarm = tempNoteAlarm;
            
            // For tasks, map over tempTasks to preserve their notified state unless reminder changed
            note.tasks = tasks.map(t => {
                const oldTask = note.tasks ? note.tasks.find(ot => ot.id === t.id) : null;
                const alarmChanged = JSON.stringify(oldTask?.alarm || null) !== JSON.stringify(t.alarm || null);
                return { ...t, notified: alarmChanged ? false : !!oldTask?.notified };
            });
            note.updatedAt = Date.now();
        }
    } else {
        state.todoNotes.push({
            id: `todo-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            title,
            desc,
            color,
            pinned,
            alarm: tempNoteAlarm,
            tasks,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            archived: false,
            archivedAt: null,
            notified: false
        });
    }

    saveState();
    renderSidebar();
    renderBentoGrid();
    editorModal.hide();
}

function archiveNote() {
    if (currentNoteId) {
        const note = state.todoNotes.find(n => n.id === currentNoteId);
        if (note) {
            note.archived = true;
            note.archivedAt = Date.now();
            note.updatedAt = Date.now();
            saveState();
            renderSidebar();
            renderBentoGrid();
            editorModal.hide();
        }
    }
}

function unarchiveNote() {
    if (currentNoteId) {
        const note = state.todoNotes.find(n => n.id === currentNoteId);
        if (note) {
            note.archived = false;
            note.archivedAt = null;
            note.updatedAt = Date.now();
            saveState();
            renderSidebar();
            renderBentoGrid();
            editorModal.hide();
        }
    }
}

function deleteNote(id) {
    state.todoNotes = state.todoNotes.filter(n => n.id !== id);
    saveState();
    renderSidebar();
    renderBentoGrid();
}

function toggleTaskComplete(noteId, taskId, completed) {
    if (!state.todoNotes) return;
    const note = state.todoNotes.find(n => n.id === noteId);
    if (note && note.tasks) {
        const task = note.tasks.find(t => t.id === taskId);
        if (task) {
            task.completed = completed;
            note.updatedAt = Date.now();
            saveState();
            renderSidebar();
            renderBentoGrid();
        }
    }
}

function cleanupArchivedNotes() {
    if (!state.todoNotes) return;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;
    
    state.todoNotes = state.todoNotes.filter(n => {
        if (n.archived && n.archivedAt && (now - n.archivedAt > THIRTY_DAYS)) {
            changed = true;
            return false;
        }
        return true;
    });

    if (changed) saveState();
}

/* ── Reminder System ── */

function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isAlarmTriggered(alarm, now) {
    if (!alarm) return false;
    if (alarm.type === 'once') {
        return now >= alarm.datetime;
    }
    
    // Everyday / Specific Days
    const d = new Date(now);
    if (alarm.type === 'specific_days') {
        const day = d.getDay();
        if (!alarm.days || !alarm.days.includes(day)) return false;
    }
    
    const todayStr = getTodayDateStr();
    if (alarm.lastNotified === todayStr) return false;
    
    const [hh, mm] = alarm.time.split(':').map(Number);
    const triggerTime = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
    
    return now >= triggerTime;
}

function startReminderDaemon() {
    if (reminderDaemonTimer) clearInterval(reminderDaemonTimer);
    
    reminderDaemonTimer = setInterval(() => {
        if (!state.todoNotes) return;
        const now = Date.now();
        let changed = false;

        state.todoNotes.forEach(note => {
            if (note.archived) return;

            // Note Reminder
            if (note.alarm && !note.notified && isAlarmTriggered(note.alarm, now)) {
                changed = true;
                triggerSystemNotification(note.title || 'Note Reminder', note.desc || '');
                if (note.alarm.type !== 'once') {
                    note.alarm.lastNotified = getTodayDateStr();
                    note.notified = false; // reset for tomorrow
                } else {
                    note.alarm = null; // clear 'once' alarms
                    note.notified = false;
                }
            }

            // Task Reminders
            if (note.tasks) {
                note.tasks.forEach(task => {
                    if (task.alarm && !task.notified && isAlarmTriggered(task.alarm, now)) {
                        changed = true;
                        triggerSystemNotification(note.title || 'Task Reminder', task.text);
                        if (task.alarm.type !== 'once') {
                            task.alarm.lastNotified = getTodayDateStr();
                            task.notified = false;
                        } else {
                            task.alarm = null; // clear 'once' alarms
                            task.notified = false;
                        }
                    }
                });
            }
        });

        if (changed) {
            saveState();
            renderSidebar();
            renderBentoGrid();
        }
    }, 15000); // check every 15s
}

function triggerSystemNotification(title, body) {
    // 1. In-app notification center fallback
    pushNotification('todo-reminder', `${title}: ${body}`.trim());

    // 2. Native OS Notification
    if (window.app && window.app.notify) {
        window.app.notify(title, body);
    } else if (Notification.permission === 'granted') {
        new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, { body });
            }
        });
    }
}
