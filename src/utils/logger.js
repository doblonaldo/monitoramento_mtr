const fs = require('fs');
const path = require('path');

const LOGS_FILE = path.join(__dirname, '../../system_logs.json');

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

module.exports = { logSystemAction, LOGS_FILE };
