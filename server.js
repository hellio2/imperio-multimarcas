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
// Substitua a linha antiga de importação do MP por esta:
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
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
// ROTA DE CONFIGURAÇÃO (Envia a chave pública pro Frontend)
// =========================================================
app.get('/api/config/mp', (req, res) => {
    res.json({ publicKey: process.env.MP_PUBLIC_KEY });
});

// =========================================================
// ROTA DE WEBHOOK (NOTIFICAÇÕES DO MERCADO PAGO)
// =========================================================
app.post('/api/webhook', (req, res) => {
    // O Mercado Pago vai enviar "avisos" para esta rota automaticamente.
    // Retornar 200 OK imediatamente é uma exigência deles.
    res.status(200).send('OK');
    
    // Aqui no futuro você pode programar a lógica de atualizar o status do pedido 
    // no banco de dados de "Pendente" para "Aprovado" quando o Pix for pago.
    console.log("🔔 Webhook Recebido do MP:", req.query);
});

/*
// =========================================================
// ROTA DE PAGAMENTO (CHECKOUT BRICKS TRANPARENTE) -- TESTE
// =========================================================
app.post('/api/pagamento/processar', autenticarToken, async (req, res) => {
    try {
        const client = new Payment(clienteMercadoPago);
        const { transaction_amount, token, installments, payment_method_id, issuer_id, payer } = req.body;

        // INJEÇÃO FORÇADA: Cria um comprador 100% validado para evitar qualquer erro de API
        const paymentBody = {
            transaction_amount: Number(transaction_amount),
            description: 'Pedido - Império Multimarcas',
            payment_method_id: payment_method_id,
            payer: {
                email: `comprador_${Date.now()}@teste.com`, // E-mail aleatório para fugir da trava de vendedor
                first_name: payer?.first_name || "Cliente",
                last_name: payer?.last_name || "Teste",
                identification: payer?.identification || { type: "CPF", number: "19119119100" },
                address: {
                    zip_code: "01001000",
                    street_name: "Rua Fictícia",
                    street_number: "123",
                    neighborhood: "Centro",
                    city: "São Paulo",
                    federal_unit: "SP"
                }
            }
        };

        // Adiciona dados de cartão somente se for cartão
        if (token) paymentBody.token = token;
        if (installments) paymentBody.installments = Number(installments);
        if (issuer_id) paymentBody.issuer_id = issuer_id;

        const payment = await client.create({ body: paymentBody });

        // 6. Verifica o status real
        if (payment.status === 'approved' || payment.status === 'in_process' || payment.status === 'pending') {
            
            // CAPTURA DE DADOS DO PIX
            let pixResponse = null;
            if (payment.payment_method_id === 'pix' && payment.point_of_interaction) {
                pixResponse = {
                    qr_code: payment.point_of_interaction.transaction_data.qr_code,
                    qr_code_base64: payment.point_of_interaction.transaction_data.qr_code_base64
                };
            }

            res.status(200).json({ 
                sucesso: true, 
                id: payment.id, 
                status: payment.status, 
                metodo: payment.payment_method_id,
                pix: pixResponse // Manda o QR Code para o Frontend
            });

        } else {
            res.status(400).json({ erro: `Recusado: ${payment.status_detail}` });
        }

    } catch (err) {
        console.error("Erro no Processamento do Brick:", err.message || err);
        res.status(500).json({ erro: 'Erro interno ao processar o pagamento. Verifique o terminal.' });
    }
});
*/

