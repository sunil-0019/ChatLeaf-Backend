// Signup ke waqt user password type NAHI karta - backend khud ek strong,
// readable password generate karta hai (fullname se related + random digits).
// 12 characters ka banta hai. Yeh plain password sirf EK BAAR (turant signup ke
// baad) welcome email me bheja jata hai - database me hamesha sirf bcrypt HASH store hota hai.

const generatePassword = (fullName) => {
  // Naam ka pehla word lo, sirf letters, capitalize first letter (jaisa "Sunil")
  const firstName = fullName.trim().split(" ")[0].replace(/[^a-zA-Z]/g, "");
  const namePart = firstName.length >= 3
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1, 5).toLowerCase()
    : "User";

  // Baaki characters random digits/symbols se bharo taaki total 12 length ho jaye aur
  // password strong bhi rahe (letter + number + ek special character)
  const specialChars = "@#$%";
  const randomSpecial = specialChars[Math.floor(Math.random() * specialChars.length)];

  let randomDigits = "";
  const digitsNeeded = 12 - namePart.length - 1; // -1 special character ke liye
  for (let i = 0; i < digitsNeeded; i++) {
    randomDigits += Math.floor(Math.random() * 10);
  }

  return `${namePart}${randomSpecial}${randomDigits}`;
};

module.exports = generatePassword;
