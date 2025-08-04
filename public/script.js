document.addEventListener('DOMContentLoaded', () => {
    const dashboard = document.getElementById('dashboard');
    const charts = {};
    const API_URL = '/api';

    const urlParams = new URLSearchParams(window.location.search);
    const editorToken = urlParams.get('editor_token');
    const isEditorMode = !!editorToken;

    let allHostsData = []; // Cache para todos os hosts, para evitar fetches repetidos
    let currentCategory = 'Todos'; // Categoria selecionada atualmente

    const startDatePicker = flatpickr("#start-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true });
    const endDatePicker = flatpickr("#end-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true });
    
    // --- INÍCIO DA ALTERAÇÃO: Lógica da Sidebar e Categorias ---

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const categoryList = document.getElementById('category-list');
    const sidebarEditorActions = document.getElementById('sidebar-editor-actions');

    sidebarToggle.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
    });

    async function loadCategories() {
        try {
            const response = await fetch(`${API_URL}/categories`);
            if (!response.ok) throw new Error('Falha ao carregar categorias.');
            const categories = await response.json();

            categoryList.innerHTML = ''; // Limpa a lista
            // Adiciona o item "Todos"
            const allItem = createCategoryItem('Todos');
            allItem.classList.add('active');
            categoryList.appendChild(allItem);

            // Adiciona outras categorias
            categories.forEach(cat => categoryList.appendChild(createCategoryItem(cat)));

            if (isEditorMode) {
                sidebarEditorActions.style.display = 'block';
            }
        } catch (error) {
            console.error(error);
        }
    }

    function createCategoryItem(categoryName) {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.dataset.category = categoryName;
        item.textContent = categoryName;

        if (isEditorMode && categoryName !== 'Geral' && categoryName !== 'Todos') {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-category-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = `Remover categoria "${categoryName}"`;
            item.appendChild(removeBtn);
        }

        return item;
    }
    
    categoryList.addEventListener('click', async (event) => {
        const target = event.target;
        
        if (target.classList.contains('remove-category-btn')) {
            event.stopPropagation(); // Impede que o clique ative a filtragem
            const categoryItem = target.closest('.category-item');
            const categoryToRemove = categoryItem.dataset.category;
            if (confirm(`Tem certeza que deseja remover a categoria "${categoryToRemove}"?\nTodos os hosts nesta categoria serão movidos para "Geral".`)) {
                try {
                    const response = await fetch(`${API_URL}/categories/${categoryToRemove}?editor_token=${editorToken}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    await refreshAllData();
                } catch (error) {
                    alert(`Erro: ${error.message}`);
                }
            }
            return;
        }

        const categoryItem = target.closest('.category-item');
        if (categoryItem) {
            document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
            categoryItem.classList.add('active');
            currentCategory = categoryItem.dataset.category;
            filterAndRenderHosts();
        }
    });

    function filterAndRenderHosts() {
        dashboard.innerHTML = ''; // Limpa o dashboard antes de renderizar
        const hostsToRender = currentCategory === 'Todos' 
            ? allHostsData 
            : allHostsData.filter(host => host.category === currentCategory);
        
        hostsToRender.forEach(hostInfo => renderHostCard(hostInfo));
        updateAllTimelines();
    }
    
    // --- FIM DA ALTERAÇÃO: Lógica da Sidebar e Categorias ---


    // ALTERAÇÃO: A função agora recebe um objeto {destino, title, category}
    function renderHostCard(hostData) {
        const { destino, title, category } = hostData;
        const cardId = `card-${destino.replace(/[.:]/g, '-')}`;
        if (document.getElementById(cardId)) return;

        const card = document.createElement('div');
        card.className = 'host-card';
        card.id = cardId;
        card.dataset.host = destino;
        card.dataset.category = category; // Armazena a categoria no card

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
        createRealtimeChart(`chart-${cardId}`, destino);
    }

    function updateTimeline(hostCard, history, startDate, endDate) {
        const timelineBar = hostCard.querySelector('.timeline-bar');
        const startLabel = hostCard.querySelector('.start-label');
        const endLabel = hostCard.querySelector('.end-label');
        timelineBar.innerHTML = '';

        if (!startDate || !endDate) return;

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
            data: { labels: Array(30).fill(''), datasets: [{ label: 'Latência (ms)', data: Array(30).fill(null), borderColor: 'var(--cor-grafico-linha)', borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: 'var(--cor-texto)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
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
                if (charts[hostDestino] && data.lastMtr) {
                    const latency = parseLatencyFromMtr(data.lastMtr);
                    card.dataset.lastAvgLatency = latency !== null ? latency : '';
                }
            }
        } catch (error) {
            console.error(`Erro ao buscar dados para ${hostDestino}:`, error);
        }
    }

    // ALTERAÇÃO: Função agora busca todos os hosts e armazena em cache
    async function loadInitialHosts() {
        try {
            const response = await fetch(`${API_URL}/hosts`);
            if (!response.ok) throw new Error('Falha ao carregar hosts.');
            allHostsData = await response.json();
            filterAndRenderHosts();
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
            statusText.textContent = data.lastCheck ? `Última verificação do servidor: ${new Date(data.lastCheck).toLocaleString('pt-BR')}` : 'Servidor online. Aguardando o primeiro ciclo de verificação.';
            if (isEditorMode) { statusText.textContent += ' | Modo de Edição Ativado'; }
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
            if (!startDate || !endDate) return;
        }

        document.querySelectorAll('.host-card:not(.hidden)').forEach(card => {
            fetchHostData(card.dataset.host, startDate, endDate);
        });
    }

    controlButtons.forEach(button => {
        button.addEventListener('click', () => {
            controlButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            startDatePicker.clear(); endDatePicker.clear();
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

    async function refreshAllData() {
        refreshBtn.classList.add('loading');
        await loadCategories();
        await loadInitialHosts();
        await updateStatusFooter();
        setTimeout(() => refreshBtn.classList.remove('loading'), 500);
    }
    refreshBtn.addEventListener('click', refreshAllData);
    
    // --- INÍCIO DA ALTERAÇÃO: Lógica dos Modais de Adição ---

    // Função genérica para controlar modais
    function setupModal(modalId, openBtnId, formId) {
        const modal = document.getElementById(modalId);
        const form = document.getElementById(formId);
        const openBtn = document.getElementById(openBtnId);

        if (openBtn) {
            openBtn.addEventListener('click', () => modal.classList.add('visible'));
        }

        const closeModal = () => modal.classList.remove('visible');
        modal.addEventListener('click', e => e.target === modal && closeModal());
        modal.querySelectorAll('.cancel-btn').forEach(btn => btn.addEventListener('click', closeModal));

        return { modal, form, closeModal };
    }

    // Modal de Adicionar Host
    if (isEditorMode) {
        const { modal, form, closeModal } = setupModal('add-host-modal', 'add-host-btn', 'add-host-form');
        const categorySelect = document.getElementById('new-host-category-select');

        document.getElementById('add-host-btn').addEventListener('click', async () => {
            // Preenche o select de categorias ao abrir o modal
            const res = await fetch(`${API_URL}/categories`);
            const categories = await res.json();
            categorySelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
            modal.classList.add('visible');
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const newHostTitle = document.getElementById('new-host-title-input').value.trim();
            const newHostDestino = document.getElementById('new-host-input').value.trim();
            const newHostCategory = categorySelect.value;

            if (newHostDestino) {
                try {
                    const response = await fetch(`${API_URL}/hosts?editor_token=${editorToken}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: newHostTitle, destino: newHostDestino, category: newHostCategory })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    closeModal();
                    await refreshAllData();
                } catch (error) { alert(`Erro: ${error.message}`); }
            }
        });
    } else {
        document.getElementById('add-host-btn').style.display = 'none';
    }

    // Modal de Adicionar Categoria
    if (isEditorMode) {
        const { form, closeModal } = setupModal('add-category-modal', 'add-category-btn', 'add-category-form');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const newCategoryName = document.getElementById('new-category-name-input').value.trim();
            if (newCategoryName) {
                try {
                    const response = await fetch(`${API_URL}/categories?editor_token=${editorToken}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newCategoryName })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    closeModal();
                    await refreshAllData();
                } catch (error) { alert(`Erro: ${error.message}`); }
            }
        });
    }

    // --- FIM DA ALTERAÇÃO: Lógica dos Modais ---

    dashboard.addEventListener('click', async (event) => {
        const target = event.target;
        const hostCard = target.closest('.host-card');
        if (!hostCard) return;

        const mtrOutputPre = hostCard.querySelector('.mtr-output pre code');
        const liveBtn = hostCard.querySelector('.live-btn');

        if (target.classList.contains('timeline-marker')) {
            mtrOutputPre.textContent = target.dataset.mtr;
            liveBtn.classList.remove('active');
        } else if (target.classList.contains('live-btn')) {
            mtrOutputPre.textContent = hostCard.dataset.lastMtr || 'Carregando...';
            liveBtn.classList.add('active');
        } else if (target.classList.contains('remove-host-btn') && isEditorMode) {
            const hostToRemove = hostCard.dataset.host;
            if (confirm(`Tem certeza que deseja remover "${hostToRemove}"?`)) {
                try {
                    const response = await fetch(`${API_URL}/hosts/${hostToRemove}?editor_token=${editorToken}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    await refreshAllData(); // Recarrega para refletir a remoção
                } catch (error) { alert(`Erro: ${error.message}`); }
            }
        }
    });

    setInterval(() => {
        for (const [host, chart] of Object.entries(charts)) {
            const card = document.getElementById(`card-${host.replace(/[.:]/g, '-')}`);
            if (!card || card.classList.contains('hidden')) continue;
            const lastAvgLatency = parseFloat(card.dataset.lastAvgLatency);
            let newValue = null;
            if (!isNaN(lastAvgLatency)) {
                const variation = (Math.random() - 0.5) * (lastAvgLatency * 0.1);
                newValue = Math.max(0, lastAvgLatency + variation);
            }
            chart.data.datasets[0].data.shift();
            chart.data.datasets[0].data.push(newValue);
            chart.update('quiet');
        }
    }, 2000);

    setInterval(() => {
        updateStatusFooter();
        updateAllTimelines();
    }, 60 * 1000);

    // Initial Load
    refreshAllData();
});