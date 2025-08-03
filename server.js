// -----------------------------------------------------------------------------
// |                            server.js                                      |
// |      Backend com monitoramento agendado, detecção de mudanças e API.      |
// -----------------------------------------------------------------------------

const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// --- Carregar Variáveis de Ambiente ---
const envPath = path.join(__dirname, '.env');
const setupEnv = async () => {
    try {
        await fs.access(envPath);
        require('dotenv').config();
    } catch (error) {
        console.log('[ENV] Arquivo .env não encontrado. Gerando um novo...');
        const newToken = crypto.randomBytes(16).toString('hex');
        await fs.writeFile(envPath, `EDITOR_TOKEN=${newToken}\n`);
        console.log(`[ENV] Novo token de edição gerado e salvo em .env`);
        require('dotenv').config();
    }
};


const app = express();
const PORT = 3000;
const HOST = '0.0.0.0'; // Ouve em todas as interfaces de rede
const DB_FILE = path.join(__dirname, 'db.json');
const HOST_LIST_FILE = path.join(__dirname, 'hosts.txt');
const MONITORED_HOSTS_FILE = path.join(__dirname, 'monitored_hosts.txt');
const MONITORING_INTERVAL = 10 * 60 * 1000;

let db = { hosts: {} };
let lastCheckTimestamp = null;

app.use(cors());
app.use(express.json());

// --- Middleware de Autenticação ---
const requireEditorToken = (req, res, next) => {
    const token = req.query.editor_token || req.body.editor_token;
    if (!token || token !== process.env.EDITOR_TOKEN) {
        return res.status(403).json({ message: 'Acesso negado. Token de edição inválido ou ausente.' });
    }
    next();
};

// Servir arquivos estáticos (CSS, JS do cliente)
app.use(express.static(path.join(__dirname, 'public')));


// --- Funções do Banco de Dados ---
async function loadDatabase() {
    try {
        await fs.access(DB_FILE);
        const data = await fs.readFile(DB_FILE, 'utf-8');
        let parsedData = JSON.parse(data);
        if (!parsedData.hosts || Array.isArray(parsedData.hosts)) {
            parsedData.hosts = {};
        }
        db = parsedData;
        console.log('[DB] Banco de dados carregado com sucesso.');
    } catch (error) {
        console.log('[DB] Arquivo db.json não encontrado. Criando um novo.');
        db = { hosts: {} };
        await saveDatabase();
    }
}

async function saveDatabase() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('[DB] Erro ao salvar o banco de dados:', error);
    }
}

async function saveHostList() {
    try {
        const hosts = Object.keys(db.hosts);
        await fs.writeFile(MONITORED_HOSTS_FILE, hosts.join('\n'));
        console.log(`[File] Lista de hosts monitorados salva em ${MONITORED_HOSTS_FILE}`);
    } catch (error) {
        console.error('[File] Erro ao salvar a lista de hosts:', error);
    }
}

