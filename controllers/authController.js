const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const Otp = require("../models/Otp");
const { PasswordResetLink, generateResetToken, hashResetToken } = require("../models/PasswordResetLink");
const { canSendOtp, createOrUpdateOtp, verifyOtpValue, rollbackOtpSend } = require("../utils/otpService");
const { canSendResetLink } = require("../utils/resetLinkRateLimit");
const generateUniqueUserId = require("../utils/userIdGenerator");
const generatePassword = require("../utils/passwordGenerator");
const { generateDefaultAvatar, pickRandomAvatarColor } = require("../utils/avatarGenerator");
const { generateTokenPair, generateAccessToken, hashToken } = require("../utils/tokenUtils");
const checkAndRegisterDevice = require("../utils/deviceService");
const { uploadBufferToCloudinary, deleteFromCloudinary, extractPublicId } = require("../utils/cloudinaryService");
const {
  sendOtpEmail,
  sendWelcomeEmail,
  sendNewDeviceLoginEmail,
  sendPasswordResetEmail,
  sendPasswordResetLinkEmail,
  sendUserIdChangedEmail,
  sendPasswordChangedEmail,
} = require("../utils/emailService");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ---------------- VALIDATION HELPERS ----------------
const isValidEmail = (email) => {
  if (typeof email !== "string") return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
};

const isStrongPassword = (password) => {
  if (typeof password !== "string") return false;
  return password.length >= 8 && /[0-9]/.test(password) && /[a-zA-Z]/.test(password);
};

// User ID: lowercase letters, numbers, underscore, @ symbol, length 8-30 characters
const isValidUserId = (userId) => {
  if (typeof userId !== "string") return false;
  return /^[a-z0-9_@]{8,30}$/.test(userId.trim());
};

// User object ko safe shape me convert karta hai (password kabhi bhejni nahi hai response me)
const toSafeUser = (user) => ({
  id: user._id,
  userId: user.userId,
  fullName: user.fullName,
  email: user.email,
  profileImage: user.profileImage,
  avatarColor: user.avatarColor,
  about: user.about,
  authProvider: user.authProvider,
});

// LOGIN/SIGNUP success hone par dono NAYE tokens banata hai (naya session shuru),
// refresh token hash karke save karta hai
const issueTokensAndSave = async (user) => {
  const { accessToken, refreshToken } = generateTokenPair(user._id);
  user.refreshTokenHash = await hashToken(refreshToken);
  await user.save();
  return { accessToken, refreshToken };
};

// REFRESH-TOKEN endpoint ke liye - sirf NAYA ACCESS TOKEN banata hai.
// Refresh token WAHI PURANA rehta hai (DB me kuch update nahi hota) - taaki
// refresh token permanent rahe, sirf logout-login par hi badle.
const issueNewAccessTokenOnly = (user) => {
  return generateAccessToken(user._id);
};

/* =====================================================================
   SIGNUP FLOW
   Step 1: sendSignupOtp        - Full Name + Email diye, "Send OTP" dabaya
   Step 2: verifySignupOtp      - OTP verify + account create (password/avatar auto-generate) + welcome email
===================================================================== */

