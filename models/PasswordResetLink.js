// Yeh model SIRF Settings/Profile ke "current password yaad nahi" flow ke liye hai.
// Yeh Otp.js se ALAG hai - kyuki yeh OTP-based nahi, LINK-based hai, aur rules bhi
// alag hain (5-min validity, one-time-use, max 2 per day) - login/signup ke OTP
// rules (5-min validity, 5-attempt/24hr-lock) se bilkul mix nahi karna.
//
// RULES:
//   - Link 5 minute tak valid rehta hai
//   - Link sirf EK BAAR use ho sakta hai (verify hote hi ya use hote hi mar jata hai)
//   - Agar link kholaa hi nahi gaya, 10 minute me safety-net TTL se apne aap delete ho jata hai
//   - Ek din (24 ghante) me max 2 baar hi naya reset-link mangwa sakte ho
//
// IMPORTANT: Yeh flow login state CHANGE NAHI karta - koi access/refresh token nahi deta,
// sirf password badalta hai. User apne existing session me hi rehta hai.

const mongoose = require("mongoose");
const crypto = require("crypto");

const passwordResetLinkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  // Yeh raw token URL me jata hai (link ke andar). DB me iska HASH store hota hai
  // (jaise password), taaki agar database leak ho jaye, koi purane links use na kar sake.
  tokenHash: {
    type: String,
    required: true,
  },
  isUsed: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Safety-net TTL - agar link kabhi kholaa hi nahi gaya, 10 min me khud delete ho jata hai
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000),
    index: { expires: 0 },
  },
});

// Ek din me max 2 requests ka hisaab rakhne ke liye alag, chhota tracking document -
// yeh purane reset-link records pe depend nahi karta (woh toh use hote hi/10-min me delete ho jate hain)
const passwordResetRateLimitSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  requestCount: {
    type: Number,
    default: 1,
  },
  windowStartedAt: {
    type: Date,
    default: Date.now,
  },
});

// Ek secure random token banata hai (link ke liye) aur uska hash bhi return karta hai
const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex"); // URL me jayega
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex"); // DB me store hoga
  return { rawToken, tokenHash };
};

const hashResetToken = (rawToken) => {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
};

const PasswordResetLink = mongoose.model("PasswordResetLink", passwordResetLinkSchema);
const PasswordResetRateLimit = mongoose.model("PasswordResetRateLimit", passwordResetRateLimitSchema);

module.exports = { PasswordResetLink, PasswordResetRateLimit, generateResetToken, hashResetToken };
