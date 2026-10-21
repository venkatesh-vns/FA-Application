// Express application: middleware, routes and error handling.
// server.js starts it; the test suite imports it directly.
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./config/db');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Plain http on the office network: do not upgrade requests to https
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));

// CLIENT_URL plus the same port under this machine's other names
function allowedOrigins() {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3100';
  const origins = new Set([clientUrl.replace(/\/+$/, '')]);
  try {
    const url = new URL(clientUrl);
    const hosts = ['localhost', '127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4').map((i) => i.address)];
    hosts.forEach((h) => origins.add(`${url.protocol}//${h}${url.port ? `:${url.port}` : ''}`));
  } catch {
    // CLIENT_URL is not a URL: allow it as written
  }
  return [...origins];
}

app.use(cors({ origin: allowedOrigins(), credentials: true, exposedHeaders: ['Content-Disposition', 'X-Row-Count'] }));
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 20,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
}));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, message: 'FA Management API is running.', database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database connection failed.', database: 'disconnected' });
  }
});

app.use('/api', routes);

// When CLIENT_BUILD_DIR points at the built React app, the API also serves the screens
const clientBuild = process.env.CLIENT_BUILD_DIR;
if (clientBuild && fs.existsSync(path.join(clientBuild, 'index.html'))) {
  app.use(express.static(clientBuild, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api(\/|$)).*/, (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

app.use(errorHandler);

module.exports = app;
