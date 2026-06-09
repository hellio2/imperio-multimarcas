let PRODUTOS_DB = [];

async function carregarProdutosDoBanco() {
    try {
        const resposta = await fetch('/api/produtos');
        if (!resposta.ok) throw new Error('Erro ao buscar dados do servidor');
        PRODUTOS_DB = await resposta.json();
        atualizarContadores(); 
        document.dispatchEvent(new Event('produtosCarregados'));
    } catch (erro) {
        console.error('⚠️ Não foi possível carregar os produtos do banco.', erro);
        document.dispatchEvent(new Event('produtosCarregados'));
    }
}

async function sincronizarCarrinhoDoBanco() {
    const token = localStorage.getItem('equilibrio_token');
    if (!token) return;

    try {
        const resposta = await fetch('/api/carrinho', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resposta.ok) {
            const itensBanco = await resposta.json();
            localStorage.setItem("equilibrio_cart", JSON.stringify(itensBanco));
            atualizarContadores();
        }
    } catch (err) {
        console.error("Erro ao sincronizar carrinho com o banco:", err);
    }
}

async function sincronizarFavoritosDoBanco() {
    const token = localStorage.getItem('equilibrio_token');
    if (!token) return;

    try {
        const resposta = await fetch('/api/favoritos', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resposta.ok) {
            const favsBanco = await resposta.json();
            localStorage.setItem("equilibrio_favorites", JSON.stringify(favsBanco));
            atualizarContadores();
        }
    } catch (err) {
        console.error("Erro ao sincronizar favoritos com o banco:", err);
    }
}

if (!localStorage.getItem("equilibrio_cart")) localStorage.setItem("equilibrio_cart", JSON.stringify([]));
if (!localStorage.getItem("equilibrio_favorites")) localStorage.setItem("equilibrio_favorites", JSON.stringify([]));

