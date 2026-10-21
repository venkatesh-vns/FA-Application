require('dotenv').config();

const app = require('./app');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 5100;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`PostgreSQL connected: ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT}`);
  } catch (err) {
    console.error('PostgreSQL connection failed:', err.message);
    console.error('Server was NOT started. Check the database settings in server/.env.');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`FA Management server running on http://localhost:${PORT} (health: /api/health)`);
  });
}

start();
