const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const router = express.Router();
const SECRET = "super_secret_key_123";

// /register
router.post("/register", async (req, res) => {
  console.log("👉 Отримано /auth/register");
  console.log("📦 Тіло запиту:", req.body);
  const { username, email, role } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (username, email, role) VALUES ($1, $2, $3) RETURNING *",
      [username, email, role]
    );
    const token = jwt.sign(
  { id: result.rows[0].id, wallet: null }, // ← спочатку без гаманця
  SECRET
);
    res.json({ token });
  } catch (err) {
    console.error(err.message);
    res.status(400).json({ error: "User already exists" });
  }
});

// /login
router.post("/login", async (req, res) => {
  const { email } = req.body;
  const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = userRes.rows[0];
  if (!user) return res.status(401).json({ error: "Not found" });

  // 🔐 Додаємо в токен Solana адресу, якщо вона є
  const token = jwt.sign(
    { id: user.id, wallet: user.public_key || null },
    SECRET
  );

  res.json({ token });
});

// /me
router.get("/me", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });
  try {
    const { id } = jwt.verify(auth.split(" ")[1], SECRET);
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    res.json(user.rows[0]);
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

module.exports = router;
