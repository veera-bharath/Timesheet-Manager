/* =============================================================
   NOTIFICATION CENTRE
   ============================================================= */

const STORAGE_KEY = 'tm_notifications';

let notifications = [];
let dropdownOpen = false;

const TYPE_META = {
    'no-ticket':        { icon: 'bi-exclamation-triangle-fill', color: 'var(--danger)'  },
    'underlogged':      { icon: 'bi-clock-history',             color: 'var(--warning)' },
    'unlogged-day':     { icon: 'bi-calendar-x',                color: 'var(--danger)'  },
    'high-hours':       { icon: 'bi-graph-up-arrow',            color: 'var(--warning)' },
    'underlogged-week': { icon: 'bi-hourglass-split',           color: 'var(--warning)' },
    'ticket-gap':       { icon: 'bi-ticket-perforated',         color: 'var(--text-secondary)' },
    'duplicate-entries':{ icon: 'bi-files',                     color: 'var(--text-secondary)' },
};

/* ── persistence ── */

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        notifications = raw ? JSON.parse(raw) : [];
    } catch { notifications = []; }
}

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
}

/* ── public API ── */

export function pushNotification(type, message) {
    load();
    const now = Date.now();
    const existing = notifications.find(n => n.type === type);
    if (existing) {
        if (existing.dismissedUntil && now < existing.dismissedUntil) return;
        existing.dismissedUntil = null;
        if (existing.message !== message) {
            existing.message = message;
            existing.timestamp = new Date().toISOString();
            existing.read = false;
            save();
            renderBadge();
        }
        return;
    }
    notifications.unshift({
        id: 'n-' + Date.now(),
        type,
        message,
        timestamp: new Date().toISOString(),
        read: false,
        dismissedUntil: null,
    });
    save();
    renderBadge();
}

/* ── init ── */

export function initNotifications() {
    load();
    renderBadge();

    const btn = document.getElementById('btn-notifications');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    document.addEventListener('click', (e) => {
        if (dropdownOpen && !document.getElementById('notif-dropdown')?.contains(e.target)) {
            closeDropdown();
        }
    });

    document.getElementById('btn-notif-clear-all')?.addEventListener('click', () => {
        notifications = [];
        save();
        renderBadge();
        renderList();
    });
}

/* ── badge ── */

function isDismissed(n) {
    return n.dismissedUntil && Date.now() < n.dismissedUntil;
}

function renderBadge() {
    const unread = notifications.filter(n => !n.read && !isDismissed(n)).length;
    const badge = document.getElementById('notif-badge');
    const btn   = document.getElementById('btn-notifications');
    if (badge) {
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.style.display = unread > 0 ? '' : 'none';
    }
    if (btn) btn.classList.toggle('notif-btn--active', unread > 0);
}

/* ── dropdown ── */

function toggleDropdown() {
    dropdownOpen ? closeDropdown() : openDropdown();
}

function openDropdown() {
    const btn = document.getElementById('btn-notifications');
    const dropdown = document.getElementById('notif-dropdown');
    if (!btn || !dropdown) return;

    const rect = btn.getBoundingClientRect();
    dropdown.style.top   = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.display = 'flex';
    dropdownOpen = true;

    // mark all as read
    notifications.forEach(n => { n.read = true; });
    save();
    renderBadge();
    renderList();
}

function closeDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    dropdownOpen = false;
}

/* ── list ── */

function renderList() {
    const list  = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (!list) return;

    const active = notifications.filter(n => !isDismissed(n));
    empty.style.display = active.length === 0 ? '' : 'none';
    list.innerHTML = '';

    active.forEach(n => {
        const typeKey = Object.keys(TYPE_META).find(k => n.type === k || n.type.startsWith(k + '-'));
        const meta = TYPE_META[typeKey] || { icon: 'bi-bell', color: 'var(--text-secondary)' };
        const time = formatTime(n.timestamp);
        const item = document.createElement('div');
        item.className = 'notif-item';
        item.innerHTML = `
            <i class="bi ${meta.icon} notif-item-icon" style="color:${meta.color}"></i>
            <div class="notif-item-body">
                <p class="notif-item-msg">${escHtml(n.message)}</p>
                <span class="notif-item-time">${time}</span>
            </div>
            <button class="notif-item-dismiss" data-id="${n.id}" title="Dismiss">
                <i class="bi bi-x"></i>
            </button>`;
        item.querySelector('.notif-item-dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            dismissOne(n.id);
        });
        list.appendChild(item);
    });
}

function dismissOne(id) {
    const n = notifications.find(n => n.id === id);
    if (!n) return;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    n.dismissedUntil = Date.now() + SEVEN_DAYS;
    save();
    renderBadge();
    renderList();
}

/* ── helpers ── */

function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1)  return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24)  return `${diffHrs}h ago`;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
