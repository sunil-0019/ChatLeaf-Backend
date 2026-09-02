const nodemailer = require("nodemailer");

// User-supplied text (fullName, userId, etc.) ko HTML me daalne se pehle escape karo -
// taaki koi HTML/script tags wala naam email template ko break na kar sake
const escapeHtml = (text) => {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Transporter ko "lazy" banaya hai - matlab yeh tabhi banega jab pehli baar
// email bhejni ho, module load hote hi nahi. Isse yeh guarantee milta hai ki
// .env file pehle se load ho chuki hogi (dotenv.config() server.js me sabse
// upar chalta hai) - warna agar transporter top-level par ban jaye aur .env
// abhi load na hua ho, EMAIL_HOST/USER/PASS hamesha ke liye undefined reh
// jayenge aur koi bhi email kabhi nahi jayegi, chahe .env sahi bhara ho.
let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  // Zaroori .env variables check karo - agar missing hain, turant clear error do
  // (generic "email fail" dekhne ke bajaye exact wajah pata chale)
  const required = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Email is not configured. Missing .env values: ${missing.join(", ")}`);
  }

  cachedTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // PERFORMANCE: 8 second timeout - agar SMTP itni der me bhi respond na kare,
    // aage try karna user ko lambi wait karwana hoga (worst case: 2 attempts x 8s = 16s
    // max, jo already bahut hai). Zyadatar successful SMTP connections 1-2 second me
    // hi ho jate hain - yeh timeout sirf genuinely-hung connections ke liye hai.
    connectionTimeout: 8000,
    socketTimeout: 8000,
  });

  return cachedTransporter;
};

// Common wrapper - har email isi style me dikhega (ek professional, polished template)
const wrapTemplate = (title, bodyHtml, accentEmoji = "") => `
  <div style="font-family: 'Segoe UI', Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #ffffff;">
    <div style="background: linear-gradient(135deg, #4C5BFF, #7A5CFA); padding: 28px 32px; border-radius: 16px 16px 0 0;">
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">ChatLeaf</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">Simple. Private. Secure.</p>
    </div>
    <div style="border: 1px solid #eef0f5; border-top: none; border-radius: 0 0 16px 16px; padding: 32px;">
      <h2 style="color: #1a1a2e; margin: 0 0 16px; font-size: 19px;">${accentEmoji} ${title}</h2>
      <div style="color: #333; font-size: 15px; line-height: 1.6;">
        ${bodyHtml}
      </div>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #eef0f5;">
        <p style="color: #9aa0ac; font-size: 12px; margin: 0;">If this wasn't you, please secure your account immediately or contact ChatLeaf support.</p>
      </div>
    </div>
    <p style="text-align: center; color: #b0b4bd; font-size: 11px; margin-top: 16px;">© ChatLeaf. This is an automated message, please don't reply.</p>
  </div>
`;

// Ek chhota "pill/badge" style banane ke liye helper - table rows ko zyada polished dikhane ke liye
const detailRow = (label, value, highlight = false) => `
  <tr>
    <td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f1f2f6;">${escapeHtml(label)}</td>
    <td style="padding: 10px 0; text-align: right; font-size: 14px; border-bottom: 1px solid #f1f2f6; ${highlight ? "font-family: 'Courier New', monospace; background: #f5f6ff; padding: 6px 10px; border-radius: 6px; color: #4C5BFF; font-weight: 700;" : "color: #1a1a2e; font-weight: 600;"}">${escapeHtml(String(value))}</td>
  </tr>
`;

// Email bhejne ki koshish karta hai, agar transient network/SMTP glitch ki wajah se fail ho
// (jaise Gmail ka temporary throttle, connection drop), toh 1 baar dobara try karta hai
// chhoti si delay ke sath. Isse genuine temporary failures apne aap resolve ho jaate hain,
// bina user ko bahut lambi wait karwaye (max ~1 second extra delay + timeout).
const sendMail = async (to, subject, html, attempt = 1) => {
  const transporter = getTransporter();
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  } catch (error) {
    const maxAttempts = 2; // 1 original + 1 retry - genuinely-down SMTP ko baar-baar try karke user ko wait na karwao
    if (attempt < maxAttempts) {
      console.error(`Email send attempt ${attempt} failed (${error.message}). Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second wait, phir ek hi retry
      return sendMail(to, subject, html, attempt + 1);
    }
    // Sab attempts fail ho gaye - ab error upar controller tak jaayega
    throw error;
  }
};

// ---------------- OTP EMAIL ----------------
const sendOtpEmail = async (toEmail, otp, fullName) => {
  const html = wrapTemplate(
    "Verify Your Email",
    `
      <p>Hi ${escapeHtml(fullName) || "there"},</p>
      <p>Your verification code is:</p>
      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; background: #f5f6ff; color: #4C5BFF; font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px 28px; border-radius: 12px; font-family: 'Courier New', monospace;">${escapeHtml(String(otp))}</span>
      </div>
      <p>This code is valid for <b>5 minutes</b>. Please don't share it with anyone, including ChatLeaf staff.</p>
    `,
    "📧"
  );
  await sendMail(toEmail, "ChatLeaf - Your Verification Code", html);
};

