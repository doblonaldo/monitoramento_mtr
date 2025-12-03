// -----------------------------------------------------------------------------
// |                            server.js                                      |
// |      Backend com monitoramento agendado, detecção de mudanças e API.      |
// |      Versão: SQLite + Prisma                                              |
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
const HOSTS_FILE = path.join(__dirname, 'hosts.txt');
const LOGS_FILE = path.join(__dirname, 'system_logs.json'); // Mantendo logs de sistema em arquivo por enquanto

// --- Helper de Logs do Sistema (Login/Logout/Ações Admin) ---
async function logSystemAction(username, action, details = '') {
    const logEntry = {
        timestamp: new Date().toISOString(),
        username,
        action,
        details
    };

    let logs = [];
    try {
        if (fs.existsSync(LOGS_FILE)) {
            const data = fs.readFileSync(LOGS_FILE, 'utf8');
            logs = JSON.parse(data);
        }
    } catch (err) {
        console.error('Erro ao ler logs de sistema:', err);
    }

    logs.unshift(logEntry);
    if (logs.length > 1000) logs = logs.slice(0, 1000);

    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
        console.error('Erro ao salvar log de sistema:', err);
    }
}

// --- Carregar Variáveis de Ambiente ---
const envPath = path.join(__dirname, '.env');

try {
    if (fs.existsSync(envPath)) {
        require('dotenv').config();
    } else {
        console.log('[ENV] Arquivo .env não encontrado. Gerando um novo...');
        const defaultEnv = `JWT_SECRET=${crypto.randomBytes(64).toString('hex')}\nEDITOR_TOKEN=${crypto.randomBytes(16).toString('hex')}\nPORT=3000\nDATABASE_URL="file:./dev.db"\n`;
        fs.writeFileSync(envPath, defaultEnv);
        require('dotenv').config();
    }
} catch (error) {
    console.error('[ENV] Erro ao carregar .env:', error);
}

if (!process.env.JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET não definido no arquivo .env.');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const EDITOR_TOKEN = process.env.EDITOR_TOKEN;
const LOGIN_ICON = process.env.LOGIN_ICON;

// --- Rate Limiter ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// --- Inicialização do Banco de Dados ---
async function initializeDatabase() {
    try {
        // Garantir Categoria "Geral"
        const geralCategory = await prisma.category.findUnique({ where: { name: 'Geral' } });
        if (!geralCategory) {
            await prisma.category.create({ data: { name: 'Geral' } });
            console.log('[DB] Categoria "Geral" criada.');
        }

        // Garantir Admin Padrão
        const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
        if (!adminUser) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await prisma.user.create({
                data: {
                    username: 'admin',
                    password: hashedPassword,
                    role: 'admin',
                    status: 'active'
                }
            });
            console.log('[DB] Usuário admin padrão criado (admin/admin123).');
        }

        console.log('[DB] Banco de dados inicializado.');
    } catch (error) {
        console.error('[DB] Erro ao inicializar banco de dados:', error);
    }
}

