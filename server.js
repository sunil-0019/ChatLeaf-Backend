require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const compression = require("compression");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { generalLimiter } = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");

// ---- Startup config check - agar zaroori .env values missing hain, server ko
// turant fail karo saaf error ke sath, na ki baad me kisi random request pe crash ho.
// Yeh production me sabse pehla aur sabse important safety check hai. ----
const REQUIRED_ENV_VARS = ["MONGO_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error("❌ Cannot start server. Missing required .env values:", missingEnvVars.join(", "));
  console.error("   Please check your .env file against .env.example and try again.");
  process.exit(1);
}

// Cloudinary sirf profile-picture-upload feature ke liye chahiye - agar missing ho,
// server phir bhi chalega (signup/login/chat sab kaam karenge), sirf photo upload fail
// hoga jab tak yeh set na ho. Isliye "fatal error" nahi, sirf ek warning.
const CLOUDINARY_VARS = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const missingCloudinaryVars = CLOUDINARY_VARS.filter((key) => !process.env[key]);
if (missingCloudinaryVars.length > 0) {
  console.warn("⚠️  Cloudinary not configured (missing:", missingCloudinaryVars.join(", ") + ") — profile picture uploads will fail until this is set.");
}

const app = express();

// ---- Trust proxy - agar Nginx/Heroku/Render jaise reverse-proxy ke peeche deploy ho,
// tab rate-limiter ko asli client IP pata chalega ----
app.set("trust proxy", 1);

// ---- Middlewares ----
app.use(cors());
// Gzip compression - JSON responses aur website (HTML/CSS/JS) ko compress karke bhejta
// hai, isse mobile network (3G/weak WiFi) pe bhi fast load hoti hai. Yeh Cloudinary
// image responses ko affect nahi karta (woh already Cloudinary CDN se seedha aati hain).
app.use(compression());
app.use(express.json({ limit: "1mb" })); // bahut bada payload bhejke crash na kar sake koi
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(generalLimiter);

// ---- DB Connect ----
connectDB();

// ---- Health check (API endpoint) ----
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "ChatLeaf backend is running 🚀" });
});

// ---- Public website pages (Terms, Privacy, Contact, App Info, reset-password form) ----
// Yeh /public folder se static HTML/CSS/JS serve karta hai (e.g. /index.html, /terms.html,
// /privacy.html, /contact.html, /app-info.html, /reset-password.html). Yeh pages sirf
// WEBSITE ke liye hain (browser me kholne ke liye) - Android app in pages ko use NAHI
// karta, app sirf /api/auth/* JSON endpoints use karta hai.
// maxAge: browser ek din tak CSS/HTML dobara download nahi karega, cache se load hoga -
// isse website revisit karne pe bahut fast lagegi.
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

// ---- Routes ----
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);

// ---- 404 handler ----
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ---- Global error handler (sabse aakhri me) ----
app.use(errorHandler);

// ---- Crash-proofing: production me server "silently corrupt" state me chalte rehne
// ke bajaye, ek clean restart le. Humara har route handler already try-catch me hai,
// isliye yeh sirf ek LAST-RESORT safety net hai for truly unexpected errors
// (jaise kisi library ka internal bug). Agar aisa kabhi ho:
//   1. Error ko poora log karo (debugging ke liye)
//   2. Server ko turant band mat karo - naye incoming requests thoda time lene do
//   3. Thodi der baad process exit karo, taaki process manager (PM2/Docker/systemd)
//      usse fresh restart kar sake - crashed/corrupt state me hamesha ke liye chalna
//      naye users ko ajeeb errors dega, ek clean restart behtar hai
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Promise Rejection:", reason);
  // Yeh crash nahi karayenge - zyadatar cases me yeh ek missed .catch() hota hai
  // jo already humare route-level try-catch se bach nikla, lekin process khud stable rehta hai
});

process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception - server will restart shortly:", err);
  // Graceful exit - process manager (PM2, Docker restart policy, systemd) ko
  // isse turant fresh instance start karne ka signal milega
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
