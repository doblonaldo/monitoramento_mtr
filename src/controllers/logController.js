const fs = require('fs');
const { LOGS_FILE } = require('../utils/logger');

exports.listLogs = (req, res) => {
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
};
