require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Client } = require('minio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
const BUCKET = process.env.MINIO_BUCKET || 'blogify-media';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT) || 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'blogify',
  secretKey: process.env.MINIO_SECRET_KEY || 'blogify123',
});

let bucketReady = false;
async function ensureBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      // Allow public read so images can be served directly
      const policy = {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET}/*`]
        }]
      };
      await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
    }
    bucketReady = true;
    console.log('Media: bucket ready');
  } catch (err) {
    console.error('Media: bucket setup failed', err.message);
    setTimeout(ensureBucket, 5000);
  }
}
ensureBucket();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'media', version: process.env.APP_VERSION || '1.0.0', bucket: bucketReady });
});

// POST /media — upload an image
app.post('/media', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid file type' });

    const ext = path.extname(req.file.originalname) || '.jpg';
    const objectName = `${req.user.sub}/${crypto.randomUUID()}${ext}`;

    await minioClient.putObject(BUCKET, objectName, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype,
    });

    const publicUrl = `${process.env.MEDIA_PUBLIC_URL || 'http://localhost:9000'}/${BUCKET}/${objectName}`;
    res.status(201).json({ url: publicUrl, objectName, size: req.file.size, contentType: req.file.mimetype });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /media/:objectName(*) — delete an uploaded file
app.delete('/media/*', requireAuth, async (req, res) => {
  try {
    const objectName = req.params[0];
    if (!objectName.startsWith(req.user.sub)) {
      return res.status(403).json({ error: 'Cannot delete files you did not upload' });
    }
    await minioClient.removeObject(BUCKET, objectName);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => console.log(`Media service v${process.env.APP_VERSION || '1.0.0'} on port ${PORT}`));