// ---------------- WELCOME EMAIL (signup success - userId + password) ----------------
const sendWelcomeEmail = async (toEmail, fullName, userId, plainPassword) => {
  const html = wrapTemplate(
    "Welcome to ChatLeaf!",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>Your account has been created successfully. Here are your account details — please save them somewhere safe:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${detailRow("User ID", userId, true)}
        ${detailRow("Email", toEmail)}
        ${plainPassword ? detailRow("Password", plainPassword, true) : ""}
      </table>
      <p>You can use your <b>User ID</b> for others to find and chat with you on ChatLeaf. For your security, we recommend changing your password from Settings after your first login.</p>
    `,
    "🎉"
  );
  await sendMail(toEmail, "Welcome to ChatLeaf - Your Account Details", html);
};

// ---------------- NEW DEVICE LOGIN ALERT ----------------
const sendNewDeviceLoginEmail = async (toEmail, fullName, deviceName, loginTime) => {
  const html = wrapTemplate(
    "New Device Login Detected",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>We noticed a login to your ChatLeaf account from a device we haven't seen before:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${detailRow("Device", deviceName || "Unknown device")}
        ${detailRow("Time", loginTime)}
      </table>
      <p>If this was you, no action is needed. If you don't recognize this activity, please change your password immediately from Settings.</p>
    `,
    "🔐"
  );
  await sendMail(toEmail, "ChatLeaf - New Device Login Alert", html);
};

// ---------------- PASSWORD RESET (forgot-password se naya password generate hone par) ----------------
const sendPasswordResetEmail = async (toEmail, fullName, newPlainPassword) => {
  const html = wrapTemplate(
    "Your New Password",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>As requested, we've generated a new password for your ChatLeaf account. You've also been logged in automatically on this device.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${detailRow("Email", toEmail)}
        ${detailRow("New Password", newPlainPassword, true)}
      </table>
      <p>For your security, we recommend logging in and changing this password to something memorable from Settings as soon as possible.</p>
    `,
    "🔒"
  );
  await sendMail(toEmail, "ChatLeaf - Your New Password", html);
};

// ---------------- PROFILE PASSWORD RESET LINK (Settings me "current password bhool gaya") ----------------
// Yeh sendPasswordResetEmail se ALAG hai - yeh LOGIN flow ke liye nahi hai, balki
// already-logged-in user ke Settings/Profile page ke liye hai jab unhe apna CURRENT
// password yaad nahi lekin naya set karna hai. Isme password nahi bheja jata - ek
// SECURE LINK bheja jata hai jo web par ek password-set form kholta hai.
const sendPasswordResetLinkEmail = async (toEmail, fullName, resetUrl) => {
  const html = wrapTemplate(
    "Reset Your Password",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>We received a request to reset your ChatLeaf account password. Click the button below to set a new password:</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #4C5BFF, #7A5CFA); color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px;">Reset Password</a>
      </div>
      <p>This link is valid for <b>5 minutes</b> and can only be used <b>once</b>. If it expires, you can request a new one from Settings.</p>
      <p style="font-size: 12px; color: #9aa0ac; word-break: break-all;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(resetUrl)}</p>
    `,
    "🔗"
  );
  await sendMail(toEmail, "ChatLeaf - Reset Your Password", html);
};

// ---------------- USER ID CHANGED ----------------
const sendUserIdChangedEmail = async (toEmail, fullName, oldUserId, newUserId) => {
  const html = wrapTemplate(
    "Your User ID Was Changed",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>Your ChatLeaf User ID has been updated:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${detailRow("Previous User ID", oldUserId)}
        ${detailRow("New User ID", newUserId, true)}
      </table>
      <p>You'll be able to change your User ID again after 30 days. If you didn't make this change, please contact support right away.</p>
    `,
    "🆔"
  );
  await sendMail(toEmail, "ChatLeaf - User ID Changed", html);
};

// ---------------- PASSWORD CHANGED ----------------
const sendPasswordChangedEmail = async (toEmail, fullName) => {
  const html = wrapTemplate(
    "Your Password Was Changed",
    `
      <p>Hi ${escapeHtml(fullName)},</p>
      <p>This is a confirmation that your ChatLeaf account password was just changed successfully.</p>
      <p>If you made this change, no action is needed. If you didn't do this, please reset your password immediately and contact support.</p>
    `,
    "🔑"
  );
  await sendMail(toEmail, "ChatLeaf - Password Changed", html);
};

module.exports = {
  sendOtpEmail,
  sendWelcomeEmail,
  sendNewDeviceLoginEmail,
  sendPasswordResetEmail,
  sendPasswordResetLinkEmail,
  sendUserIdChangedEmail,
  sendPasswordChangedEmail,
};
