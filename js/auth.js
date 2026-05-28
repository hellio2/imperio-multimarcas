// Verifica o estado da sessão assim que a página abre
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem('imperio_token');
    const userJson = localStorage.getItem('imperio_user');

    const panelDashboard = document.getElementById('panel-dashboard');
    const panelAuthForms = document.getElementById('panel-auth-forms');
    const userNameDisplay = document.getElementById('user-name-display');

    if (token && userJson && panelDashboard && panelAuthForms) {
        // Se houver token, esconde formulários e mostra o Dashboard da sessão
        const usuario = JSON.parse(userJson);
        userNameDisplay.textContent = usuario.nome;
        panelAuthForms.style.display = 'none';
        panelDashboard.style.display = 'flex';
    }
});

function alternarAba(abaDestino) {
    document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));

    if (abaDestino === 'login') {
        document.querySelectorAll('.auth-tab')[0].classList.add('active');
        document.getElementById('form-login').classList.add('active');
    } else {
        document.querySelectorAll('.auth-tab')[1].classList.add('active');
        document.getElementById('form-cadastro').classList.add('active');
    }
    document.getElementById('feedback-login').className = 'form-feedback';
    document.getElementById('feedback-cadastro').className = 'form-feedback';
}

// ==========================================
// FUNÇÃO DE LOGOUT ATUALIZADA (LIMPA TUDO)
// ==========================================
function fazerLogout() {
    localStorage.removeItem('imperio_token');
    localStorage.removeItem('imperio_user');
    localStorage.removeItem('imperio_cart'); 
    localStorage.removeItem('imperio_favorites'); // CORREÇÃO: Agora os favoritos também são limpos ao sair
    window.location.href = 'index.html';
}

// LÓGICA DE CADASTRO
document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('cad-nome').value;
    const email = document.getElementById('cad-email').value;
    const senha = document.getElementById('cad-senha').value;
    const feedback = document.getElementById('feedback-cadastro');

    if (senha.length < 6) {
        feedback.textContent = 'A senha deve ter pelo menos 6 caracteres.';
        feedback.className = 'form-feedback error';
        return;
    }

    try {
        const resposta = await fetch('/api/auth/cadastro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, email, senha })
        });
        const dados = await resposta.json();

        if (resposta.ok) {
            feedback.textContent = 'Cadastro realizado! Redirecionando para login...';
            feedback.className = 'form-feedback success';
            document.getElementById('form-cadastro').reset();
            setTimeout(() => alternarAba('login'), 2000);
        } else {
            feedback.textContent = dados.erro || 'Erro ao realizar cadastro.';
            feedback.className = 'form-feedback error';
        }
    } catch (erro) {
        feedback.textContent = 'Erro de conexão com o servidor.';
        feedback.className = 'form-feedback error';
    }
});

// LÓGICA DE LOGIN
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;
    const feedback = document.getElementById('feedback-login');

    try {
        const resposta = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });
        const dados = await resposta.json();

        if (resposta.ok) {
            feedback.textContent = 'Acesso autorizado! Sincronizando sessão...';
            feedback.className = 'form-feedback success';
            
            localStorage.setItem('imperio_token', dados.token);
            localStorage.setItem('imperio_user', JSON.stringify(dados.usuario));
            
            setTimeout(() => { window.location.href = 'index.html'; }, 1000);
        } else {
            feedback.textContent = dados.erro || 'E-mail ou senha incorretos.';
            feedback.className = 'form-feedback error';
        }
    } catch (erro) {
        feedback.textContent = 'Erro de conexão com o servidor.';
        feedback.className = 'form-feedback error';
    }
});