// --- Importação de Hosts ---
async function importHostsFromFile() {
    try {
        await fs.promises.access(HOSTS_FILE);
        const data = await fs.promises.readFile(HOSTS_FILE, 'utf-8');
        const lines = data.split('\n').map(l => l.trim()).filter(l => l);
        let newHostsCount = 0;

        // Garantir que a categoria Geral existe (já feito no init, mas por segurança)
        let geralCategory = await prisma.category.findUnique({ where: { name: 'Geral' } });
        if (!geralCategory) {
            geralCategory = await prisma.category.create({ data: { name: 'Geral' } });
        }

        for (const line of lines) {
            // Formatos suportados:
            // 1. IP
            // 2. IP, Titulo
            // 3. IP, Titulo, Categoria
            // 4. destino: IP, title: Titulo, category: Categoria (Legado)

            let destino = null;
            let title = null;
            let categoryName = 'Geral';

            if (line.includes('destino:')) {
                // Formato Legado
                const destinoMatch = line.match(/destino:\s*(\S+)/);
                if (destinoMatch) {
                    destino = destinoMatch[1].trim().replace(/,$/, '');
                    const titleMatch = line.match(/title:\s*([^,]+)/);
                    const categoryMatch = line.match(/category:\s*(.+)/);
                    if (titleMatch) title = titleMatch[1].trim();
                    if (categoryMatch) categoryName = categoryMatch[1].trim();
                }
            } else {
                // Formato Novo (CSV simples)
                const parts = line.split(',').map(p => p.trim());
                destino = parts[0];
                if (parts.length > 1) title = parts[1];
                if (parts.length > 2) categoryName = parts[2];
            }

            if (!destino) continue;
            if (!title) title = destino;

            // Verificar/Criar Categoria
            let category = await prisma.category.findUnique({ where: { name: categoryName } });
            if (!category) {
                category = await prisma.category.create({ data: { name: categoryName } });
                console.log(`[Import] Categoria criada: ${categoryName}`);
            }

            // Verificar/Criar Host
            const existingHost = await prisma.host.findUnique({ where: { destination: destino } });
            if (!existingHost) {
                await prisma.host.create({
                    data: {
                        destination: destino,
                        title: title,
                        categoryId: category.id,
                        status: 'pending'
                    }
                });
                console.log(`[Import] Host importado: ${destino}`);
                newHostsCount++;
                // Iniciar verificação imediata
                checkHost(destino);
            }
        }

        if (newHostsCount > 0) {
            console.log(`[Import] ${newHostsCount} novos hosts importados.`);
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[Import] Arquivo "${HOSTS_FILE}" não encontrado. Pulando importação.`);
        } else {
            console.error('[Import] Erro ao importar hosts:', error);
        }
    }
}

// --- Monitoramento ---
const MONITORING_INTERVAL = 30 * 1000;
let lastCheckTimestamp = null;

function executeMtr(host) {
    return new Promise((resolve, reject) => {
        if (!/^[a-zA-Z0-9.-:]+$/.test(host)) {
            return reject(new Error(`Host inválido: '${host}'.`));
        }
        const command = `mtr -r -n -c 3 -4 -z ${host}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve({ error: `Falha ao testar o host ${host}: ${stderr}` });
                return;
            }
            const lines = stdout.trim().split('\n');
            const headerLine = lines.find(line => line.includes('Loss%'));

            let routeOnly = stdout; // Fallback

            if (headerLine) {
                const lossIndex = headerLine.indexOf('Loss%');
                // Extrair apenas a parte do host/IP para detecção de mudança de rota
                const formattedLines = lines.slice(1).map(line => line.substring(0, lossIndex).trimEnd());
                routeOnly = formattedLines.join('\n');
            }

            // Retornar tanto a rota limpa quanto o output completo para extração de métricas
            resolve({ route: routeOnly, raw: stdout });
        });
    });
}

