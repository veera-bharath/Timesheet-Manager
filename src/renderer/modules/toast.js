import { escHtml } from './utils.js';

let confirmModal;

export function showConfirm(message, onYes) {
    if (!confirmModal) confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    document.getElementById('confirm-modal-message').textContent = message;
    const yesBtn = document.getElementById('btn-confirm-yes');
    const noBtn = document.getElementById('btn-confirm-no');
    const cleanup = () => { yesBtn.onclick = null; noBtn.onclick = null; };
    yesBtn.onclick = () => { confirmModal.hide(); cleanup(); onYes(); };
    noBtn.onclick = () => { confirmModal.hide(); cleanup(); };
    confirmModal.show();
}

export function showToast(msg, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-' + Date.now();
    const colors = { success: '#22d3a0', danger: '#f87171', info: '#818cf8' };
    const icons = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
    container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast toast-custom show align-items-center" role="alert" style="min-width:220px">
      <div class="d-flex align-items-center gap-2 px-3 py-2">
        <i class="bi ${icons[type] || icons.info}" style="color:${colors[type] || colors.info}"></i>
        <span style="font-size:0.85rem">${msg}</span>
        <button type="button" class="btn-close btn-close-white ms-auto" style="font-size:0.6rem" onclick="(function(el){el.classList.add('toast-hiding');setTimeout(()=>el.remove(),200);})(document.getElementById('${id}'))"></button>
      </div>
    </div>`);
    setTimeout(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('toast-hiding');
        setTimeout(() => el.remove(), 200);
    }, 3000);
}
