document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');

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
            window.location.href = '/index.html';
        } else {
            errorMsg.textContent = data.message || 'Login falhou';
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('Erro no login:', error);
        errorMsg.textContent = 'Erro ao conectar ao servidor.';
        errorMsg.style.display = 'block';
    }
});


