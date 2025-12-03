// -----------------------------------------------------------------------------
// |                            server.js                                      |
// |      Backend com monitoramento agendado, detecção de mudanças e API.      |
// |      Versão: Modular (MVC)                                                |
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const cors = require('cors');
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('./src/config/prisma');
const { startMonitoring, importHostsFromFile, getLastCheckTimestamp } = require('./src/services/mtrService');
const { scheduleCleanup } = require('./src/services/cleanupService');

// --- Carregar Variáveis de Ambiente ---
const envPath = path.join(__dirname, '.env');

try {
    if (fs.existsSync(envPath)) {
        require('dotenv').config();
    } else {
        console.log('[ENV] Arquivo .env não encontrado. Gerando um novo...');
        const defaultEnv = `JWT_SECRET=${crypto.randomBytes(64).toString('hex')}\nEDITOR_TOKEN=${crypto.randomBytes(16).toString('hex')}\nPORT=3000\nDATABASE_URL="file:./dev.db"\n`;
        fs.writeFileSync(envPath, defaultEnv);
        require('dotenv').config();
    }
} catch (error) {
    console.error('[ENV] Erro ao carregar .env:', error);
}

if (!process.env.JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET não definido no arquivo .env.');
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const LOGIN_ICON = process.env.LOGIN_ICON;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const hostRoutes = require('./src/routes/hostRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const logRoutes = require('./src/routes/logRoutes');

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', hostRoutes);
app.use('/api', categoryRoutes);
app.use('/api', logRoutes);

// --- Public Config & Status ---
app.get('/api/status', (req, res) => {
    res.json({ lastCheck: getLastCheckTimestamp() });
});

app.get('/api/public-config', (req, res) => {
    const iconUrl = LOGIN_ICON ? '/api/logo' : null;
    res.json({ loginIcon: iconUrl });
});

app.get('/api/logo', (req, res) => {
    if (!LOGIN_ICON) return res.status(404).send('Logo not configured');
    if (LOGIN_ICON.startsWith('http')) return res.redirect(LOGIN_ICON);

    let iconPath = LOGIN_ICON;
    if (!path.isAbsolute(iconPath)) iconPath = path.join(__dirname, iconPath);

    if (fs.existsSync(iconPath)) res.sendFile(iconPath);
    else res.status(404).send('Not found');
});

// --- Frontend Fallback ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/edit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- Initialization ---
async function initializeDatabase() {
    try {
        const geralCategory = await prisma.category.findUnique({ where: { name: 'Geral' } });
        if (!geralCategory) {
            await prisma.category.create({ data: { name: 'Geral' } });
            console.log('[DB] Categoria "Geral" criada.');
        }

        const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
        if (!adminUser) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await prisma.user.create({
                data: {
                    username: 'admin',
                    password: hashedPassword,
                    role: 'admin',
                    status: 'active'
                }
            });
            console.log('[DB] Usuário admin padrão criado (admin/admin123).');
        }

        console.log('[DB] Banco de dados inicializado.');
    } catch (error) {
        console.error('[DB] Erro ao inicializar banco de dados:', error);
    }
}

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    await initializeDatabase();
    await importHostsFromFile();
    scheduleCleanup();
    startMonitoring();
});
