const Otp = require("../models/Otp");
const generateOtp = require("./otpGenerator");

const OTP_VALIDITY_MS = 5 * 60 * 1000; // OTP 5 minute tak valid rehta hai
const MIN_GAP_BETWEEN_SENDS_MS = 2 * 60 * 1000; // Resend ke liye 2 minute ka gap zaroori hai
const MAX_SENDS_PER_WINDOW = 5; // 5 baar ke baad lock
const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 ghante ka lock

/**
 * OTP generate/send karne se pehle yeh function check karta hai:
 * - kya 24-hour window abhi bhi chal rahi hai, aur usme 5 se zyada attempts ho chuke
 * - kya pichla OTP bheje abhi 2 minute bhi nahi hue
 *
 * Return: { allowed: true, otp, doc } YA { allowed: false, reason, retryAfterSeconds }
 */
const canSendOtp = async (email, purpose) => {
  const now = new Date();
  const existing = await Otp.findOne({ email, purpose });

  if (!existing) {
    // Pehli baar OTP maang raha hai - koi restriction nahi
    return { allowed: true, isNew: true };
  }

  // DEFENSIVE CHECK: agar kisi purane/corrupt record me windowStartedAt ya otpCreatedAt
  // missing ho (jaise purana data jo naye schema se pehle bana tha), toh use bhi
  // "naye jaisa" treat karo - taaki NaN comparison se lock silently bypass na ho.
  // Yeh sabse important fix hai us bug ke liye jisme 24-hour lock kaam nahi kar raha tha.
  if (!existing.windowStartedAt || !existing.otpCreatedAt || typeof existing.sendCount !== "number") {
    return { allowed: true, isNew: false, shouldResetWindow: true };
  }

  const windowStartedAtMs = new Date(existing.windowStartedAt).getTime();
  const otpCreatedAtMs = new Date(existing.otpCreatedAt).getTime();
  const windowAge = now.getTime() - windowStartedAtMs;

  // Agar 24-hour window khatam ho chuki hai, sab reset kar do
  if (windowAge >= LOCK_WINDOW_MS) {
    return { allowed: true, isNew: false, shouldResetWindow: true };
  }

  // Window abhi chal rahi hai - check karo 5 attempts se zyada toh nahi ho gaye
  // ">=" isliye taaki agar kisi wajah se count 5 se zyada bhi ho jaye (race condition jaisa
  // rare case), tab bhi lock lage - "===" use karte toh 6,7,8... par lock miss ho sakta tha
  if (existing.sendCount >= MAX_SENDS_PER_WINDOW) {
    const retryAfterMs = LOCK_WINDOW_MS - windowAge;
    const hoursLeft = Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000)));
    return {
      allowed: false,
      reason: `Too many OTP requests. Please try again after ${hoursLeft} hour(s).`,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  // Check karo pichla OTP bheje 2 minute ho chuke hain kya (resend gap)
  const timeSinceLastSend = now.getTime() - otpCreatedAtMs;
  if (timeSinceLastSend < MIN_GAP_BETWEEN_SENDS_MS) {
    const waitSeconds = Math.ceil((MIN_GAP_BETWEEN_SENDS_MS - timeSinceLastSend) / 1000);
    return {
      allowed: false,
      reason: `Please wait ${waitSeconds} seconds before requesting a new code.`,
      retryAfterSeconds: waitSeconds,
    };
  }

  return { allowed: true, isNew: false };
};

/**
 * Naya OTP generate karke DB me save/update karta hai.
 * extraFields - signup ke case me pendingFullName bhi save karne ke liye
 */
const createOrUpdateOtp = async (email, purpose, checkResult, extraFields = {}) => {
  const otp = generateOtp();
  const now = new Date();

  // IMPORTANT FIX: safety-net TTL (expiresAt) ko hamesha "ab + 10 min" set NAHI karna -
  // agar user LOCKED hai (24-hour window chal rahi hai), toh record ko 24 ghante tak
  // zinda rehna zaroori hai, warna 10 min baad MongoDB record delete kar dega aur agli
  // baar canSendOtp() ko "naya user" dikhega - lock silently bypass ho jayega.
  // Isliye: agar window fresh/reset ho rahi hai -> 10 min TTL (jaisa signup abandon case).
  // Agar window already chal rahi hai (chahe locked ho ya nahi) -> TTL 24-hour window
  // khatam hone tak extend karo, taaki lock ke dauran record kabhi delete na ho.
  const isWindowFresh = checkResult.isNew || checkResult.shouldResetWindow;
  const newExpiresAt = isWindowFresh
    ? new Date(now.getTime() + 10 * 60 * 1000) // naya/reset window -> 10 min safety-net
    : new Date(now.getTime() + 24 * 60 * 60 * 1000); // existing window -> poore 24hr tak zinda rakho

  if (checkResult.isNew) {
    const doc = await Otp.create({
      email,
      purpose,
      otp,
      otpCreatedAt: now,
      sendCount: 1,
      windowStartedAt: now,
      isVerified: false,
      expiresAt: newExpiresAt,
      ...extraFields,
    });
    return { otp, doc };
  }

  const updateFields = {
    otp,
    otpCreatedAt: now,
    isVerified: false,
    expiresAt: newExpiresAt,
    ...extraFields,
  };

  if (checkResult.shouldResetWindow) {
    updateFields.sendCount = 1;
    updateFields.windowStartedAt = now;
  } else {
    updateFields.$inc = { sendCount: 1 };
  }

  // $inc ko alag se handle karna padega kyuki spread ke sath nahi chalta seedha
  const { $inc, ...rest } = updateFields;
  const doc = await Otp.findOneAndUpdate(
    { email, purpose },
    $inc ? { $set: rest, $inc } : { $set: rest },
    { new: true }
  );

  return { otp, doc };
};

/**
 * OTP verify karta hai - expiry (5 min) aur match dono check karta hai
 */
const verifyOtpValue = async (email, purpose, submittedOtp) => {
  const record = await Otp.findOne({ email, purpose });
  if (!record) {
    return { valid: false, message: "OTP not found or expired. Please request a new code." };
  }

  const age = Date.now() - new Date(record.otpCreatedAt).getTime();
  if (age > OTP_VALIDITY_MS) {
    return { valid: false, message: "OTP has expired. Please request a new code." };
  }

  if (record.otp !== String(submittedOtp).trim()) {
    return { valid: false, message: "Invalid OTP. Please try again." };
  }

  return { valid: true, record };
};

/**
 * Agar OTP DB me save hone ke baad bhi EMAIL bhejna fail ho jaye, toh is function se
 * "undo" karte hain - taaki user ka genuine attempt count waste na ho aur wo turant retry kar sake.
 */
const rollbackOtpSend = async (email, purpose, wasNew) => {
  if (wasNew) {
    // Naya record tha - poora hata do, jaise kuch hua hi nahi
    await Otp.deleteOne({ email, purpose });
  } else {
    // Purana record tha - sirf count 1 kam kar do
    await Otp.updateOne({ email, purpose }, { $inc: { sendCount: -1 } });
  }
};

module.exports = { canSendOtp, createOrUpdateOtp, verifyOtpValue, rollbackOtpSend, OTP_VALIDITY_MS };
