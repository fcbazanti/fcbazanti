// server.js – minimalistický Stripe upgrade (CommonJS)
const express = require("express");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ENV (Render) =====
// STRIPE_SECRET_KEY=sk_test_...
// STRIPE_WEBHOOK_SECRET=whsec_...
// BASE_URL=https://fcbazanti.onrender.com
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// ===== Ceník v halířích (80 Kč = 8000) =====
const PRICES = { "1.trida": 8000, "2.trida": 3500, "3.trida": 2000 };

// ===== Statika =====
app.use(express.static("public"));

// ⚠️ Webhook MUSÍ mít raw tělo – definujeme dřív než JSON parser
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const rid = session?.metadata?.reservationId;
      if (rid) {
        // TODO: Označ rezervaci jako zaplacenou v tvém úložišti:
        // await markReservationPaid(rid)
        console.log("Mark paid:", rid);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Až TEĎ zapneme JSON parser pro ostatní API
app.use(express.json());

// ===== Helper pro vytvoření session + redirect =====
async function createSessionAndRedirect(res, seatClass, reservationId, email) {
  const price = PRICES[seatClass];
  if (!price) return res.status(400).send("Neplatná třída.");

  // TODO: Tady si načti rezervaci podle reservationId, pokud ji máš v DB/souboru:
  // const r = await getReservationById(reservationId)
  // if (!r) return res.status(404).send("Rezervace nenalezena.");
  // if (r.paid) return res.status(400).send("Už zaplaceno.");
  // const customerEmail = r.email;
  const customerEmail = email || undefined; // nouzově z query (?email=...)

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    currency: "czk",
    line_items: [{
      price_data: {
        currency: "czk",
        product_data: { name: `Rezervace – ${seatClass.toUpperCase()}` },
        unit_amount: price
      },
      quantity: 1
    }],
    customer_email: customerEmail,
    // žádné nové stránky – vraťme se na domovskou
    success_url: `${BASE_URL}/?paid=ok`,
    cancel_url: `${BASE_URL}/?paid=cancel`,
    metadata: { reservationId, seatClass }
  });

  return res.redirect(303, session.url);
}

// ===== „Jeden link podle třídy“ (rid = id tvé rezervace) =====
app.get("/pay/1trida/:rid", async (req, res) => {
  await createSessionAndRedirect(res, "1.trida", req.params.rid, req.query.email);
});
app.get("/pay/2trida/:rid", async (req, res) => {
  await createSessionAndRedirect(res, "2.trida", req.params.rid, req.query.email);
});
app.get("/pay/3trida/:rid", async (req, res) => {
  await createSessionAndRedirect(res, "3.trida", req.params.rid, req.query.email);
});

// ===== Admin (pokud máš vlastní render, jen dodej sloupec „paid“) =====
// Příklad: do objektu rezervace přidej boolean/0|1 `paid` a v tabulce vypiš:
//  r.paid ? "✅ zaplaceno" : "❌ nezaplaceno"

app.listen(PORT, () => console.log(`Server on :${PORT}`));
