import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export default function registerStripeWebhook(app) {
  app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('⚠️ Webhook error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email || 'neznámý@uživatel';
      const ticketClass = session.metadata?.class || 'neznámá třída';
      console.log(`✅ Platba dokončena pro ${email} (${ticketClass})`);

      // === QR kód ===
      const redirectUrl =
        ticketClass === '1. třída'
          ? 'https://fcbazanti.onrender.com/ticket.html?class=1'
          : 'https://fcbazanti.onrender.com/ticket.html?class=2';

      const qrData = await QRCode.toDataURL(redirectUrl);

      // === PDF s QR ===
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([400, 300]);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const { width, height } = page.getSize();
      const title = ` Vstupenka FC Bažantnice`;
      page.drawText(title, { x: 50, y: height - 50, size: 16, font });
      page.drawText(`Třída: ${ticketClass}`, { x: 50, y: height - 80, size: 12, font });
      page.drawText(`Platnost: 6 měsíců od zakoupení`, { x: 50, y: height - 100, size: 12, font });

      const png = Buffer.from(qrData.split(',')[1], 'base64');
      const qrImage = await pdfDoc.embedPng(png);
      page.drawImage(qrImage, { x: 120, y: 80, width: 150, height: 150 });

      const pdfBytes = await pdfDoc.save();
      const pdfPath = path.join('./', `ticket_${Date.now()}.pdf`);
      fs.writeFileSync(pdfPath, pdfBytes);

      // === E-mail ===
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      await transporter.sendMail({
        from: 'FC Bažantnice <' + process.env.SMTP_USER + '>',
        to: email,
        subject: 'Vaše vstupenka FC Bažantnice',
        text: `Děkujeme za nákup! V příloze najdete svou vstupenku (${ticketClass}).`,
        attachments: [{ filename: 'vstupenka.pdf', path: pdfPath }],
      });

      fs.unlinkSync(pdfPath);
      console.log(`📧 Odeslán e-mail s PDF vstupenkou pro ${email}`);
    }

    res.json({ received: true });
  });
}

