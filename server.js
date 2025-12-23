import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import fs from 'fs';
import { Resend } from 'resend';
import registerStripeWebhook from './stripe-webhook.js';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const __dirname = path.resolve();

// === PostgreSQL (Neon) ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Inicializace tabulek ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      class TEXT,
      name TEXT,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      title TEXT,
      date DATE
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ PostgreSQL tabulky inicializovány');
}
initDB();

// === Middleware ===
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://js.stripe.com"],
        frameSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://checkout.stripe.com"
        ],
        connectSrc: ["'self'", "https://api.stripe.com"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'tajneheslo',
    resave: false,
    saveUninitialized: false,
  })
);

// === API: Rezervace ===
app.post('/api/book', async (req, res) => {
  try {
    const { class: cls, name, email } = req.body;
    if (!cls || !name || !email)
      return res.json({ ok: false, error: 'Chybí údaje.' });

    const result = await pool.query(
      'INSERT INTO reservations (class, name, email) VALUES ($1, $2, $3) RETURNING id',
      [cls, name, email]
    );

    res.json({ ok: true, id: result.rows[0].id });
  } catch (e) {
    console.error('❌ Chyba při přidávání rezervace:', e);
    res.json({ ok: false, error: 'Chyba při ukládání.' });
  }
});

app.get('/api/reservations', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM reservations ORDER BY created_at DESC');
    res.json({ ok: true, reservations: r.rows });
  } catch {
    res.json({ ok: false, error: 'Chyba načtení rezervací.' });
  }
});

app.delete('/api/reservations/:id', async (req, res) => {
  await pool.query('DELETE FROM reservations WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// === API: Zápasy ===
app.post('/api/matches', async (req, res) => {
  try {
    const { title, date } = req.body;
    if (!title || !date) return res.json({ ok: false, error: 'Chybí údaje.' });
    await pool.query('INSERT INTO matches (title, date) VALUES ($1, $2)', [title, date]);
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Chyba zápasu:', e);
    res.json({ ok: false });
  }
});

app.get('/api/matches', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM matches ORDER BY date');
    res.json({ ok: true, matches: result.rows });
  } catch {
    res.json({ ok: false, error: 'Chyba při načítání zápasů.' });
  }
});

app.delete('/api/matches/:id', async (req, res) => {
  await pool.query('DELETE FROM matches WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// === API: Novinky ===
app.post('/api/news', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: 'Zadejte text.' });
  await pool.query('INSERT INTO news (text) VALUES ($1)', [text]);
  res.json({ ok: true });
});

app.get('/api/news', async (req, res) => {
  const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
  res.json({ ok: true, news: result.rows });
});

app.delete('/api/news/:id', async (req, res) => {
  await pool.query('DELETE FROM news WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// === Admin login ===
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    res.json({ ok: true });
  } else res.json({ ok: false, error: 'Špatné heslo.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// === Stripe webhook ===
registerStripeWebhook(app);

// === Spuštění ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server běží na portu ${PORT}`));
