const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const { Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const anchor = require("@project-serum/anchor");

const SECRET = "super_secret_key_123";

// === POST /sessions/start ===
router.post("/start", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const { id: renter_id, wallet: renter_wallet } = jwt.verify(auth.split(" ")[1], SECRET);
    const { gpu_id, duration_hours, price_per_hour } = req.body;
    const { program, provider } = req.app.locals.anchor;

    const gpuRes = await db.query(`SELECT * FROM gpus WHERE id = $1`, [gpu_id]);
    if (!gpuRes.rows.length) return res.status(404).json({ error: "GPU not found" });
    const gpu = gpuRes.rows[0];
    if (gpu.status !== "available") return res.status(400).json({ error: "GPU is busy" });

    console.log("gpu.public_key:", gpu.public_key);
console.log("renter_wallet:", renter_wallet);
    const gpuAccount = new PublicKey(gpu.public_key);
    const renterPub = new PublicKey(renter_wallet);

    // 1. Рахуємо PDA для сесії
    const [sessionPda, bump] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("session"),
        renterPub.toBuffer(),
        gpuAccount.toBuffer(),
      ],
      program.programId
    );

    // 2. Готуємо транзакцію на створення сесії
    const tx = await program.methods
      .startSession(
        new anchor.BN(duration_hours),
        new anchor.BN(price_per_hour * 1e9) // якщо ціна в SOL
      )
      .accounts({
        session_account: sessionPda,
        renter: renterPub,
        gpu_account: gpuAccount,
        system_program: SystemProgram.programId,
      })
      .transaction();

    tx.feePayer = renterPub;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    // 3. Віддаємо транзакцію і адресу сесії
    res.status(200).json({
      tx: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      sessionPubkey: sessionPda.toBase58(), // <-- Це треба зберегти!
      gpu_id: gpu_id
    });
  } catch (err) {
    console.error("startSession TX error:", err);
    res.status(500).json({ error: "Failed to prepare start_session" });
  }
});

router.post("/save", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Missing token" });

    // отримати renter_id з JWT
    const { id: renter_id } = jwt.verify(auth.split(" ")[1], SECRET);

    const { session_pubkey, gpu_id } = req.body;
    await db.query(
      `INSERT INTO sessions (gpu_id, renter_id, start_time, status, onchain_address)
       VALUES ($1, $2, NOW(), 'active', $3)`,
      [gpu_id, renter_id, session_pubkey]
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("sessions/save error:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});

// === POST /sessions/end === (поки без контракту)
router.post("/end", async (req, res) => {
  try {
    const { session_pubkey, renter_pubkey } = req.body; // Додаємо renter_pubkey з фронту!
    const { program, provider } = req.app.locals.anchor;

    // 1️⃣ Дебаг: вхідні дані
    console.log("session_pubkey (from body):", session_pubkey);
    console.log("renter_pubkey (from body):", renter_pubkey);
    if (!session_pubkey || !renter_pubkey) {
      return res.status(400).json({ error: "session_pubkey and renter_pubkey are required" });
    }

    // 2️⃣ Отримати GPU ID по сесії
    const sessionRes = await db.query(
      "SELECT gpu_id FROM sessions WHERE onchain_address = $1",
      [session_pubkey]
    );
    if (!sessionRes.rows.length) {
      return res.status(404).json({ error: "Session not found" });
    }
    const gpu_id = sessionRes.rows[0].gpu_id;

    // 3️⃣ Дістати Solana-адресу власника GPU через users (через owner_id)
    const gpuRes = await db.query(
      `SELECT users.public_key AS owner_public_key
       FROM gpus
       JOIN users ON gpus.owner_id = users.id
       WHERE gpus.id = $1`,
      [gpu_id]
    );
    if (!gpuRes.rows.length || !gpuRes.rows[0].owner_public_key) {
      return res.status(404).json({ error: "GPU owner public_key not found" });
    }
    console.log("provider_pubkey (from users):", gpuRes.rows[0].owner_public_key);

    // 4️⃣ Формування PublicKey для Anchor
    const sessionPda = new PublicKey(session_pubkey);
    const providerPub = new PublicKey(gpuRes.rows[0].owner_public_key);
    const renterPub = new PublicKey(renter_pubkey);

    // 5️⃣ Формуємо транзакцію через Anchor (!!! Додаємо renter !!!)
    const tx = await program.methods
      .endSession()
      .accounts({
        session_account: sessionPda,
        provider: providerPub,
        renter: renterPub,
      })
      .transaction();

    // 6️⃣ Додаємо актуальний blockhash!
    const connection = provider.connection; // це anchor provider, вже підключений
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = renterPub;

    // 7️⃣ Віддаємо транзакцію клієнту (для підпису через Phantom)
    res.status(200).json({
      tx: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      session_pubkey: session_pubkey
    });
  } catch (err) {
    console.error("endSession error:", err);
    res.status(500).json({ error: "Failed to end session" });
  }
});
router.post("/mark-ended", async (req, res) => {
  try {
    const { session_pubkey, txid } = req.body;
    const end_time = new Date();

    // Оновлюємо статус, end_time і txid:
    await db.query(
      `UPDATE sessions SET end_time = $1, status = 'completed', txid = $2 WHERE onchain_address = $3`,
      [end_time, txid, session_pubkey]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("mark-ended error:", err);
    res.status(500).json({ error: "Failed to update session status" });
  }
});
module.exports = router;
