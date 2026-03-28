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

export function fmtTypeLabel(type) {
    return type === 'servicedesk' ? 'Service Desk' : 'Jira';
}

export function padTicket(ticket) {
    const target = 11;
    if (ticket.length < target) return ticket + ' '.repeat(target - ticket.length);
    return ticket;
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
