// Cloudinary setup - profile photos yahan upload/store hoti hain.
// MongoDB me sirf Cloudinary ka RETURNED URL (string) store hota hai - actual image
// file MongoDB me kabhi nahi jaati. Isse database chhota aur fast rehta hai.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
