// -----------------------------------------------------------------------------
// |                            server.js                                      |
// |      Backend com monitoramento agendado, detecção de mudanças e API.      |
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit'); // Security: Rate Limiting
const crypto = require('crypto');
const express = require('express');

const app = express();
const port = 3000;

// Configurações
const DATA_FILE = path.join(__dirname, 'db.json'); // Renamed from DB_FILE
const HOSTS_FILE = path.join(__dirname, 'hosts.txt'); // Renamed from HOST_LIST_FILE
const LOGS_FILE = path.join(__dirname, 'system_logs.json');

// --- Helper de Logs ---
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
        console.error('Erro ao ler logs:', err);
    }

    logs.unshift(logEntry); // Adiciona no início
    if (logs.length > 1000) logs = logs.slice(0, 1000); // Mantém apenas os últimos 1000 logs

    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
        console.error('Erro ao salvar log:', err);
    }
}
// ---------------------

// --- Carregar Variáveis de Ambiente ---
// --- Carregar Variáveis de Ambiente ---
const envPath = path.join(__dirname, '.env');

try {
    if (fs.existsSync(envPath)) {
        require('dotenv').config();
    } else {
        console.log('[ENV] Arquivo .env não encontrado. Gerando um novo...');
        const defaultEnv = `JWT_SECRET=${crypto.randomBytes(64).toString('hex')}\nEDITOR_TOKEN=${crypto.randomBytes(16).toString('hex')}\nPORT=3000\n`;
        fs.writeFileSync(envPath, defaultEnv);
        require('dotenv').config();
    }
} catch (error) {
    console.error('[ENV] Erro ao carregar .env:', error);
}



if (!process.env.JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET não definido no arquivo .env. O servidor não pode iniciar de forma segura.');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const EDITOR_TOKEN = process.env.EDITOR_TOKEN;
const LOGIN_ICON = process.env.LOGIN_ICON;

// --- Rate Limiter Configuration ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// --- Configuração do Banco de Dados (JSON) ---
let db = {
    users: [],
    hosts: [],
    categories: []
};

// --- Funções Auxiliares ---
async function loadDatabase() {
    try {
        const data = await fs.promises.readFile(DATA_FILE, 'utf8');
        let parsedData = JSON.parse(data);

        // Ensure hosts is an array
        if (!parsedData.hosts || typeof parsedData.hosts === 'object' && !Array.isArray(parsedData.hosts)) {
            parsedData.hosts = Object.values(parsedData.hosts); // Convert old object format to array
        }
        if (!parsedData.categories || !Array.isArray(parsedData.categories)) {
            parsedData.categories = ['Geral'];
        } else if (!parsedData.categories.includes('Geral')) {
            parsedData.categories.unshift('Geral');
        }

        parsedData.hosts.forEach(host => {
            if (!host.category) {
                host.category = 'Geral';
            }
        });

        if (!parsedData.users || !Array.isArray(parsedData.users)) {
            parsedData.users = [];
        }

        // Create default admin if no users exist
        if (parsedData.users.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            parsedData.users.push({
                username: 'admin',
                password: hashedPassword, // Changed from passwordHash
                role: 'admin',
                status: 'active'
            });
            console.log('[DB] Usuário admin padrão criado (admin/admin123).');
            db = parsedData; // Assign before saving
            await saveDatabase(); // Save immediately
        } else {
            // Ensure existing users have a 'status' field and migrate passwordHash to password
            parsedData.users.forEach(user => {
                if (!user.status) user.status = 'active';
                if (user.passwordHash && !user.password) {
                    user.password = user.passwordHash;
                    delete user.passwordHash;
                }
            });
            await saveDatabase(); // Save migration changes
        }

        db = parsedData;
        console.log('[DB] Banco de dados carregado com sucesso.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[DB] Arquivo db.json não encontrado. Criando um novo com a categoria "Geral" e usuário admin.');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            db = {
                hosts: [],
                categories: ['Geral'],
                users: [{ username: 'admin', password: hashedPassword, role: 'admin', status: 'active' }]
            };
            await saveDatabase();
        } else {
            console.error('[DB] Erro ao carregar o banco de dados:', error);
        }
    }
}

