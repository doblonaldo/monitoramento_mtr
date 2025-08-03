document.addEventListener('DOMContentLoaded', () => {
    const dashboard = document.getElementById('dashboard');
    const charts = {};
    const API_URL = '/api';

    const urlParams = new URLSearchParams(window.location.search);
    const editorToken = urlParams.get('editor_token');
    const isEditorMode = !!editorToken;

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

    // ALTERAÇÃO: A função agora recebe um objeto {destino, title}
    function renderHostCard(hostData) {
        const { destino, title } = hostData;
        const cardId = `card-${destino.replace(/[.:]/g, '-')}`;
        if (document.getElementById(cardId)) return;

        const card = document.createElement('div');
        card.className = 'host-card';
        card.id = cardId;
        // ALTERAÇÃO: O dataset armazena o 'destino' para referência interna
        card.dataset.host = destino;

        const removeButtonHTML = isEditorMode ? `<button class="remove-host-btn" title="Remover host">&times;</button>` : '';

        card.innerHTML = `
            <div class="host-header">
                <span>${title}</span>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <button class="live-btn active" title="Mostrar resultado mais recente">Live</button>
                    ${removeButtonHTML}
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
        createRealtimeChart(`chart-${cardId}`, destino); // O gráfico ainda usa o 'destino' como chave
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

    function createRealtimeChart(canvasId, hostDestino) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        charts[hostDestino] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(30).fill(''),
                datasets: [{
                    label: 'Latência (ms)',
                    data: Array(30).fill(null),
                    borderColor: 'var(--cor-grafico-linha)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: 'var(--cor-texto)' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    x: {
                        display: false
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false
                    }
                }
            }
        });
    }

    function parseLatencyFromMtr(mtrLog) {
        if (!mtrLog || typeof mtrLog !== 'string') return null;
        const lines = mtrLog.trim().split('\n');
        if (lines.length < 1) return null;
        const lastHopLine = lines[lines.length - 1];
        const parts = lastHopLine.trim().split(/\s+/);
        if (parts.length > 5) {
            const latency = parseFloat(parts[5]);
            return isNaN(latency) ? null : latency;
        }
        return null;
    }

    async function fetchHostData(hostDestino, startDate, endDate) {
        try {
            const response = await fetch(`${API_URL}/hosts/${hostDestino}`);
            if (!response.ok) throw new Error('Falha ao buscar dados do host.');
            const data = await response.json();

            const card = document.getElementById(`card-${hostDestino.replace(/[.:]/g, '-')}`);
            if (card) {
                card.dataset.lastMtr = data.lastMtr;
                const liveBtn = card.querySelector('.live-btn');
                if (liveBtn.classList.contains('active')) {
                    card.querySelector('.mtr-output pre code').textContent = data.lastMtr || 'Nenhum teste MTR executado ainda.';
                }
                updateTimeline(card, data.history || [], startDate, endDate);

                const currentChart = charts[hostDestino];
                if (currentChart && data.lastMtr) {
                    const latency = parseLatencyFromMtr(data.lastMtr);
                    card.dataset.lastAvgLatency = latency !== null ? latency : '';
                }
            }
        } catch (error) {
            console.error(`Erro ao buscar dados para ${hostDestino}:`, error);
        }
    }

    async function loadInitialHosts() {
        try {
            const response = await fetch(`${API_URL}/hosts`);
            if (!response.ok) throw new Error('Falha ao carregar hosts.');
            const hostsData = await response.json();
            dashboard.innerHTML = '';
            // ALTERAÇÃO: Itera sobre os objetos recebidos da API
            hostsData.forEach(hostInfo => renderHostCard(hostInfo));
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
            if (isEditorMode) {
                statusText.textContent += ' | Modo de Edição Ativado';
            }
        } catch (error) {
            statusText.textContent = 'Não foi possível conectar ao servidor de monitoramento.';
        }
    }

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
        if (startDatePicker.selectedDates.length === 0 || endDatePicker.selectedDates.length === 0) {
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
    if (isEditorMode) {
        const addHostModal = document.getElementById('add-host-modal');
        const addHostForm = document.getElementById('add-host-form');
        const closeModal = () => addHostModal.classList.remove('visible');

        addHostBtn.addEventListener('click', () => addHostModal.classList.add('visible'));
        document.getElementById('cancel-add-host').addEventListener('click', closeModal);
        addHostModal.addEventListener('click', e => e.target === addHostModal && closeModal());

        addHostForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            // ALTERAÇÃO: Pega os valores dos dois campos
            const newHostTitle = document.getElementById('new-host-title-input').value.trim();
            const newHostDestino = document.getElementById('new-host-input').value.trim();

            if (newHostDestino) {
                closeModal();
                try {
                    const response = await fetch(`${API_URL}/hosts?editor_token=${editorToken}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        // ALTERAÇÃO: Envia o objeto com título e destino
                        body: JSON.stringify({ title: newHostTitle, destino: newHostDestino })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    location.reload();
                } catch (error) {
                    alert(`Erro: ${error.message}`);
                }
            }
        });
    } else {
        addHostBtn.style.display = 'none';
    }

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

        if (target.classList.contains('remove-host-btn') && isEditorMode) {
            const hostToRemove = hostCard.dataset.host;
            if (confirm(`Tem certeza que deseja remover "${hostToRemove}"?`)) {
                try {
                    const response = await fetch(`${API_URL}/hosts/${hostToRemove}?editor_token=${editorToken}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    hostCard.remove();
                } catch (error) {
                    alert(`Erro: ${error.message}`);
                }
            }
        }
    });

    setInterval(() => {
        for (const [host, chart] of Object.entries(charts)) {
            const card = document.getElementById(`card-${host.replace(/[.:]/g, '-')}`);
            if (!card) continue;
            const lastAvgLatency = parseFloat(card.dataset.lastAvgLatency);
            let newValue = null;
            if (!isNaN(lastAvgLatency)) {
                const variation = (Math.random() - 0.5) * (lastAvgLatency * 0.1);
                newValue = Math.max(0, lastAvgLatency + variation);
            }
            const data = chart.data.datasets[0].data;
            data.shift();
            data.push(newValue);
            chart.update('quiet');
        }
    }, 2000);

    setInterval(() => {
        updateStatusFooter();
        updateAllTimelines();
    }, 60 * 1000);

    setTimeout(() => {
        loadInitialHosts();
        updateStatusFooter();
    }, 500);
});