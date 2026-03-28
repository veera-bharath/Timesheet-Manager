export function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let themeToApply = 'dark';
    if (savedTheme) {
        themeToApply = savedTheme;
    } else if (!systemPrefersDark) {
        themeToApply = 'light';
    }

    applyTheme(themeToApply);

    const toggleBtn = document.getElementById('btn-theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

export function applyTheme(theme) {
    document.documentElement.classList.add('theme-transition');
    document.documentElement.setAttribute('data-theme', theme);
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 400);
    const icon = document.getElementById('theme-icon');
    const toggleBtn = document.getElementById('btn-theme-toggle');

    if (theme === 'light') {
        if (icon) {
            icon.classList.remove('bi-moon-fill', 'bi-moon');
            icon.classList.add('bi-sun-fill');
        }
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Switch to Dark Mode';
        }
    } else {
        if (icon) {
            icon.classList.remove('bi-sun-fill', 'bi-sun');
            icon.classList.add('bi-moon-fill');
        }
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Switch to Light Mode';
        }
    }
}
