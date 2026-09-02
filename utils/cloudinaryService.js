const cloudinary = require("../config/cloudinary");

// Multer se mila buffer (in-memory file) ko Cloudinary par upload karta hai.
// Cloudinary ek "stream" API deta hai - hum Multer ke buffer ko stream me convert
// karke seedha upload karte hain, disk pe kabhi likhte nahi.
const uploadBufferToCloudinary = (buffer, folder = "chatleaf/profile-photos") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        // Photo ko automatically ek reasonable size tak resize karte hain (bahut badi
        // images se storage/bandwidth waste na ho) aur quality auto-optimize karte hain
        transformation: [{ width: 512, height: 512, crop: "limit" }, { quality: "auto" }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

// Purani photo Cloudinary se delete karne ke liye (jab user nayi photo lagaye,
// purani wali storage me bekar pade na rahe)
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    // Delete fail hona critical nahi hai - purani image thodi der storage me reh jayegi,
    // lekin naya upload/save fail nahi hona chahiye isi wajah se. Sirf log karte hain.
    console.error("Cloudinary delete failed (non-critical):", error.message);
  }
};

// Cloudinary ke image URL se uska "public_id" nikalta hai (delete karne ke liye zaroori hota hai)
const extractPublicId = (cloudinaryUrl) => {
  if (typeof cloudinaryUrl !== "string") return null;
  const match = cloudinaryUrl.match(/\/chatleaf\/profile-photos\/([^./]+)\./);
  return match ? `chatleaf/profile-photos/${match[1]}` : null;
};

module.exports = { uploadBufferToCloudinary, deleteFromCloudinary, extractPublicId };
