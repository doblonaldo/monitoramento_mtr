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


