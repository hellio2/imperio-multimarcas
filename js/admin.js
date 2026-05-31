// Armazenamento local temporário dos produtos carregados para consulta rápida
let PRODUTOS_LOCAL_LIST = [];

// VERIFICAÇÃO CRÍTICA DE PERMISSÃO AO CARREGAR A TELA
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem('imperio_token');
    const userJson = localStorage.getItem('imperio_user');

    if (!token || !userJson) {
        alert("Acesso restrito. Faça login para continuar.");
        window.location.href = 'login.html';
        return;
    }

    const usuario = JSON.parse(userJson);
    if (usuario.role !== 'admin') {
        alert("Acesso negado. Esta área é restrita aos administradores do Império.");
        window.location.href = 'index.html';
        return;
    }

    carregarProdutosDoCatalogo();
});

function alternarPainel(idAba) {
    document.querySelectorAll('.admin-nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.remove('active'));

    event.currentTarget.classList.add('active');
    document.getElementById(`panel-${idAba}`).classList.add('active');

    if (idAba === 'catalogo') {
        carregarProdutosDoCatalogo();
    }
    if (idAba === 'pedidos') carregarPedidosAdmin(); // <-- ADICIONE ESTA LINHA
}

function mostrarNotificacaoAdmin(mensagem, tipo = 'success') {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast show`;
    toast.style.borderLeft = tipo === 'success' ? '4px solid #28a745' : '4px solid #dc3545';
    toast.innerHTML = `<i class="fas ${tipo === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}" style="margin-right: 8px;"></i> ${mensagem}`;
    
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

// =========================================================
// AÇÃO 1: CADASTRAR PRODUTO (POST)
// =========================================================
document.getElementById('form-novo-produto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('imperio_token');
    const form = document.getElementById('form-novo-produto');
    
    const formData = new FormData();
    formData.append('nome', document.getElementById('prod-nome').value);
    formData.append('categoria', document.getElementById('prod-categoria').value);
    formData.append('preco', document.getElementById('prod-preco').value);
    formData.append('preco_antigo', document.getElementById('prod-preco-antigo').value);
    formData.append('estoque', document.getElementById('prod-estoque').value);
    formData.append('descricao', document.getElementById('prod-descricao').value);
    formData.append('imagem', document.getElementById('prod-imagem').files[0]);

    try {
        const resposta = await fetch('/api/admin/produtos', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const dados = await resposta.json();
        if (resposta.ok) {
            mostrarNotificacaoAdmin('Produto cadastrado e foto hospedada com sucesso!');
            form.reset();
        } else {
            mostrarNotificacaoAdmin(dados.erro || 'Erro ao publicar produto.', 'error');
        }
    } catch (err) {
        mostrarNotificacaoAdmin('Erro ao conectar com o servidor.', 'error');
    }
});

// =========================================================
// LISTAR PRODUTOS NA PLANILHA DO PAINEL
// =========================================================
async function carregarProdutosDoCatalogo() {
    const listaTable = document.getElementById('admin-produtos-lista');
    if (!listaTable) return;

    try {
        const resposta = await fetch('/api/produtos');
        const produtos = await resposta.json();
        
        // Guarda na memória local do script para usarmos na edição
        PRODUTOS_LOCAL_LIST = produtos;

        if (produtos.length === 0) {
            listaTable.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">Nenhum produto cadastrado no catálogo.</td></tr>`;
            return;
        }

        listaTable.innerHTML = produtos.map(prod => `
            <tr>
                <td>
                    <div class="admin-table-img">
                        ${prod.imagem_url ? `<img src="${prod.imagem_url}">` : `<span>👕</span>`}
                    </div>
                </td>
                <td style="font-weight:600;">${prod.nome}</td>
                <td>${prod.categoria}</td>
                <td style="font-weight:700;">R$ ${parseFloat(prod.preco).toFixed(2)}</td>
                <td>${prod.estoque} un</td>
                <td>
                    <button class="table-action-btn edit" onclick="abrirModalEditar(${prod.id})" style="margin-right:5px;">
                        <i class="far fa-edit"></i> Editar
                    </button>
                    <button class="table-action-btn delete" onclick="deletarProduto(${prod.id})">
                        <i class="far fa-trash-alt"></i> Excluir
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        listaTable.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red; padding: 20px;">Erro de conexão ao carregar catálogo.</td></tr>`;
    }
}

