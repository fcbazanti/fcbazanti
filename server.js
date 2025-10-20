import express from 'express';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { PDFDocument, StandardFonts } from 'pdf-lib';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bazant';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// === DB ===
let db;
(async () => {
  db = await open({ filename: path.join(__dirname, 'db.sqlite'), driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
})();

// === Email transporter ===
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// === Helpers ===
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ ok: false, error: 'Nejste přihlášen/a.' });
}

// === Rezervace ===
app.post('/api/book', async (req, res) => {
  try {
    const { class: cls, name, email } = req.body;
    if (!cls || !name || !email)
      return res.status(400).json({ ok: false, error: 'Vyplňte třídu, jméno i e-mail.' });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email))
      return res.status(400).json({ ok: false, error: 'Zadejte platný e-mail.' });

    const stmt = await db.run(
      'INSERT INTO reservations (class, name, email) VALUES (?, ?, ?)',
      [cls, name.trim(), email.trim().toLowerCase()]
    );

    // === PDF vstupenka ===
    const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 6);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 240]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('FC Bažantnice – Vstupenka', { x: 90, y: 200, size: 16, font });
    page.drawText(`ID rezervace: ${stmt.lastID}`, { x: 50, y: 165, size: 13, font });
    page.drawText(`Jméno: ${name}`, { x: 50, y: 145, size: 13, font });
    page.drawText(`Třída: ${cls}`, { x: 50, y: 125, size: 13, font });
    page.drawText(`Vytvořeno: ${new Date().toLocaleDateString('cs-CZ')}`, { x: 50, y: 105, size: 13, font });
    page.drawText(`Platnost do: ${expiry.toLocaleDateString('cs-CZ')}`, { x: 50, y: 85, size: 13, font });
    const pdfBytes = await pdf.save();

    // === E-maily ===
    await transporter.sendMail({
      from: `"FC Bažantnice" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Potvrzení rezervace #${stmt.lastID}`,
      text: `Děkujeme za rezervaci! Vaše vstupenka platí 6 měsíců.`,
      attachments: [{ filename: `vstupenka_${stmt.lastID}.pdf`, content: pdfBytes }]
    });
    await transporter.sendMail({
      from: `"FC Bažantnice" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `Nová rezervace #${stmt.lastID}`,
      text: `Rezervace od ${name} (${email}) – ${cls}`
    });

    res.json({ ok: true, id: stmt.lastID });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Chyba serveru.' });
  }
});

// === Admin login/logout ===
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Špatné heslo.' });
});
app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// === Admin: rezervace ===
app.get('/api/reservations', requireAdmin, async (_, res) =>
  res.json({ ok: true, reservations: await db.all('SELECT * FROM reservations ORDER BY created_at DESC') })
);
app.delete('/api/reservations/:id', requireAdmin, async (req, res) => {
  await db.run('DELETE FROM reservations WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// === Zápasy + kalendář ===
app.post('/api/matches', requireAdmin, async (req, res) => {
  const { title, date } = req.body;
  if (!title || !date) return res.json({ ok: false, error: 'Vyplňte název a datum.' });
  await db.run('INSERT INTO matches (title, date) VALUES (?, ?)', [title.trim(), date]);
  res.json({ ok: true });
});
app.get('/api/matches', async (req, res) => {
  const { year, month } = req.query;
  if (year && month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
    const rows = await db.all('SELECT * FROM matches WHERE date >= ? AND date < ?', [start, end]);
    return res.json({ ok: true, matches: rows });
  }
  const rows = await db.all('SELECT * FROM matches ORDER BY date DESC');
  res.json({ ok: true, matches: rows });
});
app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
  await db.run('DELETE FROM matches WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// === Novinky ===
app.get('/api/news', async (_, res) =>
  res.json({ ok: true, news: await db.all('SELECT * FROM news ORDER BY created_at DESC') })
);
app.post('/api/news', requireAdmin, async (req, res) => {
  if (!req.body.text) return res.json({ ok: false, error: 'Zadejte text.' });
  await db.run('INSERT INTO news (text) VALUES (?)', [req.body.text]);
  res.json({ ok: true });
});
app.delete('/api/news/:id', requireAdmin, async (req, res) => {
  await db.run('DELETE FROM news WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`✅ Server běží na http://localhost:${PORT}`));
