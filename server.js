import express from 'express';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bazant';

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.static(path.join(__dirname, 'public')));

let db;
(async () => {
  db = await open({
    filename: path.join(__dirname, 'db.sqlite'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
})();

app.post('/api/book', async (req, res) => {
  try {
    const { class: selectedClass, name, email } = req.body;
    if (!selectedClass || !name || !email) {
      return res.status(400).json({ ok: false, error: 'Vyplňte třídu, jméno i e‑mail.' });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res.status(400).json({ ok: false, error: 'Zadejte platný e‑mail.' });
    }

    const stmt = await db.run(
      'INSERT INTO reservations (class, name, email) VALUES (?, ?, ?)',
      [selectedClass, name.trim(), email.trim().toLowerCase()]
    );

    res.json({ ok: true, id: stmt.lastID });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Chyba serveru. Zkuste to prosím znovu.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Špatné heslo.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ ok: false, error: 'Nejste přihlášen/a.' });
}

app.get('/api/reservations', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM reservations ORDER BY created_at DESC');
    res.json({ ok: true, reservations: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Nepodařilo se načíst rezervace.' });
  }
});

app.delete('/api/reservations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.run('DELETE FROM reservations WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Smazání se nepodařilo.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});