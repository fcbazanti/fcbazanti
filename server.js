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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

let db;
(async () => {
  db = await open({ filename: path.join(__dirname, 'db.sqlite'), driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      match_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD
      time TEXT NOT NULL, -- HH:MM
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  app.listen(PORT, () => { console.log(`Server běží na http://localhost:${PORT}`); });
})();

const CAPACITY = { "1. třída": 5, "2. třída": 5, "3. třída": 10 };

// Rezervace
app.post('/api/book', async (req, res) => {
  try {
    const { class: selectedClass, name, email, match_id } = req.body;
    if (!selectedClass || !name || !email || !match_id) {
      return res.status(400).json({ ok: false, error: 'Vyplňte všechny údaje.' });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) return res.status(400).json({ ok: false, error: 'Zadejte platný e-mail.' });

    const count = await db.get(
      'SELECT COUNT(*) as c FROM reservations WHERE match_id = ? AND class = ?',
      [match_id, selectedClass]
    );
    if (count.c >= CAPACITY[selectedClass]) {
      return res.status(400).json({ ok: false, error: 'Kapacita této třídy pro vybraný zápas je plná.' });
    }

    const stmt = await db.run(
      'INSERT INTO reservations (class, name, email, match_id) VALUES (?, ?, ?, ?)',
      [selectedClass, name.trim(), email.trim().toLowerCase(), match_id]
    );
    res.json({ ok: true, id: stmt.lastID });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Chyba serveru. Zkuste to prosím znovu.' });
  }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) { req.session.isAdmin = true; return res.json({ ok: true }); }
  return res.status(401).json({ ok: false, error: 'Špatné heslo.' });
});
app.post('/api/admin/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

function requireAdmin(req, res, next) { if (req.session?.isAdmin) return next(); return res.status(401).json({ ok: false, error: 'Nejste přihlášen/a.' }); }

// Admin: výpis rezervací
app.get('/api/reservations', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT r.*, m.title, m.date, m.time 
      FROM reservations r
      JOIN matches m ON r.match_id = m.id
      ORDER BY r.created_at DESC
    `);
    res.json({ ok: true, reservations: rows });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Nepodařilo se načíst rezervace.' }); }
});

app.delete('/api/reservations/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM reservations WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Smazání se nepodařilo.' }); }
});

// === ZÁPASY ===
app.post('/api/matches', requireAdmin, async (req, res) => {
  try {
    const { title, date, time } = req.body;
    if (!title || !date || !time) return res.status(400).json({ ok: false, error: 'Vyplňte název, datum a čas.' });
    const stmt = await db.run('INSERT INTO matches (title, date, time) VALUES (?, ?, ?)', [title.trim(), date, time]);
    res.json({ ok: true, id: stmt.lastID });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Nelze uložit zápas.' }); }
});

app.get('/api/matches', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM matches ORDER BY date DESC, time DESC, id DESC');
    res.json({ ok: true, matches: rows });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Nelze načíst zápasy.' }); }
});

app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM matches WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Smazání se nepodařilo.' }); }
});

// Veřejně: zápasy na následující měsíc
app.get('/api/matches/upcoming', async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const startStr = start.toISOString().slice(0,10);
    const endStr = end.toISOString().slice(0,10);
    const rows = await db.all(
      'SELECT * FROM matches WHERE date >= ? AND date < ? ORDER BY date ASC, time ASC',
      [startStr, endStr]
    );

    const matches = [];
    for (const m of rows) {
      const counts = {};
      for (const cls of Object.keys(CAPACITY)) {
        const row = await db.get('SELECT COUNT(*) as c FROM reservations WHERE match_id = ? AND class = ?', [m.id, cls]);
        counts[cls] = row.c;
      }
      matches.push({ ...m, capacity: counts });
    }

    res.json({ ok: true, matches, month: start.getMonth() + 1, year: start.getFullYear() });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Nelze načíst kalendář.' }); }
});
