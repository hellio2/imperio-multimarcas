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

// PAGAMENTO E FRETE
const { calcularPrecoPrazo } = require('correios-brasil');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
        folder: 'equilibrio_produtos',
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
// ROTAS DE AUTENTICAÇÃO
// =========================================================
// =========================================================
// ROTA DE CADASTRO SANITIZADA E CORRIGIDA
// =========================================================
app.post('/api/auth/cadastro', async (req, res) => {
    // Tratamento preventivo: se req.body não vier definido por falha de requisição
    const body = req.body || {};
    
    const { 
        nome, email, senha, telefone, cep, 
        logradouro, numero, complemento, bairro, 
        cidade, estado 
    } = body;

    // Validação estrita dos campos vitais
    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, E-mail e Senha).' });
    }

    try {
        // Normaliza o e-mail para evitar duplicidade com letras maiúsculas/minúsculas
        const emailNormalizado = email.toLowerCase().trim();

        const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [emailNormalizado]);
        if (usuarioExistente.rows.length > 0) {
            return res.status(400).json({ erro: 'Este e-mail já está cadastrado no sistema.' });
        }

        // Criptografia da senha com salt seguro
        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);

        // Substituição de campos vazios/undefined por strings vazias ou NULL para o PostgreSQL aceitar sem quebras
        const params = [
            nome.trim(),
            emailNormalizado,
            senhaCriptografada,
            telefone ? telefone.trim() : '',
            cep ? cep.replace(/\D/g, '') : '', // Armazena apenas os números do CEP
            logradouro ? logradouro.trim() : '',
            numero ? numero.trim() : '',
            complemento ? complemento.trim() : '', // Aceita vazio sem quebrar
            bairro ? bairro.trim() : '',
            cidade ? cidade.trim() : '',
            estado ? estado.trim().toUpperCase() : ''
        ];

        const novoUsuario = await pool.query(
            `INSERT INTO usuarios (
                nome, email, senha_hash, telefone, cep, 
                logradouro, numero, complemento, bairro, cidade, estado
             ) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING id, nome, email`,
            params
        );

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Conta criada com sucesso!', 
            usuario: novoUsuario.rows[0] 
        });

    } catch (err) {
        console.error("❌ Erro Crítico no Processo de Cadastro:", err.message || err);
        res.status(500).json({ erro: 'Erro interno no servidor ao processar o cadastro.' });
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
        res.status(500).json({ erro: 'Erro interno no login.' });
    }
});

// =========================================================
// ROTAS ADMINISTRATIVAS
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
        res.status(201).json({ sucesso: true, mensagem: 'Produto cadastrado!', produto: result.rows[0] });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao cadastrar o produto.' });
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
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
        res.status(200).json({ sucesso: true, mensagem: 'Produto atualizado!', produto: result.rows[0] });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar produto.' });
    }
});

app.delete('/api/admin/produtos/:id', autenticarToken, autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
        res.status(200).json({ sucesso: true, mensagem: 'Produto removido!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao remover produto.' });
    }
});

