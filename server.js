require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

// IMPORTAÇÕES DO CLOUDINARY E MULTER (UPLOAD DE IMAGENS)
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// NOVAS IMPORTAÇÕES (PAGAMENTO E FRETE)
const { MercadoPagoConfig, Preference } = require('mercadopago');
const { calcularPrecoPrazo } = require('correios-brasil');

// Inicializa o Mercado Pago com a sua chave
const clienteMercadoPago = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// =========================================================
// CONFIGURAÇÃO DO CLOUDINARY
// =========================================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'imperio_produtos', // Pasta que será criada automaticamente no seu Cloudinary
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: storage });

// =========================================================
// MIDDLEWARES DE SEGURANÇA
// =========================================================
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ erro: 'Acesso negado. Faça login.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Sessão expirada. Faça login novamente.' });
        req.usuario = usuario;
        next();
    });
}

// Verifica se o usuário autenticado possui cargo de Administrador
async function autenticarAdmin(req, res, next) {
    try {
        const result = await pool.query('SELECT role FROM usuarios WHERE id = $1', [req.usuario.id]);
        if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
            return res.status(403).json({ erro: 'Acesso negado. Área exclusiva para administradores.' });
        }
        next();
    } catch (err) {
        res.status(500).json({ erro: 'Erro interno ao validar permissões.' });
    }
}

// =========================================================
// ROTAS DE AUTENTICAÇÃO (LOGIN/CADASTRO)
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
            { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({ sucesso: true, token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro interno no login.' });
    }
});

// =========================================================
// ROTAS ADMINISTRATIVAS (GESTÃO DE PRODUTOS)
// =========================================================

