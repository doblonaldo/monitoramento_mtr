const prisma = require('../config/prisma');
const { logSystemAction } = require('../utils/logger');
const { checkHost } = require('../services/mtrService');

exports.listHosts = async (req, res) => {
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
};

exports.getHost = async (req, res) => {
    const hostDest = req.params.host;
    const host = await prisma.host.findUnique({
        where: { destination: hostDest },
        include: {
            category: true,
            logs: { orderBy: { timestamp: 'desc' }, take: 20 }
        }
    });

    if (host) {
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
};

exports.addHost = async (req, res) => {
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
        checkHost(destino);
        res.status(201).json(newHost);
    } catch (e) {
        if (e.code === 'P2002') {
            return res.status(409).json({ message: 'Host já existe.' });
        }
        res.status(500).json({ message: 'Erro ao criar host.' });
    }
};

exports.deleteHost = async (req, res) => {
    const hostDest = req.params.host;
    try {
        await prisma.host.delete({ where: { destination: hostDest } });
        logSystemAction(req.user.username, 'Remover Host', `Host: ${hostDest}`);
        res.json({ message: 'Host removido.' });
    } catch (e) {
        res.status(404).json({ message: 'Host não encontrado.' });
    }
};

exports.getMetrics = async (req, res) => {
    const hostDest = req.params.host;
    const { start, end } = req.query;

    let whereClause = { host: { destination: hostDest } };

    if (start && end) {
        whereClause.timestamp = {
            gte: new Date(start),
            lte: new Date(end)
        };
    }

    try {
        const metrics = await prisma.metric.findMany({
            where: whereClause,
            orderBy: { timestamp: 'asc' }
        });

        if (metrics.length === 0) return res.json([]);

        const startTime = new Date(start || metrics[0].timestamp).getTime();
        const endTime = new Date(end || metrics[metrics.length - 1].timestamp).getTime();
        const diffHours = (endTime - startTime) / (1000 * 60 * 60);

        if (diffHours > 24) {
            const aggregated = {};

            metrics.forEach(m => {
                const date = new Date(m.timestamp);
                const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;

                if (!aggregated[key]) {
                    aggregated[key] = {
                        timestamp: new Date(date.setMinutes(0, 0, 0)),
                        latencySum: 0,
                        lossSum: 0,
                        count: 0
                    };
                }

                if (m.latency !== null) aggregated[key].latencySum += m.latency;
                if (m.packetLoss !== null) aggregated[key].lossSum += m.packetLoss;
                aggregated[key].count++;
            });

            const result = Object.values(aggregated).map(item => ({
                timestamp: item.timestamp,
                latency: item.count > 0 ? parseFloat((item.latencySum / item.count).toFixed(2)) : null,
                packetLoss: item.count > 0 ? parseFloat((item.lossSum / item.count).toFixed(2)) : null
            }));

            result.sort((a, b) => a.timestamp - b.timestamp);
            return res.json(result);
        }

        res.json(metrics);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Erro ao buscar métricas.' });
    }
};
