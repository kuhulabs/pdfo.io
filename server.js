const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const { execFile } = require('child_process');
const util = require('util');
const Razorpay = require('razorpay');
const Stripe = require('stripe');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TMP_DIR = '/tmp/pdfo-uploads';
const MAX_FREE_SIZE = 10 * 1024 * 1024;
const MAX_PRO_SIZE = 50 * 1024 * 1024;
const execFileAsync = util.promisify(execFile);

class SimpleDB {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.get(key); }
  async set(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
  async *list(prefix = '') {
    for (const key of this.store.keys()) if (key.startsWith(prefix)) yield key;
  }
}
const db = new SimpleDB();

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const tools = {
  'merge-pdf': { title: 'Merge PDF Online Free — PDFo by Kuhu Labs', desc: 'Combine multiple PDF files into a single polished document.' },
  'split-pdf': { title: 'Split PDF Online Free — PDFo by Kuhu Labs', desc: 'Split PDF pages by range or extract every page.' },
  'compress-pdf': { title: 'Compress PDF Online Free — PDFo by Kuhu Labs', desc: 'Reduce PDF file size with quality controls.' },
  'pdf-to-jpg': { title: 'PDF to JPG Online Free — PDFo by Kuhu Labs', desc: 'Convert PDF pages into JPG images.' },
  'jpg-to-pdf': { title: 'JPG to PDF Online Free — PDFo by Kuhu Labs', desc: 'Convert images into one PDF in the right order.' },
  'word-to-pdf': { title: 'Word to PDF Online Free — PDFo by Kuhu Labs', desc: 'Convert DOCX files into PDF quickly.' },
  'pdf-to-word': { title: 'PDF to Word Online Free — PDFo by Kuhu Labs', desc: 'Convert your PDF into editable DOCX.' },
  'rotate-pdf': { title: 'Rotate PDF Online Free — PDFo by Kuhu Labs', desc: 'Rotate selected pages by 90°, 180°, or 270°.' },
  'watermark-pdf': { title: 'Add Watermark to PDF — PDFo by Kuhu Labs', desc: 'Add text watermark with style controls.' },
  'protect-pdf': { title: 'Protect PDF Online Free — PDFo by Kuhu Labs', desc: 'Apply password protection to your PDF.' },
  'unlock-pdf': { title: 'Unlock PDF Online Free — PDFo by Kuhu Labs', desc: 'Unlock a password-protected PDF securely.' },
  'add-page-numbers': { title: 'Add Page Numbers to PDF — PDFo by Kuhu Labs', desc: 'Insert page numbers in header or footer.' }
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, TMP_DIR),
  filename: (_, file, cb) => cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_PRO_SIZE },
  fileFilter: (_, file, cb) => {
    const ok = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp'].some((ext) => file.originalname.toLowerCase().endsWith(ext));
    cb(ok ? null : new Error('Unsupported file type'), ok);
  }
});

function getClientKey(req) {
  const user = req.user?.id || 'guest';
  return `${req.ip}:${user}`;
}

async function authOptional(req, _, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* noop */ }
  return next();
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function rateLimit(req, res, next) {
  const key = `rl:${getClientKey(req)}:${Math.floor(Date.now() / 60000)}`;
  const current = Number((await db.get(key)) || 0);
  if (current >= 5) return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  await db.set(key, current + 1);
  next();
}

async function enforceUsageLimit(req, res, next) {
  const plan = req.user?.plan || 'free';
  if (plan !== 'free') return next();
  const date = new Date().toISOString().slice(0, 10);
  const key = `usage:${getClientKey(req)}:${date}`;
  const count = Number((await db.get(key)) || 0);
  if (count >= 2) {
    return res.status(403).json({ error: "You've used your 2 free tools today. Upgrade to Pro for unlimited access." });
  }
  req.usageKey = key;
  next();
}

async function incrementUsage(key) {
  if (!key) return;
  const count = Number((await db.get(key)) || 0);
  await db.set(key, count + 1);
}

app.use(authOptional);
app.use(rateLimit);

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/pricing', (_, res) => res.sendFile(path.join(__dirname, 'public/pricing.html')));
app.get('/about', (_, res) => res.sendFile(path.join(__dirname, 'public/about.html')));
app.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/signup', (_, res) => res.sendFile(path.join(__dirname, 'public/signup.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/privacy', (_, res) => res.sendFile(path.join(__dirname, 'public/privacy.html')));
app.get('/terms', (_, res) => res.sendFile(path.join(__dirname, 'public/terms.html')));

app.get('/tools/:tool', (req, res) => {
  if (!tools[req.params.tool]) return res.status(404).send('Tool not found');
  return res.sendFile(path.join(__dirname, 'public/tools/tool.html'));
});

app.get('/api/tools', (_, res) => res.json(tools));

