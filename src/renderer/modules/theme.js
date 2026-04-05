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

    // Update theme buttons in Settings → Appearance if visible
    document.querySelectorAll('.settings-theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.selectTheme === theme);
    });
}
