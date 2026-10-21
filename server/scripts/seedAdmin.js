/**
 * Creates the first Admin user when there are no users yet, as Code.gs did
 * (admin / admin123). Change the password after the first login.
 *
 *   npm run seed
 *   npm run seed -- --username=admin --name="Administrator" --password=YourPassword
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

function arg(name, fallback) {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : fallback;
}

async function run() {
  const username = arg('username', 'admin');
  const existing = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (existing.rows.length) {
    console.log(`User '${username}' already exists. Nothing to do.`);
    return;
  }
  await pool.query(
    `INSERT INTO users (username, password_hash, name, role, active) VALUES ($1, $2, $3, 'Admin', 'Yes')`,
    [username, await bcrypt.hash(arg('password', 'admin123'), 10), arg('name', 'Administrator')]
  );
  console.log(`Admin user '${username}' created. Log in and change the password in Users.`);
}

run()
  .catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
