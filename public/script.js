document.addEventListener('DOMContentLoaded', () => {
    const dashboard = document.getElementById('dashboard');
    const charts = {};
    const API_URL = '/api'; // Usa um caminho relativo que funciona com localhost e IP

    // --- Inicialização do Calendário ---
    const startDatePicker = flatpickr("#start-date", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
    });
    const endDatePicker = flatpickr("#end-date", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
    });

    // --- Funções de Renderização e UI ---
    function renderHostCard(host) {
        const cardId = `card-${host.replace(/\./g, '-')}`;
        if (document.getElementById(cardId)) return;

        const card = document.createElement('div');
        card.className = 'host-card';
        card.id = cardId;
        card.dataset.host = host;

        card.innerHTML = `
            <div class="host-header">
                <span>Destino: ${host}</span>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <button class="live-btn active" title="Mostrar resultado mais recente">Live</button>
                    <button class="remove-host-btn" title="Remover host">&times;</button>
                </div>
            </div>
            <div class="chart-container"><canvas id="chart-${cardId}"></canvas></div>
            <div class="mtr-output"><pre><code>Carregando...</code></pre></div>
            <div class="timeline">
                <div class="timeline-bar-container">
                    <div class="timeline-bar"></div>
                </div>
                <div class="timeline-labels">
                    <span class="start-label"></span>
                    <span class="end-label"></span>
                </div>
            </div>
        `;
        dashboard.appendChild(card);
        createRealtimeChart(`chart-${cardId}`, host);
    }
    
    function updateTimeline(hostCard, history, startDate, endDate) {
        const timelineBar = hostCard.querySelector('.timeline-bar');
        const startLabel = hostCard.querySelector('.start-label');
        const endLabel = hostCard.querySelector('.end-label');
        timelineBar.innerHTML = '';

        const startMs = startDate.getTime();
        const endMs = endDate.getTime();
        const totalDurationMs = endMs - startMs;

        startLabel.textContent = startDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        endLabel.textContent = endDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        history.forEach(change => {
            const eventMs = new Date(change.timestamp).getTime();
            if (eventMs >= startMs && eventMs <= endMs) {
                const positionPercent = totalDurationMs > 0 ? ((eventMs - startMs) / totalDurationMs) * 100 : 50;
                const marker = document.createElement('div');
                marker.className = 'timeline-marker';
                marker.style.left = `${positionPercent}%`;
                marker.title = `Mudança em ${new Date(change.timestamp).toLocaleString()}`;
                marker.dataset.mtr = change.mtrLog;
                timelineBar.appendChild(marker);
            }
        });
    }
    
    function createRealtimeChart(canvasId, host) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        charts[host] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(30).fill(''),
                datasets: [{ data: Array(30).fill(null), borderColor: 'var(--cor-grafico-linha)', borderWidth: 2, pointRadius: 0, tension: 0.4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, x: { display: false } }, plugins: { legend: { display: false } } }
        });
    }

    // --- Funções de API ---
    async function fetchHostData(host, startDate, endDate) {
        try {
            const response = await fetch(`${API_URL}/hosts/${host}`);
            if (!response.ok) throw new Error('Falha ao buscar dados do host.');
            const data = await response.json();
            
            const card = document.getElementById(`card-${host.replace(/\./g, '-')}`);
            if (card) {
                card.dataset.lastMtr = data.lastMtr;
                const liveBtn = card.querySelector('.live-btn');
                if (liveBtn.classList.contains('active')) {
                    card.querySelector('.mtr-output pre code').textContent = data.lastMtr || 'Nenhum teste MTR executado ainda.';
                }
                updateTimeline(card, data.history || [], startDate, endDate);
            }
        } catch (error) {
            console.error(`Erro ao buscar dados para ${host}:`, error);
        }
    }

    async function loadInitialHosts() {
        try {
            const response = await fetch(`${API_URL}/hosts`);
            if (!response.ok) throw new Error('Falha ao carregar hosts.');
            const hosts = await response.json();
            dashboard.innerHTML = '';
            hosts.forEach(host => renderHostCard(host));
            updateAllTimelines(); 
        } catch (error) {
            console.error('Erro ao carregar hosts:', error);
            dashboard.innerHTML = `<p style="color: var(--cor-remover);">${error.message}. Verifique se o backend está rodando.</p>`;
        }
    }
    
    async function updateStatusFooter() {
        const statusText = document.getElementById('status-text');
        try {
            const response = await fetch(`${API_URL}/status`);
            if (!response.ok) throw new Error('Falha ao buscar status.');
            const data = await response.json();
            if (data.lastCheck) {
                const lastCheckDate = new Date(data.lastCheck);
                statusText.textContent = `Última verificação do servidor: ${lastCheckDate.toLocaleString('pt-BR')}`;
            } else {
                statusText.textContent = 'Servidor online. Aguardando o primeiro ciclo de verificação.';
            }
        } catch (error) {
            statusText.textContent = 'Não foi possível conectar ao servidor de monitoramento.';
        }
    }

    // --- Lógica de Eventos ---
    const controlButtons = document.querySelectorAll('.control-btn');
    const filterBtn = document.getElementById('filter-btn');
    const refreshBtn = document.getElementById('refresh-btn');

    function updateAllTimelines() {
        const activeBtn = document.querySelector('.control-btn.active');
        let startDate, endDate = new Date();

        if (activeBtn) {
            const rangeInHours = parseInt(activeBtn.dataset.range, 10);
            startDate = new Date(endDate.getTime() - rangeInHours * 3600 * 1000);
        } else { 
            startDate = startDatePicker.selectedDates[0];
            endDate = endDatePicker.selectedDates[0];
            if (!startDate || !endDate) {
                alert("Por favor, selecione uma data de início e fim válidas.");
                return;
            }
        }

        document.querySelectorAll('.host-card').forEach(card => {
            fetchHostData(card.dataset.host, startDate, endDate);
        });
    }

    controlButtons.forEach(button => {
        button.addEventListener('click', () => {
            controlButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            startDatePicker.clear();
            endDatePicker.clear();
            updateAllTimelines();
        });
    });

    filterBtn.addEventListener('click', () => {
        if(startDatePicker.selectedDates.length === 0 || endDatePicker.selectedDates.length === 0){
            alert("Por favor, selecione uma data de início e fim.");
            return;
        }
        controlButtons.forEach(btn => btn.classList.remove('active'));
        updateAllTimelines();
    });

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('loading');
        await loadInitialHosts();
        await updateStatusFooter();
        setTimeout(() => refreshBtn.classList.remove('loading'), 500);
    });

    const addHostBtn = document.getElementById('add-host-btn');
    const addHostModal = document.getElementById('add-host-modal');
    const addHostForm = document.getElementById('add-host-form');
    const closeModal = () => addHostModal.classList.remove('visible');
    addHostBtn.addEventListener('click', () => addHostModal.classList.add('visible'));
    document.getElementById('cancel-add-host').addEventListener('click', closeModal);
    addHostModal.addEventListener('click', e => e.target === addHostModal && closeModal());

    addHostForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const newHost = document.getElementById('new-host-input').value.trim();
        if (newHost) {
            closeModal();
            try {
                const response = await fetch(`${API_URL}/hosts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host: newHost })
                });
                if (!response.ok) throw new Error((await response.json()).message);
                location.reload();
            } catch (error) { 
                alert(error.message);
            }
        }
    });

    dashboard.addEventListener('click', async (event) => {
        const target = event.target;
        const hostCard = target.closest('.host-card');
        if (!hostCard) return;

        const mtrOutputPre = hostCard.querySelector('.mtr-output pre code');
        const liveBtn = hostCard.querySelector('.live-btn');

        if (target.classList.contains('timeline-marker')) {
            mtrOutputPre.textContent = target.dataset.mtr;
            liveBtn.classList.remove('active');
        }

        if (target.classList.contains('live-btn')) {
            mtrOutputPre.textContent = hostCard.dataset.lastMtr || 'Carregando...';
            liveBtn.classList.add('active');
        }
        
        if (target.classList.contains('remove-host-btn')) {
            const hostToRemove = hostCard.dataset.host;
            if (confirm(`Tem certeza que deseja remover "${hostToRemove}"?`)) {
                await fetch(`${API_URL}/hosts/${hostToRemove}`, { method: 'DELETE' });
                hostCard.remove();
            }
        }
    });
    
    // Simulação de atualização de latência (gráfico)
    setInterval(() => {
        Object.values(charts).forEach(chart => {
            chart.data.datasets[0].data.shift();
            chart.data.datasets[0].data.push(Math.random() * 10);
            chart.update('quiet');
        });
    }, 2000);
    
    // Atualiza o rodapé e os dados a cada minuto
    setInterval(() => {
        updateStatusFooter();
        updateAllTimelines();
    }, 60 * 1000);

    // Adiciona um pequeno atraso antes de carregar os dados iniciais
    setTimeout(() => {
        loadInitialHosts();
        updateStatusFooter();
    }, 500);
});