export function initRipple() {
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('button, .btn');
        if (!btn) return;

        if (btn.classList.contains('btn-close') ||
            btn.classList.contains('day-toggle-btn') ||
            btn.classList.contains('day-quick-view-btn') ||
            btn.classList.contains('search-adv-btn') ||
            btn.classList.contains('copy-to-prev-week') ||
            btn.classList.contains('copy-to-next-week') ||
            btn.classList.contains('entry-btn-star')) {
            return;
        }

        btn.classList.add('btn-ripple');
        const rect = btn.getBoundingClientRect();

        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        if (e.clientX === 0 && e.clientY === 0) {
            x = rect.width / 2;
            y = rect.height / 2;
        }

        btn.style.setProperty('--x', `${x}px`);
        btn.style.setProperty('--y', `${y}px`);

        btn.classList.remove('ripple-active');
        void btn.offsetWidth;
        btn.classList.add('ripple-active');
    });
}
