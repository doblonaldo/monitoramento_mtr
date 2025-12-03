const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');

const MONITORING_INTERVAL = 30 * 1000;
const HOSTS_FILE = path.join(__dirname, '../../hosts.txt');
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

            let routeOnly = stdout;

            if (headerLine) {
                const lossIndex = headerLine.indexOf('Loss%');
                const formattedLines = lines.slice(1).map(line => line.substring(0, lossIndex).trimEnd());
                routeOnly = formattedLines.join('\n');
            }

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

        try {
            const lines = rawOutput.trim().split('\n');
            if (lines.length > 1) {
                const lastLine = lines[lines.length - 1];
                const parts = lastLine.trim().split(/\s+/);

                const lossPart = parts.find(p => p.includes('%'));
                let lossValue = null;
                let avgValue = null;

                if (lossPart) {
                    lossValue = parseFloat(lossPart.replace('%', ''));
                    const lossIndex = parts.indexOf(lossPart);
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

    let newStatus = isError ? 'failing' : 'ok';
    const lastLog = host.logs[0];
    let isChange = false;

    if (!lastLog) {
        isChange = true;
    } else if (lastLog.output !== outputText) {
        isChange = true;
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

async function importHostsFromFile() {
    try {
        await fs.promises.access(HOSTS_FILE);
        const data = await fs.promises.readFile(HOSTS_FILE, 'utf-8');
        const lines = data.split('\n').map(l => l.trim()).filter(l => l);
        let newHostsCount = 0;

        let geralCategory = await prisma.category.findUnique({ where: { name: 'Geral' } });
        if (!geralCategory) {
            geralCategory = await prisma.category.create({ data: { name: 'Geral' } });
        }

        for (const line of lines) {
            let destino = null;
            let title = null;
            let categoryName = 'Geral';

            if (line.includes('destino:')) {
                const destinoMatch = line.match(/destino:\s*(\S+)/);
                if (destinoMatch) {
                    destino = destinoMatch[1].trim().replace(/,$/, '');
                    const titleMatch = line.match(/title:\s*([^,]+)/);
                    const categoryMatch = line.match(/category:\s*(.+)/);
                    if (titleMatch) title = titleMatch[1].trim();
                    if (categoryMatch) categoryName = categoryMatch[1].trim();
                }
            } else {
                const parts = line.split(',').map(p => p.trim());
                destino = parts[0];
                if (parts.length > 1) title = parts[1];
                if (parts.length > 2) categoryName = parts[2];
            }

            if (!destino) continue;
            if (!title) title = destino;

            let category = await prisma.category.findUnique({ where: { name: categoryName } });
            if (!category) {
                category = await prisma.category.create({ data: { name: categoryName } });
                console.log(`[Import] Categoria criada: ${categoryName}`);
            }

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

function getLastCheckTimestamp() {
    return lastCheckTimestamp;
}

module.exports = {
    startMonitoring,
    importHostsFromFile,
    checkHost,
    getLastCheckTimestamp
};
