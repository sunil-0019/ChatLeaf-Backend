const { PasswordResetRateLimit } = require("../models/PasswordResetLink");

const MAX_LINKS_PER_DAY = 2;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 ghante (1 din)

/**
 * Check karta hai ki is email ko aaj (24-hour window me) 2 se zyada reset-link
 * toh nahi bheje ja chuke. Agar allowed hai, counter bhi update kar deta hai.
 */
const canSendResetLink = async (email) => {
  const now = new Date();
  const existing = await PasswordResetRateLimit.findOne({ email });

  if (!existing) {
    await PasswordResetRateLimit.create({ email, requestCount: 1, windowStartedAt: now });
    return { allowed: true };
  }

  const windowAge = now.getTime() - new Date(existing.windowStartedAt).getTime();

  // 24 ghante beet chuke - window reset karo
  if (windowAge >= RATE_LIMIT_WINDOW_MS) {
    existing.requestCount = 1;
    existing.windowStartedAt = now;
    await existing.save();
    return { allowed: true };
  }

  if (existing.requestCount >= MAX_LINKS_PER_DAY) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - windowAge;
    const hoursLeft = Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000)));
    return {
      allowed: false,
      reason: `You've reached the limit of ${MAX_LINKS_PER_DAY} password reset requests per day. Please try again in ${hoursLeft} hour(s).`,
    };
  }

  existing.requestCount += 1;
  await existing.save();
  return { allowed: true };
};

module.exports = { canSendResetLink, MAX_LINKS_PER_DAY };
