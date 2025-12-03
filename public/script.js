document.addEventListener('DOMContentLoaded', () => {
    const dashboard = document.getElementById('dashboard');
    const charts = {};
    const API_URL = '/api';

    const accessToken = localStorage.getItem('accessToken');
    const userRole = localStorage.getItem('userRole');
    const username = localStorage.getItem('username');

    if (!accessToken) {
        window.location.href = '/login.html';
        return;
    }

    const isEditor = userRole === 'editor' || userRole === 'admin';
    const isAdmin = userRole === 'admin';

    // Auth Header Helper
    const authHeaders = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const authHeadersGet = { 'Authorization': `Bearer ${accessToken}` };

    // Helper para Fetch Seguro (Redireciona para login se 401/403)
    async function safeFetch(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (response.status === 401 || response.status === 403) {
                console.warn('Sessão expirada ou inválida. Redirecionando para login...');
                localStorage.clear();
                window.location.href = '/login.html';
                return null; // Interrompe o fluxo
            }
            return response;
        } catch (error) {
            console.error('Erro de rede:', error);
            throw error;
        }
    }

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

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await safeFetch('/api/logout', { method: 'POST', headers: authHeadersGet });
        } catch (e) {
            console.error('Erro ao registrar logout:', e);
        }
        localStorage.clear();
        window.location.href = '/login.html';
    });

    if (isAdmin) {
        const manageUsersBtn = document.getElementById('manage-users-btn');
        manageUsersBtn.style.display = 'block';

        // Add "Ver Logs" button to sidebar
        const viewLogsBtn = document.createElement('button');
        viewLogsBtn.id = 'view-logs-btn';
        viewLogsBtn.className = 'sidebar-btn secondary-btn'; // Use classes
        viewLogsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Logs do Sistema
        `;
        sidebarEditorActions.appendChild(viewLogsBtn);

        const { modal, form, closeModal } = setupModal('manage-users-modal', 'manage-users-btn', 'invite-user-form');
        const { modal: editModal, form: editForm, closeModal: closeEditModal } = setupModal('edit-user-modal', null, 'edit-user-form');
        const { modal: logsModal, closeModal: closeLogsModal } = setupModal('system-logs-modal', 'view-logs-btn', null);

        const userListBody = document.getElementById('user-list-body');
        const logsListBody = document.getElementById('logs-list-body');

        manageUsersBtn.addEventListener('click', async () => {
            modal.classList.add('visible');
            await loadUsers();
        });

        viewLogsBtn.addEventListener('click', async () => {
            logsModal.classList.add('visible');
            await loadLogs();
        });

        document.getElementById('refresh-logs-btn').addEventListener('click', async () => {
            await loadLogs();
        });

        async function loadLogs() {
            try {
                const res = await safeFetch(`${API_URL}/logs`, { headers: authHeadersGet });
                if (!res) return;
                if (!res.ok) throw new Error('Falha ao carregar logs');
                const logs = await res.json();

                logsListBody.innerHTML = logs.map(log => `
                    <tr>
                        <td>${new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                        <td>${log.username}</td>
                        <td>${log.action}</td>
                        <td>${log.details}</td>
                    </tr>
                `).join('');
            } catch (e) {
                console.error(e);
                logsListBody.innerHTML = '<tr><td colspan="4">Erro ao carregar logs.</td></tr>';
            }
        }

        async function loadUsers() {
            try {
                const res = await safeFetch(`${API_URL}/users`, { headers: authHeadersGet });
                if (!res) return;
                if (!res.ok) throw new Error('Falha ao carregar usuários');
                const users = await res.json();

                userListBody.innerHTML = users.map(u => `
                    <tr>
                        <td>${u.email || u.username}</td>
                        <td>${u.role}</td>
                        <td>${u.status === 'pending' ? '<span style="color: orange;">Pendente</span>' : '<span style="color: green;">Ativo</span>'}</td>
                        <td class="user-actions">
                            <button class="edit-user-btn" data-username="${u.username}" data-role="${u.role}">Editar</button>
                            ${u.username !== 'admin' ? `<button class="delete-user-btn" data-username="${u.username}">Excluir</button>` : ''}
                            <button class="reset-password-btn" style="background-color: #f39c12; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-left: 5px;" data-username="${u.username}">Gerar Link Senha</button>
                        </td>
                    </tr>
                `).join('');

                window.generateResetLink = async (username) => {
                    if (!confirm(`Gerar link de redefinição de senha para ${username}?`)) return;

                    try {
                        const token = localStorage.getItem('accessToken');
                        const res = await safeFetch(`/api/users/${username}/reset-link`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (!res) return;
                        const data = await res.json();

                        if (res.ok) {
                            showLinkModal('Link de Redefinição', data.link);
                        } else {
                            alert(data.message);
                        }
                    } catch (error) {
                        console.error('Erro:', error);
                        alert('Erro ao gerar link.');
                    }
                };

                // Attach event listeners
                document.querySelectorAll('.delete-user-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm(`Remover usuário ${e.target.dataset.username}?`)) {
                            await deleteUser(e.target.dataset.username);
                        }
                    });
                });

                document.querySelectorAll('.edit-user-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        openEditUserModal(e.target.dataset.username, e.target.dataset.role);
                    });
                });

                document.querySelectorAll('.reset-password-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        window.generateResetLink(e.target.dataset.username);
                    });
                });

            } catch (e) { console.error(e); }
        }

        function openEditUserModal(username, role) {
            document.getElementById('edit-user-username-hidden').value = username;
            document.getElementById('edit-user-display-name').textContent = username;
            document.getElementById('edit-user-role').value = role;
            document.getElementById('edit-user-password').value = ''; // Clear password
            editModal.classList.add('visible');
        }

        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('edit-user-username-hidden').value;
            const password = document.getElementById('edit-user-password').value;
            const role = document.getElementById('edit-user-role').value;

            const body = { role };
            if (password) body.password = password;

            try {
                const res = await safeFetch(`${API_URL}/users/${username}`, {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify(body)
                });
                if (!res) return;
                if (res.ok) {
                    closeEditModal();
                    loadUsers();
                } else {
                    const data = await res.json();
                    alert(data.message || 'Erro ao atualizar usuário');
                }
            } catch (e) { alert('Erro ao atualizar usuário'); }
        });

        async function deleteUser(username) {
            try {
                const res = await safeFetch(`${API_URL}/users/${username}`, { method: 'DELETE', headers: authHeadersGet });
                if (!res) return;
                if (res.ok) loadUsers();
                else alert('Erro ao remover usuário');
            } catch (e) { alert('Erro ao remover usuário'); }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('invite-user-email').value;
            const role = document.getElementById('invite-user-role').value;

            try {
                const res = await safeFetch(`${API_URL}/users/invite`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify({ email, role })
                });
                if (!res) return;
                const data = await res.json();

                if (res.ok) {
                    form.reset();

                    if (data.link) {
                        showLinkModal('Convite Gerado', data.link);
                    } else {
                        alert(data.message);
                    }

                    modal.classList.remove('visible');
                    loadUsers();
                } else {
                    alert(data.message);
                }
            } catch (e) { alert('Erro ao enviar convite'); }
        });
    }

    async function loadCategories() {
        try {
            const response = await safeFetch(`${API_URL}/categories`, { headers: authHeadersGet });
            if (!response) return;
            if (!response.ok) throw new Error('Falha ao carregar categorias.');
            const categories = await response.json();

            categoryList.innerHTML = ''; // Limpa a lista
            // Adiciona o item "Todos"
            const allItem = createCategoryItem('Todos');
            allItem.classList.add('active');
            categoryList.appendChild(allItem);

            // Adiciona outras categorias
            categories.forEach(cat => categoryList.appendChild(createCategoryItem(cat)));

            if (isEditor) {
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

        if (isEditor && categoryName !== 'Geral' && categoryName !== 'Todos') {
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
                    const response = await safeFetch(`${API_URL}/categories/${categoryToRemove}`, { method: 'DELETE', headers: authHeadersGet });
                    if (!response) return;
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

        hostsToRender.forEach(hostInfo => createHostCard(hostInfo));
        updateAllTimelines();
    }

    // --- FIM DA ALTERAÇÃO: Lógica da Sidebar e Categorias ---


    // ALTERAÇÃO: A função agora recebe um objeto {destino, title, category}
    function createHostCard(hostData) {
        const destino = hostData.destino;
        if (!destino) return null; // Prevent crash if destino is missing
        const cardId = `card-${destino.replace(/[.:]/g, '-')}`;
        if (document.getElementById(cardId)) return;

        const { title, category } = hostData;
        const card = document.createElement('div');
        card.className = 'host-card';
        card.id = cardId;
        card.dataset.host = destino;
        card.dataset.category = category; // Armazena a categoria no card

        const removeButtonHTML = isEditor ? `<button class="remove-host-btn" title="Remover host">&times;</button>` : '';

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
            const response = await safeFetch(`${API_URL}/hosts/${hostDestino}`, { headers: authHeadersGet });
            if (!response) return;
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

                // Fetch Metrics for Chart
                let metricsUrl = `${API_URL}/hosts/${hostDestino}/metrics`;
                if (startDate && endDate) {
                    metricsUrl += `?start=${startDate.toISOString()}&end=${endDate.toISOString()}`;
                }

                const metricsRes = await safeFetch(metricsUrl, { headers: authHeadersGet });
                if (metricsRes && metricsRes.ok) {
                    const metrics = await metricsRes.json();
                    if (charts[hostDestino]) {
                        const chart = charts[hostDestino];

                        // Determinar formato da data
                        const diffHours = startDate && endDate ? (endDate - startDate) / (1000 * 60 * 60) : 0;
                        const isLongRange = diffHours > 24;

                        const labels = metrics.map(m => {
                            const date = new Date(m.timestamp);
                            if (isLongRange) {
                                return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                            }
                            return date.toLocaleTimeString('pt-BR');
                        });

                        const latencyData = metrics.map(m => m.latency);

                        chart.data.labels = labels;
                        chart.data.datasets[0].data = latencyData;

                        // Mostrar Eixo X sempre para ver os horários
                        chart.options.scales.x.display = true;

                        chart.update('quiet');
                    }
                }
            }
        } catch (error) {
            console.error(`Erro ao buscar dados para ${hostDestino}:`, error);
        }
    }

    // ALTERAÇÃO: Função agora busca todos os hosts e armazena em cache
    async function loadInitialHosts() {
        try {
            const response = await safeFetch(`${API_URL}/hosts`, { headers: authHeadersGet });
            if (!response) return;
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
            const response = await safeFetch(`${API_URL}/status`, { headers: authHeadersGet });
            if (!response) return;
            if (!response.ok) throw new Error('Falha ao buscar status.');
            const data = await response.json();
            statusText.textContent = data.lastCheck ? `Última verificação do servidor: ${new Date(data.lastCheck).toLocaleString('pt-BR')}` : 'Servidor online. Aguardando o primeiro ciclo de verificação.';
            if (isEditor) { statusText.textContent += ' | Modo de Edição Ativado'; }
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
        const form = formId ? document.getElementById(formId) : null;
        const openBtn = openBtnId ? document.getElementById(openBtnId) : null;

        if (openBtn) {
            openBtn.addEventListener('click', () => modal.classList.add('visible'));
        }

        const closeModal = () => modal.classList.remove('visible');
        modal.addEventListener('click', e => e.target === modal && closeModal());
        modal.querySelectorAll('.cancel-btn').forEach(btn => btn.addEventListener('click', closeModal));

        return { modal, form, closeModal };
    }

    // Modal de Adicionar Host
    if (isEditor) {
        const { modal, form, closeModal } = setupModal('add-host-modal', 'add-host-btn', 'add-host-form');
        const categorySelect = document.getElementById('new-host-category-select');

        document.getElementById('add-host-btn').addEventListener('click', async () => {
            // Preenche o select de categorias ao abrir o modal
            const res = await safeFetch(`${API_URL}/categories`, { headers: authHeadersGet });
            if (!res) return;
            const categories = await res.json();
            categorySelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
            modal.classList.add('visible');
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const newHostTitle = document.getElementById('new-host-title-input').value.trim();
            const newHostDestino = document.getElementById('new-host-input').value.trim();
            const newHostCategory = categorySelect.value;
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;

            if (newHostDestino) {
                try {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Adicionando...';

                    submitBtn.textContent = 'Adicionando...';

                    const response = await safeFetch(`${API_URL}/hosts`, {
                        method: 'POST',
                        headers: authHeaders,
                        body: JSON.stringify({ title: newHostTitle, destino: newHostDestino, category: newHostCategory })
                    });
                    if (!response) return;
                    const result = await response.json();

                    if (!response.ok) {
                        if (response.status === 409) {
                            throw new Error('Este host já está sendo monitorado.');
                        }
                        throw new Error(result.message);
                    }

                    alert('Host adicionado com sucesso!');
                    closeModal();
                    await refreshAllData();
                } catch (error) {
                    alert(`Erro: ${error.message}`);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
            }
        });
    } else {
        document.getElementById('add-host-btn').style.display = 'none';
    }

    // Modal de Adicionar Categoria
    if (isEditor) {
        const { form, closeModal } = setupModal('add-category-modal', 'add-category-btn', 'add-category-form');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const newCategoryName = document.getElementById('new-category-name-input').value.trim();
            if (newCategoryName) {
                try {
                    const response = await safeFetch(`${API_URL}/categories`, {
                        method: 'POST',
                        headers: authHeaders,
                        body: JSON.stringify({ name: newCategoryName })
                    });
                    if (!response) return;
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    closeModal();
                    await refreshAllData();
                } catch (error) { alert(`Erro: ${error.message}`); }
            }
        });
    }

    // --- FIM DA ALTERAÇÃO: Lógica dos Modais ---

    // --- Link Modal Logic ---
    const linkModal = document.getElementById('link-modal');
    const linkInput = document.getElementById('generated-link-input');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const linkModalTitle = document.getElementById('link-modal-title');

    function showLinkModal(title, link) {
        linkModalTitle.textContent = title;
        linkInput.value = link;
        linkModal.classList.add('visible');
    }

    if (linkModal) {
        const closeLinkModal = () => linkModal.classList.remove('visible');
        linkModal.querySelectorAll('.cancel-btn').forEach(btn => btn.addEventListener('click', closeLinkModal));
        linkModal.addEventListener('click', e => e.target === linkModal && closeLinkModal());

        copyLinkBtn.addEventListener('click', () => {
            linkInput.select();
            linkInput.setSelectionRange(0, 99999); // For mobile devices
            navigator.clipboard.writeText(linkInput.value).then(() => {
                const originalText = copyLinkBtn.innerHTML;
                copyLinkBtn.innerHTML = 'Copiado!';
                copyLinkBtn.style.backgroundColor = '#28a745';
                setTimeout(() => {
                    copyLinkBtn.innerHTML = originalText;
                    copyLinkBtn.style.backgroundColor = '';
                }, 2000);
            }).catch(err => {
                console.error('Erro ao copiar: ', err);
                alert('Erro ao copiar link. Por favor, copie manualmente.');
            });
        });
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
        } else if (target.classList.contains('live-btn')) {
            mtrOutputPre.textContent = hostCard.dataset.lastMtr || 'Carregando...';
            liveBtn.classList.add('active');
        } else if (target.classList.contains('remove-host-btn') && isEditor) {
            const hostToRemove = hostCard.dataset.host;
            if (confirm(`Tem certeza que deseja remover "${hostToRemove}"?`)) {
                try {
                    const response = await safeFetch(`${API_URL}/hosts/${hostToRemove}`, { method: 'DELETE', headers: authHeadersGet });
                    if (!response) return;
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    await refreshAllData(); // Recarrega para refletir a remoção
                } catch (error) { alert(`Erro: ${error.message}`); }
            }
        }
    });

    // Loop de dados aleatórios removido em favor de dados reais

    setInterval(() => {
        updateStatusFooter();
        updateAllTimelines();
    }, 60 * 1000);

    // Initial Load
    refreshAllData();
});