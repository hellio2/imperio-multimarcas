const { Pool } = require('pg');
require('dotenv').config();

// Configuração flexível: Funciona tanto no seu PC quanto no Render
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // A MÁGICA ACONTECE AQUI: 
    // Se o host não for o localhost (ou seja, está no Render), ativa o SSL obrigatório.
    ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    // console.log('Conexão ao banco de dados estabelecida!'); // Opcional
});

module.exports = pool;