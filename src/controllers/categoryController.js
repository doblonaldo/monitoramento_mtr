const prisma = require('../config/prisma');
const { logSystemAction } = require('../utils/logger');

exports.listCategories = async (req, res) => {
    const categories = await prisma.category.findMany();
    res.json(categories.map(c => c.name));
};

exports.addCategory = async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Nome inválido.' });

    try {
        await prisma.category.create({ data: { name: name } });
        logSystemAction(req.user.username, 'Adicionar Categoria', `Categoria: ${name}`);
        res.status(201).json({ message: 'Categoria criada.' });
    } catch (e) {
        res.status(409).json({ message: 'Categoria já existe.' });
    }
};

exports.deleteCategory = async (req, res) => {
    const catName = decodeURIComponent(req.params.category);
    if (catName === 'Geral') return res.status(400).json({ message: 'Não pode remover Geral.' });

    try {
        const cat = await prisma.category.findUnique({ where: { name: catName } });
        if (!cat) return res.status(404).json({ message: 'Categoria não encontrada.' });

        const geral = await prisma.category.findUnique({ where: { name: 'Geral' } });
        await prisma.host.updateMany({
            where: { categoryId: cat.id },
            data: { categoryId: geral.id }
        });

        await prisma.category.delete({ where: { id: cat.id } });
        logSystemAction(req.user.username, 'Remover Categoria', `Categoria: ${catName}`);
        res.json({ message: 'Categoria removida.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao remover categoria.' });
    }
};
