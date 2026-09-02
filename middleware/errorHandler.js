const errorHandler = (err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Malformed JSON body bheja gaya (jaise galat syntax wala JSON) - yeh client ki galti hai, server ki nahi
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ success: false, message: "Invalid JSON in request body." });
  }

  res.status(500).json({
    success: false,
    message: "Something went wrong. Please try again later.",
  });
};

module.exports = errorHandler;
