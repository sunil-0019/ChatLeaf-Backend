const rateLimit = require("express-rate-limit");

// General API limiter - koi bhi ek IP bahut zyada requests na bhej sake
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  max: 200, // ek IP se 15 min me max 200 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

// Auth-specific limiter (login, signup, otp) - inpe zyada strict rakha hai kyuki
// yeh sabse zyada attack-prone endpoints hote hain (brute force, spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 15 min me max 30 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

module.exports = { generalLimiter, authLimiter };