async function checkHost(hostDestino) {
    const host = await prisma.host.findUnique({
        where: { destination: hostDestino },
        include: { logs: { orderBy: { timestamp: 'desc' }, take: 1 } }
    });

    if (!host) return;

    const newMtrResult = await executeMtr(hostDestino).catch(err => ({ error: err.message }));
    let outputText = '';
    let rawOutput = '';
    let isError = false;

    if (newMtrResult.error) {
        console.error(`[Monitor] Erro em ${hostDestino}:`, newMtrResult.error);
        outputText = `Erro: ${newMtrResult.error}`;
        isError = true;
    } else {
        console.log(`[Monitor] Sucesso em ${hostDestino}.`);
        outputText = newMtrResult.route;
        rawOutput = newMtrResult.raw;

        // --- Extrair Métricas (Loss% e Avg Latency) ---
        try {
            const lines = rawOutput.trim().split('\n');
            // Encontrar a linha do destino (última linha válida)
            // MTR output example:
            // Host              Loss%   Snt   Last   Avg  Best  Wrst StDev
            // 1. 192.168.1.1     0.0%     3    1.2   1.1   1.0   1.2   0.1
            // ...
            // N. 8.8.8.8         0.0%     3   14.2  14.5  14.2  14.9   0.3

            if (lines.length > 1) {
                const lastLine = lines[lines.length - 1];
                const parts = lastLine.trim().split(/\s+/);

                // Assumindo formato padrão do MTR (Loss% é a 2ª coluna, Avg é a 5ª)
                // parts[0] = Host (pode ter espaço? Geralmente é ID. Hostname)
                // Se tiver ID (1.), o host é parts[1].
                // Vamos tentar achar a coluna com %

                const lossPart = parts.find(p => p.includes('%'));
                let lossValue = null;
                let avgValue = null;

                if (lossPart) {
                    lossValue = parseFloat(lossPart.replace('%', ''));
                    const lossIndex = parts.indexOf(lossPart);
                    // Avg geralmente é LossIndex + 3 (Snt, Last, Avg)
                    if (parts.length > lossIndex + 3) {
                        avgValue = parseFloat(parts[lossIndex + 3]);
                    }
                }

                if (lossValue !== null || avgValue !== null) {
                    await prisma.metric.create({
                        data: {
                            hostId: host.id,
                            latency: avgValue,
                            packetLoss: lossValue
                        }
                    });
                }
            }
        } catch (e) {
            console.error(`[Monitor] Erro ao extrair métricas de ${hostDestino}:`, e);
        }
    }

    // Atualizar Status do Host
    let newStatus = isError ? 'failing' : 'ok';
    if (isError && host.status === 'failing') {
        // Mantendo status failing
    }

    // Verificar Mudança
    const lastLog = host.logs[0];
    let isChange = false;

    if (!lastLog) {
        isChange = true; // Primeiro log
    } else if (lastLog.output !== outputText) {
        isChange = true; // Mudou a saída
    }

    if (isChange) {
        console.log(`[Monitor] Mudança detectada em ${hostDestino}`);
        await prisma.monitoringLog.create({
            data: {
                hostId: host.id,
                output: outputText,
                isChange: true
            }
        });
    }

    await prisma.host.update({
        where: { id: host.id },
        data: { status: newStatus }
    });
}

function startMonitoring() {
    console.log(`[Monitor] Iniciando ciclo a cada ${MONITORING_INTERVAL / 1000}s.`);
    setInterval(async () => {
        console.log('[Monitor] Ciclo de verificação...');
        const hosts = await prisma.host.findMany();
        if (hosts.length === 0) {
            lastCheckTimestamp = new Date().toISOString();
            return;
        }

        for (const host of hosts) {
            await checkHost(host.destination);
        }
        lastCheckTimestamp = new Date().toISOString();
        console.log('[Monitor] Ciclo concluído.');
    }, MONITORING_INTERVAL);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Middleware Auth ---
// --- Middleware Auth ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.sendStatus(403);

        try {
            // Validar contra o banco de dados para garantir status e role atuais
            const user = await prisma.user.findUnique({ where: { username: decoded.username } });

            if (!user) return res.sendStatus(403); // Usuário não existe mais
            if (user.status !== 'active') return res.sendStatus(403); // Usuário inativo

            // Se o token tiver role, verificar se ainda bate com o banco
            if (decoded.role && decoded.role !== user.role) return res.sendStatus(403); // Role mudou

            req.user = user;
            next();
        } catch (e) {
            console.error('Erro na validação de token:', e);
            res.sendStatus(500);
        }
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }
        next();
    };
};

// --- Rotas API ---

// Login
app.post('/api/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });

        if (await bcrypt.compare(password, user.password)) {
            if (user.status !== 'active') return res.status(403).json({ message: 'Conta inativa.' });

            const accessToken = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
            logSystemAction(user.username, 'Login', 'Login realizado.');
            res.json({ accessToken, role: user.role, username: user.username });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (e) {
        res.status(500).send();
    }
});

// Logout
app.post('/api/logout', authenticateToken, (req, res) => {
    logSystemAction(req.user.username, 'Logout', 'Logout realizado.');
    res.json({ message: 'Logout registrado.' });
});

// --- Rotas de Usuários (Admin) ---

// Listar Usuários
app.get('/api/users', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { username: true, role: true, status: true, createdAt: true }
        });
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: 'Erro ao listar usuários.' });
    }
});

