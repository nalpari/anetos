const calls = [];

async function query(sql) {
  calls.push(sql);
  return [];
}

module.exports = { query, calls };
