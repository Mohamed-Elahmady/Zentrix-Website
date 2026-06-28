const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

// ─── Security Config ─────────────────────────────────────────────────────────
// JWT secret — generated once at startup, stays in memory
const JWT_SECRET = crypto.randomBytes(64).toString('hex');
const TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

// Rate limiting store — tracks failed login attempts per IP
const loginAttempts = {};
const MAX_ATTEMPTS = 5;         // max wrong passwords before lockout
const LOCKOUT_MS = 15 * 60 * 1000;  // 15 minute lockout

// ─── Settings Async Cache & Sync Local Fallback ──────────────────────────────
let cachedSettings = null;
let lastSettingsFetchTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds cache for settings reading

function getLocalSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    console.error('Error reading local settings file:', err.message);
    return {};
  }
}

async function getSettingsAsync() {
  const localSettings = getLocalSettings();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || localSettings.google_sheets_url;

  if (!sheetsUrl) {
    return localSettings;
  }

  const now = Date.now();
  if (cachedSettings && (now - lastSettingsFetchTime < CACHE_TTL)) {
    return cachedSettings;
  }

  try {
    const res = await fetch(`${sheetsUrl}?action=get_settings`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && !data.error) {
        // Merge fetched settings with local defaults to avoid empty settings
        cachedSettings = { ...localSettings, ...data };
        lastSettingsFetchTime = now;
        return cachedSettings;
      }
    }
  } catch (err) {
    console.warn('⚠️ Could not fetch settings from Google Sheets, using local:', err.message);
  }

  return localSettings;
}

async function saveSettingsAsync(data) {
  cachedSettings = data;
  lastSettingsFetchTime = Date.now();

  // Try writing locally (will fail on Vercel, which is caught)
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('⚠️ Could not write settings to disk (expected on Vercel):', err.message);
  }

  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || data.google_sheets_url;
  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_settings', settings: data })
      });
    } catch (err) {
      console.error('Error saving settings to Google Sheets:', err.message);
    }
  }
}

// ─── Secret Admin URL ─────────────────────────────────────────────────────────
async function getAdminSlugAsync() {
  try {
    const s = await getSettingsAsync();
    if (s.admin_slug) return s.admin_slug;
    // First run: generate and save a random slug
    const slug = crypto.randomBytes(16).toString('hex'); // e.g. "a3f9c21b..."
    s.admin_slug = slug;
    await saveSettingsAsync(s);
    console.log(`🔐 Admin URL generated: /panel-${slug}`);
    return slug;
  } catch (e) {
    return 'fallback-' + crypto.randomBytes(8).toString('hex');
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/imgs', express.static(path.join(__dirname, 'imgs')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOrderId() {
  return 'ZNT-' + Math.floor(1000 + Math.random() * 9000);
}

function formatPhone(num) {
  let digits = String(num).replace(/\D/g, '');
  if (digits.startsWith('20')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  // Format: +20 1XX XXX XXXX
  return '+20 ' + digits.slice(0,3) + ' ' + digits.slice(3,6) + ' ' + digits.slice(6);
}

// ─── Simple JWT (no library needed) ──────────────────────────────────────────
function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_EXPIRY_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > payload.exp) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Rate Limit Middleware ────────────────────────────────────────────────────
function checkRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: now };

  const entry = loginAttempts[ip];

  // Reset if lockout window passed
  if (now - entry.firstAttempt > LOCKOUT_MS) {
    loginAttempts[ip] = { count: 0, firstAttempt: now };
    return next();
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const remaining = Math.ceil((entry.firstAttempt + LOCKOUT_MS - now) / 60000);
    return res.status(429).json({ error: `كتير أوي. استنى ${remaining} دقيقة.` });
  }

  next();
}

// ─── Google Sheets Helper ─────────────────────────────────────────────────────
async function sendToGoogleSheets(orderData) {
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;
  if (!sheetsUrl) return { success: false, reason: 'no_url' };
  try {
    const res = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    return { success: res.ok };
  } catch (e) {
    console.error('Google Sheets error:', e.message);
    return { success: false, reason: e.message };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const s = await getSettingsAsync();
  res.json({
    products: s.products,
    shipping: s.shipping,
    whatsapp_number: s.whatsapp_number,
    instapay_link: s.instapay_link
  });
});