// =========================================================
// ROTAS DE CARRINHO E FAVORITOS
// =========================================================
app.get('/api/carrinho', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id as carrinho_id, c.quantidade as qtd, c.tamanho, p.id, p.nome, p.preco, p.icone, p.imagem_url, p.categoria 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id WHERE c.usuario_id = $1`, 
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
// ROTAS DE LOGÍSTICA (CÁLCULO DE FRETE VIA CORREIOS - CORRIGIDO)
// =========================================================
app.post('/api/frete', async (req, res) => {
    const { cep_destino } = req.body;

    if (!cep_destino || cep_destino.replace(/\D/g, '').length < 8) {
        return res.status(400).json({ erro: 'CEP de destino inválido. Digite 8 números.' });
    }

    try {
        const cepOrigem = process.env.CEP_ORIGEM || "01001000"; 
        const cepLimpoDestino = cep_destino.replace(/\D/g, '');

        // Configuração conforme a API mais recente dos Correios-Brasil
        let args = {
            sCepOrigem: cepOrigem,
            sCepDestino: cepLimpoDestino,
            nVlPeso: '0.5', // Peso padrão para roupas (500g)
            nCdFormato: '1', // 1 para Caixa/Pacote
            nVlComprimento: '20',
            nVlAltura: '5',
            nVlLargura: '15',
            nCdServico: ['04014', '04510'], // SEDEX à vista e PAC à vista
            nVlDiametro: '0',
        };

        const correiosResult = await calcularPrecoPrazo(args);

        // Tratamento de segurança: se a API retornar mas vier com erro interno dos Correios
        if (!correiosResult || correiosResult.length === 0 || correiosResult[0].MsgErro) {
            throw new Error(correiosResult[0]?.MsgErro || "Erro interno na resposta dos Correios");
        }

        res.status(200).json({ sucesso: true, fretes: correiosResult });
    } catch (err) {
        console.error("⚠️ Falha na API dos Correios, aplicando contingência comercial:", err.message || err);
        
        // Valores baseados em tabelas comerciais reais para e-commerce (Evita travar o carrinho do cliente)
        res.status(200).json({
            sucesso: true, 
            fretes: [
                { Codigo: '04014', Valor: '22,50', PrazoEntrega: '2 a 4' }, // Simulação Sedex
                { Codigo: '04510', Valor: '14,80', PrazoEntrega: '5 a 8' }  // Simulação PAC
            ]
        });
    }
});

app.get('/api/config/stripe', (req, res) => {
    res.json({ publicKey: process.env.STRIPE_PUBLIC_KEY });
});

// =========================================================
// ROTA DE PAGAMENTO HÍBRIDA (STRIPE + ASAAS BLINDADA)
// =========================================================
app.post('/api/pagamento/processar', autenticarToken, async (req, res) => {
    try {
        const { metodo, cpf } = req.body;
        
        const cartRes = await pool.query(
            `SELECT c.quantidade, p.nome, p.preco 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, [req.usuario.id]
        );

        if (cartRes.rows.length === 0) return res.status(400).json({ erro: 'Carrinho vazio.' });
        const totalCarrinho = cartRes.rows.reduce((acc, item) => acc + (Number(item.preco) * Number(item.quantidade)), 0);

        // 🔀 STRIPE (CARTÃO)
        if (metodo === 'cartao') {
            const valorEmCentavos = Math.round(totalCarrinho * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: valorEmCentavos, currency: 'brl',
                metadata: { usuario_id: req.usuario.id },
                automatic_payment_methods: { enabled: true },
            });
            return res.status(200).json({ gateway: 'stripe', clientSecret: paymentIntent.client_secret });
        }

        // 🔀 ASAAS (PIX E BOLETO)
        else if (metodo === 'pix' || metodo === 'boleto') {
            const asaasUrl = 'https://api-sandbox.asaas.com/v3'; //TESTE
            //const asaasUrl = 'https://api.asaas.com/v3'; //PRODUÇÃO
            const asaasHeaders = {
                'Content-Type': 'application/json',
                'access_token': process.env.ASAAS_API_KEY
            };

            // Passo A: Cliente
            const customerReq = await fetch(`${asaasUrl}/customers`, {
                method: 'POST', headers: asaasHeaders,
                body: JSON.stringify({
                    name: req.usuario.nome || 'Cliente Teste',
                    email: req.usuario.email || 'teste@email.com',
                    cpfCnpj: cpf
                })
            });
            const customerData = await customerReq.json();

            // 🚨 BLINDAGEM 1: Erro de Cliente/CPF
            if (customerData.errors) {
                console.error("Erro Asaas (Cliente):", customerData.errors);
                return res.status(400).json({ erro: customerData.errors[0].description });
            }

            // Passo B: Cobrança
            let dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 3);

            const paymentReq = await fetch(`${asaasUrl}/payments`, {
                method: 'POST', headers: asaasHeaders,
                body: JSON.stringify({
                    customer: customerData.id,
                    billingType: metodo.toUpperCase(),
                    value: Number(totalCarrinho),
                    dueDate: dueDate.toISOString().split('T')[0],
                    description: 'Pedido - Equilíbrio Multimarcas'
                })
            });
            const paymentData = await paymentReq.json();

            // 🚨 BLINDAGEM 2: Erro de Cobrança
            if (paymentData.errors) {
                console.error("Erro Asaas (Cobrança):", paymentData.errors);
                return res.status(400).json({ erro: paymentData.errors[0].description });
            }

            // Passo C: QR Code (se for Pix)
            let qrCodeData = null;
            if (metodo === 'pix') {
                const qrReq = await fetch(`${asaasUrl}/payments/${paymentData.id}/pixQrCode`, { headers: asaasHeaders });
                qrCodeData = await qrReq.json();
                
                // 🚨 BLINDAGEM 3: Erro do QR Code
                if (qrCodeData.errors) {
                    return res.status(400).json({ erro: qrCodeData.errors[0].description });
                }
            }

            return res.status(200).json({
                gateway: 'asaas',
                cobranca_id: paymentData.id,
                boleto_url: paymentData.bankSlipUrl,
                pix_qrcode: qrCodeData?.encodedImage,
                pix_copia_cola: qrCodeData?.payload
            });
        } 
        else { return res.status(400).json({ erro: 'Método não reconhecido.' }); }

    } catch (err) {
        console.error("❌ Erro no Roteamento:", err);
        res.status(500).json({ erro: 'Erro interno no processamento.' });
    }
});

// =========================================================
// WEBHOOK DO ASAAS (SINAL DE PAGAMENTO RECEBIDO)
// =========================================================
app.post('/api/webhooks/asaas', async (req, res) => {
    // O Asaas envia o aviso no formato event = 'PAYMENT_RECEIVED'
    const evento = req.body;

    if (evento.event === 'PAYMENT_RECEIVED' || evento.event === 'PAYMENT_CONFIRMED') {
        // Aqui a mágica acontece: Pega o ID da cobrança paga
        const asaasCobrancaId = evento.payment.id;
        
        try {
            // Em um sistema 100% completo, você teria uma coluna "transacao_id" na tabela pedidos.
            // Quando ele paga, o sistema busca o pedido por esse transacao_id e muda para Aprovado:
            /*
            await pool.query(
                "UPDATE pedidos SET status = 'Aprovado' WHERE transacao_id = $1", 
                [asaasCobrancaId]
            );
            */
            console.log(`✅ Uau! O Asaas avisou que a cobrança ${asaasCobrancaId} foi paga!`);
            
        } catch (err) {
            console.error("Erro ao atualizar pedido via Webhook:", err);
        }
    }

    // Você SEMPRE deve devolver status 200 pro Asaas, senão ele acha que seu site caiu e tenta de novo.
    res.status(200).send('OK'); 
});

