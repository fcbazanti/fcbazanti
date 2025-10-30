import express from "express";
import session from "express-session";
import path from "path";
import helmet from "helmet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import registerStripeWebhook from "./stripe-webhook.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bazant";

// ✅ Připojení k SQLite
const db = new Database(path.join(__dirname, "db.sqlite"));

// ✅ Tabulky – vytvoří se automaticky, pokud neexistují
db.prepare(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 🔗 Stripe webhook
registerStripeWebhook(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// === Pomocná funkce pro ochranu admin části ===
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ ok: false, error: "Nejste přihlášen/a." });
}

// === Přihlášení admina ===
app.post("/api/admin/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: "Špatné heslo." });
});

app.post("/api/admin/logout", (req, res) =>
  req.session.destroy(() => res.json({ ok: true }))
);

// === 📅 Zápasy ===
app.post("/api/matches", requireAdmin, (req, res) => {
  const { title, date, time } = req.body;
  if (!title || !date) return res.json({ ok: false, error: "Zadejte název a datum." });
  db.prepare("INSERT INTO matches (title, date, time) VALUES (?, ?, ?)").run(title, date, time || "");
  res.json({ ok: true });
});

app.get("/api/matches", (req, res) => {
  const rows = db.prepare("SELECT * FROM matches ORDER BY date ASC").all();
  res.json({ ok: true, matches: rows });
});

app.delete("/api/matches/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM matches WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// === 📰 Novinky ===
app.get("/api/news", (req, res) => {
  const rows = db.prepare("SELECT * FROM news ORDER BY created_at DESC").all();
  res.json({ ok: true, news: rows });
});

app.post("/api/news", requireAdmin, (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: "Zadejte text." });
  db.prepare("INSERT INTO news (text) VALUES (?)").run(text);
  res.json({ ok: true });
});

app.delete("/api/news/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM news WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// === 🎟️ Rezervace ===
app.post("/api/book", (req, res) => {
  const { class: selectedClass, name, email } = req.body;
  if (!selectedClass || !name || !email) {
    return res.status(400).json({ ok: false, error: "Vyplňte třídu, jméno i e-mail." });
  }

  const stmt = db.prepare(
    "INSERT INTO reservations (class, name, email) VALUES (?, ?, ?)"
  );
  const info = stmt.run(selectedClass.trim(), name.trim(), email.trim().toLowerCase());
  res.status(200).json({ ok: true, id: info.lastInsertRowid });
});

app.get("/api/reservations", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM reservations ORDER BY created_at DESC").all();
  res.json({ ok: true, reservations: rows });
});

app.delete("/api/reservations/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM reservations WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// === Server start ===
app.listen(PORT, () => console.log(`✅ Server běží na http://localhost:${PORT}`));
