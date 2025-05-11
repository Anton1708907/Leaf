const express = require('express');
const router = express.Router();
const db = require('../db'); 

router.post('/start', async (req, res) => {
    try {
        const { renter_id, gpu_id } = req.body;
        const start_time = new Date();
        const status = 'active';

        const result = await db.query(
            `INSERT INTO sessions (gpu_id, renter_id, start_time, status)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [gpu_id, renter_id, start_time, status]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

router.post('/end', async (req, res) => {
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

        res.status(200).json({
            message: 'Session ended',
            total_cost,
            reward_issued: reward_amount
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to end session' });
    }
});

module.exports = router;
