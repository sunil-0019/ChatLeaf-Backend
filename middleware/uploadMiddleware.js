// Multer se image file receive karte hain - MEMORY storage use kar rahe hain (disk pe
// nahi), taaki file seedha Cloudinary ko stream ho jaye aur server ke disk pe kabhi
// bache nahi (security + cleanliness dono ke liye better).

const multer = require("multer");

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB max - bahut badi image se server hang na ho

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    // Multer ko ek Error object dena hota hai, jo aage errorHandler tak pahunchega
    return cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
  }
  cb(null, true);
};

const uploadProfileImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).single("profileImage"); // Android app isi field-name se image bhejega (multipart/form-data)

module.exports = uploadProfileImage;
