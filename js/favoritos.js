async function alternarFavorito(id) {
    let favs = JSON.parse(localStorage.getItem("equilibrio_favorites") || "[]");
    const index = favs.indexOf(id);
    const token = localStorage.getItem('equilibrio_token'); 
    
    if (index > -1) {
        favs.splice(index, 1);
        if (typeof mostrarNotificacao === 'function') mostrarNotificacao("Removido dos favoritos.");
        if (token) {
            await fetch(`/api/favoritos/${id}`, { 
                method: 'DELETE', 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
        }
    } else {
        favs.push(id);
        if (typeof mostrarNotificacao === 'function') mostrarNotificacao("Adicionado aos favoritos!");
        if (token) {
            await fetch('/api/favoritos', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ produto_id: id })
            });
        }
    }
    
    localStorage.setItem("equilibrio_favorites", JSON.stringify(favs));
    if (typeof atualizarContadores === 'function') atualizarContadores();
    renderizarFavoritosPagina();
}

function renderizarFavoritosPagina() {
    const container = document.getElementById("favorites-page-grid");
    if (!container) return; 
    
    const favs = JSON.parse(localStorage.getItem("equilibrio_favorites") || "[]");
    const produtosFavoritos = PRODUTOS_DB.filter(p => favs.includes(p.id));
    
    if (produtosFavoritos.length === 0) {
        container.innerHTML = `
            <div class="empty-cart-msg" style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                <i class="far fa-heart" style="font-size: 3.5rem; color: var(--cor-texto-secundario); margin-bottom: 20px; display: block;"></i>
                <p style="color: var(--cor-texto-secundario); margin-bottom: 20px; font-weight: 600;">Sua lista de favoritos está vazia.</p>
                <a href="produtos.html" class="hero-btn">Explorar Produtos</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = produtosFavoritos.map(prod => `
        <div class="product-card">
            ${prod.badge ? `<div class="product-badge">${prod.badge}</div>` : ''}
            <button class="fav-btn-pos active" onclick="alternarFavorito(${prod.id})">
                <i class="fas fa-heart"></i>
            </button>
            <div class="product-img-wrapper" onclick="window.location.href='produto-detalhe.html?id=${prod.id}'" style="cursor:pointer;">
                <div class="product-img-placeholder" style="background: none; padding: 0; display: flex; align-items: center; justify-content: center; height: 100%; overflow: hidden;">
                    ${prod.imagem_url 
                        ? `<img src="${prod.imagem_url}" alt="${prod.nome}" style="width: 100%; height: 100%; object-fit: cover;">` 
                        : `<span style="font-size: 2.5rem;">👕</span>`
                    }
                </div>
            </div>
            <div class="product-info">
                <div class="product-cat">${prod.categoria || 'Geral'}</div>
                <div class="product-title" onclick="window.location.href='produto-detalhe.html?id=${prod.id}'" style="cursor:pointer;">${prod.nome}</div>
                <div class="product-price-box">
                    ${prod.preco_antigo ? `<span class="old-price">${formatarMoeda(prod.preco_antigo)}</span>` : ''}
                    <span class="new-price">${formatarMoeda(prod.preco)}</span>
                </div>
                <button class="add-to-cart-btn" onclick="adicionarAoCarrinhoGlobal(${prod.id})">
                    <i class="fas fa-shopping-cart"></i> Adicionar
                </button>
            </div>
        </div>
    `).join('');
}

document.addEventListener("produtosCarregados", renderizarFavoritosPagina);