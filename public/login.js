document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg'); // Re-added errorMsg for consistency and the final catch block

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (res.ok) {
            localStorage.setItem('accessToken', data.accessToken);
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('username', data.username);
            window.location.href = '/index.html'; // Changed from '/' to '/index.html' as per new code
        } else {
            errorMsg.textContent = data.message || 'Login falhou'; // Changed alert to errorMsg
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('Erro no login:', error);
        errorMsg.textContent = 'Erro ao conectar ao servidor.'; // Changed alert to errorMsg
        errorMsg.style.display = 'block';
    }
});

const forgotPasswordLink = document.getElementById('forgot-password-link');
const forgotPasswordModal = document.getElementById('forgot-password-modal');
const forgotPasswordForm = document.getElementById('forgot-password-form');
const cancelBtn = forgotPasswordModal.querySelector('.cancel-btn');

if (forgotPasswordLink && forgotPasswordModal) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        forgotPasswordModal.classList.add('visible');
    });

    const closeModal = () => forgotPasswordModal.classList.remove('visible');
    cancelBtn.addEventListener('click', closeModal);
    forgotPasswordModal.addEventListener('click', (e) => {
        if (e.target === forgotPasswordModal) closeModal();
    });

    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        if (email) {
            try {
                const res = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (res.ok) {
                    closeModal();
                    if (data.preview) {
                        alert(`Email enviado! (Modo Teste)\nLink: ${data.preview}`);
                        window.open(data.preview, '_blank');
                    } else {
                        alert(data.message);
                    }
                } else {
                    alert(data.message);
                }
            } catch (error) {
                alert('Erro ao solicitar recuperação de senha.');
            }
        }
    });
}
