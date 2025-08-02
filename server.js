// -----------------------------------------------------------------------------
// |                            server.js                                      |
// |      Backend com monitoramento agendado, detecção de mudanças e API.      |
// -----------------------------------------------------------------------------

const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');
// --- ARQUIVOS DE LISTA DE HOSTS ---
const HOST_LIST_FILE = path.join(__dirname, 'hosts.txt'); // Arquivo para importação inicial
const MONITORED_HOSTS_FILE = path.join(__dirname, 'monitored_hosts.txt'); // Arquivo para exportação da lista

const MONITORING_INTERVAL = 2 * 60 * 1000; // 10 minutos em milissegundos

// Estrutura de dados em memória
let db = { hosts: {} };
let lastCheckTimestamp = null;

app.use(cors());
app.use(express.json());
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

// --- FUNÇÃO PARA SALVAR A LISTA DE HOSTS EM .TXT ---
async function saveHostList() {
    try {
        const hosts = Object.keys(db.hosts);
        await fs.writeFile(MONITORED_HOSTS_FILE, hosts.join('\n'));
        console.log(`[File] Lista de hosts monitorados salva em ${MONITORED_HOSTS_FILE}`);
    } catch (error) {
        console.error('[File] Erro ao salvar a lista de hosts:', error);
    }
}

// --- FUNÇÃO PARA IMPORTAR HOSTS DE .TXT NA INICIALIZAÇÃO ---
async function importHostsFromFile() {
    try {
        await fs.access(HOST_LIST_FILE);
        const data = await fs.readFile(HOST_LIST_FILE, 'utf-8');
        const hostsFromFile = data.split('\n').map(h => h.trim()).filter(h => h);

        let newHostsAdded = false;
        for (const host of hostsFromFile) {
            if (!db.hosts[host]) {
                console.log(`[Import] Host "${host}" do arquivo não está no DB. Adicionando...`);
                db.hosts[host] = { lastMtr: null, history: [] };
                checkHost(host); // Inicia uma verificação imediata
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
                return reject(new Error(`Falha ao testar o host ${host}: ${stderr}`));
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
    try {
        console.log(`[Monitor] Verificando host: ${host}`);
        const newMtrResult = await executeMtr(host);
        const hostData = db.hosts[host];

        if (!hostData.lastMtr) {
            console.log(`[Monitor] Primeiro resultado para ${host}. Salvando como base.`);
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
    } catch (error) {
        console.error(error.message);
    }
}

function startMonitoring() {
    console.log(`[Monitor] Iniciando ciclo de monitoramento a cada ${MONITORING_INTERVAL / 60000} minutos.`);
    setInterval(async () => {
        console.log('[Monitor] Executando ciclo de verificação...');
        const hostsToMonitor = Object.keys(db.hosts);
        if (hostsToMonitor.length === 0) {
            console.log('[Monitor] Nenhum host para monitorar.');
            lastCheckTimestamp = new Date().toISOString();
            return;
        }
        
        for (const host of hostsToMonitor) {
            await checkHost(host);
        }
        
        await saveDatabase();
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
        lastCheck: lastCheckTimestamp
    });
});

app.post('/api/hosts', async (req, res) => {
    const { host } = req.body;
    if (!host) {
        return res.status(400).json({ message: 'O host é obrigatório.' });
    }
    if (db.hosts[host]) {
        return res.status(409).json({ message: 'Este host já está sendo monitorado.' });
    }

    db.hosts[host] = { lastMtr: null, history: [] };
    
    console.log(`[API] Host adicionado: ${host}. Verificação inicial em andamento...`);
    await checkHost(host);
    await saveDatabase();
    await saveHostList(); // Atualiza a lista de hosts
    
    res.status(201).json({ message: `Host ${host} adicionado com sucesso.` });
});

app.delete('/api/hosts/:host', async (req, res) => {
    const hostToRemove = req.params.host;
    if (!db.hosts[hostToRemove]) {
        return res.status(404).json({ message: 'Host não encontrado.' });
    }

    delete db.hosts[hostToRemove];
    await saveDatabase();
    await saveHostList(); // Atualiza a lista de hosts
    
    console.log(`[API] Host removido: ${hostToRemove}`);
    res.status(200).json({ message: `Host ${hostToRemove} removido com sucesso.` });
});

// --- Inicialização do Servidor ---
(async () => {
    await loadDatabase();
    await importHostsFromFile(); // Roda a importação após carregar o DB
    startMonitoring();
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
        console.log(`Acesse o painel em: http://localhost:${PORT}`);
    });
})();