// =========================================================
// AÇÃO 2: CONTROLAR FILTRAGEM E PREENCHIMENTO DO MODAL (EDIT)
// =========================================================
function abrirModalEditar(id) {
    // Localiza os dados do produto clicado na lista que guardamos
    const prod = PRODUTOS_LOCAL_LIST.find(p => p.id === id);
    if (!prod) return;

    // Preenche as caixas de texto do Modal com as informações atuais do Postgres
    document.getElementById('edit-prod-id').value = prod.id;
    document.getElementById('edit-prod-name').value = prod.nome;
    document.getElementById('edit-prod-categoria').value = prod.categoria;
    document.getElementById('edit-prod-preco').value = prod.preco;
    document.getElementById('edit-prod-preco-antigo').value = prod.preco_antigo || '';
    document.getElementById('edit-prod-estoque').value = prod.estoque;
    document.getElementById('edit-prod-descricao').value = prod.descricao || '';

    // Abre a janela flutuante adicionando a classe CSS
    document.getElementById('modal-editar').classList.add('active');
}

function fecharModalEditar() {
    document.getElementById('modal-editar').classList.remove('active');
    document.getElementById('form-editar-produto').reset();
}

// INTERCEPTA O ENVIO DE SALVAR DA JANELA DE EDIÇÃO (PUT)
document.getElementById('form-editar-produto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('imperio_token');
    const id = document.getElementById('edit-prod-id').value;

    const formData = new FormData();
    formData.append('nome', document.getElementById('edit-prod-name').value);
    formData.append('categoria', document.getElementById('edit-prod-categoria').value);
    formData.append('preco', document.getElementById('edit-prod-preco').value);
    formData.append('preco_antigo', document.getElementById('edit-prod-preco-antigo').value);
    formData.append('estoque', document.getElementById('edit-prod-estoque').value);
    formData.append('descricao', document.getElementById('edit-prod-descricao').value);
    
    // Só envia a foto se o usuário selecionou algum arquivo novo
    const fotoInput = document.getElementById('edit-prod-imagem');
    if (fotoInput.files.length > 0) {
        formData.append('imagem', fotoInput.files[0]);
    }

    try {
        const resposta = await fetch(`/api/admin/produtos/${id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const dados = await resposta.json();
        if (resposta.ok) {
            mostrarNotificacaoAdmin('Produto e fotos atualizados com absoluto sucesso!');
            fecharModalEditar();
            carregarProdutosDoCatalogo(); // Recarrega a planilha na hora
        } else {
            mostrarNotificacaoAdmin(dados.erro || 'Erro ao atualizar produto.', 'error');
        }
    } catch (err) {
        mostrarNotificacaoAdmin('Erro ao conectar com o servidor.', 'error');
    }
});

// =========================================================
// AÇÃO 3: REMOVER ITEM DO BANCO (DELETE)
// =========================================================
async function deletarProduto(id) {
    if (!confirm("Tem certeza absoluta de que deseja remover esta peça do catálogo do Império definitivamente?")) return;

    const token = localStorage.getItem('imperio_token');

    try {
        const resposta = await fetch(`/api/admin/produtos/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const dados = await resposta.json();
        if (resposta.ok) {
            mostrarNotificacaoAdmin('Produto removido do seu catálogo!');
            carregarProdutosDoCatalogo(); // Atualiza a tabela na hora
        } else {
            mostrarNotificacaoAdmin(dados.erro || 'Erro ao deletar produto.', 'error');
        }
    } catch (err) {
        mostrarNotificacaoAdmin('Erro ao conectar com o servidor.', 'error');
    }
}
// =========================================================
// GESTÃO DE PEDIDOS (ADMIN)
// =========================================================
async function carregarPedidosAdmin() {
    const tbody = document.querySelector('#panel-pedidos tbody');
    if (!tbody) return;

    const token = localStorage.getItem('imperio_token');
    
    try {
        const resposta = await fetch('/api/admin/pedidos', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const pedidos = await resposta.json();

        if (pedidos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum pedido realizado ainda.</td></tr>`;
            return;
        }

        tbody.innerHTML = pedidos.map(p => {
            const dataFormatada = new Date(p.criado_em).toLocaleDateString('pt-BR');
            const totalFormatado = parseFloat(p.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            return `
                <tr>
                    <td style="font-weight:bold;">#${p.id}</td>
                    <td>${p.cliente}</td>
                    <td>${dataFormatada}</td>
                    <td style="font-weight:bold;">${totalFormatado}</td>
                    <td><span class="status-badge" style="background:#d4edda; color:#155724;">${p.status}</span></td>
                    <td>
                        <button class="table-action-btn edit" onclick="alert('Funcionalidade de despacho em desenvolvimento.')">
                            <i class="fas fa-truck"></i> Enviar
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Erro ao carregar pedidos.</td></tr>`;
    }
}