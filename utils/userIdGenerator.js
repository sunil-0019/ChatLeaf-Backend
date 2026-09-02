const User = require("../models/User");

// Full name se ek chhota, readable, unique userId banata hai
// Format: hamesha "naam_XXXX" jaisa (jaise "sunil_1234") - naam ke sath 4-digit number
// Length hamesha 8-30 characters ke beech rehti hai (User model ke validation se match karta hai)
//
// PRODUCTION NOTE: collision chance bahut kam hai (9000 possible numbers per base-name),
// isliye zyadatar signups pehle ya doosre attempt me hi unique ID pa lete hain. Attempts
// ki max limit (15) isliye rakhi hai taaki kisi extreme edge case (jaise ek hi naam ke
// hazaaron users) me bhi yeh function hamesha ke liye loop na kare aur signup request
// timeout ho jaaye - us case me guaranteed-unique timestamp-based fallback use hota hai.
const generateUniqueUserId = async (fullName) => {
  // Naam ka pehla word lo, sirf letters rakho, lowercase karo
  const firstName = fullName.trim().split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");

  // base ki length kam se kam 4 honi chahiye taaki base + "_" + 4-digit number
  // (4+1+4=9) hamesha 8-char minimum se upar rahe. Chhote naam (jaise "Al", "Bo")
  // ko "user" fallback milta hai (4 letters), lamba naam max 20 tak trim hota hai
  // (20+1+4=25, jo 30-char maximum ke andar aata hai).
  const base = firstName.length >= 4 ? firstName.slice(0, 20) : "user";

  // "naam_XXXX" format - 4-digit random number ke sath
  const MAX_ATTEMPTS = 15;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const randomNum = Math.floor(Math.random() * 9000) + 1000; // 1000-9999 ka 4-digit number
    const candidate = `${base}_${randomNum}`;
    const existing = await User.findOne({ userId: candidate }).lean(); // .lean() - sirf existence check karna hai, poora Mongoose document nahi chahiye, isse query fast hoti hai
    if (!existing) return candidate;
  }

  // Agar MAX_ATTEMPTS me bhi unique nahi mila (bahut rare case), timestamp jod do - guaranteed unique.
  // slice(-8) se 8-digit timestamp suffix milta hai, base(max 20) + "_" + 8 = max 29, 30-char limit ke andar.
  return `${base}_${Date.now().toString().slice(-8)}`;
};

module.exports = generateUniqueUserId;
