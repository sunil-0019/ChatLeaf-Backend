const express = require("express");
const router = express.Router();
const { generalLimiter } = require("../middleware/rateLimiter");
const { submitContactForm } = require("../controllers/contactController");

// Website ke contact-form se aati hai - koi login required nahi, general rate-limit
// (jo server.js me already global lagi hui hai) hi kaafi hai isके liye
router.post("/contact", generalLimiter, submitContactForm);

module.exports = router;