app.post('/api/order', async (req, res) => {
  const {
    name, phone, whatsapp, address, city, governorate,
    product, payment,
    flash_size, is_personal_flash
  } = req.body;

  if (!name || !phone || !whatsapp || !address || !city || !governorate || !product || !payment) {
    return res.status(400).json({ error: 'بيانات ناقصة' });
  }

  const settings = await getSettingsAsync();
  const shippingCost = settings.shipping[governorate] || 0;

  let productPrice = 0;
  let productLabel = '';
  let isPersonal = false;

  if (product === 'custom') {
    if (!flash_size) return res.status(400).json({ error: 'اختار حجم الفلاشة' });
    const sizeData = settings.products.custom.sizes[flash_size];
    if (!sizeData) return res.status(400).json({ error: 'حجم الفلاشة غلط' });
    productPrice = sizeData.price;
    productLabel = `${sizeData.label} Flash`;
    isPersonal = is_personal_flash === true || is_personal_flash === 'true';
  } else {
    const productData = settings.products[product];
    if (!productData) return res.status(400).json({ error: 'المنتج غلط' });
    productPrice = productData.price;
    productLabel = productData.label;
    isPersonal = false;
  }

  const isCustom = product === 'custom';
  const effectiveShipping = isCustom ? shippingCost * 2 : shippingCost;
  const total = productPrice + effectiveShipping;
  const flashType = isCustom ? 'Personal' : 'New';

  const orderId = generateOrderId();
  const orderData = {
    order_id: orderId,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    name, phone: formatPhone(phone), whatsapp: formatPhone(whatsapp),
    product: productLabel,
    flash_size: isCustom ? flash_size : null,
    flash_type: flashType,
    is_personal_flash: isPersonal,
    product_price: productPrice,
    shipping_cost: effectiveShipping,
    total, payment, governorate, city, address,
    shipping_paid: false,
    product_paid: false,
    status: 'Confirmed',
  };

  try {
    const ordersPath = path.join(__dirname, 'data', 'orders.json');
    let orders = [];
    if (fs.existsSync(ordersPath)) {
      orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
    }
    orders.unshift(orderData);
    fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error('Error saving order locally:', e.message);
  }

  sendToGoogleSheets(orderData);

  res.json({
    success: true, order_id: orderId,
    shipping_cost: effectiveShipping, shipping_per_trip: shippingCost,
    is_double_shipping: isCustom, product_price: productPrice,
    product_label: productLabel, flash_type: flashType,
    is_personal_flash: isPersonal, total,
    whatsapp_number: settings.whatsapp_number,
    instapay_link: settings.instapay_link, payment
  });
});

// ─── Admin Login — with Rate Limiting ────────────────────────────────────────
app.post('/api/admin/login', checkRateLimit, async (req, res) => {
  const { password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const settings = await getSettingsAsync();

  if (password !== settings.admin_password) {
    // Count the failed attempt
    if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
    loginAttempts[ip].count++;
    const remaining = MAX_ATTEMPTS - loginAttempts[ip].count;
    if (remaining > 0) {
      return res.status(401).json({ error: `كلمة السر غلط. باقيلك ${remaining} محاولة.` });
    } else {
      return res.status(429).json({ error: `اتقفلت. استنى 15 دقيقة.` });
    }
  }

  // Success — reset attempts and issue token
  loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
  const token = createToken({ role: 'admin' });
  res.json({ success: true, token, expires_in: TOKEN_EXPIRY_MS });
});

// ─── Admin API (all protected by JWT) ────────────────────────────────────────
app.get('/api/admin/settings', requireAuth, async (req, res) => {
  const settings = await getSettingsAsync();
  res.json(settings);
});

app.get('/api/admin/orders', requireAuth, async (req, res) => {
  const ordersPath = path.join(__dirname, 'data', 'orders.json');
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl);
      if (response.ok) {
        const orders = await response.json();
        if (Array.isArray(orders)) {
          try {
            fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
          } catch (writeErr) {
            // Ignore EROFS errors on serverless environments
          }
          return res.json(orders);
        }
      }
    } catch (e) {
      console.warn('⚠️ Could not fetch from Google Sheets, using local cache:', e.message);
    }
  }

  let orders = [];
  if (fs.existsSync(ordersPath)) {
    try {
      orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
    } catch (e) {
      console.error('Error reading local orders cache:', e.message);
    }
  }
  res.json(orders);
});

