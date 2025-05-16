const pool = require("./db");

async function resetDatabase() {
  try {
    console.log("🚨 Увага: видалення всіх записів у базі...");

    // У правильному порядку через залежності
    await pool.query("DELETE FROM rewards");
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM gpus");
    await pool.query("DELETE FROM users");

    console.log("✅ Всі таблиці очищено успішно");
    process.exit(0);
  } catch (err) {
    console.error("❌ Помилка очищення:", err.message);
    process.exit(1);
  }
}

resetDatabase();
