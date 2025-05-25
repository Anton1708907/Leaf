const express = require("express");
const cors = require("cors");
const anchor = require("@project-serum/anchor");
const { Connection, clusterApiUrl, Keypair, PublicKey } = require("@solana/web3.js");
const idl = require("./idl/gpumarket.json"); // 🔁 заміни шлях, якщо інший

const app = express();
app.use(cors());
app.use(express.json());

// === Підключення до Solana Devnet + смарт-контракту ===
const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");

// ❗ Секретний ключ Anchor-програми (він і є upgrade authority)
const walletKeypair = Keypair.fromSecretKey(
  new Uint8Array(require("../contract/programs/gpumarket/wallet/new_program-keypair.json"))
);
const wallet = new anchor.Wallet(walletKeypair);

const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed"
});

anchor.setProvider(provider);

const programId = new PublicKey("Akb9QUyV4rZeZd6kJHKMj2UEsZ32z9s8HsbqFCCkND4A"); // ✅ Твій задеплоєний ID
const program = new anchor.Program(idl, programId, provider);

// === Експортуємо у глобальний об'єкт app.locals для доступу з роутів ===
app.locals.anchor = {
  program,
  provider,
  wallet,
  connection,
};

// === Підключаємо маршрути ===
app.use("/auth", require("./routes/auth"));
app.use("/wallet", require("./routes/wallet"));
app.use("/gpus", require("./routes/gpus"));
app.use("/session", require("./routes/session")); // ✅ не забудь

// === Запуск сервера ===
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер працює на http://localhost:${PORT}`);
});
