// SECURITY DESIGN (jaisa maanga gaya tha):
//
// Sirf ek lamba-chauda token dene ke bajaye, hum DO tokens dete hain:
//   1. ACCESS TOKEN  - chhoti life (15 min). Har API request me yeh bhejna hota hai.
//                      Agar yeh kisi tarah leak bhi ho jaye, 15 min baad khud expire ho jayega.
//   2. REFRESH TOKEN - PERMANENT (koi expiry nahi). Ek baar login/signup pe banta hai,
//                      aur tab tak wahi rehta hai jab tak user khud LOGOUT nahi karta.
//                      Jab access token 15 min me expire ho jaye, isi refresh token se
//                      naya access token mil jata hai - refresh token khud NAYA nahi
//                      banta is process me, sirf tab naya banta hai jab user logout
//                      karke dubara login kare.
//
// Refresh token ka HASH (bcrypt se) database me store hota hai, plain text kabhi nahi -
// isse agar database bhi leak ho jaye, koi refresh token use nahi kar payega.

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const generateAccessToken = (mongoUserId) => {
  return jwt.sign({ id: mongoUserId, type: "access" }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  });
};

// Refresh token PERMANENT hai - expiresIn NAHI diya, isliye JWT kabhi expire nahi hoga.
// Yeh sirf logout hone par hi invalidate hota hai (DB se hash hata ke).
const generateRefreshToken = (mongoUserId) => {
  return jwt.sign({ id: mongoUserId, type: "refresh" }, process.env.JWT_REFRESH_SECRET);
};

// Refresh token ko hash karke DB me save karne layak banata hai
const hashToken = async (token) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
};

// LOGIN/SIGNUP ke waqt use hota hai - dono NAYE tokens banata hai (naya session shuru)
const generateTokenPair = (mongoUserId) => {
  return {
    accessToken: generateAccessToken(mongoUserId),
    refreshToken: generateRefreshToken(mongoUserId),
  };
};

module.exports = { generateAccessToken, generateRefreshToken, generateTokenPair, hashToken };
