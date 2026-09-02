// Yeh controller sirf WEBSITE ke contact-form ke liye hai (public/contact.html).
// Android app isse kabhi use nahi karta.

const nodemailer = require("nodemailer");

const escapeHtml = (text) => {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const isValidEmail = (email) => {
  if (typeof email !== "string") return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
};

// Simple in-memory rate limiting hata diya - global express-rate-limit middleware
// (routes me lagi hui) already isko cover karti hai, taaki duplicate logic na ho.

let cachedTransporter = null;
const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;
  const required = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Email is not configured. Missing .env values: ${missing.join(", ")}`);
  }
  cachedTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: 20000,
    socketTimeout: 20000,
  });
  return cachedTransporter;
};

// Contact-form submission: sirf TEXT fields (email, phone, message) accept karta hai.
// Attachments/images/PDF is form se INTENTIONALLY accept nahi karte (jaisa maanga gaya
// tha) - user apni email client se seedha DEVELOPER_CONTACT_EMAIL par photo/PDF bhej
// sakta hai agar zaroorat pade.
exports.submitContactForm = async (req, res) => {
  try {
    const { email, phone, message } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (!phone || typeof phone !== "string" || phone.trim().length < 6) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number." });
    }
    if (!message || typeof message !== "string" || message.trim().length < 5) {
      return res.status(400).json({ success: false, message: "Please enter a message (at least 5 characters)." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: "Message is too long (max 2000 characters)." });
    }

    const developerEmail = process.env.DEVELOPER_CONTACT_EMAIL;
    if (!developerEmail) {
      console.error("❌ DEVELOPER_CONTACT_EMAIL is not set in .env — contact form cannot deliver messages.");
      return res.status(500).json({ success: false, message: "Contact form is temporarily unavailable. Please try again later." });
    }

    const transporter = getTransporter();
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #4C5BFF;">New ChatLeaf Contact Form Submission</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666; width: 100px;">From Email</td><td style="padding: 8px 0; font-weight: bold;">${escapeHtml(email)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Phone</td><td style="padding: 8px 0; font-weight: bold;">${escapeHtml(phone)}</td></tr>
        </table>
        <p style="color: #666;">Message:</p>
        <p style="background: #f5f6ff; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(message)}</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: developerEmail,
        replyTo: email, // developer seedha "Reply" dabake user ko jawab de sake
        subject: "ChatLeaf Contact Form",
        html,
      });
    } catch (emailError) {
      console.error("Contact form email failed:", emailError.message);
      return res.status(502).json({ success: false, message: "Could not send your message. Please try again shortly." });
    }

    return res.status(200).json({ success: true, message: "Your message has been sent. We'll get back to you soon." });
  } catch (error) {
    console.error("submitContactForm error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};
