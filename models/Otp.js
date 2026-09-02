// Yeh EK hi model, DO jagah use hota hai:
//   purpose = "signup"  -> Signup ke waqt email verify karne ke liye
//   purpose = "login"   -> Forgot Password / OTP-login ke liye
//
// RULES (jaisa maanga gaya tha):
//   - OTP 5 minute tak valid rehta hai
//   - Naya OTP maangne (resend) ke beech kam se kam 2 minute ka gap hona chahiye
//   - Total 5 baar OTP bhej sakte ho, uske baad 24 ghante ka lock lag jata hai
//   - 24 ghante baad counter apne aap reset ho jata hai, aur yeh record bhi TTL se delete ho jata hai

const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  purpose: {
    type: String,
    enum: ["signup", "login"],
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  // OTP kab bana - isi se 5-minute expiry check hoti hai (utils/otpService.js me)
  otpCreatedAt: {
    type: Date,
    default: Date.now,
  },
  // Aaj tak (is 24-hour window me) kitni baar OTP bheja gaya
  sendCount: {
    type: Number,
    default: 1,
  },
  // 24-hour window kab shuru hui thi - isi se lock/reset decide hota hai
  windowStartedAt: {
    type: Date,
    default: Date.now,
  },
  // OTP verify ho chuka hai kya (signup flow me password-step tak carry karne ke liye)
  isVerified: {
    type: Boolean,
    default: false,
  },
  // Yeh temporary signup data bhi yahin store karte hain (purpose="signup" ke liye)
  // taaki alag PendingSignup collection na banani pade. Password yahan store NAHI hota -
  // wo OTP verify hone ke baad hi generate hota hai (backend khud banata hai).
  pendingFullName: { type: String, default: null },

  // Agar user OTP process beech me hi chhod de (na verify kare na dobara try kare),
  // toh yeh record hamesha DB me pada na rahe - storage bharne se bachne ke liye
  // 10 minute baad MongoDB TTL se khud delete ho jayega. Yeh sirf ek "safety net" hai -
  // normal case me toh verify/login hote hi record turant delete ho jata hai (code me
  // Otp.deleteOne() se), yeh field sirf abandoned/incomplete attempts clean karta hai.
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000),
    expires: 0, // TTL index - "expiresAt" me jo time hai, wahi delete hone ka time hai
  },
});

// Ek email + ek purpose ka sirf ek hi active OTP record ho
otpSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model("Otp", otpSchema);
