// Adicionar item ao carrinho em qualquer página
function adicionarAoCarrinhoGlobal(id, qtd = 1, tamanho = "M") {
    let cart = JSON.parse(localStorage.getItem("imperio_cart") || "[]");
    const itemExistente = cart.find(item => item.id === id && item.tamanho === tamanho);
    
    if (itemExistente) {
        itemExistente.qtd += qtd;
    } else {
        cart.push({ id, qtd, tamanho });
    }
    
    localStorage.setItem("imperio_cart", JSON.stringify(cart));
    atualizarContadores();
    alert("Produto adicionado ao carrinho do Império!");
}

// Alterar quantidade na página do carrinho
function mudarQtd(id, tamanho, delta) {
    let cart = JSON.parse(localStorage.getItem("imperio_cart") || "[]");
    const item = cart.find(i => i.id === id && i.tamanho === tamanho);
    
    if (item) {
        item.qtd += delta;
        if (item.qtd <= 0) {
            cart = cart.filter(i => !(i.id === id && i.tamanho === tamanho));
        }
        localStorage.setItem("imperio_cart", JSON.stringify(cart));
        atualizarContadores();
        renderizarCarrinhoPagina();
    }
}

// Remover item na página do carrinho
function removerItemCarrinho(id, tamanho) {
    let cart = JSON.parse(localStorage.getItem("imperio_cart") || "[]");
    cart = cart.filter(i => !(i.id === id && i.tamanho === tamanho));
    localStorage.setItem("imperio_cart", JSON.stringify(cart));
    atualizarContadores();
    renderizarCarrinhoPagina();
}

// Renderizar itens na página carrinho.html
function renderizarCarrinhoPagina() {
    const itemsContainer = document.getElementById("cart-items-container");
    if (!itemsContainer) return;
    
    const cart = JSON.parse(localStorage.getItem("imperio_cart") || "[]");
    
    if (cart.length === 0) {
        itemsContainer.innerHTML = `
            <div class="empty-cart-msg">
                <i class="fas fa-shopping-bag"></i>
                <p>Seu carrinho está vazio.</p>
                <a href="produtos.html" class="hero-btn">Explorar Coleções</a>
            </div>
        `;
        document.getElementById("subtotal-val").innerText = formatarMoeda(0);
        document.getElementById("discount-val").innerText = formatarMoeda(0);
        document.getElementById("total-val").innerText = formatarMoeda(0);
        return;
    }
    
    let subtotal = 0;
    
    itemsContainer.innerHTML = cart.map(item => {
        const prod = PRODUTOS_DB.find(p => p.id === item.id);
        if (!prod) return '';
        
        const valorItem = prod.preco * item.qtd;
        subtotal += valorItem;
        
        return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-img">${prod.icone}</div>
                    <div class="cart-item-details">
                        <h3>${prod.nome}</h3>
                        <p>Tamanho: ${item.tamanho}</p>
                    </div>
                </div>
                <div class="cart-qty-control">
                    <button class="cart-qty-btn" onclick="mudarQtd(${item.id}, '${item.tamanho}', -1)">-</button>
                    <span class="cart-qty-val">${item.qtd}</span>
                    <button class="cart-qty-btn" onclick="mudarQtd(${item.id}, '${item.tamanho}', 1)">+</button>
                </div>
                <div class="cart-item-price">${formatarMoeda(valorItem)}</div>
                <button class="remove-item-btn" onclick="removerItemCarrinho(${item.id}, '${item.tamanho}')">
                    <i class="far fa-trash-alt"></i>
                </button>
            </div>
        `;
    }).join('');
    
    let desconto = 0;
    const cupomAplicado = sessionStorage.getItem("imperio_coupon");
    if (cupomAplicado === "IMPERIO10") {
        desconto = subtotal * 0.10;
        document.getElementById("coupon-msg").innerText = "Cupom IMPERIO10 (10%) Ativo!";
    } else {
        document.getElementById("coupon-msg").innerText = "";
    }
    
    document.getElementById("subtotal-val").innerText = formatarMoeda(subtotal);
    document.getElementById("discount-val").innerText = formatarMoeda(desconto);
    document.getElementById("total-val").innerText = formatarMoeda(subtotal - desconto);
}

// Aplicação de Cupom
function aplicarCupom() {
    const code = document.getElementById("coupon-input").value.trim().toUpperCase();
    if (code === "IMPERIO10") {
        sessionStorage.setItem("imperio_coupon", "IMPERIO10");
        renderizarCarrinhoPagina();
        alert("Cupom de 10% aplicado com sucesso!");
    } else {
        alert("Cupom inválido ou expirado.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    renderizarCarrinhoPagina();
    const couponBtn = document.getElementById("apply-coupon-btn");
    if (couponBtn) {
        couponBtn.addEventListener("click", aplicarCupom);
    }
});