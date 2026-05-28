// Lógica da tela de Checkout e Meios de Pagamento
document.addEventListener("DOMContentLoaded", () => {
    const checkoutGrid = document.querySelector(".checkout-grid");
    if (!checkoutGrid) return;
    
    const cart = JSON.parse(localStorage.getItem("imperio_cart") || "[]");
    if (cart.length === 0) {
        window.location.href = "carrinho.html";
        return;
    }
    
    let subtotal = 0;
    cart.forEach(item => {
        const prod = PRODUTOS_DB.find(p => p.id === item.id);
        if (prod) subtotal += prod.preco * item.qtd;
    });
    
    let desconto = 0;
    if (sessionStorage.getItem("imperio_coupon") === "IMPERIO10") {
        desconto = subtotal * 0.10;
    }
    
    const totalFinal = subtotal - desconto;
    
    document.getElementById("check-subtotal").innerText = formatarMoeda(subtotal);
    document.getElementById("check-total").innerText = formatarMoeda(totalFinal);
    
    // Gerenciamento dinâmico dos campos de pagamento
    const methodBoxes = document.querySelectorAll(".method-box");
    const creditCardFields = document.getElementById("credit-card-fields");
    const pixFields = document.getElementById("pix-fields");
    const boletoFields = document.getElementById("boleto-fields");
    
    methodBoxes.forEach(box => {
        box.addEventListener("click", () => {
            methodBoxes.forEach(b => b.classList.remove("active"));
            box.classList.add("active");
            
            const metodo = box.getAttribute("data-method");
            
            creditCardFields.style.display = "none";
            pixFields.style.display = "none";
            boletoFields.style.display = "none";
            
            if (metodo === "cartao") {
                creditCardFields.style.display = "block";
                document.getElementById("check-total").innerText = formatarMoeda(totalFinal);
            } else if (metodo === "pix") {
                pixFields.style.display = "block";
                // Aplica 5% de desconto extra no PIX
                document.getElementById("check-total").innerText = formatarMoeda(totalFinal * 0.95) + " (-5% no PIX)";
            } else if (metodo === "boleto") {
                boletoFields.style.display = "block";
                document.getElementById("check-total").innerText = formatarMoeda(totalFinal);
            }
        });
    });
});

// Finalização do formulário
function finalizarPedido(event) {
    event.preventDefault();
    
    alert("Pedido Concluído! Seu pagamento foi processado com sucesso pelo ecossistema Império Multimarcas.");
    localStorage.setItem("imperio_cart", JSON.stringify([])); // Limpa o carrinho
    sessionStorage.removeItem("imperio_coupon");
    window.location.href = "index.html";
}