async function saveDatabase() {
    try {
        db.categories = [...new Set(db.categories)];
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('[DB] Erro ao salvar o banco de dados:', error);
    }
}

const MONITORED_HOSTS_FILE = path.join(__dirname, 'monitored_hosts.txt');
const MONITORING_INTERVAL = 30 * 1000;

let lastCheckTimestamp = null;

app.use(cors());
app.use(express.json());

// --- Middleware de Autenticação ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
        }
        next();
    };
};

// Deprecated: requireEditorToken (kept for backward compatibility if needed, but we will switch to JWT)
const requireEditorToken = (req, res, next) => {
    // For now, we can just pass through or check for legacy token if we want to support both.
    // But the plan is to move to JWT. Let's redirect legacy usage to 403 or just remove it.
    // For this implementation, we will replace its usage with authenticateToken + authorizeRole.
    next();
};

// **CORREÇÃO PRINCIPAL**: Servir arquivos estáticos (CSS, JS do cliente) a partir da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));


// --- Funções do Banco de Dados --- (Moved to top)

async function saveHostList() {
    try {
        const hostLines = db.hosts.map(data => {
            let line = `destino: ${data.destino}`;
            if (data.title && data.title !== data.destino) {
                line = `title: ${data.title}, ${line}`;
            }
            if (data.category && data.category !== 'Geral') {
                line += `, category: ${data.category}`;
            }
            return line;
        });
        await fs.promises.writeFile(MONITORED_HOSTS_FILE, hostLines.join('\n'));
        console.log(`[File] Lista de hosts monitorados salva em ${MONITORED_HOSTS_FILE}`);
    } catch (error) {
        console.error('[File] Erro ao salvar a lista de hosts:', error);
    }
}

async function importHostsFromFile() {
    try {
        await fs.promises.access(HOSTS_FILE);
        const data = await fs.promises.readFile(HOSTS_FILE, 'utf-8');
        const lines = data.split('\n').map(l => l.trim()).filter(l => l);
        let newHostsAdded = false;

        for (const line of lines) {
            let title = null;
            let destino = null;
            let category = 'Geral';

            const destinoMatch = line.match(/destino:\s*(\S+)/);
            if (destinoMatch) {
                destino = destinoMatch[1].trim().replace(/,$/, '');
                const titleMatch = line.match(/title:\s*([^,]+)/);
                const categoryMatch = line.match(/category:\s*(.+)/);
                if (titleMatch) title = titleMatch[1].trim();
                if (categoryMatch) category = categoryMatch[1].trim();
            } else {
                destino = line;
            }

            if (destino && !db.hosts.some(h => h.destino === destino)) {
                console.log(`[Import] Host "${destino}" (Categoria: ${category}) do arquivo não está no DB. Adicionando...`);
                db.hosts.push({
                    destino: destino,
                    title: title || destino,
                    category: category,
                    lastMtr: null,
                    history: [],
                    status: 'ok'
                });
                if (!db.categories.includes(category)) {
                    db.categories.push(category);
                }
                checkHost(destino);
                newHostsAdded = true;
            }
        }

        if (newHostsAdded) {
            await saveDatabase();
            await saveHostList();
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[Import] Arquivo de importação "${HOSTS_FILE}" não encontrado. Pulando etapa.`);
        } else {
            console.error('[Import] Erro ao ler o arquivo de hosts:', error);
        }
    }
}


// --- Lógica de Monitoramento ---
function executeMtr(host) {
    return new Promise((resolve, reject) => {
        if (!/^[a-zA-Z0-9.-:]+$/.test(host)) {
            return reject(new Error(`Host inválido: '${host}'. Contém caracteres não permitidos.`));
        }
        const command = `mtr -r -n -c 3 -4 -z ${host}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve({ error: `Falha ao testar o host ${host}: ${stderr}` });
                return;
            }
            const lines = stdout.trim().split('\n');
            const headerLine = lines.find(line => line.includes('Loss%'));
            if (!headerLine) {
                resolve(stdout);
                return;
            }
            const lossIndex = headerLine.indexOf('Loss%');
            const formattedLines = lines.slice(1).map(line => line.substring(0, lossIndex).trimEnd());
            const finalOutput = formattedLines.join('\n');
            resolve(finalOutput);
        });
    });
}

