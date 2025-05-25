const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const anchor = require("@project-serum/anchor");
const { PublicKey, SystemProgram, Connection } = require("@solana/web3.js");
const { Keypair } = anchor.web3;
const bs58 = require("bs58");
const pool = require("../db");

const SECRET = "super_secret_key_123";
const PROGRAM_ID = new PublicKey("Akb9QUyV4rZeZd6kJHKMj2UEsZ32z9s8HsbqFCCkND4A");
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

    const [gpuPda, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("gpu"), userPubkey.toBuffer(), Buffer.from(specs)],
      program.programId
    );

    console.log('Accounts for registerGpu:', {
  gpu_account: gpuPda.toBase58(),
  owner: userPubkey.toBase58(),
  systemProgram: SystemProgram.programId.toBase58()
});
const tx = await program.methods
  .registerGpu(specs)
  .accounts({
    gpu_account: gpuPda,
    owner: userPubkey,
    system_program: SystemProgram.programId
  })
  .transaction();
    tx.feePayer = userPubkey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
console.log('------ Accounts in Transaction ------');
tx.instructions[0].keys.forEach(k =>
  console.log(
    `${k.pubkey.toBase58()} | signer: ${k.isSigner} | writable: ${k.isWritable}`
  )
);
console.log('-------------------------------------');
tx.instructions.forEach(ix => {
  ix.keys[0].isSigner = false;  // gpu_account (PDA)
  ix.keys[0].isWritable = true;
  ix.keys[1].isSigner = true;   // owner
  ix.keys[1].isWritable = true;
  ix.keys[2].isSigner = false;  // systemProgram
  ix.keys[2].isWritable = false;
});
    const serialized = tx.serialize({
      requireAllSignatures: false,  
      verifySignatures: false,
    });

    res.json({
      transaction: Buffer.from(serialized).toString("base64"),
      gpu_pubkey: gpuPda.toBase58(),
    });
  } catch (err) {
    console.error("❌ create-tx error:", err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// ✅ ПІДПИСАНА КОРИСТУВАЧЕМ — ВІДПРАВЛЯЄМО В МЕРЕЖУ
router.post("/submit-tx", async (req, res) => {
  try {
    const { signedTx, gpu_pubkey, model, vram_gb, location, price_per_hour, owner_public_key } = req.body;

    if (!signedTx || !gpu_pubkey) {
      return res.status(400).json({ error: "Missing signedTx or gpu_pubkey" });
    }

    // 1️⃣ Декодуємо та десеріалізуємо транзакцію
  const tx = anchor.web3.Transaction.from(Buffer.from(signedTx, "base64"));
  const txid = await connection.sendRawTransaction(tx.serialize());

    // 🔁 Оновлений спосіб підтвердження транзакції
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature: txid,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    // 3️⃣ Отримуємо власника з токена
    const { id } = jwt.verify(req.headers.authorization.split(" ")[1], SECRET);

    // 4️⃣ Записуємо GPU в базу
await pool.query(
  `INSERT INTO gpus (owner_id, model, vram_gb, location, status, price_per_hour, public_key, owner_public_key)
   VALUES ($1, $2, $3, $4, 'available', $5, $6, $7)`,
  [id, model, vram_gb, location, price_per_hour, gpu_pubkey, owner_public_key]
);

    res.json({ success: true, txid });
  } catch (err) {
    console.error("❌ submit-tx error:", err);
    res.status(500).json({ error: "Failed to submit transaction" });
  }
});

module.exports = router;
