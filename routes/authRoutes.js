const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiter");
const uploadProfileImage = require("../middleware/uploadMiddleware");
const {
  sendSignupOtp,
  verifySignupOtp,
  resendSignupOtp,
  login,
  googleLogin,
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  forgotPasswordResendOtp,
  refreshToken,
  logout,
  updateUserId,
  changePassword,
  requestPasswordResetLink,
  validateResetLink,
  resetPasswordViaLink,
  updateProfile,
  uploadProfilePicture,
} = require("../controllers/authController");

// Multer errors (jaise "file too large", "wrong file type") ko safely JSON error me
// convert karta hai - warna yeh raw Express error crash jaisa dikh sakta hai
const handleUpload = (req, res, next) => {
  uploadProfileImage(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "Image is too large. Maximum size is 5MB."
        : err.message || "Could not process the uploaded file.";
      return res.status(400).json({ success: false, message });
    }
    next();
  });
};

// ----- SIGNUP -----
router.post("/signup/send-otp", authLimiter, sendSignupOtp);
router.post("/signup/verify-otp", authLimiter, verifySignupOtp);
router.post("/signup/resend-otp", authLimiter, resendSignupOtp);

// ----- LOGIN -----
router.post("/login", authLimiter, login);
router.post("/google-login", authLimiter, googleLogin);

// ----- FORGOT PASSWORD (LOGIN SCREEN - OTP -> naya password auto-generate + auto-login) -----
router.post("/forgot-password/send-otp", authLimiter, forgotPasswordSendOtp);
router.post("/forgot-password/verify-otp", authLimiter, forgotPasswordVerifyOtp);
router.post("/forgot-password/resend-otp", authLimiter, forgotPasswordResendOtp);

// ----- TOKEN -----
router.post("/refresh-token", refreshToken);
router.post("/logout", protect, logout);

// ----- PROFILE (login required - Settings screen) -----
router.patch("/profile/user-id", protect, updateUserId);
router.patch("/profile/password", protect, changePassword); // current password se khud change karna
router.patch("/profile", protect, updateProfile); // "fullName" aur "about" text update
router.post("/profile/picture", protect, handleUpload, uploadProfilePicture); // profile photo -> Cloudinary

// ----- PROFILE "FORGOT PASSWORD" (Settings - current password yaad nahi, LINK-based, session change nahi hota) -----
router.post("/profile/password/request-reset-link", protect, authLimiter, requestPasswordResetLink);
// Neeche wale DO routes PUBLIC hain (login required nahi) - kyuki user email ke link se
// yaha aata hai, uske paas us waqt koi valid session/token nahi hota
router.get("/profile/password/validate-reset-link", authLimiter, validateResetLink);
router.post("/profile/password/reset-via-link", authLimiter, resetPasswordViaLink);

module.exports = router;
