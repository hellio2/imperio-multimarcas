require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// =========================================================
// MIDDLEWARE DE PROTEÇÃO DE ROTAS (VERIFICA SE ESTÁ LOGADO)
// =========================================================
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ erro: 'Acesso negado. Faça login.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Sessão expirada. Faça login novamente.' });
        req.usuario = usuario; // injeta os dados do usuário logado na requisição
        next();
    });
}

// =========================================================
// ROTAS DE AUTENTICAÇÃO
// =========================================================

app.post('/api/auth/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos.' });

    try {
        const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExistente.rows.length > 0) return res.status(400).json({ erro: 'E-mail já cadastrado.' });

        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);

        const novoUsuario = await pool.query(
            'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id, nome, email',
            [nome, email, senhaCriptografada]
        );
        res.status(201).json({ sucesso: true, mensagem: 'Conta criada!', usuario: novoUsuario.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro interno no cadastro.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos.' });

    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });

        const usuario = result.rows[0];
        const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
        if (!senhaCorreta) return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });

        const token = jwt.sign(
            { id: usuario.id, nome: usuario.nome, email: usuario.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({ sucesso: true, token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro interno no login.' });
    }
});

// =========================================================
// ROTAS DO CARRINHO DE COMPRAS (SALVO NO POSTGRESQL)
// =========================================================

// 1. Buscar o carrinho do usuário logado
app.get('/api/carrinho', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id as carrinho_id, c.quantidade as qtd, c.tamanho, p.id, p.nome, p.preco, p.icone, p.categoria 
             FROM carrinho c 
             JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, 
            [req.usuario.id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao buscar itens do carrinho.' });
    }
});

// 2. Adicionar ou atualizar item no carrinho
app.post('/api/carrinho', autenticarToken, async (req, res) => {
    const { produto_id, quantidade, tamanho } = req.body;
    try {
        await pool.query(
            `INSERT INTO carrinho (usuario_id, produto_id, quantidade, tamanho) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (usuario_id, produto_id, tamanho) 
             DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade`,
            [req.usuario.id, produto_id, quantidade, tamanho]
        );
        res.status(200).json({ sucesso: true, mensagem: 'Carrinho atualizado no banco!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao salvar no carrinho.' });
    }
});

// 3. Remover item do carrinho
app.delete('/api/carrinho/:produto_id/:tamanho', autenticarToken, async (req, res) => {
    const { produto_id, tamanho } = req.params;
    try {
        await pool.query(
            'DELETE FROM carrinho WHERE usuario_id = $1 AND produto_id = $2 AND tamanho = $3',
            [req.usuario.id, produto_id, tamanho]
        );
        res.status(200).json({ sucesso: true, mensagem: 'Item removido do banco!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao remover item do carrinho.' });
    }
});

// =========================================================
// ROTAS DE FAVORITOS (SALVOS NO POSTGRESQL)
// =========================================================

// 1. Buscar favoritos do usuário logado
app.get('/api/favoritos', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT produto_id FROM favoritos WHERE usuario_id = $1', [req.usuario.id]);
        const favoritosIds = result.rows.map(row => row.produto_id);
        res.status(200).json(favoritosIds);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar favoritos.' });
    }
});

// 2. Adicionar aos favoritos
app.post('/api/favoritos', autenticarToken, async (req, res) => {
    const { produto_id } = req.body;
    try {
        await pool.query(
            'INSERT INTO favoritos (usuario_id, produto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.usuario.id, produto_id]
        );
        res.status(200).json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao favoritar.' });
    }
});

// 3. Remover dos favoritos
app.delete('/api/favoritos/:produto_id', autenticarToken, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM favoritos WHERE usuario_id = $1 AND produto_id = $2', 
            [req.usuario.id, req.params.produto_id]
        );
        res.status(200).json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao remover favorito.' });
    }
});

// =========================================================
// ROTAS DE PRODUTOS E LOGÍSTICA
// =========================================================

app.get('/api/produtos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id ASC');
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao carregar produtos.' });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`👑 Império Multimarcas rodando na porta ${PORT}!`);
});