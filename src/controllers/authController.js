const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { logSystemAction } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });

        if (await bcrypt.compare(password, user.password)) {
            if (user.status !== 'active') return res.status(403).json({ message: 'Conta inativa.' });

            const accessToken = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
            logSystemAction(user.username, 'Login', 'Login realizado.');
            res.json({ accessToken, role: user.role, username: user.username });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (e) {
        res.status(500).send();
    }
};

exports.logout = (req, res) => {
    logSystemAction(req.user.username, 'Logout', 'Logout realizado.');
    res.json({ message: 'Logout registrado.' });
};

exports.setupPassword = async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Dados incompletos.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.action !== 'setup') return res.status(403).json({ message: 'Token inválido para esta ação.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { username: decoded.username },
            data: { password: hashedPassword, status: 'active' }
        });

        res.json({ message: 'Senha definida com sucesso. Faça login.' });
    } catch (e) {
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Dados incompletos.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.action !== 'reset') return res.status(403).json({ message: 'Token inválido para esta ação.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { username: decoded.username },
            data: { password: hashedPassword }
        });

        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (e) {
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
};
