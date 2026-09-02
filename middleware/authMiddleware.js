const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Yeh middleware un routes pe lagta hai jinke liye login hona zaroori hai
// (jaise profile update, userId change, password change)
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Not authorized. Please log in again." });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Session expired. Please refresh your token." });
      }
      return res.status(401).json({ success: false, message: "Invalid token. Please log in again." });
    }

    // Defense-in-depth: confirm karo yeh token specifically "access" type ka hai,
    // "refresh" type ka nahi. Yeh dono alag JWT_SECRET se sign hote hain isliye
    // normally galat-type token verify hi nahi hoga, lekin agar kabhi galti se
    // dono secrets same set ho jayein, yeh extra check phir bhi surakshit rakhta hai.
    if (decoded.type !== "access") {
      return res.status(401).json({ success: false, message: "Invalid token. Please log in again." });
    }

    const user = await User.findById(decoded.id).catch(() => null); // invalid ObjectId format se crash na ho
    if (!user) {
      return res.status(401).json({ success: false, message: "User not found. Please log in again." });
    }

    req.user = user; // aage controller me req.user se access kar sakte hain
    next();
  } catch (error) {
    console.error("protect middleware error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

module.exports = protect;