function mostrarNotificacao(mensagem) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<i class="fas fa-check-circle" style="color: var(--cor-primaria); margin-right: 8px;"></i> ${mensagem}`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add("show"); }, 10);
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function atualizarContadores() {
    const cart = JSON.parse(localStorage.getItem("equilibrio_cart") || "[]");
    let favs = JSON.parse(localStorage.getItem("equilibrio_favorites") || "[]");
    
    if (PRODUTOS_DB.length > 0) {
        const favsValidos = favs.filter(id => PRODUTOS_DB.some(p => p.id === id));
        if (favsValidos.length !== favs.length) {
            favs = favsValidos;
            localStorage.setItem("equilibrio_favorites", JSON.stringify(favs));
        }
    }
    
    const cartCount = cart.reduce((acc, item) => acc + item.qtd, 0);
    document.querySelectorAll("#cart-badge").forEach(badge => badge.innerText = cartCount);
    document.querySelectorAll("#fav-badge").forEach(badge => badge.innerText = favs.length);
}

function formatarMoeda(valor) {
    const numero = typeof valor === 'string' ? parseFloat(valor) : valor;
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

document.addEventListener("DOMContentLoaded", async () => {
    await carregarProdutosDoBanco();
    await sincronizarCarrinhoDoBanco(); 
    await sincronizarFavoritosDoBanco();
    
    const menuToggle = document.querySelector(".menu-toggle");
    const navMenu = document.querySelector(".nav-menu");
    if (menuToggle && navMenu) {
        menuToggle.addEventListener("click", () => {
            navMenu.classList.toggle("active");
        });
    }

    const cartOverlay = document.getElementById("cart-overlay");
    const cartDrawer = document.getElementById("cart-drawer");
    const closeCartBtn = document.getElementById("close-cart-btn");
    
    document.querySelectorAll(".action-icon.open-cart").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            cartOverlay.classList.add("active");
            cartDrawer.classList.add("active");
            renderizarMinicart();
        });
    });

    const fecharCarrinho = () => {
        if (cartOverlay) cartOverlay.classList.remove("active");
        if (cartDrawer) cartDrawer.classList.remove("active");
    };
    if (closeCartBtn) closeCartBtn.addEventListener("click", fecharCarrinho);
    if (cartOverlay) cartOverlay.addEventListener("click", fecharCarrinho);
});

async function adicionarAoCarrinhoGlobal(id, qtd = 1, tamanho = "M") {
    const token = localStorage.getItem('equilibrio_token');
    
    if (token) {
        try {
            await fetch('/api/carrinho', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ produto_id: id, quantidade: qtd, tamanho: tamanho })
            });
        } catch (err) {
            console.error("Não foi possível persistir no banco de dados:", err);
        }
    }

    let cart = JSON.parse(localStorage.getItem("equilibrio_cart") || "[]");
    const itemExistente = cart.find(item => item.id === id && item.tamanho === tamanho);
    if (itemExistente) {
        itemExistente.qtd += qtd;
    } else {
        cart.push({ id, qtd, tamanho });
    }
    localStorage.setItem("equilibrio_cart", JSON.stringify(cart));
    
    if (token) await sincronizarCarrinhoDoBanco();
    
    atualizarContadores();
    mostrarNotificacao("Adicionado ao seu Equilíbrio de compras!");
    
    document.getElementById("cart-overlay").classList.add("active");
    document.getElementById("cart-drawer").classList.add("active");
    renderizarMinicart();
}

function renderizarMinicart() {
    const minicartBody = document.getElementById("minicart-body");
    const minicartTotal = document.getElementById("minicart-total");
    if (!minicartBody) return;

    const cart = JSON.parse(localStorage.getItem("equilibrio_cart") || "[]");
    let subtotal = 0;

    if (cart.length === 0) {
        minicartBody.innerHTML = `<p style="text-align:center; padding: 40px 0; color: #666;">Seu carrinho está vazio.</p>`;
        minicartTotal.innerText = formatarMoeda(0);
        return;
    }

    minicartBody.innerHTML = cart.map(item => {
        const prod = PRODUTOS_DB.find(p => p.id === item.id);
        if (!prod) return '';
        const valor = prod.preco * item.qtd;
        subtotal += valor;
        return `
            <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                <div style="display:flex; gap: 10px; align-items: center;">
                    <div class="minicart-img-box" style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; background: #f4f6f9; border-radius: 4px; overflow: hidden;">
                        ${prod.imagem_url ? `<img src="${prod.imagem_url}" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:1.5rem;">👕</span>`}
                    </div>
                    <div>
                        <h4 style="font-size:0.9rem;">${prod.nome}</h4>
                        <p style="font-size:0.8rem; color:#666;">Tam: ${item.tamanho} | Qtd: ${item.qtd}</p>
                        <p style="font-weight:bold; color:var(--cor-texto-principal);">${formatarMoeda(valor)}</p>
                    </div>
                </div>
                <button onclick="removerDoCarrinhoGlobal(${item.id}, '${item.tamanho}')" style="background:none; border:none; color:#dc3545; cursor:pointer; font-size: 1.1rem; padding: 5px;">
                    <i class="far fa-trash-alt"></i>
                </button>
            </div>
        `;
    }).join('');

    minicartTotal.innerText = formatarMoeda(subtotal);
}

// Remove o item do banco de dados e do navegador
async function removerDoCarrinhoGlobal(id, tamanho) {
    const token = localStorage.getItem('equilibrio_token');
    
    if (token) {
        try {
            await fetch(`/api/carrinho/${id}/${tamanho}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) { console.error("Erro ao deletar do banco:", err); }
    }

    let cart = JSON.parse(localStorage.getItem("equilibrio_cart") || "[]");
    cart = cart.filter(i => !(i.id === id && i.tamanho === tamanho));
    localStorage.setItem("equilibrio_cart", JSON.stringify(cart));
    
    atualizarContadores();
    renderizarMinicart();
    
    // Atualiza a página inteira do carrinho se o usuário estiver nela
    if (typeof renderizarCarrinhoPagina === 'function') renderizarCarrinhoPagina();
}

document.addEventListener("DOMContentLoaded", () => {
    // Busca o Token de segurança salvo no navegador
    const token = localStorage.getItem('equilibrio_token');
    const containerAdmin = document.getElementById("menu-admin-container");

    // === NOVO: REDIRECIONA O ÍCONE DE USUÁRIO PARA MINHA CONTA ===
    const iconeUsuario = document.querySelector('a[href="login.html"]');
    if (iconeUsuario && token) {
        iconeUsuario.href = 'minha-conta.html';
    }
    // =============================================================

    if (containerAdmin && token) {
        try {
            // Decodifica o Token JWT magicamente sem precisar do backend
            const payloadBase64 = token.split('.')[1];
            const decodedJson = atob(payloadBase64);
            const usuarioLogado = JSON.parse(decodedJson);

            // Injeta o botão apenas se o payload confirmar que é admin
            if (usuarioLogado.role === 'admin') {
                containerAdmin.innerHTML = `
                    <a href="admin.html" class="btn-admin-dashboard" style="background: #dc3545; color: #fff; padding: 8px 15px; border-radius: 4px; font-weight: bold; text-decoration: none; margin-right: 10px; display: inline-flex; align-items: center; gap: 5px;">
                        <i class="fas fa-user-shield"></i> Admin
                    </a>
                `;
            }
        } catch (e) {
            console.error("Erro ao decodificar permissões de admin:", e);
        }
    }
});