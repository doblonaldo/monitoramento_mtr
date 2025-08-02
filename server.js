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
const MONITORING_INTERVAL = 10 * 60 * 1000; // 10 minutos em milissegundos

// Estrutura de dados em memória
let db = { hosts: {} };

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Funções do Banco de Dados ---
async function loadDatabase() {
    try {
        await fs.access(DB_FILE);
        const data = await fs.readFile(DB_FILE, 'utf-8');
        db = JSON.parse(data);
        if (!db.hosts) db.hosts = {};
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

// --- Lógica de Monitoramento ---
function executeMtr(host) {
    return new Promise((resolve, reject) => {
        if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
            return reject(new Error('Host inválido.'));
        }
        const command = `mtr -r -n -c 10 -z ${host}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Falha ao testar o host ${host}: ${stderr}`));
            }
            
            // ** AJUSTE APLICADO AQUI **
            // Processa a saída do MTR para manter apenas as colunas de rota.
            const lines = stdout.trim().split('\n');
            const headerLine = lines.find(line => line.includes('Loss%'));
            if (!headerLine) {
                // Se não encontrar o cabeçalho, retorna a saída como está (pode ser um erro do mtr)
                resolve(stdout);
                return;
            }

            const lossIndex = headerLine.indexOf('Loss%');
            
            const formattedLines = lines.slice(1) // Pula a linha "Start:"
                .map(line => {
                    // Pega a parte da string antes da coluna "Loss%" e remove espaços extras
                    return line.substring(0, lossIndex).trimEnd();
                });

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

        // Se for o primeiro teste, apenas salva o resultado
        if (!hostData.lastMtr) {
            console.log(`[Monitor] Primeiro resultado para ${host}. Salvando.`);
            hostData.lastMtr = newMtrResult;
        } else if (hostData.lastMtr !== newMtrResult) {
            // Se o resultado mudou, registra no histórico
            console.log(`[Monitor] MUDANÇA DETECTADA para ${host}!`);
            const changeEvent = {
                timestamp: new Date().toISOString(),
                mtrLog: newMtrResult
            };
            hostData.history.push(changeEvent);
            hostData.lastMtr = newMtrResult; // Atualiza o último resultado
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
            return;
        }
        
        for (const host of hostsToMonitor) {
            await checkHost(host);
        }
        
        // Salva todas as mudanças no final do ciclo
        await saveDatabase();
        console.log('[Monitor] Ciclo de verificação concluído.');

    }, MONITORING_INTERVAL);
}

// --- Rotas da API ---

// Retorna a lista de hosts
app.get('/api/hosts', (req, res) => {
    res.status(200).json(Object.keys(db.hosts));
});

// Retorna os dados completos de um host (último MTR e histórico)
app.get('/api/hosts/:host', (req, res) => {
    const host = req.params.host;
    if (db.hosts[host]) {
        res.status(200).json(db.hosts[host]);
    } else {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
});

// Adiciona um novo host
app.post('/api/hosts', async (req, res) => {
    const { host } = req.body;
    if (!host) {
        return res.status(400).json({ message: 'O host é obrigatório.' });
    }
    if (db.hosts[host]) {
        return res.status(409).json({ message: 'Este host já está sendo monitorado.' });
    }

    db.hosts[host] = {
        lastMtr: null,
        history: []
    };
    
    console.log(`[API] Host adicionado: ${host}. Verificação inicial em andamento...`);
    // Executa uma verificação imediata para o novo host
    await checkHost(host);
    await saveDatabase();
    
    res.status(201).json({ message: `Host ${host} adicionado com sucesso.` });
});

// Remove um host
app.delete('/api/hosts/:host', async (req, res) => {
    const hostToRemove = req.params.host;
    if (!db.hosts[hostToRemove]) {
        return res.status(404).json({ message: 'Host não encontrado.' });
    }

    delete db.hosts[hostToRemove];
    await saveDatabase();
    console.log(`[API] Host removido: ${hostToRemove}`);
    res.status(200).json({ message: `Host ${hostToRemove} removido com sucesso.` });
});

// --- Inicialização do Servidor ---
(async () => {
    await loadDatabase();
    startMonitoring(); // Inicia o monitoramento em segundo plano
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
        console.log(`Acesse o painel em: http://localhost:${PORT}`);
    });
})();