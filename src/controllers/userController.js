const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logSystemAction } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;

exports.listUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { username: true, role: true, status: true, createdAt: true }
        });
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: 'Erro ao listar usuários.' });
    }
};

exports.inviteUser = async (req, res) => {
    const { email, role } = req.body;
    const username = email;

    if (!username) return res.status(400).json({ message: 'Username/Email obrigatório.' });

    try {
        const existingUser = await prisma.user.findUnique({ where: { username } });
        if (existingUser) return res.status(409).json({ message: 'Usuário já existe.' });

        const tempPassword = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                role: role || 'viewer',
                status: 'pending'
            }
        });

        const setupToken = jwt.sign({ username, action: 'setup' }, JWT_SECRET, { expiresIn: '24h' });
        const setupLink = `${req.protocol}://${req.get('host')}/setup-password.html?token=${setupToken}`;

        logSystemAction(req.user.username, 'Convidar Usuário', `Usuário: ${username}`);
        res.status(201).json({ message: 'Usuário convidado.', link: setupLink });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Erro ao convidar usuário.' });
    }
};

exports.updateUser = async (req, res) => {
    const usernameParam = req.params.username;
    const { role, password } = req.body;

    try {
        const data = {};
        if (role) data.role = role;
        if (password) data.password = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { username: usernameParam },
            data
        });

        logSystemAction(req.user.username, 'Editar Usuário', `Usuário: ${usernameParam}`);
        res.json({ message: 'Usuário atualizado.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao atualizar usuário.' });
    }
};

exports.deleteUser = async (req, res) => {
    const usernameParam = req.params.username;
    if (usernameParam === 'admin') return res.status(403).json({ message: 'Não pode remover o admin principal.' });

    try {
        await prisma.user.delete({ where: { username: usernameParam } });
        logSystemAction(req.user.username, 'Remover Usuário', `Usuário: ${usernameParam}`);
        res.json({ message: 'Usuário removido.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao remover usuário.' });
    }
};

exports.generateResetLink = async (req, res) => {
    const usernameParam = req.params.username;

    try {
        const user = await prisma.user.findUnique({ where: { username: usernameParam } });
        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

        const resetToken = jwt.sign({ username: usernameParam, action: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${resetToken}`;

        logSystemAction(req.user.username, 'Gerar Reset Link', `Usuário: ${usernameParam}`);
        res.json({ link: resetLink });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao gerar link.' });
    }
};