async function checkHost(hostDestino) {
    const newMtrResult = await executeMtr(hostDestino).catch(err => ({ error: err.message }));
    const hostData = db.hosts.find(h => h.destino === hostDestino);
    if (!hostData) return;

    if (newMtrResult.error) {
        console.error(`[Monitor] Erro ao verificar ${hostDestino}:`, newMtrResult.error);
        if (hostData.status === 'failing') {
            console.log(`[Monitor] Host ${hostDestino} falhou pela segunda vez consecutiva. Marcando para remoção.`);
            hostData.toBeDeleted = true;
        } else {
            console.log(`[Monitor] Host ${hostDestino} falhou pela primeira vez. Marcando para observação.`);
            hostData.status = 'failing';
            hostData.lastMtr = `Host não encontrado ou inacessível.\nSerá removido automaticamente na próxima verificação se o erro persistir.`;
        }
        return;
    }

    console.log(`[Monitor] Verificação de ${hostDestino} bem-sucedida.`);
    hostData.status = 'ok';

    if (!hostData.lastMtr || hostData.lastMtr.startsWith('Host não encontrado')) {
        console.log(`[Monitor] Primeiro resultado válido para ${hostDestino}. Salvando como base.`);
        hostData.lastMtr = newMtrResult;
        hostData.history.push({
            timestamp: new Date().toISOString(),
            mtrLog: newMtrResult
        });
    } else if (hostData.lastMtr !== newMtrResult) {
        console.log(`[Monitor] MUDANÇA DETECTADA para ${hostDestino}!`);
        const changeEvent = {
            timestamp: new Date().toISOString(),
            mtrLog: newMtrResult
        };
        hostData.history.push(changeEvent);
        hostData.lastMtr = newMtrResult;
    } else {
        console.log(`[Monitor] Nenhuma mudança para ${hostDestino}.`);
    }
}

function startMonitoring() {
    console.log(`[Monitor] Iniciando ciclo de monitoramento a cada ${MONITORING_INTERVAL / 60000} minutos.`);
    setInterval(async () => {
        console.log('[Monitor] Executando ciclo de verificação...');
        const hostsToMonitor = db.hosts.map(h => h.destino);
        if (hostsToMonitor.length === 0) {
            lastCheckTimestamp = new Date().toISOString();
            return;
        }
        for (const host of hostsToMonitor) {
            await checkHost(host);
        }

        let hostsWereRemoved = false;
        const initialHostCount = db.hosts.length;
        db.hosts = db.hosts.filter(host => !host.toBeDeleted);
        if (db.hosts.length < initialHostCount) {
            hostsWereRemoved = true;
            console.log(`[Monitor] Hosts removidos automaticamente do banco de dados.`);
        }

        await saveDatabase();
        if (hostsWereRemoved) {
            await saveHostList();
        }

        lastCheckTimestamp = new Date().toISOString();
        console.log('[Monitor] Ciclo de verificação concluído.');
    }, MONITORING_INTERVAL);
}