app.put('/api/admin/orders/:order_id', requireAuth, async (req, res) => {
  const { order_id } = req.params;
  const { shipping_paid, product_paid } = req.body;
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  // 1. Update on Google Sheets if configured
  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          order_id,
          shipping_paid,
          product_paid
        })
      });
      if (!response.ok) {
        console.warn('⚠️ Failed to update order on Google Sheets');
      }
    } catch (err) {
      console.error('Error updating order on Google Sheets:', err.message);
    }
  }

  // 2. Also try updating local cache for consistency (will fail silently on Vercel)
  const ordersPath = path.join(__dirname, 'data', 'orders.json');
  let orderUpdated = null;
  if (fs.existsSync(ordersPath)) {
    try {
      let orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
      const idx = orders.findIndex(o => o.order_id === order_id);
      if (idx !== -1) {
        if (shipping_paid !== undefined) orders[idx].shipping_paid = !!shipping_paid;
        if (product_paid !== undefined) orders[idx].product_paid = !!product_paid;
        orderUpdated = orders[idx];
        fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
      }
    } catch (err) {
      console.warn('⚠️ Could not update local orders cache:', err.message);
    }
  }

  // If local cache failed to update or didn't contain the order (expected on Vercel), construct return object
  if (!orderUpdated) {
    orderUpdated = { order_id, shipping_paid, product_paid };
  }

  res.json({ success: true, order: orderUpdated });
});

app.delete('/api/admin/orders/:order_id', requireAuth, async (req, res) => {
  const { order_id } = req.params;
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_order',
          order_id
        })
      });
    } catch (err) {
      console.error('Error deleting order from Google Sheets:', err.message);
    }
  }

  const ordersPath = path.join(__dirname, 'data', 'orders.json');
  if (fs.existsSync(ordersPath)) {
    try {
      let orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
      const filtered = orders.filter(o => o.order_id !== order_id);
      fs.writeFileSync(ordersPath, JSON.stringify(filtered, null, 2));
    } catch (err) {
      console.warn('⚠️ Could not delete from local orders cache:', err.message);
    }
  }

  res.json({ success: true });
});

// ─── Expenses API ─────────────────────────────────────────────────────────────
app.get('/api/admin/expenses', requireAuth, async (req, res) => {
  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(`${sheetsUrl}?action=get_expenses`);
      if (response.ok) {
        const expenses = await response.json();
        if (Array.isArray(expenses)) {
          try {
            fs.writeFileSync(expensesPath, JSON.stringify(expenses, null, 2));
          } catch (writeErr) {
            // Ignore writing errors
          }
          return res.json(expenses);
        }
      }
    } catch (e) {
      console.warn('⚠️ Could not fetch expenses from Google Sheets, using local cache:', e.message);
    }
  }

  let expenses = [];
  if (fs.existsSync(expensesPath)) {
    try {
      expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
    } catch (e) {
      console.error('Error reading local expenses cache:', e.message);
    }
  }
  res.json(expenses);
});

app.post('/api/admin/expenses', requireAuth, async (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || isNaN(amount) || !reason) return res.status(400).json({ error: 'بيانات ناقصة' });

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  const newExpense = {
    id: 'exp-' + Date.now(),
    amount: Number(amount), reason,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })
  };

  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_expense',
          expense: newExpense
        })
      });
    } catch (err) {
      console.error('Error adding expense to Google Sheets:', err.message);
    }
  }

  let expenses = [];
  if (fs.existsSync(expensesPath)) {
    try {
      expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
    } catch (e) {
      // ignore
    }
  }
  expenses.unshift(newExpense);
  try {
    fs.writeFileSync(expensesPath, JSON.stringify(expenses, null, 2));
  } catch (err) {
    console.warn('⚠️ Could not save expense locally:', err.message);
  }

  res.json({ success: true, expense: newExpense });
});

app.delete('/api/admin/expenses/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_expense',
          id
        })
      });
    } catch (err) {
      console.error('Error deleting expense from Google Sheets:', err.message);
    }
  }

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  if (fs.existsSync(expensesPath)) {
    try {
      let expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
      const filtered = expenses.filter(e => String(e.id) !== String(id));
      fs.writeFileSync(expensesPath, JSON.stringify(filtered, null, 2));
    } catch (err) {
      console.warn('⚠️ Could not delete expense locally:', err.message);
    }
  }

  res.json({ success: true });
});

// ─── Income API ───────────────────────────────────────────────────────────────
app.get('/api/admin/income', requireAuth, async (req, res) => {
  const incomePath = path.join(__dirname, 'data', 'income.json');
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(`${sheetsUrl}?action=get_income`);
      if (response.ok) {
        const income = await response.json();
        if (Array.isArray(income)) {
          try {
            fs.writeFileSync(incomePath, JSON.stringify(income, null, 2));
          } catch (writeErr) {
            // Ignore writing errors
          }
          return res.json(income);
        }
      }
    } catch (e) {
      console.warn('⚠️ Could not fetch income from Google Sheets, using local cache:', e.message);
    }
  }

  let income = [];
  if (fs.existsSync(incomePath)) {
    try {
      income = JSON.parse(fs.readFileSync(incomePath, 'utf8'));
    } catch (e) {
      console.error('Error reading local income cache:', e.message);
    }
  }
  res.json(income);
});

