const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../db");
const SECRET = "super_secret_key_123";

router.post("/connect-wallet", async (req, res) => {
  const { publicKey } = req.body;
  const auth = req.headers.authorization;

  if (!auth || !publicKey) return res.status(400).json({ error: "Missing token or wallet" });

  try {
    const { id } = jwt.verify(auth.split(" ")[1], SECRET);
    await pool.query("UPDATE users SET public_key = $1 WHERE id = $2", [publicKey, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(403).json({ error: "Invalid token" });
  }
});

module.exports = router;
