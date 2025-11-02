import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import registerStripeWebhook from './stripe-webhook.js';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 📁 TRVALÉ ÚLOŽIŠTĚ SQLite
// 📁 TRVALÉ ÚLOŽIŠTĚ SQLite (Render safe)
const dbDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'database.sqlite');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });


const db = await open({
  filename: dbPath,
  driver: sqlite3.Database,
});

// 🧱 Tabulky
await db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class TEXT,
    name TEXT,
    email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    date TEXT
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// 🧠 Middleware
app.use(helmet());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'tajneheslo123',
    resave: false,
    saveUninitialized: false,
  })
);

// 🗂️ Statické soubory
app.use(express.static('public'));

// 🧩 Stripe webhook
registerStripeWebhook(app);

// === API ENDPOINTY ===

// 💬 Rezervace
app.post('/api/book', async (req, res) => {
  const { class: cls, name, email } = req.body;
  if (!cls || !name || !email)
    return res.json({ ok: false, error: 'Chybí údaje.' });

  const result = await db.run(
    'INSERT INTO reservations (class, name, email) VALUES (?, ?, ?)',
    [cls, name, email]
  );

  res.json({ ok: true, id: result.lastID });
});

// 📜 Získání rezervací (admin)
app.get('/api/reservations', async (req, res) => {
  const reservations = await db.all('SELECT * FROM reservations ORDER BY id DESC');
  res.json({ ok: true, reservations });
});

app.delete('/api/reservations/:id', async (req, res) => {
  await db.run('DELETE FROM reservations WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// 🏟️ Zápasy
app.get('/api/matches', async (req, res) => {
  const matches = await db.all('SELECT * FROM matches ORDER BY date DESC');
  res.json({ ok: true, matches });
});

app.post('/api/matches', async (req, res) => {
  const { title, date } = req.body;
  if (!title || !date)
    return res.json({ ok: false, error: 'Chybí údaje.' });

  await db.run('INSERT INTO matches (title, date) VALUES (?, ?)', [title, date]);
  res.json({ ok: true });
});

app.delete('/api/matches/:id', async (req, res) => {
  await db.run('DELETE FROM matches WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// 📰 Novinky
app.get('/api/news', async (req, res) => {
  const news = await db.all('SELECT * FROM news ORDER BY created_at DESC');
  res.json({ ok: true, news });
});

app.post('/api/news', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: 'Chybí text.' });
  await db.run('INSERT INTO news (text) VALUES (?)', [text]);
  res.json({ ok: true });
});

app.delete('/api/news/:id', async (req, res) => {
  await db.run('DELETE FROM news WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// 🔒 Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: 'Špatné heslo.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 🏠 Spuštění
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server běží na portu ${PORT}`)
);
