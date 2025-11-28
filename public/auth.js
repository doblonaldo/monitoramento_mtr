document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        alert('Token inválido ou ausente.');
        return;
    }

    const setupForm = document.getElementById('setup-password-form');
    const resetForm = document.getElementById('reset-password-form');

    const handlePasswordSubmit = async (e, endpoint) => {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (password !== confirmPassword) {
            alert('As senhas não coincidem.');
            return;
        }

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
            });
            const data = await res.json();

            if (res.ok) {
                alert(data.message);
                window.location.href = '/login.html';
            } else {
                alert(data.message);
            }
        } catch (error) {
            alert('Erro ao processar solicitação.');
        }
    };

    if (setupForm) {
        setupForm.addEventListener('submit', (e) => handlePasswordSubmit(e, '/api/auth/setup-password'));
    }

    if (resetForm) {
        resetForm.addEventListener('submit', (e) => handlePasswordSubmit(e, '/api/auth/reset-password'));
    }
});