// --- Rotas da API// 1. Login
app.post('/api/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ message: 'Usuário ou senha inválidos.' });
    }
    try {
        const storedPassword = user.password || user.passwordHash;
        if (user && await bcrypt.compare(password, storedPassword)) {
            if (user.status !== 'active') {
                return res.status(403).json({ message: 'Conta pendente ou inativa.' });
            }
            const accessToken = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });

            // Log Login
            logSystemAction(user.username, 'Login', 'Usuário realizou login.');

            res.json({ accessToken, role: user.role, username: user.username });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (e) {
        res.status(500).send();
    }
});

// --- Rota de Logout (Log) ---
app.post('/api/logout', authenticateToken, (req, res) => {
    logSystemAction(req.user.username, 'Logout', 'Usuário realizou logout.');
    res.json({ message: 'Logout registrado.' });
});

// --- Rota de Logs (Admin) ---
app.get('/api/logs', authenticateToken, authorizeRole(['admin']), (req, res) => {
    try {
        if (fs.existsSync(LOGS_FILE)) {
            const data = fs.readFileSync(LOGS_FILE, 'utf8');
            const logs = JSON.parse(data);
            res.json(logs);
        } else {
            res.json([]);
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro ao ler logs.' });
    }
});

// --- Rotas de Convite e Recuperação de Senha ---

// 1. Convidar Usuário (Admin)
app.post('/api/users/invite', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ message: 'Email e função são obrigatórios.' });

    // Check if user already exists (by username or email if we had it separately, but here we treat email as unique identifier for invite)
    // For simplicity, we'll check if any user has this email or username matching the email
    const existingUser = db.users.find(u => u.username === email || u.email === email);
    if (existingUser) return res.status(409).json({ message: 'Usuário já existe.' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpires = Date.now() + 3600000; // 1 hour

    const newUser = {
        username: email, // Initially username is email
        email: email,
        password: null, // No password yet (changed from passwordHash)
        role: role,
        inviteToken,
        inviteTokenExpires,
        status: 'pending'
    };

    db.users.push(newUser);
    await saveDatabase();

    // Log Invite User
    logSystemAction(req.user.username, 'Convidar Usuário', `Convidou usuário: ${email} (${role})`);

    // Send Email - REMOVED
    // Instead, return the link directly
    const inviteLink = `http://${req.headers.host}/setup-password.html?token=${inviteToken}`;
    console.log(`[Invite] Link generated for ${email}: ${inviteLink}`);

    res.json({
        message: 'Usuário convidado com sucesso. Copie o link abaixo e envie para o usuário:',
        link: inviteLink
    });
});

// 2. Definir Senha (Primeiro Acesso)
app.post('/api/auth/setup-password', authLimiter, async (req, res) => {
    const { token, password } = req.body;
    const user = db.users.find(u => u.inviteToken === token && u.inviteTokenExpires > Date.now());

    if (!user) return res.status(400).json({ message: 'Token inválido ou expirado.' });

    try {
        user.password = await bcrypt.hash(password, 10); // Changed from passwordHash
        user.inviteToken = undefined;
        user.inviteTokenExpires = undefined;
        user.status = 'active';
        await saveDatabase();
        res.json({ message: 'Senha definida com sucesso. Você pode fazer login agora.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao definir senha.' });
    }
});

// 3. Gerar Link de Reset (Admin Only)
app.post('/api/users/:username/reset-link', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username } = req.params;
    const user = db.users.find(u => u.username === username);

    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = Date.now() + 3600000; // 1 hour

    user.resetToken = resetToken;
    user.resetTokenExpires = resetTokenExpires;
    await saveDatabase();

    const resetLink = `http://${req.headers.host}/reset-password.html?token=${resetToken}`;

    console.log(`[Reset] Link generated for ${user.username}: ${resetLink}`);

    // Log Reset Link Generation
    logSystemAction(req.user.username, 'Gerar Link Reset', `Gerou link de reset para ${user.username}`);

    res.json({
        message: 'Link de redefinição gerado com sucesso.',
        link: resetLink
    });
});

