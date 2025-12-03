const prisma = require('../config/prisma');

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas

async function runCleanup() {
    console.log('[Cleanup] Iniciando limpeza de dados antigos...');

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    try {
        // Limpar Métricas Antigas
        const deletedMetrics = await prisma.metric.deleteMany({
            where: {
                timestamp: {
                    lt: sixMonthsAgo
                }
            }
        });

        // Limpar Logs de Monitoramento Antigos
        const deletedLogs = await prisma.monitoringLog.deleteMany({
            where: {
                timestamp: {
                    lt: sixMonthsAgo
                }
            }
        });

        if (deletedMetrics.count > 0 || deletedLogs.count > 0) {
            console.log(`[Cleanup] Limpeza concluída. Métricas removidas: ${deletedMetrics.count}, Logs removidos: ${deletedLogs.count}`);
        } else {
            console.log('[Cleanup] Nenhum dado antigo encontrado para remoção.');
        }

    } catch (error) {
        console.error('[Cleanup] Erro ao executar limpeza:', error);
    }
}

function scheduleCleanup() {
    // Executar imediatamente ao iniciar (opcional, mas bom para garantir)
    runCleanup();

    // Agendar para rodar a cada 24h
    setInterval(runCleanup, CLEANUP_INTERVAL);
    console.log(`[Cleanup] Agendado para rodar a cada 24 horas.`);
}

module.exports = { scheduleCleanup };
