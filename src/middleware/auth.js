const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.sendStatus(403);

        try {
            const user = await prisma.user.findUnique({ where: { username: decoded.username } });

            if (!user) return res.sendStatus(403);
            if (user.status !== 'active') return res.sendStatus(403);
            if (decoded.role && decoded.role !== user.role) return res.sendStatus(403);

            req.user = user;
            next();
        } catch (e) {
            console.error('Erro na validação de token:', e);
            res.sendStatus(500);
        }
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }
        next();
    };
};

module.exports = { authenticateToken, authorizeRole };
