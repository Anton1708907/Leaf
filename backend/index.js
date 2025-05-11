const express = require("express");
const cors = require("cors");
const bs58 = require("bs58").default;
const crypto = require("crypto");
const ed25519 = require("@noble/ed25519");
const jwt = require("jsonwebtoken");
const { PublicKey, Connection, clusterApiUrl, Keypair, SystemProgram } = require("@solana/web3.js");
const anchor = require("@project-serum/anchor");

// === Ініціалізація ===
ed25519.etc.sha512Sync = (msg) => crypto.createHash("sha512").update(msg).digest();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/session', sessionRoutes);

const JWT_SECRET = "very_secret_key_123";
const nonces = {}; // для nonce

// === Anchor / Solana setup ===
const NETWORK = "devnet";
const PROGRAM_ID = new anchor.web3.PublicKey("BddqQ2dwbQLtbcgEg1v9QAFejU7vnEAVHcvutCd98eBT"); // заміни на свій
const connection = new Connection(clusterApiUrl(NETWORK), "confirmed");
const walletKeypair = Keypair.fromSecretKey(new Uint8Array(require("./wallet/keypair.json")));
const wallet = new anchor.Wallet(walletKeypair);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);
const idl = require("./idl/gpumarket.json");
const program = new anchor.Program(idl, PROGRAM_ID, provider);

// === 1️⃣ /auth/nonce ===
app.post("/auth/nonce", (req, res) => {
  const { wallet } = req.body;
  if (!wallet || typeof wallet !== "string")
    return res.status(400).json({ error: "Невалідна адреса гаманця" });

  const nonce = Math.random().toString(36).substring(2);
  nonces[wallet] = nonce;
  res.json({ nonce });
});

// === 2️⃣ /auth/login ===
app.post("/auth/login", async (req, res) => {
  try {
    const { wallet, signature } = req.body;
    const nonce = nonces[wallet];

    if (!wallet || !signature || !nonce)
      return res.status(400).json({ error: "Відсутні дані" });

    const pubKey = new PublicKey(wallet);
    const msgBytes = new TextEncoder().encode(nonce);
    const sigBytes = Uint8Array.from(signature);

    const isValid = await ed25519.verify(sigBytes, msgBytes, pubKey.toBytes());

    if (!isValid) return res.status(401).json({ error: "Невірний підпис" });

    delete nonces[wallet];
    const token = jwt.sign({ wallet }, JWT_SECRET, { expiresIn: "1h" });

    res.json({ success: true, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Серверна помилка" });
  }
});

// === 3️⃣ /auth/me — перевірка JWT ===
app.get("/auth/me", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Відсутній токен" });

  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ wallet: payload.wallet });
  } catch (err) {
    res.status(403).json({ error: "Недійсний токен" });
  }
});

// === 4️⃣ /register-gpu — із захистом по JWT ===
app.post("/register-gpu", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Відсутній токен" });

  const token = auth.split(" ")[1];
  let walletAddr;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    walletAddr = new PublicKey(payload.wallet);
  } catch (err) {
    return res.status(403).json({ error: "Недійсний токен" });
  }

  try {
    const { specs } = req.body;
    if (!specs) return res.status(400).json({ error: "Відсутній опис GPU" });

    const gpuAccount = Keypair.generate();

    await program.methods
      .registerGpu(specs)
      .accounts({
        gpuAccount: gpuAccount.publicKey,
        owner: wallet.publicKey, // системний ключ, який викликає транзакцію
        systemProgram: SystemProgram.programId,
      })
      .signers([gpuAccount])
      .rpc();

    res.json({
      success: true,
      gpuAddress: gpuAccount.publicKey.toBase58(),
    });
  } catch (err) {
    console.error("Register GPU Error:", err);
    res.status(500).json({ error: "Помилка при реєстрації GPU" });
  }
});

// === Старт ===
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер працює на http://localhost:${PORT}`);
});
