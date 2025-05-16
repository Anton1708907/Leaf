const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const anchor = require("@project-serum/anchor");
const { PublicKey, SystemProgram, Connection } = require("@solana/web3.js");
const { Keypair } = anchor.web3;
const bs58 = require("bs58");
const pool = require("../db");

const SECRET = "super_secret_key_123";
const PROGRAM_ID = new PublicKey("DPQG3BiR9Avg5mknQTDKZ24w4T9D8NEKmgALvEyyH2N4");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const idl = require("../idl/gpumarket.json");

const walletKeypair = Keypair.fromSecretKey(
  new Uint8Array(require("../../contract/programs/gpumarket/wallet/new_program-keypair.json"))
);
const wallet = new anchor.Wallet(walletKeypair);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);
const program = new anchor.Program(idl, PROGRAM_ID, provider);

// 📥 Отримати GPU користувача
router.get("/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM gpus WHERE owner_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// 📥 Доступні GPU для оренди
router.get("/available", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM gpus WHERE status = 'available' ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// 📤 СТВОРИТИ СИРОВУ ТРАНЗАКЦІЮ (без підпису)
router.post("/create-tx", async (req, res) => {
  try {
    const { specs, pubkey } = req.body;
    const userPubkey = new PublicKey(pubkey);
    const gpuKeypair = Keypair.generate();

    const tx = await program.methods
      .registerGpu(specs)
      .accounts({
        gpuAccount: gpuKeypair.publicKey,
        owner: userPubkey,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    tx.feePayer = userPubkey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const base64 = Buffer.from(serialized).toString("base64");

    res.json({
      transaction: base64,
      gpu_pubkey: gpuKeypair.publicKey.toBase58(),
      gpu_secret: Array.from(gpuKeypair.secretKey), // щоб зберегти при сабміті
    });
  } catch (err) {
    console.error("❌ create-tx error:", err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// ✅ ПІДПИСАНА КОРИСТУВАЧЕМ — ВІДПРАВЛЯЄМО В МЕРЕЖУ
router.post("/submit-tx", async (req, res) => {
  try {
    const { signedTx, gpu_pubkey, gpu_secret, model, vram_gb, location, price_per_hour } = req.body;

    if (!signedTx || !gpu_secret) {
      return res.status(400).json({ error: "Missing signedTx or gpu_secret" });
    }

    const bufferTx = Buffer.from(signedTx, "base64");
    const finalTx = anchor.web3.Transaction.from(bufferTx);

    const txid = await connection.sendRawTransaction(finalTx.serialize());
    await connection.confirmTransaction(txid, "confirmed");

    const { id } = jwt.verify(req.headers.authorization.split(" ")[1], SECRET);

    await pool.query(
      `INSERT INTO gpus (owner_id, model, vram_gb, location, status, price_per_hour)
       VALUES ($1, $2, $3, $4, 'available', $5)`,
      [id, model, vram_gb, location, price_per_hour]
    );

    res.json({ success: true, txid });
  } catch (err) {
    console.error("❌ submit-tx error:", err);
    res.status(500).json({ error: "Failed to submit transaction" });
  }
});

module.exports = router;