// =========================================================
// ROTAS DE PEDIDOS E PÚBLICAS
// =========================================================
app.post('/api/pedidos', autenticarToken, async (req, res) => {
    try {
        const cartRes = await pool.query(
            `SELECT c.quantidade, c.tamanho, p.id as produto_id, p.preco 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id WHERE c.usuario_id = $1`, [req.usuario.id]
        );
        if(cartRes.rows.length === 0) return res.status(400).json({erro: "Carrinho vazio"});

        const total = cartRes.rows.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        const pedRes = await pool.query(
            `INSERT INTO pedidos (usuario_id, total, status) VALUES ($1, $2, 'Pendente') RETURNING id`, 
            [req.usuario.id, total]
        );
        const pedidoId = pedRes.rows[0].id;

        for(let item of cartRes.rows) {
            await pool.query(
                `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, tamanho, preco_unitario) 
                 VALUES ($1, $2, $3, $4, $5)`, 
                [pedidoId, item.produto_id, item.quantidade, item.tamanho, item.preco]
            );
        }
        await pool.query(`DELETE FROM carrinho WHERE usuario_id = $1`, [req.usuario.id]);
        res.status(200).json({ sucesso: true, pedido_id: pedidoId });
    } catch (err) { res.status(500).json({erro: "Erro ao gerar pedido."}); }
});

app.get('/api/admin/pedidos', autenticarToken, autenticarAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, u.nome as cliente, p.total, p.status, p.criado_em, p.codigo_rastreio 
            FROM pedidos p JOIN usuarios u ON p.usuario_id = u.id ORDER BY p.id DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) { 
        res.status(500).json({erro: "Erro ao buscar pedidos."}); 
    }
});

// Rota para o Admin atualizar o Rastreio
app.put('/api/admin/pedidos/:id/rastreio', autenticarToken, autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { codigo_rastreio } = req.body;
    try {
        // Atualiza o código e já muda o status para "Enviado"
        await pool.query(
            `UPDATE pedidos SET codigo_rastreio = $1, status = 'Enviado' WHERE id = $2`, 
            [codigo_rastreio, id]
        );
        res.status(200).json({ sucesso: true });
    } catch (err) { 
        res.status(500).json({erro: "Erro ao salvar rastreio."}); 
    }
});

app.get('/api/produtos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (err) { res.status(500).json({ erro: 'Erro ao carregar produtos.' }); }
});

// =========================================================
// ROTAS DO PAINEL DO CLIENTE (PERFIL E MEUS PEDIDOS)
// =========================================================

// Busca os dados do cliente para preencher o perfil e o checkout
app.get('/api/usuario/perfil', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT nome, email, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado FROM usuarios WHERE id = $1', 
            [req.usuario.id]
        );
        res.status(200).json(result.rows[0]);
    } catch (err) { res.status(500).json({ erro: 'Erro ao carregar perfil.' }); }
});

// Atualiza os dados do cliente
app.put('/api/usuario/perfil', autenticarToken, async (req, res) => {
    const { nome, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;
    try {
        await pool.query(
            `UPDATE usuarios SET nome=$1, telefone=$2, cep=$3, logradouro=$4, numero=$5, complemento=$6, bairro=$7, cidade=$8, estado=$9 WHERE id=$10`,
            [nome, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado, req.usuario.id]
        );
        res.status(200).json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso!' });
    } catch (err) { res.status(500).json({ erro: 'Erro ao atualizar perfil.' }); }
});

// Busca o histórico de compras do cliente logado
app.get('/api/meus-pedidos', autenticarToken, async (req, res) => {
    try {
        const pedidosRes = await pool.query(
            `SELECT id, total, status, criado_em, codigo_rastreio FROM pedidos WHERE usuario_id = $1 ORDER BY id DESC`, 
            [req.usuario.id]
        );
        
        const pedidos = pedidosRes.rows;
        // Puxa as roupas de cada pedido
        for (let pedido of pedidos) {
            const itensRes = await pool.query(
                `SELECT p.nome, p.imagem_url, i.quantidade, i.tamanho, i.preco_unitario 
                 FROM itens_pedido i JOIN produtos p ON i.produto_id = p.id WHERE i.pedido_id = $1`, 
                [pedido.id]
            );
            pedido.itens = itensRes.rows;
        }
        res.status(200).json(pedidos);
    } catch (err) { 
        res.status(500).json({ erro: 'Erro ao buscar histórico de pedidos.' }); 
    }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`👑 Equilíbrio Multimarcas (Admin Mode) rodando na porta ${PORT}!`));