require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { pool, initSchema } = require('./db');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

let dbReady = false;
initSchema()
  .then(() => { dbReady = true; console.log('Auth: schema ready'); })
  .catch(err => console.error('Auth: schema init failed', err));

// Health check — used by blue-green deploy script
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth', version: process.env.APP_VERSION || '1.0.0', db: dbReady });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'email, password, displayName are required' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO auth.users (email, password_hash, display_name) VALUES ($1, $2, $3)
       RETURNING id, email, display_name, role, created_at`,
      [email.toLowerCase(), hash, displayName]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM auth.users WHERE email = $1', [email?.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    await redis.set(`session:${user.id}`, token, 'EX', 7 * 24 * 3600);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /verify — used internally by other services to verify a JWT
app.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

// POST /logout
app.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await redis.del(`session:${decoded.sub}`);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`Auth service v${process.env.APP_VERSION || '1.0.0'} on port ${PORT}`));
