const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ---- Unique readable user ID (chat me phone number ki jagah yeh dikhega) ----
    // Format: "sunil_1234" - naam se bana, 8-30 characters, readable, unique
    // Allowed characters: lowercase letters, numbers, underscore (_), at-symbol (@)
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: [8, "User ID must be at least 8 characters."],
      maxlength: [30, "User ID must be at most 30 characters."],
      match: [/^[a-z0-9_@]{8,30}$/, "User ID can only contain lowercase letters, numbers, underscores, and @."],
    },
    // Last baar userId kab change hui thi - 30-din cooldown check karne ke liye.
    // BUG FIX: yeh "null" se shuru hoti hai, "Date.now()" se NAHI - warna signup
    // hote hi cooldown-timer shuru ho jata tha, aur user pehli baar bhi userId
    // change karne ki koshish kare toh galat "30 din baad try karo" milta tha,
    // chahe usne kabhi userId change hi nahi kiya ho.
    userIdLastChangedAt: {
      type: Date,
      default: null,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Email sahi format me nahi hai"],
    },

    // Google se sign up karne walon ko bhi ab password milta hai (backend generate karta hai) -
    // isse woh chahe toh simple email+password se bhi login kar sakte hain, Google ke bina.
    // "required: local only" isliye rakha hai backward-compatibility ke liye (agar koi purana
    // Google account bina password ke ho), naye Google signups me hamesha password set hota hai.
    password: {
      type: String,
      required: function () {
        return this.authProvider === "local";
      },
    },

    // "local" = email/password se bana account, "google" = Google Sign-In se bana account
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    // Default avatar - naam ke pehle letter se automatically banta hai (WhatsApp jaisa style)
    // "https://api.dicebear.com/7.x/initials/svg?seed=S&backgroundColor=..." jaisa URL store hota hai
    // User baad me apni khud ki photo laga sakta hai - tab yeh field usi URL se replace ho jayegi
    profileImage: {
      type: String,
      default: "",
    },
    // Avatar ka background color hex yahan STORE hota hai (jaise "4C5BFF") - taaki har
    // user ka color ek baar random assign hone ke baad HAMESHA wahi rahe (consistent),
    // baar-baar login/photo-generate karne par badle nahi. Har user ko alag-alag
    // random color milta hai signup ke waqt, naam se koi lena-dena nahi.
    avatarColor: {
      type: String,
      default: "",
    },
    about: {
      type: String,
      default: "Hey there! I am using ChatLeaf.",
    },

    // ---- Known devices - naya device se login hone par security email bhejne ke liye ----
    knownDevices: [
      {
        deviceId: String, // client se aane wala unique device identifier
        deviceName: String, // "Chrome on Windows", "Samsung SM-G991B" jaisa
        firstLoginAt: { type: Date, default: Date.now },
        lastLoginAt: { type: Date, default: Date.now },
      },
    ],

    // Refresh token ka hashed version yahan store hota hai (security ke liye plain nahi)
    refreshTokenHash: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
