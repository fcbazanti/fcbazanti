import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';
import { Resend } from 'resend';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY);

export default function registerStripeWebhook(app) {
  // ✅ Webhook musí mít raw body parser
  app.post(
    '/api/stripe/webhook',
    bodyParser.raw({ type: 'application/json' }),
    async (req, res) => {
      console.log('💬 Stripe webhook request přišel');

      const sig = req.headers['stripe-signature'];
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log('📦 Stripe event typ:', event.type);
      } catch (err) {
        console.error('❌ Stripe webhook error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_details?.email || 'neznamy@uzivatel.cz';
        const ticketClass = session.metadata?.class || 'neznámá třída';

        console.log(`✅ Platba dokončena pro ${email} (${ticketClass})`);

        try {
          // === QR kód ===
          const redirectUrl =
            ticketClass === '1. třída'
              ? 'https://fcbazanti.onrender.com/ticket.html?class=1'
              : 'https://fcbazanti.onrender.com/ticket.html?class=2';

          const qrData = await QRCode.toDataURL(redirectUrl);
          console.log('🟩 QR kód úspěšně vygenerován');

          // === PDF s QR ===
          const pdfDoc = await PDFDocument.create();
          const page = pdfDoc.addPage([400, 300]);
          const { width, height } = page.getSize();

          page.drawText('🎫 Vstupenka FC Bažantnice', { x: 50, y: height - 50, size: 16 });
          page.drawText(`Třída: ${ticketClass}`, { x: 50, y: height - 80, size: 12 });
          page.drawText(`Platnost: 6 měsíců od zakoupení`, { x: 50, y: height - 100, size: 12 });

          const png = Buffer.from(qrData.split(',')[1], 'base64');
          const qrImage = await pdfDoc.embedPng(png);
          page.drawImage(qrImage, { x: 120, y: 80, width: 150, height: 150 });

          const pdfBytes = await pdfDoc.save();
          const pdfPath = path.join('./', `ticket_${Date.now()}.pdf`);
          fs.writeFileSync(pdfPath, pdfBytes);
          console.log('🧾 PDF vstupenka vytvořena:', pdfPath);

          // === Odeslání e-mailu přes RESEND ===
          const sendResult = await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: email,
            subject: 'Vaše vstupenka FC Bažantnice',
            text: `Děkujeme za nákup! V příloze najdete svou vstupenku (${ticketClass}).`,
            attachments: [
              {
                filename: 'vstupenka.pdf',
                content: pdfBytes.toString('base64'),
              },
            ],
          });

          console.log('📧 E-mail odeslán přes Resend:', sendResult?.id || sendResult);
          fs.unlinkSync(pdfPath);
          console.log('🧹 Dočasný PDF soubor odstraněn');
        } catch (error) {
          console.error('❌ Chyba při generování nebo odesílání e-mailu:', error);
        }
      }

      // ✅ Stripe očekává odpověď vždy, i při chybě v odeslání
      res.json({ received: true });
      console.log('✅ Webhook dokončen a Stripe potvrzen (200 OK)');
    }
  );
}
