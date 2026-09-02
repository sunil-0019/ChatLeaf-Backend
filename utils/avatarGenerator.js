// Jab tak user khud koi photo upload nahi karta, tab tak yeh default avatar dikhta hai -
// WhatsApp/Slack jaisa style: naam ka SIRF PEHLA LETTER (jaise "Sunil Pal" -> "S") +
// ek background color, SVG image ke roop me.
//
// DiceBear (free, public API) ka "initials" style use kar rahe hain - koi API key nahi chahiye.
// Yeh sirf ek URL return karta hai jo Android app me Glide/Coil se seedha load ho jayega.

// Background colors ka set - har NAYE USER ko in me se ek RANDOM color milta hai.
// Yeh naam se bilkul link nahi hai - do "Sunil" naam ke alag users ko bhi alag-alag
// color mil sakta hai (aur kabhi-kabhi same bhi - dono normal hai, jaisa maanga gaya).
const AVATAR_BACKGROUND_COLORS = [
  "4C5BFF", "7A5CFA", "22C55E", "F59E0B",
  "EF4444", "06B6D4", "EC4899", "8B5CF6",
  "10B981", "F97316", "3B82F6", "D946EF",
];

const pickRandomAvatarColor = () => {
  return AVATAR_BACKGROUND_COLORS[Math.floor(Math.random() * AVATAR_BACKGROUND_COLORS.length)];
};

// fullName se sirf PEHLA LETTER nikalta hai (jaise "Sunil Pal" -> "S", "anjali" -> "A")
// Emoji ya surrogate-pair characters (jaise 😀) ko safely handle karta hai - inka
// pehla "half" nikalne se malformed/invalid character ban jata hai jo URL-encoding
// crash karwa sakta hai, isliye Array.from() use kiya hai jo poore Unicode character
// ko ek unit ki tarah treat karta hai, aadha nahi kaatta.
const getFirstInitial = (fullName) => {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "U";

  const firstUnicodeChar = Array.from(trimmed)[0]; // poora character (emoji sahit) safely nikalta hai
  const upper = firstUnicodeChar.toUpperCase();

  // Agar pehla character letter/number nahi hai (jaise emoji, symbol), fallback "U" use karo -
  // taaki avatar hamesha readable rahe aur URL-encoding kabhi fail na ho
  const isLetterOrDigit = /^[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]$/.test(upper);
  return isLetterOrDigit ? upper : "U";
};

// bgColorHex - agar pehle se assign color hai (DB me store) toh wahi use karo,
// warna naya random color generate karo. Isse ek user ka avatar hamesha consistent
// rehta hai (baar-baar login pe color badalta nahi), lekin alag users alag color pate hain.
const generateDefaultAvatar = (fullName, bgColorHex) => {
  const initial = encodeURIComponent(getFirstInitial(fullName));
  const color = bgColorHex || pickRandomAvatarColor();
  return `https://api.dicebear.com/7.x/initials/svg?seed=${initial}&backgroundColor=${color}&fontSize=42`;
};

module.exports = { generateDefaultAvatar, pickRandomAvatarColor, getFirstInitial };