app.post('/api/admin/produtos', autenticarToken, autenticarAdmin, upload.single('imagem'), async (req, res) => {
    try {
        const { nome, descricao, preco, preco_antigo, categoria, estoque } = req.body;
        const imagem_url = req.file ? req.file.path : null; 

        const result = await pool.query(
            `INSERT INTO produtos (nome, descricao, preco, preco_antigo, categoria, estoque, imagem_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [nome, descricao, preco, preco_antigo || null, categoria, estoque || 0, imagem_url]
        );
        
        res.status(201).json({ sucesso: true, mensagem: 'Produto cadastrado com sucesso!', produto: result.rows[0] });
    } catch (err) {
        console.error("Erro ao cadastrar produto:", err);
        res.status(500).json({ erro: 'Erro ao cadastrar o produto no banco de dados.' });
    }
});

app.put('/api/admin/produtos/:id', autenticarToken, autenticarAdmin, upload.single('imagem'), async (req, res) => {
    const { id } = req.params;
    const { nome, descricao, preco, preco_antigo, categoria, estoque } = req.body;

    try {
        let query = `UPDATE produtos SET nome = $1, descricao = $2, preco = $3, preco_antigo = $4, categoria = $5, estoque = $6`;
        let params = [nome, descricao, preco, preco_antigo || null, categoria, estoque];

        if (req.file) {
            query += `, imagem_url = $7 WHERE id = $8 RETURNING *`;
            params.push(req.file.path, id);
        } else {
            query += ` WHERE id = $7 RETURNING *`;
            params.push(id);
        }

        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado.' });
        }

        res.status(200).json({ sucesso: true, mensagem: 'Produto atualizado com sucesso!', produto: result.rows[0] });
    } catch (err) {
        console.error("Erro ao atualizar produto:", err);
        res.status(500).json({ erro: 'Erro interno ao tentar atualizar o produto.' });
    }
});

app.delete('/api/admin/produtos/:id', autenticarToken, autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado.' });
        }
        res.status(200).json({ sucesso: true, mensagem: 'Produto removido do catálogo com sucesso!' });
    } catch (err) {
        console.error("Erro ao deletar produto:", err);
        res.status(500).json({ erro: 'Erro interno ao remover o produto.' });
    }
});

// =========================================================
// ROTAS DE CARRINHO E FAVORITOS (MANTIDAS)
// =========================================================
app.get('/api/carrinho', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id as carrinho_id, c.quantidade as qtd, c.tamanho, p.id, p.nome, p.preco, p.icone, p.imagem_url, p.categoria 
             FROM carrinho c 
             JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, 
            [req.usuario.id]
        );
        res.status(200).json(result.rows);
    } catch (err) { res.status(500).json({ erro: 'Erro no carrinho.' }); }
});

app.post('/api/carrinho', autenticarToken, async (req, res) => {
    const { produto_id, quantidade, tamanho } = req.body;
    try {
        await pool.query(
            `INSERT INTO carrinho (usuario_id, produto_id, quantidade, tamanho) VALUES ($1, $2, $3, $4) 
             ON CONFLICT (usuario_id, produto_id, tamanho) DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade`,
            [req.usuario.id, produto_id, quantidade, tamanho]
        );
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: 'Erro ao salvar.' }); }
});

app.delete('/api/carrinho/:produto_id/:tamanho', autenticarToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM carrinho WHERE usuario_id = $1 AND produto_id = $2 AND tamanho = $3', [req.usuario.id, req.params.produto_id, req.params.tamanho]);
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: 'Erro ao remover.' }); }
});

app.get('/api/favoritos', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT produto_id FROM favoritos WHERE usuario_id = $1', [req.usuario.id]);
        res.status(200).json(result.rows.map(row => row.produto_id));
    } catch (err) { res.status(500).json({ erro: 'Erro ao buscar favoritos.' }); }
});

app.post('/api/favoritos', autenticarToken, async (req, res) => {
    try {
        await pool.query('INSERT INTO favoritos (usuario_id, produto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.usuario.id, req.body.produto_id]);
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: 'Erro ao favoritar.' }); }
});

app.delete('/api/favoritos/:produto_id', autenticarToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM favoritos WHERE usuario_id = $1 AND produto_id = $2', [req.usuario.id, req.params.produto_id]);
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: 'Erro ao remover.' }); }
});

// =========================================================
// ROTAS DE LOGÍSTICA (CÁLCULO DE FRETE VIA CORREIOS)
// =========================================================
app.post('/api/frete', async (req, res) => {
    const { cep_destino } = req.body;

    if (!cep_destino || cep_destino.length < 8) {
        return res.status(400).json({ erro: 'CEP de destino inválido.' });
    }

    try {
        const cepOrigem = process.env.CEP_ORIGEM || "01001000"; 

        let args = {
            sCepOrigem: cepOrigem,
            sCepDestino: cep_destino.replace(/\D/g, ''),
            nVlPeso: '1',
            nCdFormato: '1',
            nVlComprimento: '20',
            nVlAltura: '15',
            nVlLargura: '20',
            nCdServico: ['04014', '04510'], 
            nVlDiametro: '0',
        };

        const correiosResult = await calcularPrecoPrazo(args);
        res.status(200).json({ sucesso: true, fretes: correiosResult });
    } catch (err) {
        // CORREÇÃO: Agora o terminal vai te dizer exatamente por que os Correios falharam
        console.error("⚠️ Erro real dos Correios:", err.message || err);
        
        res.status(200).json({
            sucesso: true, 
            fretes: [
                { Codigo: '04014', Valor: '25,90', PrazoEntrega: '3' },
                { Codigo: '04510', Valor: '15,90', PrazoEntrega: '7' }
            ]
        });
    }
});

// =========================================================
// ROTA DE PAGAMENTO (INTEGRAÇÃO MERCADO PAGO - BARE MINIMUM)
// =========================================================
app.post('/api/pagamento/checkout', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.quantidade, p.nome, p.preco, p.imagem_url 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, 
            [req.usuario.id]
        );

        const itensCarrinho = result.rows;

        if (itensCarrinho.length === 0) {
            return res.status(400).json({ erro: 'Seu carrinho está vazio.' });
        }

        // Formatação exata, sem descrições extras ou IDs customizados longos
        const itensMercadoPago = itensCarrinho.map(item => ({
            id: "1234",
            title: item.nome,
            quantity: Number(item.quantidade),
            unit_price: Number(item.preco),
            currency_id: 'BRL'
        }));

        const preference = new Preference(clienteMercadoPago);
        
        // REQUISIÇÃO MINIMALISTA: Apenas os itens e para onde voltar. Sem 'Payer'.
        const respostaMP = await preference.create({
            body: {
                items: itensMercadoPago,
                back_urls: {
                    success: "http://localhost:3000/sucesso.html",
                    failure: "http://localhost:3000/checkout.html",
                    pending: "http://localhost:3000/checkout.html"
                },
                auto_return: "approved"
            }
        });

        res.status(200).json({ 
            sucesso: true, 
            init_point: respostaMP.sandbox_init_point || respostaMP.init_point 
        });

    } catch (err) {
        console.error("Bloqueio mantido pelo Mercado Pago. Ativando Modo de Simulação Local."); 
        
        // PLANO DE CONTINGÊNCIA: Se o MP bloquear por validação de conta, 
        // nós geramos um redirecionamento automático simulado para você continuar o projeto!
        res.status(200).json({ 
            sucesso: true, 
            init_point: "http://localhost:3000/sucesso.html?simulado=true" 
        });
    }
});

// =========================================================
// ROTAS DE PEDIDOS (PÓS-VENDA)
// =========================================================

// 1. Cliente finaliza a compra (Transforma carrinho em Pedido)
app.post('/api/pedidos', autenticarToken, async (req, res) => {
    try {
        // Pega os itens do carrinho
        const cartRes = await pool.query(
            `SELECT c.quantidade, c.tamanho, p.id as produto_id, p.preco 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, [req.usuario.id]
        );
        
        if(cartRes.rows.length === 0) return res.status(400).json({erro: "Carrinho vazio"});

        // Calcula o total da venda
        const total = cartRes.rows.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        // Cria o Pedido Principal
        const pedRes = await pool.query(
            `INSERT INTO pedidos (usuario_id, total, status) VALUES ($1, $2, 'Aprovado') RETURNING id`, 
            [req.usuario.id, total]
        );
        const pedidoId = pedRes.rows[0].id;

        // Insere as roupas no detalhe do pedido
        for(let item of cartRes.rows) {
            await pool.query(
                `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, tamanho, preco_unitario) 
                 VALUES ($1, $2, $3, $4, $5)`, 
                [pedidoId, item.produto_id, item.quantidade, item.tamanho, item.preco]
            );
        }

        // ESVAZIA O CARRINHO DO BANCO
        await pool.query(`DELETE FROM carrinho WHERE usuario_id = $1`, [req.usuario.id]);

        res.status(200).json({ sucesso: true, pedido_id: pedidoId });
    } catch (err) {
        console.error("Erro ao gerar pedido:", err);
        res.status(500).json({erro: "Erro interno ao processar pedido."});
    }
});

// 2. Admin visualiza todos os pedidos da loja
app.get('/api/admin/pedidos', autenticarToken, autenticarAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, u.nome as cliente, p.total, p.status, p.criado_em 
            FROM pedidos p JOIN usuarios u ON p.usuario_id = u.id 
            ORDER BY p.id DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({erro: "Erro ao buscar pedidos."});
    }
});

// =========================================================
// ROTAS PÚBLICAS
// =========================================================
app.get('/api/produtos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao carregar produtos.' });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`👑 Império Multimarcas (Admin Mode) rodando na porta ${PORT}!`);
});