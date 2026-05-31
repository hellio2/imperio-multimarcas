const { Pool } = require('pg');
require('dotenv').config();

// Verifica se está rodando no localhost ou na rede interna do Render
const isLocalhost = process.env.DB_HOST === 'localhost';
const isRenderInternal = process.env.DB_HOST && process.env.DB_HOST.includes('dpg-');

// Só ativa o SSL se NÃO for localhost e NÃO for o link interno do Render
const requiresSsl = !(isLocalhost || isRenderInternal);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    console.log('✅ Banco de dados conectado com sucesso na nuvem!');
});

module.exports = pool;