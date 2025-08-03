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
const HOST = '::';
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
        // ALTERAÇÃO: Salva no formato "title: ..., destino: ..." para manter consistência.
        const hostLines = Object.entries(db.hosts).map(([destino, data]) => {
            if (data.title && data.title !== destino) {
                return `title: ${data.title}, destino: ${destino}`;
            }
            return destino;
        });
        await fs.writeFile(MONITORED_HOSTS_FILE, hostLines.join('\n'));
        console.log(`[File] Lista de hosts monitorados salva em ${MONITORED_HOSTS_FILE}`);
    } catch (error) {
        console.error('[File] Erro ao salvar a lista de hosts:', error);
    }
}

async function importHostsFromFile() {
    try {
        await fs.access(HOST_LIST_FILE);
        const data = await fs.readFile(HOST_LIST_FILE, 'utf-8');
        const lines = data.split('\n').map(l => l.trim()).filter(l => l);
        let newHostsAdded = false;

        for (const line of lines) {
            let title = null;
            let destino = null;

            // ALTERAÇÃO: Lógica para interpretar o novo formato "title: ..., destino: ..."
            if (line.includes('destino:')) {
                const titleMatch = line.match(/title:\s*([^,]+)/);
                const destinoMatch = line.match(/destino:\s*(\S+)/);
                if (destinoMatch) {
                    destino = destinoMatch[1].trim();
                    if (titleMatch) {
                        title = titleMatch[1].trim();
                    }
                }
            } else {
                // Mantém a compatibilidade com o formato antigo
                destino = line;
            }

            if (destino && !db.hosts[destino]) {
                console.log(`[Import] Host "${destino}" do arquivo não está no DB. Adicionando...`);
                // ALTERAÇÃO: Usa o novo formato de objeto
                db.hosts[destino] = {
                    title: title || destino, // Usa o próprio destino como título se não for fornecido
                    lastMtr: null,
                    history: [],
                    status: 'ok'
                };
                checkHost(destino); // A função de checagem continua recebendo apenas o destino
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
// A função executeMtr e checkHost não precisam de grandes alterações,
// pois elas operam sobre o "destino" (a chave do objeto), que continua sendo o IP/domínio.
function executeMtr(host) {
    return new Promise((resolve, reject) => {
        if (!/^[a-zA-Z0-9.-:]+$/.test(host)) {
            return reject(new Error(`Host inválido: '${host}'. Contém caracteres não permitidos.`));
        }
        const command = `mtr -r -n -c 10 -4 -z ${host}`;
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
    const hostData = db.hosts[hostDestino];
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
    // ALTERAÇÃO: Envia um objeto com destino e título, em vez de apenas a string do host.
    const hostList = Object.entries(db.hosts).map(([destino, data]) => ({
        destino: destino,
        title: data.title || destino // Garante que sempre tenha um título
    }));
    res.status(200).json(hostList);
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
    // ALTERAÇÃO: Aceita "title" e "destino" no corpo da requisição.
    const { title, destino } = req.body;
    if (!destino) {
        return res.status(400).json({ message: 'O destino é obrigatório.' });
    }
    if (db.hosts[destino]) {
        return res.status(409).json({ message: 'Este destino já está sendo monitorado.' });
    }

    // ALTERAÇÃO: Cria o objeto do host com o título.
    db.hosts[destino] = {
        title: title || destino, // Se o título for vazio, usa o próprio destino.
        lastMtr: null,
        history: [],
        status: 'ok'
    };
    console.log(`[API] Host adicionado: ${destino} (Título: ${title || destino}). Verificação inicial em andamento...`);
    await checkHost(destino);
    await saveDatabase();
    await saveHostList();
    res.status(201).json({ message: `Host ${destino} adicionado com sucesso.` });
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
    await setupEnv();
    console.log(`Servidor rodando na porta ${PORT}, acessível via IPv4 e IPv6.`);
    console.log(`Acesse o painel em modo de visualização, por exemplo: http://localhost:${PORT} ou http://[::1]:${PORT}`);
    console.log(`Para editar, use a URL com o token de edição, por exemplo: http://localhost:${PORT}/edit?editor_token=${process.env.EDITOR_TOKEN}`);

    await loadDatabase();
    await importHostsFromFile();
    startMonitoring();
});