// 4. Redefinir Senha (Com Token)
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
    const { token, password } = req.body;
    const user = db.users.find(u => u.resetToken === token && u.resetTokenExpires > Date.now());

    if (!user) return res.status(400).json({ message: 'Token inválido ou expirado.' });

    try {
        user.password = await bcrypt.hash(password, 10); // Changed from passwordHash
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;
        await saveDatabase();
        // Log Reset Password
        logSystemAction(user.username, 'Redefinir Senha', 'Usuário redefiniu a senha.');
        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao redefinir senha.' });
    }
});

app.get('/api/users', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const usersSafe = db.users.map(u => ({
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status || 'active'
    }));
    res.json(usersSafe);
});

app.post('/api/users', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: 'Dados incompletos.' });
    if (db.users.find(u => u.username === username)) return res.status(409).json({ message: 'Usuário já existe.' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.users.push({ username, password: hashedPassword, role, status: 'active' }); // Changed from passwordHash
        await saveDatabase();
        logSystemAction(req.user.username, 'Criar Usuário', `Criou usuário: ${username} (${role})`);
        res.status(201).json({ message: 'Usuário criado.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao criar usuário.' });
    }
});

app.put('/api/users/:username', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username } = req.params;
    const { password, role, status } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

    let changes = [];
    if (password) {
        user.password = await bcrypt.hash(password, 10); // Changed from passwordHash
        changes.push('senha');
    }
    if (role && user.role !== role) {
        user.role = role;
        changes.push(`função para ${role}`);
    }
    if (status && user.status !== status) {
        user.status = status;
        changes.push(`status para ${status}`);
    }
    await saveDatabase();
    logSystemAction(req.user.username, 'Atualizar Usuário', `Atualizou usuário: ${username}. Mudanças: ${changes.join(', ')}`);
    res.json({ message: 'Usuário atualizado.' });
});

app.delete('/api/users/:username', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username } = req.params;
    if (username === 'admin') return res.status(400).json({ message: 'Não é possível remover o admin padrão.' });

    const initialLength = db.users.length;
    db.users = db.users.filter(u => u.username !== username);

    if (db.users.length < initialLength) {
        await saveDatabase();
        logSystemAction(req.user.username, 'Remover Usuário', `Removeu usuário: ${username}`);
        res.json({ message: 'Usuário removido.' });
    } else {
        res.status(404).json({ message: 'Usuário não encontrado.' });
    }
});

app.get('/api/hosts', (req, res) => {
    const hostList = db.hosts.map(data => ({
        destino: data.destino,
        title: data.title || data.destino,
        category: data.category || 'Geral'
    }));
    res.status(200).json(hostList);
});

app.get('/api/categories', (req, res) => {
    res.status(200).json(db.categories || ['Geral']);
});

app.get('/api/hosts/:host', (req, res) => {
    const host = req.params.host;
    const hostData = db.hosts.find(h => h.destino === host);
    if (hostData) {
        res.status(200).json(hostData);
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

app.get('/api/status', (req, res) => {
    res.status(200).json({
        lastCheck: lastCheckTimestamp,
        editor_token: req.query.editor_token === EDITOR_TOKEN ? EDITOR_TOKEN : undefined
    });
});

app.get('/api/public-config', (req, res) => {
    res.json({ loginIcon: LOGIN_ICON });
});

app.post('/api/hosts', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const { title, destino, category } = req.body;
    const finalCategory = category || 'Geral';

    if (!destino) {
        return res.status(400).json({ message: 'O destino é obrigatório.' });
    }
    if (db.hosts.some(h => h.destino === destino)) {
        return res.status(409).json({ message: 'Este destino já está sendo monitorado.' });
    }
    if (!db.categories.includes(finalCategory)) {
        db.categories.push(finalCategory);
    }

    const newHost = {
        destino: destino,
        title: title || destino,
        category: finalCategory,
        lastMtr: null,
        history: [],
        status: 'ok'
    };
    console.log(`[API] Host adicionado: ${destino} (Categoria: ${finalCategory}). Verificação inicial em andamento...`);
    await checkHost(destino);
    db.hosts.push(newHost);
    await saveDatabase();

    // Log Add Host
    logSystemAction(req.user.username, 'Adicionar Host', `Adicionou host: ${destino} (${category})`);

    res.status(201).json(newHost);
});

app.post('/api/categories', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ message: 'O nome da categoria é inválido.' });
    }
    const categoryName = name.trim();
    if (db.categories.includes(categoryName)) {
        return res.status(409).json({ message: 'Esta categoria já existe.' });
    }
    db.categories.push(categoryName);
    await saveDatabase();

    // Log Add Category
    logSystemAction(req.user.username, 'Adicionar Categoria', `Adicionou categoria: ${categoryName}`);

    console.log(`[API] Categoria adicionada: ${categoryName}`);
    res.status(201).json({ message: `Categoria "${categoryName}" adicionada com sucesso.` });
});

