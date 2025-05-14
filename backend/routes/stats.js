import express from 'express';
import { db } from '../db.js';
const router = express.Router();

// GET /api/provider/stats/daily-income?provider_id=UUID
router.get('/daily-income', async (req, res) => {
  const { provider_id } = req.query;

  if (!provider_id)
    return res.status(400).json({ error: 'Missing provider_id' });

  try {
    const result = await db.query(
      `
      SELECT 
        DATE(s.end_time) AS day,
        SUM(s.total_cost) AS total
      FROM sessions s
      JOIN gpus g ON s.gpu_id = g.id
      WHERE g.owner_id = $1
        AND s.status = 'completed'
        AND s.end_time > now() - interval '30 days'
      GROUP BY day
      ORDER BY day
      `,
      [provider_id]
    );

    res.json(result.rows); // [{ day: '2025-05-13', total: '15.50' }, ...]
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

export default router;
