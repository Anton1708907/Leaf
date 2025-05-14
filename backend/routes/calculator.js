import express from 'express';
import { db } from '../db/index.js';
const router = express.Router();

router.post('/calculate', async (req, res) => {
  const { gpu_id, hours, minutes } = req.body;

  if (!gpu_id || hours < 0 || minutes < 0 || minutes > 59)
    return res.status(400).json({ error: 'Invalid input' });

  try {
    const result = await db.query(
      'SELECT price_per_hour FROM gpus WHERE id = $1',
      [gpu_id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: 'GPU not found' });

    const pricePerHour = parseFloat(result.rows[0].price_per_hour);
    const totalMinutes = hours * 60 + minutes;
    const cost = +(pricePerHour / 60 * totalMinutes).toFixed(2);
    const tokens = +(cost * 1000).toFixed(0);

    res.json({ gpu_id, cost_usd: cost, tokens });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

export default router;