// Convidar Usuário
app.post('/api/users/invite', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { email, role } = req.body; // Frontend envia 'email' como username para convite
    const username = email;

    if (!username) return res.status(400).json({ message: 'Username/Email obrigatório.' });

    try {
        const existingUser = await prisma.user.findUnique({ where: { username } });
        if (existingUser) return res.status(409).json({ message: 'Usuário já existe.' });

        // Criar usuário com senha temporária ou aleatória (bloqueada) e status pendente
        const tempPassword = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                role: role || 'viewer',
                status: 'pending'
            }
        });

        // Gerar token de setup
        const setupToken = jwt.sign({ username, action: 'setup' }, JWT_SECRET, { expiresIn: '24h' });
        const setupLink = `${req.protocol}://${req.get('host')}/setup-password.html?token=${setupToken}`;

        logSystemAction(req.user.username, 'Convidar Usuário', `Usuário: ${username}`);
        res.status(201).json({ message: 'Usuário convidado.', link: setupLink });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Erro ao convidar usuário.' });
    }
});

// Editar Usuário
app.put('/api/users/:username', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const usernameParam = req.params.username;
    const { role, password } = req.body;

    try {
        const data = {};
        if (role) data.role = role;
        if (password) data.password = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { username: usernameParam },
            data
        });

        logSystemAction(req.user.username, 'Editar Usuário', `Usuário: ${usernameParam}`);
        res.json({ message: 'Usuário atualizado.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao atualizar usuário.' });
    }
});

// Remover Usuário
app.delete('/api/users/:username', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const usernameParam = req.params.username;
    if (usernameParam === 'admin') return res.status(403).json({ message: 'Não pode remover o admin principal.' });

    try {
        await prisma.user.delete({ where: { username: usernameParam } });
        logSystemAction(req.user.username, 'Remover Usuário', `Usuário: ${usernameParam}`);
        res.json({ message: 'Usuário removido.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao remover usuário.' });
    }
});