app.post('/api/admin/income', requireAuth, async (req, res) => {
  const { amount, source } = req.body;
  if (!amount || isNaN(amount) || !source) return res.status(400).json({ error: 'بيانات ناقصة' });

  const incomePath = path.join(__dirname, 'data', 'income.json');
  const newIncome = {
    id: 'inc-' + Date.now(),
    amount: Number(amount), source,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })
  };

  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_income',
          income: newIncome
        })
      });
    } catch (err) {
      console.error('Error adding income to Google Sheets:', err.message);
    }
  }

  let income = [];
  if (fs.existsSync(incomePath)) {
    try {
      income = JSON.parse(fs.readFileSync(incomePath, 'utf8'));
    } catch (e) {
      // ignore
    }
  }
  income.unshift(newIncome);
  try {
    fs.writeFileSync(incomePath, JSON.stringify(income, null, 2));
  } catch (err) {
    console.warn('⚠️ Could not save income locally:', err.message);
  }

  res.json({ success: true, income: newIncome });
});

app.delete('/api/admin/income/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const settings = await getSettingsAsync();
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL || settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_income',
          id
        })
      });
    } catch (err) {
      console.error('Error deleting income from Google Sheets:', err.message);
    }
  }

  const incomePath = path.join(__dirname, 'data', 'income.json');
  if (fs.existsSync(incomePath)) {
    try {
      let income = JSON.parse(fs.readFileSync(incomePath, 'utf8'));
      const filtered = income.filter(i => String(i.id) !== String(id));
      fs.writeFileSync(incomePath, JSON.stringify(filtered, null, 2));
    } catch (err) {
      console.warn('⚠️ Could not delete income locally:', err.message);
    }
  }

  res.json({ success: true });
});

app.put('/api/admin/settings', requireAuth, async (req, res) => {
  const settings = await getSettingsAsync();
  const {
    price_64gb, price_128gb, cost_64gb, cost_128gb,
    custom_price_16gb, custom_price_32gb, custom_price_64gb, custom_price_128gb,
    whatsapp_number, instapay_link, google_sheets_url,
    games_64gb, games_128gb
  } = req.body;

  if (price_64gb !== undefined) settings.products['64gb'].price = Number(price_64gb);
  if (price_128gb !== undefined) settings.products['128gb'].price = Number(price_128gb);
  if (cost_64gb !== undefined) settings.products['64gb'].cost = Number(cost_64gb);
  if (cost_128gb !== undefined) settings.products['128gb'].cost = Number(cost_128gb);

  if (!settings.products.custom) settings.products.custom = { sizes: {} };
  if (!settings.products.custom.sizes) settings.products.custom.sizes = {};
  if (custom_price_16gb !== undefined) settings.products.custom.sizes['16gb'].price = Number(custom_price_16gb);
  if (custom_price_32gb !== undefined) settings.products.custom.sizes['32gb'].price = Number(custom_price_32gb);
  if (custom_price_64gb !== undefined) settings.products.custom.sizes['64gb'].price = Number(custom_price_64gb);
  if (custom_price_128gb !== undefined) settings.products.custom.sizes['128gb'].price = Number(custom_price_128gb);

  if (whatsapp_number) settings.whatsapp_number = whatsapp_number;
  if (instapay_link) settings.instapay_link = instapay_link;
  if (google_sheets_url !== undefined) settings.google_sheets_url = google_sheets_url;
  if (games_64gb && typeof games_64gb === 'object') settings.products['64gb'].games = games_64gb;
  if (games_128gb && typeof games_128gb === 'object') settings.products['128gb'].games = games_128gb;

  await saveSettingsAsync(settings);
  res.json({ success: true });
});

app.put('/api/admin/shipping', requireAuth, async (req, res) => {
  const { shipping } = req.body;
  const settings = await getSettingsAsync();
  if (shipping && typeof shipping === 'object') {
    settings.shipping = { ...settings.shipping, ...shipping };
    await saveSettingsAsync(settings);
  }
  res.json({ success: true });
});

// ─── Serve Pages ──────────────────────────────────────────────────────────────
// Secret admin URL — only this works, /admin returns 404
app.get('/panel-:slug', async (req, res) => {
  const settings = await getSettingsAsync();
  if (req.params.slug !== settings.admin_slug) {
    return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Old /admin URL — silently redirects to homepage (don't reveal it exists)
app.get('/admin', (req, res) => {
  res.redirect('/');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Startup ──────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  const slug = await getAdminSlugAsync();
  console.log(`✅ Zentrix server running on http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/panel-${slug}`);
});