app.post('/api/upload', authOptional, upload.array('files', 20), async (req, res) => {
  try {
    const plan = req.user?.plan || 'free';
    const maxSize = plan === 'pro' || plan === 'business' ? MAX_PRO_SIZE : MAX_FREE_SIZE;
    const files = [];
    for (const file of req.files || []) {
      if (file.size > maxSize) {
        await fsp.unlink(file.path).catch(() => {});
        return res.status(400).json({ error: `File ${file.originalname} exceeds ${maxSize / (1024 * 1024)}MB limit for your plan.` });
      }
      const fileId = uuidv4();
      await db.set(`file:${fileId}`, {
        id: fileId,
        path: file.path,
        originalname: file.originalname,
        size: file.size,
        createdAt: Date.now()
      });
      files.push({ fileId, name: file.originalname, size: file.size });
    }
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function loadFileById(fileId) {
  const meta = await db.get(`file:${fileId}`);
  if (!meta || !fs.existsSync(meta.path)) throw new Error('File not found');
  return meta;
}

async function saveResult(buffer, ext = 'pdf') {
  const resultId = uuidv4();
  const outPath = path.join(TMP_DIR, `${resultId}.${ext}`);
  await fsp.writeFile(outPath, buffer);
  await db.set(`result:${resultId}`, { path: outPath, createdAt: Date.now() });
  return resultId;
}

function parseRanges(rangeInput, totalPages) {
  if (!rangeInput || rangeInput === 'all') return [...Array(totalPages).keys()];
  const out = new Set();
  for (const token of rangeInput.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (token.includes('-')) {
      const [a, b] = token.split('-').map((n) => Number(n.trim()));
      for (let i = a; i <= b; i += 1) if (i >= 1 && i <= totalPages) out.add(i - 1);
    } else {
      const n = Number(token);
      if (n >= 1 && n <= totalPages) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

app.post('/api/process/:tool', enforceUsageLimit, async (req, res) => {
  const { tool } = req.params;
  const { fileIds = [], options = {} } = req.body;
  if (!tools[tool]) return res.status(404).json({ error: 'Unknown tool' });

  try {
    let resultId;
    if (tool === 'merge-pdf') {
      const merged = await PDFDocument.create();
      const ordered = Array.isArray(options.order) && options.order.length ? options.order : fileIds;
      for (const fileId of ordered) {
        const file = await loadFileById(fileId);
        const bytes = await fsp.readFile(file.path);
        const src = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      resultId = await saveResult(await merged.save());
    } else if (tool === 'split-pdf') {
      const srcMeta = await loadFileById(fileIds[0]);
      const srcDoc = await PDFDocument.load(await fsp.readFile(srcMeta.path));
      const indices = parseRanges(options.range || 'all', srcDoc.getPageCount());
      const out = await PDFDocument.create();
      const pages = await out.copyPages(srcDoc, indices);
      pages.forEach((p) => out.addPage(p));
      resultId = await saveResult(await out.save());
    } else if (tool === 'rotate-pdf') {
      const srcMeta = await loadFileById(fileIds[0]);
      const srcDoc = await PDFDocument.load(await fsp.readFile(srcMeta.path));
      const indices = parseRanges(options.pages || 'all', srcDoc.getPageCount());
      const angle = Number(options.angle || 90);
      indices.forEach((i) => srcDoc.getPage(i).setRotation(degrees(angle)));
      resultId = await saveResult(await srcDoc.save());
    } else if (tool === 'watermark-pdf') {
      const srcMeta = await loadFileById(fileIds[0]);
      const srcDoc = await PDFDocument.load(await fsp.readFile(srcMeta.path));
      const font = await srcDoc.embedFont(StandardFonts.HelveticaBold);
      const txt = options.text || 'PDFo by Kuhu Labs';
      const size = Number(options.fontSize || 36);
      const opacity = Math.max(0.1, Math.min(1, Number(options.opacity || 0.25)));
      for (const page of srcDoc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(txt, { x: width * 0.15, y: height * 0.5, size, font, color: rgb(1, 0.36, 0.36), opacity, rotate: degrees(35) });
      }
      resultId = await saveResult(await srcDoc.save());
    } else if (tool === 'add-page-numbers') {
      const srcMeta = await loadFileById(fileIds[0]);
      const srcDoc = await PDFDocument.load(await fsp.readFile(srcMeta.path));
      const font = await srcDoc.embedFont(StandardFonts.Helvetica);
      const start = Number(options.start || 1);
      const pos = options.position || 'footer-center';
      srcDoc.getPages().forEach((page, idx) => {
        const { width, height } = page.getSize();
        const label = `${start + idx}`;
        const xMap = { left: 28, center: width / 2 - 5, right: width - 28 };
        const y = pos.startsWith('header') ? height - 30 : 18;
        const align = pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center';
        page.drawText(label, { x: xMap[align], y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      });
      resultId = await saveResult(await srcDoc.save());
    } else if (tool === 'jpg-to-pdf') {
      const out = await PDFDocument.create();
      for (const id of fileIds) {
        const meta = await loadFileById(id);
        const bytes = await fsp.readFile(meta.path);
        const lower = meta.originalname.toLowerCase();
        const img = lower.endsWith('.png') ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      resultId = await saveResult(await out.save());
    } else if (tool === 'compress-pdf') {
      const meta = await loadFileById(fileIds[0]);
      const quality = options.quality || 'medium';
      const profile = quality === 'low' ? '/screen' : quality === 'high' ? '/prepress' : '/ebook';
      const outPath = path.join(TMP_DIR, `${uuidv4()}-compressed.pdf`);
      await execFileAsync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', `-dPDFSETTINGS=${profile}`, '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, meta.path]);
      const bytes = await fsp.readFile(outPath);
      resultId = await saveResult(bytes);
    } else {
      const meta = await loadFileById(fileIds[0]);
      const bytes = await fsp.readFile(meta.path);
      resultId = await saveResult(bytes, path.extname(meta.originalname).replace('.', '') || 'pdf');
    }

    await incrementUsage(req.usageKey);
    const result = await db.get(`result:${resultId}`);
    const firstMeta = fileIds[0] ? await loadFileById(fileIds[0]) : null;
    const after = result?.path ? (await fsp.stat(result.path)).size : 0;
    res.json({ resultId, beforeSize: firstMeta?.size || 0, afterSize: after });
  } catch (err) {
    res.status(500).json({ error: `Processing failed: ${err.message}` });
  }
});

app.get('/api/download/:resultId', async (req, res) => {
  const result = await db.get(`result:${req.params.resultId}`);
  if (!result || !fs.existsSync(result.path)) return res.status(404).json({ error: 'Result not found' });
  res.download(result.path);
});

app.delete('/api/cleanup/:fileId', async (req, res) => {
  const file = await db.get(`file:${req.params.fileId}`);
  if (file?.path) await fsp.unlink(file.path).catch(() => {});
  await db.delete(`file:${req.params.fileId}`);
  res.json({ ok: true });
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const existing = await db.get(`user:${email}`);
  if (existing) return res.status(400).json({ error: 'User already exists' });
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), name: name || 'User', email, password: hashed, plan: 'free', createdAt: Date.now() };
  await db.set(`user:${email}`, user);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get(`user:${email}`);
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ token, redirect: '/dashboard' });
});

app.get('/api/user/usage', async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const key = `usage:${getClientKey(req)}:${date}`;
  const count = Number((await db.get(key)) || 0);
  res.json({ plan: req.user?.plan || 'free', usedToday: count, dailyLimit: req.user?.plan === 'free' ? 2 : null });
});

app.post('/api/payment/create-order', authRequired, async (req, res) => {
  const { plan, gateway } = req.body;
  const amountMap = { pro: 29900, business: 79900 };
  if (!amountMap[plan]) return res.status(400).json({ error: 'Invalid plan' });

  if (gateway === 'razorpay') {
    if (!razorpay) return res.status(503).json({ error: 'Razorpay not configured' });
    const order = await razorpay.orders.create({ amount: amountMap[plan], currency: 'INR', receipt: `pdfo-${uuidv4()}` });
    return res.json({ gateway: 'razorpay', order });
  }

  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const intent = await stripe.paymentIntents.create({ amount: amountMap[plan], currency: 'inr', metadata: { plan } });
  return res.json({ gateway: 'stripe', clientSecret: intent.client_secret });
});

app.post('/api/payment/verify', authRequired, async (req, res) => {
  const { email, plan } = req.body;
  const user = await db.get(`user:${email}`);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.plan = plan;
  await db.set(`user:${email}`, user);
  res.json({ ok: true, plan });
});

app.get('/sitemap.xml', (_, res) => {
  const urls = ['/', '/pricing', '/about', '/login', '/signup', '/privacy', '/terms', ...Object.keys(tools).map((t) => `/tools/${t}`)];
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`);
});

app.get('/robots.txt', (_, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: /sitemap.xml');
});

setInterval(async () => {
  const cutoff = Date.now() - (2 * 60 * 60 * 1000);
  for await (const key of db.list('file:')) {
    const file = await db.get(key);
    if (file?.createdAt < cutoff) {
      if (file.path) await fsp.unlink(file.path).catch(() => {});
      await db.delete(key);
    }
  }
  for await (const key of db.list('result:')) {
    const result = await db.get(key);
    if (result?.createdAt < cutoff) {
      if (result.path) await fsp.unlink(result.path).catch(() => {});
      await db.delete(key);
    }
  }
}, 30 * 60 * 1000);

app.get('/api/keep-alive', (_, res) => res.json({ ok: true, service: 'PDFo by Kuhu Labs' }));

app.listen(port, () => {
  console.log(`PDFo listening on ${port}`);
});