async function importHostsFromFile() {
    try {
        await fs.access(HOST_LIST_FILE);
        const data = await fs.readFile(HOST_LIST_FILE, 'utf-8');
        const hostsFromFile = data.split('\n').map(h => h.trim()).filter(h => h);
        let newHostsAdded = false;
        for (const host of hostsFromFile) {
            if (!db.hosts[host]) {
                console.log(`[Import] Host "${host}" do arquivo não está no DB. Adicionando...`);
                db.hosts[host] = { lastMtr: null, history: [], status: 'ok' };
                checkHost(host);
                newHostsAdded = true;
            }
        }
        if (newHostsAdded) {
            await saveDatabase();
            await saveHostList();
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[Import] Arquivo de importação "${HOST_LIST_FILE}" não encontrado. Pulando etapa.`);
        } else {
            console.error('[Import] Erro ao ler o arquivo de hosts:', error);
        }
    }
}

// --- Lógica de Monitoramento ---
function executeMtr(host) {
    return new Promise((resolve, reject) => {
        if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
            return reject(new Error('Host inválido.'));
        }
        const command = `mtr -r -n -c 10 -z -4 ${host}`;
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

async function checkHost(host) {
    const newMtrResult = await executeMtr(host);
    const hostData = db.hosts[host];
    if (!hostData) return;

    if (newMtrResult.error) {
        console.error(`[Monitor] Erro ao verificar ${host}:`, newMtrResult.error);
        if (hostData.status === 'failing') {
            console.log(`[Monitor] Host ${host} falhou pela segunda vez consecutiva. Marcando para remoção.`);
            hostData.toBeDeleted = true;
        } else {
            console.log(`[Monitor] Host ${host} falhou pela primeira vez. Marcando para observação.`);
            hostData.status = 'failing';
            hostData.lastMtr = `Host não encontrado ou inacessível.\nSerá removido automaticamente na próxima verificação se o erro persistir.`;
        }
        return;
    }

    console.log(`[Monitor] Verificação de ${host} bem-sucedida.`);
    hostData.status = 'ok';

    if (!hostData.lastMtr || hostData.lastMtr.startsWith('Host não encontrado')) {
        console.log(`[Monitor] Primeiro resultado válido para ${host}. Salvando como base.`);
        hostData.lastMtr = newMtrResult;
        hostData.history.push({
            timestamp: new Date().toISOString(),
            mtrLog: newMtrResult
        });
    } else if (hostData.lastMtr !== newMtrResult) {
        console.log(`[Monitor] MUDANÇA DETECTADA para ${host}!`);
        const changeEvent = {
            timestamp: new Date().toISOString(),
            mtrLog: newMtrResult
        };
        hostData.history.push(changeEvent);
        hostData.lastMtr = newMtrResult;
    } else {
        console.log(`[Monitor] Nenhuma mudança para ${host}.`);
    }
}

function startMonitoring() {
    console.log(`[Monitor] Iniciando ciclo de monitoramento a cada ${MONITORING_INTERVAL / 60000} minutos.`);
    setInterval(async () => {
        console.log('[Monitor] Executando ciclo de verificação...');
        const hostsToMonitor = Object.keys(db.hosts);
        if (hostsToMonitor.length === 0) {
            lastCheckTimestamp = new Date().toISOString();
            return;
        }
        for (const host of hostsToMonitor) {
            await checkHost(host);
        }
        
        let hostsWereRemoved = false;
        const currentHosts = Object.keys(db.hosts);
        for (const host of currentHosts) {
            if (db.hosts[host].toBeDeleted) {
                delete db.hosts[host];
                hostsWereRemoved = true;
                console.log(`[Monitor] Host ${host} removido automaticamente do banco de dados.`);
            }
        }
        
        await saveDatabase();
        if (hostsWereRemoved) {
            await saveHostList();
        }

        lastCheckTimestamp = new Date().toISOString();
        console.log('[Monitor] Ciclo de verificação concluído.');
    }, MONITORING_INTERVAL);
}

// --- Rotas da API ---
app.get('/api/hosts', (req, res) => {
    res.status(200).json(Object.keys(db.hosts));
});

app.get('/api/hosts/:host', (req, res) => {
    const host = req.params.host;
    if (db.hosts[host]) {
        res.status(200).json(db.hosts[host]);
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

app.get('/api/status', (req, res) => {
    res.status(200).json({
        lastCheck: lastCheckTimestamp,
        editor_token: req.query.editor_token === process.env.EDITOR_TOKEN ? process.env.EDITOR_TOKEN : undefined
    });
});

app.post('/api/hosts', requireEditorToken, async (req, res) => {
    const { host } = req.body;
    if (!host) {
        return res.status(400).json({ message: 'O host é obrigatório.' });
    }
    if (db.hosts[host]) {
        return res.status(409).json({ message: 'Este host já está sendo monitorado.' });
    }
    db.hosts[host] = { lastMtr: null, history: [], status: 'ok' };
    console.log(`[API] Host adicionado: ${host}. Verificação inicial em andamento...`);
    await checkHost(host);
    await saveDatabase();
    await saveHostList();
    res.status(201).json({ message: `Host ${host} adicionado com sucesso.` });
});

app.delete('/api/hosts/:host', requireEditorToken, async (req, res) => {
    const hostToRemove = req.params.host;
    if (!db.hosts[hostToRemove]) {
        return res.status(404).json({ message: 'Host não encontrado.' });
    }
    delete db.hosts[hostToRemove];
    await saveDatabase();
    await saveHostList();
    console.log(`[API] Host removido: ${hostToRemove}`);
    res.status(200).json({ message: `Host ${hostToRemove} removido com sucesso.` });
});

// --- Roteamento da Página ---
app.get('/edit', (req, res) => {
    const token = req.query.editor_token;
    if (!token || token !== process.env.EDITOR_TOKEN) {
        return res.status(403).send('<h1>EROR 404</h1><p>PAGE NOT FOUND.</p>');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// A rota raiz sempre serve a versão de visualização
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- Inicialização do Servidor ---
app.listen(PORT, HOST, async () => {
    await setupEnv(); // Garante que o .env exista e seja carregado
    console.log(`Servidor rodando em http://${HOST}:${PORT}`);
    console.log(`Acesse o painel em modo de visualização em qualquer IP da máquina, ex: http://172.16.254.11:${PORT}`);
    console.log(`Para editar, acesse: http://172.16.254.11:${PORT}/edit?editor_token=${process.env.EDITOR_TOKEN}`);
    
    await loadDatabase();
    await importHostsFromFile();
    startMonitoring();
});