// Gerar Link de Reset
app.post('/api/users/:username/reset-link', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const usernameParam = req.params.username;

    try {
        const user = await prisma.user.findUnique({ where: { username: usernameParam } });
        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

        const resetToken = jwt.sign({ username: usernameParam, action: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${resetToken}`;

        logSystemAction(req.user.username, 'Gerar Reset Link', `Usuário: ${usernameParam}`);
        res.json({ link: resetLink });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao gerar link.' });
    }
});

// --- Rotas de Auth (Publicas com Token) ---

// Setup Senha
app.post('/api/auth/setup-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Dados incompletos.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.action !== 'setup') return res.status(403).json({ message: 'Token inválido para esta ação.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { username: decoded.username },
            data: { password: hashedPassword, status: 'active' }
        });

        res.json({ message: 'Senha definida com sucesso. Faça login.' });
    } catch (e) {
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
});

// Reset Senha
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Dados incompletos.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.action !== 'reset') return res.status(403).json({ message: 'Token inválido para esta ação.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { username: decoded.username },
            data: { password: hashedPassword }
        });

        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (e) {
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
});

// --- Rotas de Logs (Admin) ---

app.get('/api/logs', authenticateToken, authorizeRole(['admin']), (req, res) => {
    try {
        if (fs.existsSync(LOGS_FILE)) {
            const data = fs.readFileSync(LOGS_FILE, 'utf8');
            const logs = JSON.parse(data);
            res.json(logs);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ message: 'Erro ao ler logs.' });
    }
});

// Hosts (Listar)
app.get('/api/hosts', async (req, res) => {
    const hosts = await prisma.host.findMany({
        include: { category: true }
    });
    const formatted = hosts.map(h => ({
        destino: h.destination,
        title: h.title || h.destination,
        category: h.category.name,
        status: h.status
    }));
    res.json(formatted);
});

// Hosts (Detalhe)
app.get('/api/hosts/:host', async (req, res) => {
    const hostDest = req.params.host;
    const host = await prisma.host.findUnique({
        where: { destination: hostDest },
        include: {
            category: true,
            logs: { orderBy: { timestamp: 'desc' }, take: 20 } // Retorna últimos 20 logs
        }
    });

    if (host) {
        // Formatar para manter compatibilidade com frontend se possível
        // O frontend espera: { lastMtr: string, history: [], status: string }
        // Vamos adaptar
        const lastLog = host.logs[0];
        res.json({
            destino: host.destination,
            title: host.title,
            category: host.category.name,
            status: host.status,
            lastMtr: lastLog ? lastLog.output : null,
            history: host.logs.map(l => ({
                timestamp: l.timestamp,
                mtrLog: l.output
            }))
        });
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

// Metrics (Histórico)
app.get('/api/hosts/:host/metrics', async (req, res) => {
    const hostDest = req.params.host;
    const host = await prisma.host.findUnique({
        where: { destination: hostDest },
        include: {
            metrics: {
                orderBy: { timestamp: 'desc' },
                take: 60 // Últimos 60 pontos (aprox 30 min se a cada 30s)
            }
        }
    });

    if (host) {
        // Retornar em ordem cronológica para o gráfico
        res.json(host.metrics.reverse());
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

// Categorias
app.get('/api/categories', async (req, res) => {
    const categories = await prisma.category.findMany();
    res.json(categories.map(c => c.name));
});

// Adicionar Host
app.post('/api/hosts', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const { title, destino, category } = req.body;
    const categoryName = category || 'Geral';

    if (!destino) return res.status(400).json({ message: 'Destino obrigatório.' });

    try {
        let cat = await prisma.category.findUnique({ where: { name: categoryName } });
        if (!cat) {
            cat = await prisma.category.create({ data: { name: categoryName } });
        }

        const newHost = await prisma.host.create({
            data: {
                destination: destino,
                title: title || destino,
                categoryId: cat.id
            }
        });

        logSystemAction(req.user.username, 'Adicionar Host', `Host: ${destino}`);
        checkHost(destino); // Check inicial
        res.status(201).json(newHost);
    } catch (e) {
        if (e.code === 'P2002') { // Unique constraint
            return res.status(409).json({ message: 'Host já existe.' });
        }
        res.status(500).json({ message: 'Erro ao criar host.' });
    }
});

// Remover Host
app.delete('/api/hosts/:host', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const hostDest = req.params.host;
    try {
        await prisma.host.delete({ where: { destination: hostDest } });
        logSystemAction(req.user.username, 'Remover Host', `Host: ${hostDest}`);
        res.json({ message: 'Host removido.' });
    } catch (e) {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

// Adicionar Categoria
app.post('/api/categories', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Nome inválido.' });

    try {
        await prisma.category.create({ data: { name: name } });
        logSystemAction(req.user.username, 'Adicionar Categoria', `Categoria: ${name}`);
        res.status(201).json({ message: 'Categoria criada.' });
    } catch (e) {
        res.status(409).json({ message: 'Categoria já existe.' });
    }
});

// Remover Categoria
app.delete('/api/categories/:category', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const catName = decodeURIComponent(req.params.category);
    if (catName === 'Geral') return res.status(400).json({ message: 'Não pode remover Geral.' });

    try {
        const cat = await prisma.category.findUnique({ where: { name: catName } });
        if (!cat) return res.status(404).json({ message: 'Categoria não encontrada.' });

        // Mover hosts para Geral
        const geral = await prisma.category.findUnique({ where: { name: 'Geral' } });
        await prisma.host.updateMany({
            where: { categoryId: cat.id },
            data: { categoryId: geral.id }
        });

        await prisma.category.delete({ where: { id: cat.id } });
        logSystemAction(req.user.username, 'Remover Categoria', `Categoria: ${catName}`);
        res.json({ message: 'Categoria removida.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao remover categoria.' });
    }
});

// Status
app.get('/api/status', (req, res) => {
    res.json({ lastCheck: lastCheckTimestamp });
});

// Config Publica
app.get('/api/public-config', (req, res) => {
    const iconUrl = LOGIN_ICON ? '/api/logo' : null;
    res.json({ loginIcon: iconUrl });
});

// Logo
app.get('/api/logo', (req, res) => {
    if (!LOGIN_ICON) return res.status(404).send('Logo not configured');
    if (LOGIN_ICON.startsWith('http')) return res.redirect(LOGIN_ICON);

    let iconPath = LOGIN_ICON;
    if (!path.isAbsolute(iconPath)) iconPath = path.join(__dirname, iconPath);

    if (fs.existsSync(iconPath)) res.sendFile(iconPath);
    else res.status(404).send('Not found');
});

// Frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/edit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    await initializeDatabase();
    await importHostsFromFile();
    startMonitoring();
});
