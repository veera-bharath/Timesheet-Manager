export function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function fmtDate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function fmtDisplayDate(yyyymmdd) {
    const d = new Date(yyyymmdd + 'T00:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

export function minsToHHMM(totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtHHMM(hh, mm) {
    return `${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`;
}

export function fmtSearchDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// Parse a freeform time string → { hh, mm } or null
// Supported: "2:30", "2h 30m", "2h30m", "90m", "1.5h", "2h", "30m", "30", "2"
// Maximum: 24:00 (1440 minutes total)
export function parseTimeInput(str) {
    if (!str) return null;
    const s = str.trim();
    if (!s) return null;

    let m;
    const cap = (hh, mm) => (hh * 60 + mm <= 1440) ? { hh, mm } : null;

    // H:MM or HH:MM
    m = s.match(/^(\d{1,3}):(\d{2})$/);
    if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (mm > 59) return null;
        return cap(hh, mm);
    }

    // XhYm or Xh Ym (e.g. 2h30m, 2h 30m)
    m = s.match(/^(\d+)\s*h\s*(\d+)\s*m$/i);
    if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (mm > 59) return null;
        return cap(hh, mm);
    }

    // X.Yh decimal hours — must come before plain Xh (e.g. 1.5h)
    m = s.match(/^(\d+\.\d+)\s*h$/i);
    if (m) {
        const totalMins = Math.round(parseFloat(m[1]) * 60);
        return cap(Math.floor(totalMins / 60), totalMins % 60);
    }

    // Xh (e.g. 2h)
    m = s.match(/^(\d+)\s*h$/i);
    if (m) return cap(parseInt(m[1], 10), 0);

    // Xm — total minutes (e.g. 90m → 1h 30m)
    m = s.match(/^(\d+)\s*m$/i);
    if (m) {
        const totalMins = parseInt(m[1], 10);
        return cap(Math.floor(totalMins / 60), totalMins % 60);
    }

    // Bare integer: < 24 → treat as hours, >= 24 → treat as total minutes
    m = s.match(/^(\d+)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n < 24) return cap(n, 0);
        return cap(Math.floor(n / 60), n % 60);
    }

    return null;
}

// Returns a human-readable error string for an invalid time input, or null if valid.
// maxMins: optional upper bound (default 1440 = 24h). Pass 840 for daily-target fields.
export function timeInputError(str, maxMins = 1440) {
    if (!str || !str.trim()) return null; // empty is handled separately
    const s = str.trim();
    const parsed = parseTimeInput(s);

    if (parsed) {
        // Parsed OK against the 24h cap — now check the caller's cap
        const total = parsed.hh * 60 + parsed.mm;
        if (total > maxMins) {
            const h = Math.floor(maxMins / 60);
            const m = maxMins % 60;
            return `Maximum is ${m ? `${h}h ${m}m` : `${h}h`} (e.g. 8h, 2:30, 90m)`;
        }
        return null;
    }

    // parseTimeInput returned null — either unrecognised format or > 24h
    const looksLikeTime = /^(\d+):(\d{2})$/.test(s)
        || /^(\d+)\s*h\s*(\d+)\s*m$/i.test(s)
        || /^(\d+\.\d+)\s*h$/i.test(s)
        || /^(\d+)\s*h$/i.test(s)
        || /^(\d+)\s*m$/i.test(s)
        || /^\d+$/.test(s);
    if (looksLikeTime) {
        const h = Math.floor(maxMins / 60);
        const m = maxMins % 60;
        return `Maximum is ${m ? `${h}h ${m}m` : `${h}h`} (e.g. 8h, 2:30, 90m)`;
    }
    return 'Use a format like 2:30, 2h 30m, 90m, or 1.5h';
}

// Format hh + mm → "H:MM" for display in the freeform time field
export function fmtTimeInput(hh, mm) {
    return `${parseInt(hh) || 0}:${String(parseInt(mm) || 0).padStart(2, '0')}`;
}

export function padTicket(ticket) {
    const target = 11;
    if (ticket.length < target) return ticket + ' '.repeat(target - ticket.length);
    return ticket;
}

export function debounce(fn, delay) {
    let timer;
    function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    }
    debounced.flush = function (...args) {
        clearTimeout(timer);
        fn.apply(this, args);
    };
    return debounced;
}

export function animateCountUp(el, targetVal, isTimeFormat = false) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = isTimeFormat ? minsToHHMM(targetVal) : targetVal;
        el.dataset.val = targetVal;
        return;
    }

    const startVal = parseInt(el.dataset.val || '0', 10);
    if (startVal === targetVal) {
        el.textContent = isTimeFormat ? minsToHHMM(targetVal) : targetVal;
        return;
    }

    if (el._animFrame) cancelAnimationFrame(el._animFrame);

    const duration = 500;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        let progress = Math.min(elapsed / duration, 1);
        progress = 1 - Math.pow(1 - progress, 4);

        const current = Math.floor(startVal + (targetVal - startVal) * progress);
        el.textContent = isTimeFormat ? minsToHHMM(current) : current;

        if (progress < 1) {
            el._animFrame = requestAnimationFrame(step);
        } else {
            el.textContent = isTimeFormat ? minsToHHMM(targetVal) : targetVal;
            el.dataset.val = targetVal;
        }
    }
    el._animFrame = requestAnimationFrame(step);
}