// =========================================================
// ROTA DE PAGAMENTO (CHECKOUT BRICKS - HIPER RAIO-X PRODUÇÃO)
// =========================================================
app.post('/api/pagamento/processar', autenticarToken, async (req, res) => {
    try {
        const client = new Payment(clienteMercadoPago);
        const { transaction_amount, token, installments, payment_method_id, issuer_id, payer } = req.body;

        // 🚨 LOG 1: MONITORAMENTO DE INPUT DO FRONTEND
        console.log("\n=======================================================");
        console.log("📥 [RAIO-X FRONTEND] PAYLOAD BRUTO DO BRICK:");
        console.log(JSON.stringify(req.body, null, 2));
        console.log("=======================================================\n");

        // 1. Sanitização Robusta de Endereço e Dados Cadastrais
        const rawAddress = payer?.address || req.body;
        
        let uf = rawAddress.federal_unit || rawAddress.estado || "SP";
        const estadosBR = {
            "acre": "AC", "alagoas": "AL", "amapá": "AP", "amazonas": "AM", "bahia": "BA",
            "ceará": "CE", "distrito federal": "DF", "espírito santo": "ES", "goiás": "GO",
            "maranhão": "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
            "pará": "PA", "paraíba": "PB", "paraná": "PR", "pernambuco": "PE", "piauí": "PI",
            "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
            "rondônia": "RO", "roraima": "RR", "santa catarina": "SC", "são paulo": "SP",
            "sergipe": "SE", "tocantins": "TO"
        };
        if (uf.length > 2) {
            uf = estadosBR[uf.toLowerCase().trim()] || uf.substring(0, 2).toUpperCase();
        }

        let numeroBruto = rawAddress.street_number || rawAddress.numero || "S/N";
        const numerosExtraidos = String(numeroBruto).match(/\d+/);
        const numeroLimpo = numerosExtraidos ? numerosExtraidos[0] : "1";

        const enderecoFormatado = {
            zip_code: String(rawAddress.zip_code || rawAddress.cep || "01001000").replace(/\D/g, ''),
            street_name: String(rawAddress.street_name || rawAddress.rua || "Rua Principal").trim(),
            street_number: numeroLimpo,
            neighborhood: String(rawAddress.neighborhood || rawAddress.bairro || "Centro").trim(),
            city: String(rawAddress.city || rawAddress.cidade || "Cidade").trim(),
            federal_unit: uf.toUpperCase().trim()
        };

        // Separando Nome e Sobrenome de forma segura
        const nomeCompleto = (payer?.first_name || req.body.nome || "Cliente Teste").trim();
        const partesNome = nomeCompleto.split(" ");
        const firstName = partesNome[0];
        const lastName = partesNome.slice(1).join(" ") || "Silva";

        // 2. Busca e montagem do carrinho
        const cartRes = await pool.query(
            `SELECT c.quantidade, p.nome, p.preco, p.categoria 
             FROM carrinho c JOIN produtos p ON c.produto_id = p.id 
             WHERE c.usuario_id = $1`, [req.usuario.id]
        );

        const itensDoCarrinho = cartRes.rows.map(item => ({
            title: item.nome,
            description: `Roupas - ${item.nome}`,
            category_id: item.categoria || "fashion",
            quantity: Number(item.quantidade),
            unit_price: Number(item.preco)
        }));

        const referenciaExterna = `PEDIDO_USER${req.usuario.id}_${Date.now()}`;

        // 3. Montagem do Payload Final estruturando os nós adicionais exigidos contra fraude
        const paymentBody = {
            transaction_amount: Number(transaction_amount),
            description: 'Pedido - Império Multimarcas',
            statement_descriptor: 'IMPERIOMULTI',
            external_reference: referenciaExterna, 
            notification_url: 'https://imperio-multimarcas.onrender.com/api/webhook',
            payment_method_id: payment_method_id,
            additional_info: { 
                items: itensDoCarrinho,
                payer: {
                    first_name: firstName,
                    last_name: lastName,
                    address: {
                        zip_code: enderecoFormatado.zip_code,
                        street_name: enderecoFormatado.street_name,
                        street_number: Number(enderecoFormatado.street_number)
                    }
                }
            },
            payer: {
                email: (req.usuario.email || payer?.email || "cliente@email.com").trim(),
                first_name: firstName,
                last_name: lastName,
                identification: {
                    type: payer?.identification?.type || "CPF",
                    number: String(payer?.identification?.number || "").replace(/\D/g, '')
                },
                address: enderecoFormatado
            }
        };

        if (token) paymentBody.token = token;
        if (installments) paymentBody.installments = Number(installments);
        if (issuer_id) paymentBody.issuer_id = issuer_id;

        // 🚨 LOG 2: MONITORAMENTO DO PAYLOAD TRATADO ANTES DO ENVIO
        console.log("\n=======================================================");
        console.log("📤 [RAIO-X BACKEND] PAYLOAD SANITIZADO INDO PARA O MP:");
        console.log(JSON.stringify(paymentBody, null, 2));
        console.log("=======================================================\n");

        const chaveIdempotencia = `IDEMP_${req.usuario.id}_${Date.now()}`;

        const payment = await client.create({ 
            body: paymentBody,
            requestOptions: { idempotencyKey: chaveIdempotencia }
        });

        // 🚨 LOG 3: RESPOSTA CRUA DO MERCADO PAGO DO SEU AMBIENTE
        console.log("\n=======================================================");
        console.log("💥 [RAIO-X MERCADO PAGO] RESPOSTA COMPLETA DA FINANCIAL:");
        console.log(`Status Obtido: ${payment.status}`);
        console.log(`Detalhe do Status: ${payment.status_detail}`);
        if (payment.api_response) {
            console.log("Corpo de Resposta do Servidor do MP:");
            console.log(JSON.stringify(payment.api_response, null, 2));
        }
        console.log("=======================================================\n");

        if (payment.status === 'approved' || payment.status === 'in_process' || payment.status === 'pending') {
            let pixResponse = null;
            let boletoResponse = null;

            if (payment.payment_method_id === 'pix' && payment.point_of_interaction) {
                pixResponse = {
                    qr_code: payment.point_of_interaction.transaction_data.qr_code,
                    qr_code_base64: payment.point_of_interaction.transaction_data.qr_code_base64
                };
            } 
            else if (payment.payment_type_id === 'ticket') {
                boletoResponse = {
                    url: payment.transaction_details?.external_resource_url, 
                    linha_digitavel: payment.barcode?.content 
                };
            }

            res.status(200).json({ 
                sucesso: true, 
                id: payment.id, 
                status: payment.status, 
                metodo: payment.payment_method_id,
                pix: pixResponse,
                boleto: boletoResponse
            });
        } else {
            res.status(400).json({ erro: `Recusado: ${payment.status_detail}` });
        }

    } catch (err) {
        console.error("\n❌ [RAIO-X ERROR] FALHA CRÍTICA NO CATCH DA ROTA:");
        console.error(err.message || err);
        if (err.cause) console.error("Causa:", JSON.stringify(err.cause, null, 2));
        res.status(500).json({ erro: 'Erro interno ao processar o pagamento.' });
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