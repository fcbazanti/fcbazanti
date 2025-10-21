import express from "express";
import session from "express-session";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import helmet from "helmet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import { Resend } from "resend";
import registerStripeWebhook from "./stripe-webhook.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bazant";
const resend = new Resend(process.env.RESEND_API_KEY);

// ⚠️ Stripe webhook musí být registrován dřív než JSON parsery!
registerStripeWebhook(app);

// ✅ Až potom ostatní middleware
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

// === DB ===
let db;
(async () => {
  db = await open({
    filename: path.join(__dirname, "db.sqlite"),
    driver: sqlite3.Database,
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

// === Helpers ===
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ ok: false, error: "Nejste přihlášen/a." });
}

// === Admin login/logout ===
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

// === Rezervace ===
app.post("/api/book", async (req, res) => {
  try {
    const { class: selectedClass, name, email } = req.body;

    if (!selectedClass || !name || !email) {
      return res
        .status(400)
        .json({ ok: false, error: "Vyplňte třídu, jméno i e-mail." });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res.status(400).json({ ok: false, error: "Zadejte platný e-mail." });
    }

    const stmt = await db.run(
      "INSERT INTO reservations (class, name, email) VALUES (?, ?, ?)",
      [selectedClass.trim(), name.trim(), email.trim().toLowerCase()]
    );

    console.log("✅ Rezervace uložena – ID:", stmt.lastID);

    // Po uložení pošli potvrzovací e-mail
    await resend.emails.send({
      from: process.env.RESEND_FROM,
      to: email,
      subject: "Potvrzení rezervace",
      html: `<p>Děkujeme, ${name}, vaše rezervace pro třídu <b>${selectedClass}</b> byla přijata.</p>`,
    });

    res.status(200).json({ ok: true, id: stmt.lastID });
  } catch (e) {
    console.error("❌ CHYBA API /api/book:", e.message);
    res
      .status(500)
      .json({ ok: false, error: "Chyba na serveru při ukládání rezervace." });
  }
});

// === Admin: rezervace ===
app.get("/api/reservations", requireAdmin, async (_, res) =>
  res.json({
    ok: true,
    reservations: await db.all(
      "SELECT * FROM reservations ORDER BY created_at DESC"
    ),
  })
);

app.delete("/api/reservations/:id", requireAdmin, async (req, res) => {
  await db.run("DELETE FROM reservations WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// === Zápasy + kalendář ===
app.post("/api/matches", requireAdmin, async (req, res) => {
  const { title, date } = req.body;
  if (!title || !date)
    return res.json({ ok: false, error: "Vyplňte název a datum." });
  await db.run("INSERT INTO matches (title, date) VALUES (?, ?)", [
    title.trim(),
    date,
  ]);
  res.json({ ok: true });
});

app.get("/api/matches", async (req, res) => {
  const { year, month } = req.query;
  if (year && month) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;
    const rows = await db.all(
      "SELECT * FROM matches WHERE date >= ? AND date < ?",
      [start, end]
    );
    return res.json({ ok: true, matches: rows });
  }
  const rows = await db.all("SELECT * FROM matches ORDER BY date DESC");
  res.json({ ok: true, matches: rows });
});

app.delete("/api/matches/:id", requireAdmin, async (req, res) => {
  await db.run("DELETE FROM matches WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// === Novinky ===
app.get("/api/news", async (_, res) =>
  res.json({
    ok: true,
    news: await db.all("SELECT * FROM news ORDER BY created_at DESC"),
  })
);

app.post("/api/news", requireAdmin, async (req, res) => {
  if (!req.body.text) return res.json({ ok: false, error: "Zadejte text." });
  await db.run("INSERT INTO news (text) VALUES (?)", [req.body.text]);
  res.json({ ok: true });
});

app.delete("/api/news/:id", requireAdmin, async (req, res) => {
  await db.run("DELETE FROM news WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// === Start serveru ===
app.listen(PORT, () =>
  console.log(`✅ Server běží na http://localhost:${PORT}`)
);
