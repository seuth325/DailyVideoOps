const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'db.json');

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    const initial = { users: [], posts: [], postLogs: [] };
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
  }
}

function loadDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function withDb(mutator) {
  const db = loadDb();
  const result = mutator(db);
  saveDb(db);
  return result;
}

module.exports = {
  loadDb,
  saveDb,
  withDb,
};
