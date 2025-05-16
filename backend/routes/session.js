const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const { Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");

const SECRET = "super_secret_key_123";

// === POST /sessions/start ===
router.post("/start", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const { id: renter_id, wallet: renter_wallet } = jwt.verify(auth.split(" ")[1], SECRET);
    const { gpu_id, duration_hours, price_per_hour } = req.body;

    const { program, provider } = req.app.locals.anchor;

    // Отримуємо GPU та провайдера
    const gpuRes = await db.query(`SELECT * FROM gpus WHERE id = $1`, [gpu_id]);
    if (!gpuRes.rows.length) return res.status(404).json({ error: "GPU не знайдено" });
    const gpu = gpuRes.rows[0];
    if (gpu.status !== "available") return res.status(400).json({ error: "GPU зайнятий" });

    const gpuAccount = new PublicKey(gpu.public_key); // обов'язково додай це поле
    const renterPub = new PublicKey(renter_wallet);
    const providerPub = new PublicKey(gpu.owner_public_key); // теж додай до БД або через JOIN

    const sessionAccount = Keypair.generate();

    // ВИКЛИК Anchor
    await program.methods
      .startSession(
        new anchor.BN(duration_hours),
        new anchor.BN(price_per_hour * 1e9) // у лампортах
      )
      .accounts({
        sessionAccount: sessionAccount.publicKey,
        renter: renterPub,
        provider: providerPub,
        gpuAccount: gpuAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([sessionAccount])
      .rpc();

    // Синхронізуємо локальну базу
    await db.query(
      `INSERT INTO sessions (gpu_id, renter_id, start_time, status)
       VALUES ($1, $2, NOW(), 'active')`,
      [gpu_id, renter_id]
    );

    await db.query(`UPDATE gpus SET status = 'in_use' WHERE id = $1`, [gpu_id]);

    res.status(201).json({
      success: true,
      session_pubkey: sessionAccount.publicKey.toBase58()
    });

  } catch (err) {
    console.error("🔴 start_session error:", err);
    res.status(500).json({ error: "Не вдалося почати сесію через контракт" });
  }
});

// === POST /sessions/end === (поки без контракту)
router.post("/end", async (req, res) => {
  try {
    const { session_id } = req.body;
    const sessionRes = await db.query(`SELECT * FROM sessions WHERE id = $1`, [session_id]);

    const session = sessionRes.rows[0];
    if (!session || session.status !== 'active') {
      return res.status(400).json({ error: 'Session not found or already ended' });
    }

    const end_time = new Date();
    const durationSeconds = (end_time - session.start_time) / 1000;
    const ratePerSecond = 0.05;
    const total_cost = parseFloat((durationSeconds * ratePerSecond).toFixed(2));

    await db.query(
      `UPDATE sessions SET end_time = $1, total_cost = $2, status = 'completed'
       WHERE id = $3`,
      [end_time, total_cost, session_id]
    );

    const reward_amount = parseFloat((total_cost * 0.7).toFixed(4));

    await db.query(
      `INSERT INTO rewards (gpu_id, amount) VALUES ($1, $2)`,
      [session.gpu_id, reward_amount]
    );

    await db.query(`UPDATE gpus SET status = 'available' WHERE id = $1`, [session.gpu_id]);

    res.status(200).json({
      message: 'Session ended',
      total_cost,
      reward_issued: reward_amount
    });
  } catch (err) {
    console.error("🔴 end_session error:", err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;