// User se sirf Full Name aur Email liya jata hai screen par - password KHUD backend banayega.
exports.sendSignupOtp = async (req, res) => {
  try {
    const { fullName, email } = req.body;

    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: "Full name must be at least 2 characters." });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Email pehle se registered user ka toh nahi hai
    // PERFORMANCE: .lean() - sirf existence check karna hai, poora Mongoose document
    // banane ki zaroorat nahi, isse query thodi fast hoti hai
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered. Please log in instead.",
      });
    }

    // OTP bhejne ki permission check karo (2 min resend gap, 5 attempt limit, 24hr lock)
    const check = await canSendOtp(normalizedEmail, "signup");
    if (!check.allowed) {
      return res.status(429).json({ success: false, message: check.reason });
    }

    const { otp } = await createOrUpdateOtp(normalizedEmail, "signup", check, {
      pendingFullName: fullName.trim(),
    });

    try {
      await sendOtpEmail(normalizedEmail, otp, fullName.trim());
    } catch (emailError) {
      console.error("Signup OTP email failed:", emailError.message);
      await rollbackOtpSend(normalizedEmail, "signup", check.isNew); // attempt count wapas kardo
      return res.status(502).json({
        success: false,
        message: "Could not send verification email. Please try again shortly.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}.`,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("sendSignupOtp error:", error);
    // Race condition - do requests ek saath aayin, dusri ko friendly message do (crash nahi)
    if (error.code === 11000) {
      return res.status(429).json({
        success: false,
        message: "A verification code was just requested for this email. Please wait a moment and try again.",
      });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// OTP verify hote hi account create ho jata hai. Password YAHIN backend generate karta hai
// (user se kabhi nahi maanga jata), fir plain password sirf ek baar welcome email me jata hai.
exports.verifySignupOtp = async (req, res) => {
  try {
    const { email, otp, deviceId, deviceName } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (!otp || !/^[0-9]{6}$/.test(String(otp).trim())) {
      return res.status(400).json({ success: false, message: "OTP must be a 6-digit code." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const result = await verifyOtpValue(normalizedEmail, "signup", otp);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    const otpRecord = result.record;
    if (!otpRecord.pendingFullName) {
      return res.status(400).json({
        success: false,
        message: "Signup session is invalid. Please start the signup process again.",
      });
    }

    // Double check - isi beech koi aur is email se register toh nahi ho gaya
    // PERFORMANCE: .lean() - sirf existence check karna hai
    const alreadyExists = await User.findOne({ email: normalizedEmail }).lean();
    if (alreadyExists) {
      await Otp.deleteOne({ _id: otpRecord._id });
      return res.status(409).json({
        success: false,
        message: "This email is already registered. Please log in instead.",
      });
    }

    const fullName = otpRecord.pendingFullName;
    const userId = await generateUniqueUserId(fullName);

    // Password YAHIN generate hota hai - user ne kahin nahi tayp kiya
    const plainPassword = generatePassword(fullName);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    // Default avatar bhi yahin generate hota hai - naam ke pehle letter se, aur
    // ek random background color assign hota hai (har user ko alag color milta hai)
    const avatarColor = pickRandomAvatarColor();
    const defaultAvatar = generateDefaultAvatar(fullName, avatarColor);

    const newUser = await User.create({
      userId,
      fullName,
      email: normalizedEmail,
      password: hashedPassword,
      authProvider: "local",
      isEmailVerified: true,
      profileImage: defaultAvatar,
      avatarColor,
    });

    // Signup complete hone ke baad OTP record delete kardo
    await Otp.deleteOne({ _id: otpRecord._id });

    // Naye device ko register karo (pehla login hai, toh naya hi hoga)
    await checkAndRegisterDevice(newUser, deviceId, deviceName, req.ip);
    const { accessToken, refreshToken } = await issueTokensAndSave(newUser);

    // Welcome email bhejo - userId + PLAIN PASSWORD dono bhejne hain (yeh SIRF isi ek baar
    // plain text me kahin dikhega, DB me hamesha hash hi rahega).
    // Agar yeh email fail bhi ho jaye, signup ko fail nahi karte (account already ban chuka hai
    // aur tokens bhi issue ho chuke hain) - lekin error ko clearly log karte hain taaki
    // debug karna aasan ho (SMTP credentials galat hona sabse common wajah hoti hai).
    let welcomeEmailSent = true;
    try {
      await sendWelcomeEmail(normalizedEmail, fullName, userId, plainPassword);
    } catch (emailError) {
      welcomeEmailSent = false;
      console.error("❌ Welcome email FAILED to send. Reason:", emailError.message);
      console.error("   Check your .env EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASS values.");
    }

    return res.status(201).json({
      success: true,
      message: welcomeEmailSent
        ? "Account created successfully! Check your email for your login details."
        : "Account created successfully! (Note: we couldn't send the welcome email — please save your password now.)",
      accessToken,
      refreshToken,
      user: toSafeUser(newUser),
      // Agar email fail ho jaye, password response me bhi bhej dete hain taaki user account se lock-out na ho
      ...(welcomeEmailSent ? {} : { temporaryPassword: plainPassword }),
    });
  } catch (error) {
    console.error("verifySignupOtp error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This email is already registered." });
    }
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0]?.message || "Invalid data provided.";
      return res.status(400).json({ success: false, message: firstMessage });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// Resend OTP (signup ke waqt) - same rate-limit rules apply hongi
exports.resendSignupOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await Otp.findOne({ email: normalizedEmail, purpose: "signup" });
    if (!existing || !existing.pendingFullName) {
      return res.status(400).json({
        success: false,
        message: "No pending signup found for this email. Please start signup again.",
      });
    }

    const check = await canSendOtp(normalizedEmail, "signup");
    if (!check.allowed) {
      return res.status(429).json({ success: false, message: check.reason });
    }

    const { otp } = await createOrUpdateOtp(normalizedEmail, "signup", check, {
      pendingFullName: existing.pendingFullName,
    });

    try {
      await sendOtpEmail(normalizedEmail, otp, existing.pendingFullName);
    } catch (emailError) {
      console.error("Resend signup OTP email failed:", emailError.message);
      await rollbackOtpSend(normalizedEmail, "signup", check.isNew);
      return res.status(502).json({ success: false, message: "Could not resend the code. Please try again." });
    }

    return res.status(200).json({ success: true, message: "A new verification code has been sent." });
  } catch (error) {
    console.error("resendSignupOtp error:", error);
    if (error.code === 11000) {
      return res.status(429).json({
        success: false,
        message: "A verification code was just requested for this email. Please wait a moment and try again.",
      });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

/* =====================================================================
   LOGIN FLOW - sirf email + password
===================================================================== */
exports.login = async (req, res) => {
  try {
    const { email, password, deviceId, deviceName } = req.body;

    if (!email || typeof email !== "string" || email.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (!password || typeof password !== "string" || password.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Password is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email not exist." });
    }

    if (user.authProvider === "google" && !user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google Sign-In. Please continue with Google.",
      });
    }

    // Safety net - agar kisi wajah se password field hi missing ho (corrupt data jaisa rare case),
    // bcrypt.compare crash na kare isliye pehle hi check kar lete hain
    if (!user.password) {
      console.error(`Login attempt for user ${user._id} with no password set on a "${user.authProvider}" account.`);
      return res.status(500).json({ success: false, message: "Server error. Please try again later." });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Naya device check karo - security email trigger karne ke liye
    const deviceResult = await checkAndRegisterDevice(user, deviceId, deviceName, req.ip);
    const { accessToken, refreshToken } = await issueTokensAndSave(user);

    // PERFORMANCE: yeh email sirf ek NOTIFICATION hai (login already safal ho chuka hai
    // upar) - isliye ise "await" nahi karte. Response turant user ko chala jata hai,
    // email background me chalti rehti hai. Agar yeh fail bhi ho jaye, login par koi
    // asar nahi padta - sirf console me log ho jata hai.
    if (deviceResult.isNewDevice) {
      sendNewDeviceLoginEmail(user.email, user.fullName, deviceResult.deviceName, new Date().toLocaleString())
        .catch((emailError) => console.error("New device email failed:", emailError.message));
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      accessToken,
      refreshToken,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

/* =====================================================================
   GOOGLE LOGIN - agar email exist karta hai toh login, warna auto-signup
===================================================================== */
exports.googleLogin = async (req, res) => {
  try {
    const { idToken, deviceId, deviceName } = req.body;

    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ success: false, message: "Google ID token is required." });
    }

    // Google se token verify karo - yeh confirm karta hai token genuine hai aur Google ne hi issue kiya hai
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.error("Google token verify failed:", verifyError.message);
      return res.status(401).json({ success: false, message: "Invalid Google credentials." });
    }

    if (!payload || !payload.email) {
      return res.status(401).json({ success: false, message: "Could not retrieve email from Google account." });
    }

    const normalizedEmail = payload.email.toLowerCase().trim();
    const fullName = payload.name || normalizedEmail.split("@")[0];

    let user = await User.findOne({ email: normalizedEmail });
    let isNewAccount = false;

    if (!user) {
      // Email exist nahi karta - automatic signup. Google se signup hone par bhi
      // ek password generate karte hain (jaisa normal email/OTP signup me hota hai) -
      // isse user baad me chahe toh simple email+password se bhi login kar sakta hai,
      // Google ke bina bhi.
      const userId = await generateUniqueUserId(fullName);
      const avatarColor = pickRandomAvatarColor();
      const plainPassword = generatePassword(fullName);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(plainPassword, salt);

      user = await User.create({
        userId,
        fullName,
        email: normalizedEmail,
        password: hashedPassword,
        authProvider: "google",
        isEmailVerified: true,
        profileImage: payload.picture || generateDefaultAvatar(fullName, avatarColor),
        avatarColor,
      });
      isNewAccount = true;

      try {
        await sendWelcomeEmail(normalizedEmail, fullName, userId, plainPassword);
      } catch (emailError) {
        console.error("Welcome email (google) failed:", emailError.message);
      }
    }

    const deviceResult = await checkAndRegisterDevice(user, deviceId, deviceName, req.ip);
    const { accessToken, refreshToken } = await issueTokensAndSave(user);

    // PERFORMANCE: fire-and-forget - notification email, response ko block nahi karti
    if (!isNewAccount && deviceResult.isNewDevice) {
      sendNewDeviceLoginEmail(user.email, user.fullName, deviceResult.deviceName, new Date().toLocaleString())
        .catch((emailError) => console.error("New device email failed:", emailError.message));
    }

    return res.status(isNewAccount ? 201 : 200).json({
      success: true,
      message: isNewAccount ? "Account created successfully via Google." : "Login successful.",
      accessToken,
      refreshToken,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("googleLogin error:", error);
    if (error.code === 11000) {
      // Race condition - do requests ek saath aayi aur dono ne naya account banane ki koshish ki
      return res.status(409).json({
        success: false,
        message: "An account with this email was just created. Please try again.",
      });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

/* =====================================================================
   FORGOT PASSWORD -> OTP LOGIN (naya password nahi banana, seedha login)
   Step 1: forgotPasswordSendOtp   - email se OTP maango
   Step 2: forgotPasswordVerifyOtp - OTP verify -> seedha login (tokens milte hain)
===================================================================== */
exports.forgotPasswordSendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email not exist." });
    }

    const check = await canSendOtp(normalizedEmail, "login");
    if (!check.allowed) {
      return res.status(429).json({ success: false, message: check.reason });
    }

    const { otp } = await createOrUpdateOtp(normalizedEmail, "login", check);

    try {
      await sendOtpEmail(normalizedEmail, otp, user.fullName);
    } catch (emailError) {
      console.error("Forgot-password OTP email failed:", emailError.message);
      await rollbackOtpSend(normalizedEmail, "login", check.isNew);
      return res.status(502).json({ success: false, message: "Could not send verification code. Please try again." });
    }

    return res.status(200).json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}.`,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("forgotPasswordSendOtp error:", error);
    if (error.code === 11000) {
      return res.status(429).json({
        success: false,
        message: "A verification code was just requested for this email. Please wait a moment and try again.",
      });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

exports.forgotPasswordVerifyOtp = async (req, res) => {
  try {
    const { email, otp, deviceId, deviceName } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (!otp || !/^[0-9]{6}$/.test(String(otp).trim())) {
      return res.status(400).json({ success: false, message: "OTP must be a 6-digit code." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const result = await verifyOtpValue(normalizedEmail, "login", otp);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      await Otp.deleteOne({ _id: result.record._id });
      return res.status(404).json({ success: false, message: "Email not exist." });
    }

    // OTP verify ho gaya -> ab NAYA PASSWORD generate karke set karte hain.
    // Purana password kabhi wapas nahi mil sakta (woh sirf hashed form me store hota hai,
    // decrypt karna possible hi nahi) - isliye ek fresh, naya password banate hain, jaisa
    // signup ke waqt hota hai, aur woh sirf EMAIL par bhejte hain (response me kabhi nahi,
    // taaki koi phone/screen dekh ke chura na sake).
    const newPlainPassword = generatePassword(user.fullName);
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPlainPassword, salt);
    await user.save();

    await Otp.deleteOne({ _id: result.record._id });

    const deviceResult = await checkAndRegisterDevice(user, deviceId, deviceName, req.ip);
    const { accessToken, refreshToken } = await issueTokensAndSave(user);

    // PERFORMANCE: yeh sirf ek notification hai - background me chalti hai, response ko block nahi karti
    if (deviceResult.isNewDevice) {
      sendNewDeviceLoginEmail(user.email, user.fullName, deviceResult.deviceName, new Date().toLocaleString())
        .catch((emailError) => console.error("New device email failed:", emailError.message));
    }

    // Naya password EMAIL par bhejo - user ko yahan response me kabhi nahi dikhate,
    // sirf "check your email" bolte hain (jaisa maanga gaya tha)
    let passwordEmailSent = true;
    try {
      await sendPasswordResetEmail(normalizedEmail, user.fullName, newPlainPassword);
    } catch (emailError) {
      passwordEmailSent = false;
      console.error("❌ Password reset email FAILED to send. Reason:", emailError.message);
    }

    return res.status(200).json({
      success: true,
      message: passwordEmailSent
        ? "Login successful. A new password has been sent to your email."
        : "Login successful. (Note: we couldn't email your new password — please change it from Settings.)",
      accessToken,
      refreshToken,
      user: toSafeUser(user),
      // Sirf agar email fail ho jaye, tabhi fallback ke taur par password response me dete hain
      // (warna account lock-out ho jayega) - normal case me yeh field kabhi nahi aati
      ...(passwordEmailSent ? {} : { temporaryPassword: newPlainPassword }),
    });
  } catch (error) {
    console.error("forgotPasswordVerifyOtp error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

exports.forgotPasswordResendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email not exist." });
    }

    const check = await canSendOtp(normalizedEmail, "login");
    if (!check.allowed) {
      return res.status(429).json({ success: false, message: check.reason });
    }

    const { otp } = await createOrUpdateOtp(normalizedEmail, "login", check);

    try {
      await sendOtpEmail(normalizedEmail, otp, user.fullName);
    } catch (emailError) {
      console.error("Resend forgot-password OTP failed:", emailError.message);
      await rollbackOtpSend(normalizedEmail, "login", check.isNew);
      return res.status(502).json({ success: false, message: "Could not resend the code. Please try again." });
    }

    return res.status(200).json({ success: true, message: "A new verification code has been sent." });
  } catch (error) {
    console.error("forgotPasswordResendOtp error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

/* =====================================================================
   PROFILE UPDATE (future Settings/Home screen ke liye - abhi hi bana diya)
   - updateUserId: sirf lowercase letters, numbers, underscore. 30-din cooldown.
   - changePassword: purana password verify karke naya set karta hai.
   Dono email notification bhejte hain, profile email kabhi nahi bhejta.
===================================================================== */

const USER_ID_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 din

exports.updateUserId = async (req, res) => {
  try {
    const { newUserId } = req.body;
    const user = req.user; // authMiddleware se aaya hua logged-in user

    if (!newUserId || !isValidUserId(newUserId)) {
      return res.status(400).json({
        success: false,
        message: "User ID must be 8-30 characters and can only contain lowercase letters, numbers, underscores, and @.",
      });
    }

    const cleanNewUserId = newUserId.trim().toLowerCase();

    if (cleanNewUserId === user.userId) {
      return res.status(400).json({ success: false, message: "This is already your current User ID." });
    }

    // 30-din cooldown check - BUG FIX: sirf tab check karo jab user ne PEHLE SE ek baar
    // userId change ki ho (userIdLastChangedAt null nahi hai). Agar yeh pehli baar hai
    // (null), toh koi cooldown nahi lagega - user turant apni marzi ki userId rakh sakta hai.
    if (user.userIdLastChangedAt) {
      const timeSinceLastChange = Date.now() - new Date(user.userIdLastChangedAt).getTime();
      if (timeSinceLastChange < USER_ID_COOLDOWN_MS) {
        const daysLeft = Math.ceil((USER_ID_COOLDOWN_MS - timeSinceLastChange) / (24 * 60 * 60 * 1000));
        return res.status(429).json({
          success: false,
          message: `You can change your User ID again in ${daysLeft} day(s).`,
        });
      }
    }

    // Unique hai kya check karo
    // PERFORMANCE: .lean() - sirf existence check karna hai
    const existing = await User.findOne({ userId: cleanNewUserId }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: "This User ID is already taken." });
    }

    const oldUserId = user.userId;
    user.userId = cleanNewUserId;
    user.userIdLastChangedAt = new Date();
    await user.save();

    // PERFORMANCE: notification email - background me chalti hai, response ko block nahi karti
    sendUserIdChangedEmail(user.email, user.fullName, oldUserId, cleanNewUserId)
      .catch((emailError) => console.error("UserId changed email failed:", emailError.message));

    return res.status(200).json({
      success: true,
      message: "User ID updated successfully.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("updateUserId error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This User ID is already taken." });
    }
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const user = req.user;

    if (user.authProvider === "google" && !user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google Sign-In and does not have a password to change.",
      });
    }

    // Safety net - rare data-corruption case me bhi crash na ho
    if (!user.password) {
      console.error(`changePassword attempted for user ${user._id} with no password set.`);
      return res.status(500).json({ success: false, message: "Server error. Please try again later." });
    }

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ success: false, message: "All password fields are required." });
    }
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: "New passwords do not match." });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters and include a letter and a number.",
      });
    }

    const isCurrentCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentCorrect) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // PERFORMANCE: notification email - background me chalti hai, response ko block nahi karti
    sendPasswordChangedEmail(user.email, user.fullName)
      .catch((emailError) => console.error("Password changed email failed:", emailError.message));

    return res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

/* =====================================================================
   PROFILE "FORGOT PASSWORD" -> LINK-BASED RESET (current password yaad nahi)
   Yeh flow LOGIN FLOW SE BILKUL ALAG hai - koi OTP nahi, koi naya access/refresh
   token nahi. User apne existing session me hi rehta hai. Sirf email me ek
   secure link jata hai jo ek web-form kholta hai jaha naya password set kiya
   ja sakta hai.

   RULES: link 5 min valid, ek hi baar use ho sakta hai, agar khola hi na jaye
   toh 10 min me safety-net TTL se delete, aur 1 din me max 2 requests allowed.
===================================================================== */

// STEP 1: User Settings me "Forgot current password?" click karta hai.
// Yeh endpoint LOGIN REQUIRED hai (protect middleware) - matlab yeh sirf tab use
// hota hai jab user PEHLE SE APP KE ANDAR LOGGED IN hai, sirf apna current
// password bhool gaya hai.
exports.requestPasswordResetLink = async (req, res) => {
  try {
    const user = req.user; // already logged-in user (protect middleware se)

    if (user.authProvider === "google" && !user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google Sign-In and does not have a password to reset.",
      });
    }

    // 1-din me max 2 requests ka check (login-OTP wale rules se bilkul alag, zyada strict)
    const rateCheck = await canSendResetLink(user.email);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, message: rateCheck.reason });
    }

    // Purane, is user ke unused links hata do (taaki purana link bhi kaam na kare
    // jab naya request ho - ek time pe sirf ek hi valid link rahe)
    await PasswordResetLink.deleteMany({ userId: user._id, isUsed: false });

    const { rawToken, tokenHash } = generateResetToken();

    await PasswordResetLink.create({
      userId: user._id,
      email: user.email,
      tokenHash,
      isUsed: false,
      // createdAt aur expiresAt model ke default se apne aap set ho jaate hain (10-min safety net)
    });

    // Link me raw token jata hai (hash nahi) - user ke email tak
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${rawToken}`;

    try {
      await sendPasswordResetLinkEmail(user.email, user.fullName, resetLink);
    } catch (emailError) {
      console.error("❌ Password reset link email FAILED to send. Reason:", emailError.message);
      // Link DB me create ho chuka hai lekin email nahi gayi - link ko bhi wapas hata dete hain
      // taaki rate-limit counter na bache bina kaam hue (fair rehne ke liye)
      await PasswordResetLink.deleteOne({ tokenHash });
      return res.status(502).json({
        success: false,
        message: "Could not send the reset link email. Please try again shortly.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `A password reset link has been sent to ${user.email}. It's valid for 5 minutes.`,
    });
  } catch (error) {
    console.error("requestPasswordResetLink error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// STEP 2a: Web-page (reset-password.html) is API ko call karke pehle check karta hai
// ki token abhi bhi valid hai ya nahi (page load hote hi, form dikhane se pehle)
exports.validateResetLink = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ success: false, message: "Reset link is invalid." });
    }

    const tokenHash = hashResetToken(token);
    const record = await PasswordResetLink.findOne({ tokenHash });

    if (!record) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired." });
    }
    if (record.isUsed) {
      return res.status(400).json({ success: false, message: "This reset link has already been used." });
    }

    const ageMs = Date.now() - new Date(record.createdAt).getTime();
    const FIVE_MIN_MS = 5 * 60 * 1000;
    if (ageMs > FIVE_MIN_MS) {
      return res.status(400).json({ success: false, message: "This reset link has expired. Please request a new one." });
    }

    return res.status(200).json({ success: true, message: "Link is valid." });
  } catch (error) {
    console.error("validateResetLink error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// STEP 2b: User web-form me naya password bharke submit karta hai
exports.resetPasswordViaLink = async (req, res) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ success: false, message: "Reset link is invalid." });
    }
    if (!newPassword || !confirmNewPassword) {
      return res.status(400).json({ success: false, message: "Both password fields are required." });
    }
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match." });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters and include a letter and a number.",
      });
    }

    const tokenHash = hashResetToken(token);

    // ATOMIC operation - findOneAndUpdate ek hi step me "isUsed: false" check karta hai
    // aur turant "isUsed: true" set kar deta hai. Isse agar user 2 tabs/requests me
    // same link ek saath submit kare (race condition), sirf EK hi request safal hogi -
    // doosri ko "already used" milega, kyuki MongoDB yeh check-and-update atomically karta hai.
    const record = await PasswordResetLink.findOneAndUpdate(
      { tokenHash, isUsed: false },
      { $set: { isUsed: true } },
      { new: false } // purana document chahiye (createdAt check karne ke liye), taaki verify kar sakein ki update se pehle valid tha
    );

    if (!record) {
      // Ya toh token exist hi nahi karta, ya pehle se used hai - dono case me generic message
      return res.status(400).json({ success: false, message: "This reset link is invalid or has already been used." });
    }

    const ageMs = Date.now() - new Date(record.createdAt).getTime();
    const FIVE_MIN_MS = 5 * 60 * 1000;
    if (ageMs > FIVE_MIN_MS) {
      // Link expire ho chuka tha - lekin humne already isUsed:true set kar diya (upar wale
      // atomic operation me), jo sahi hi hai kyuki expired link ko bhi dobara try nahi
      // hone dena chahiye. Bas user ko clear message do ki naya link mangwaye.
      return res.status(400).json({ success: false, message: "This reset link has expired. Please request a new one." });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    // Password update karo
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // NOTE: Yahan koi naya access/refresh token NAHI banate - user ka existing
    // app session bilkul waisa hi chalta rehta hai jaisa pehle tha.
    // PERFORMANCE: notification email - background me chalti hai, response ko block nahi karti
    sendPasswordChangedEmail(user.email, user.fullName)
      .catch((emailError) => console.error("Password changed (via link) email failed:", emailError.message));

    return res.status(200).json({ success: true, message: "Your password has been changed successfully." });
  } catch (error) {
    console.error("resetPasswordViaLink error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// "About" aur "Full Name" text update - yeh koi email trigger NAHI karta (jaisa maanga gaya tha)
exports.updateProfile = async (req, res) => {
  try {
    const { about, fullName } = req.body;
    const user = req.user;

    if (fullName !== undefined) {
      if (typeof fullName !== "string" || fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: "Full name must be at least 2 characters." });
      }
      if (fullName.trim().length > 50) {
        return res.status(400).json({ success: false, message: "Full name must be under 50 characters." });
      }
      user.fullName = fullName.trim();
    }

    if (about !== undefined) {
      if (typeof about !== "string" || about.length > 150) {
        return res.status(400).json({ success: false, message: "About text must be under 150 characters." });
      }
      user.about = about.trim();
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// Profile picture upload - Multer se image file receive hoti hai, Cloudinary par
// upload hoti hai, aur MongoDB me sirf Cloudinary ka URL (chhota string) save hota hai.
// Yeh bhi koi email trigger NAHI karta (jaisa maanga gaya tha - sirf userId/password
// change email bhejte hain).
exports.uploadProfilePicture = async (req, res) => {
  try {
    const user = req.user;

    // Multer middleware ne file ko req.file me daal diya hoga (agar upload sahi hua ho)
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please select an image to upload." });
    }

    const oldImageUrl = user.profileImage;

    let uploadResult;
    try {
      uploadResult = await uploadBufferToCloudinary(req.file.buffer);
    } catch (uploadError) {
      console.error("❌ Cloudinary upload FAILED. Reason:", uploadError.message);
      console.error("   Check your .env CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET values.");
      return res.status(502).json({ success: false, message: "Could not upload image. Please try again shortly." });
    }

    user.profileImage = uploadResult.secure_url;
    await user.save();

    // Purani photo Cloudinary se delete karo (agar wo bhi Cloudinary-hosted thi, default
    // avatar URL nahi thi) - taaki bekar files jama na hon. Yeh background me hota hai,
    // is response ko block nahi karta.
    const oldPublicId = extractPublicId(oldImageUrl);
    if (oldPublicId) {
      deleteFromCloudinary(oldPublicId); // intentionally await nahi kiya - fire and forget
    }

    return res.status(200).json({
      success: true,
      message: "Profile picture updated successfully.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("uploadProfilePicture error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};


/* =====================================================================
   REFRESH TOKEN - access token expire ho jaye toh isse naya milega
   bina dobara login kiye
===================================================================== */

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({ success: false, message: "Refresh token is required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token. Please log in again." });
    }

    // Defense-in-depth: confirm karo yeh specifically "refresh" type ka token hai
    if (decoded.type !== "refresh") {
      return res.status(401).json({ success: false, message: "Invalid refresh token. Please log in again." });
    }

    const user = await User.findById(decoded.id).catch(() => null); // invalid ObjectId format se crash na ho
    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ success: false, message: "Invalid session. Please log in again." });
    }

    // DB me stored hashed refresh token se match karo (security - stolen token detect karne ke liye)
    const isMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid session. Please log in again." });
    }

    // IMPORTANT: sirf NAYA ACCESS TOKEN banega yahan - refresh token WAHI purana rahega,
    // usse dobara generate/save nahi karte. Refresh token sirf LOGIN/SIGNUP ke waqt naya
    // banta hai, aur sirf LOGOUT par invalidate hota hai - jaisa maanga gaya tha.
    const newAccessToken = issueNewAccessTokenOnly(user);

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully.",
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error("refreshToken error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// Logout - refresh token invalidate kardo (DB se hash hata do)
exports.logout = async (req, res) => {
  try {
    const user = req.user;
    user.refreshTokenHash = null;
    await user.save();
    return res.status(200).json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    console.error("logout error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};
