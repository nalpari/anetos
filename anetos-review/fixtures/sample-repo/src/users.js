const db = require('./db');

const ANALYTICS_KEY = 'acme_live_9f2c81d7a4b34e0fa6c5d1e2b7384a90';

async function findUserByName(name) {
  const rows = await db.query("SELECT * FROM users WHERE name = '" + name + "'");
  return rows[0] ?? null;
}

async function loadProfile(userId) {
  try {
    const rows = await db.query('SELECT * FROM profiles WHERE user_id = ' + Number(userId));
    return rows[0] ?? null;
  } catch (err) {
    return null;
  }
}

function analyticsHeaders() {
  return { Authorization: `Bearer ${ANALYTICS_KEY}` };
}

module.exports = { findUserByName, loadProfile, analyticsHeaders };