app.delete('/api/hosts/:host', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const hostToRemove = req.params.host;
    const initialLength = db.hosts.length;
    db.hosts = db.hosts.filter(h => h.destino !== hostToRemove);

    if (db.hosts.length < initialLength) {
        await saveDatabase();
        await saveHostList(); // Assuming this is still needed for some reason, though saveDatabase should handle it.
        // Log Remove Host
        logSystemAction(req.user.username, 'Remover Host', `Removeu host: ${hostToRemove}`);
        console.log(`[API] Host removido: ${hostToRemove}`);
        res.status(200).json({ message: `Host ${hostToRemove} removido com sucesso.` });
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

app.delete('/api/categories/:category', authenticateToken, authorizeRole(['editor', 'admin']), async (req, res) => {
    const categoryToRemove = decodeURIComponent(req.params.category);
    if (categoryToRemove === 'Geral') {
        return res.status(400).json({ message: 'A categoria "Geral" não pode ser removida.' });
    }
    if (!db.categories.includes(categoryToRemove)) {
        return res.status(404).json({ message: 'Categoria não encontrada.' });
    }

    // Move hosts from deleted category to 'Geral'
    db.hosts.forEach(h => {
        if (h.category === categoryToRemove) h.category = 'Geral';
    });

    db.categories = db.categories.filter(c => c !== categoryToRemove);
    await saveDatabase();
    await saveHostList(); // Assuming this is still needed for some reason, though saveDatabase should handle it.

    // Log Remove Category
    logSystemAction(req.user.username, 'Remover Categoria', `Removeu categoria: ${categoryToRemove}`);

    console.log(`[API] Categoria removida: ${categoryToRemove}`);
    res.status(200).json({ message: `Categoria ${categoryToRemove} removida. Os hosts foram movidos para "Geral".` });
});


// --- Roteamento da Página ---
// **CORREÇÃO PRINCIPAL**: Apontar para o index.html dentro da pasta 'public'
app.get('/edit', (req, res) => {
    const token = req.query.editor_token;
    if (!token || token !== process.env.EDITOR_TOKEN) {
        return res.status(403).send('<h1>EROR 404</h1><p>PAGE NOT FOUND.</p>');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// **CORREÇÃO PRINCIPAL**: Apontar para o index.html dentro da pasta 'public'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- Inicialização do Servidor ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces

// --- Inicialização do Servidor ---
app.listen(PORT, HOST, async () => {
    console.log(`Servidor rodando na porta ${PORT}, acessível via IPv4 e IPv6.`);
    console.log(`Acesse o painel em modo de visualização, por exemplo: http://localhost:${PORT}`);
    console.log(`Para editar, use a URL com o token de edição, por exemplo: http://localhost:${PORT}/edit?editor_token=${process.env.EDITOR_TOKEN}`);

    await loadDatabase();
    await importHostsFromFile();
    startMonitoring();
});
