const { Pool } = require('pg');
require('dotenv').config(); // Carrega as variáveis do arquivo .env

// Cria um "Pool" de conexões. Isso é melhor para performance do que abrir/fechar conexões o tempo todo.
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

// Testa a conexão assim que o arquivo é chamado
pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Erro ao conectar no PostgreSQL:', err.stack);
    }
    console.log('✅ Conectado ao banco de dados PostgreSQL (imperio_db) com sucesso!');
    release();
});

module.exports = pool;