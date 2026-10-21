require('dotenv').config();

const app = require('./app');
const { pool, connectionSummary, TIME_ZONE } = require('./config/db');
const { appInfo } = require('./utils/version');

const PORT = process.env.PORT || 5100;

async function start() {
  try {
    await pool.query('SELECT 1');
    const db = connectionSummary();
    const info = appInfo();
    console.log(`FA Management ${info.version} (${info.environmentLabel})`);
    console.log(`PostgreSQL connected: ${db.database} on ${db.host}:${db.port}${db.ssl ? ' (SSL)' : ''}; time zone ${TIME_ZONE}`);
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
