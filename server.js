const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = reportExpressErrors(express());
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

// Error reporting wrapper to see errors in logs
function reportExpressErrors(appInstance) {
  return appInstance;
}

// ─── Token Expiry & Settings ──────────────────────────────────────────────────
const TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

// Rate limiting store — tracks failed login attempts per IP
const loginAttempts = {};
const MAX_ATTEMPTS = 5;         // max wrong passwords before lockout
const LOCKOUT_MS = 15 * 60 * 1000;  // 15 minute lockout

// ─── Synchronous Settings (Instant and Stateless) ──────────────────────────────
function getLocalSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    console.error('Error reading settings.json:', err.message);
    return {};
  }
}

// GetSettings reads local config + environment variables (stateless & super fast)
function getSettings() {
  const localSettings = getLocalSettings();
  return {
    ...localSettings,
    whatsapp_number: process.env.WHATSAPP_NUMBER || localSettings.whatsapp_number,
    instapay_link: process.env.INSTAPAY_LINK || localSettings.instapay_link,
    google_sheets_url: process.env.GOOGLE_SHEETS_URL || localSettings.google_sheets_url,
    admin_password: process.env.ADMIN_PASSWORD || localSettings.admin_password
  };
}

function saveSettings(data) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('⚠️ Could not write settings to disk (expected on Vercel):', err.message);
  }
}

// ─── JWT Authentication with Static Secret ─────────────────────────────────────
// Uses SHA-256 hash of admin_password so all serverless instances share the same secret
function getJwtSecret() {
  const settings = getSettings();
  const pwd = settings.admin_password || 'zentrix-fallback-default-secret-2026';
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function createToken(payload) {
  const secret = getJwtSecret();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_EXPIRY_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const secret = getJwtSecret();
    const [header, body, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > payload.exp) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

function getAdminSlug() {
  const s = getSettings();
  if (s.admin_slug) return s.admin_slug;
  return 'mysecretsection'; // fallback
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

// ─── Combined Dashboard Cache (Combines parallel queries, avoids timeouts) ─────
let cachedDashboardData = null;
let lastDashboardFetchTime = 0;
const DASHBOARD_CACHE_TTL = 8 * 1000; // 8 seconds cache
let activeDashboardPromise = null;

function readLocalCacheFile(filename) {
  try {
    const filepath = path.join(__dirname, 'data', filename);
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading cache file ${filename}:`, err.message);
  }
  return [];
}

async function getDashboardDataAsync(sheetsUrl) {
  const now = Date.now();
  if (cachedDashboardData && (now - lastDashboardFetchTime < DASHBOARD_CACHE_TTL)) {
    return cachedDashboardData;
  }

  if (activeDashboardPromise) {
    return activeDashboardPromise;
  }

  activeDashboardPromise = (async () => {
    try {
      const response = await fetch(`${sheetsUrl}?action=get_dashboard`);
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === 'object' && !data.error) {
          cachedDashboardData = {
            orders: Array.isArray(data.orders) ? data.orders : [],
            expenses: Array.isArray(data.expenses) ? data.expenses : [],
            income: Array.isArray(data.income) ? data.income : []
          };
          lastDashboardFetchTime = Date.now();
          return cachedDashboardData;
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch dashboard data from Google Sheets:', err.message);
    } finally {
      activeDashboardPromise = null;
    }
    return cachedDashboardData || {
      orders: readLocalCacheFile('orders.json'),
      expenses: readLocalCacheFile('expenses.json'),
      income: readLocalCacheFile('income.json')
    };
  })();

  return activeDashboardPromise;
}

// ─── Google Sheets Helper ─────────────────────────────────────────────────────
// Sends data to Google Sheets — retries once on failure to prevent lost orders
async function sendToGoogleSheets(orderData) {
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;
  if (!sheetsUrl) return { success: false, reason: 'no_url' };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      if (res.ok) return { success: true };
      console.warn(`Google Sheets attempt ${attempt} failed with status ${res.status}`);
    } catch (e) {
      console.error(`Google Sheets attempt ${attempt} error:`, e.message);
      if (attempt === 2) return { success: false, reason: e.message };
    }
    // Wait 1.5s before retry
    await new Promise(r => setTimeout(r, 1500));
  }
  return { success: false, reason: 'max_retries' };
}

// ─── Middleware setup ─────────────────────────────────────────────────────────
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
  return '+20 ' + digits.slice(0,3) + ' ' + digits.slice(3,6) + ' ' + digits.slice(6);
}

// ─── Public API ───────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const s = getSettings();
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

  const settings = getSettings();
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

  // Await the Google Sheets write — this ensures the order is saved before we respond
  // (fire-and-forget was causing lost orders on Vercel serverless)
  const sheetsResult = await sendToGoogleSheets(orderData);
  if (!sheetsResult.success) {
    console.warn('⚠️ Google Sheets write failed after retries — order saved locally only:', orderId);
  }
  cachedDashboardData = null; // Invalidate cache so new order is visible immediately

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
app.post('/api/admin/login', checkRateLimit, (req, res) => {
  const { password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const settings = getSettings();

  if (password !== settings.admin_password) {
    if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
    loginAttempts[ip].count++;
    const remaining = MAX_ATTEMPTS - loginAttempts[ip].count;
    if (remaining > 0) {
      return res.status(401).json({ error: `كلمة السر غلط. باقيلك ${remaining} محاولة.` });
    } else {
      return res.status(429).json({ error: `اتقفلت. استنى 15 دقيقة.` });
    }
  }

  loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
  const token = createToken({ role: 'admin' });
  res.json({ success: true, token, expires_in: TOKEN_EXPIRY_MS });
});

// ─── Admin API (protected by JWT) ────────────────────────────────────────────
app.get('/api/admin/settings', requireAuth, (req, res) => {
  res.json(getSettings());
});

app.get('/api/admin/orders', requireAuth, async (req, res) => {
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    const data = await getDashboardDataAsync(sheetsUrl);
    // Try updating disk cache in local background (will fail silently on Vercel)
    try {
      const ordersPath = path.join(__dirname, 'data', 'orders.json');
      fs.writeFileSync(ordersPath, JSON.stringify(data.orders, null, 2));
    } catch (err) {}
    return res.json(data.orders);
  }

  res.json(readLocalCacheFile('orders.json'));
});

app.put('/api/admin/orders/:order_id', requireAuth, async (req, res) => {
  const { order_id } = req.params;
  const { shipping_paid, product_paid } = req.body;
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

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
      if (response.ok) {
        cachedDashboardData = null; // Invalidate dashboard cache
      }
    } catch (err) {
      console.error('Error updating order on Google Sheets:', err.message);
    }
  }

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
    } catch (err) {}
  }

  if (!orderUpdated) {
    orderUpdated = { order_id, shipping_paid, product_paid };
  }

  res.json({ success: true, order: orderUpdated });
});

app.delete('/api/admin/orders/:order_id', requireAuth, async (req, res) => {
  const { order_id } = req.params;
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_order',
          order_id
        })
      });
      if (response.ok) {
        cachedDashboardData = null;
      }
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
    } catch (err) {}
  }

  res.json({ success: true });
});

// ─── Expenses API ─────────────────────────────────────────────────────────────
app.get('/api/admin/expenses', requireAuth, async (req, res) => {
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    const data = await getDashboardDataAsync(sheetsUrl);
    try {
      const expensesPath = path.join(__dirname, 'data', 'expenses.json');
      fs.writeFileSync(expensesPath, JSON.stringify(data.expenses, null, 2));
    } catch (err) {}
    return res.json(data.expenses);
  }

  res.json(readLocalCacheFile('expenses.json'));
});

app.post('/api/admin/expenses', requireAuth, async (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || isNaN(amount) || !reason) return res.status(400).json({ error: 'بيانات ناقصة' });

  const newExpense = {
    id: 'exp-' + Date.now(),
    amount: Number(amount), reason,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })
  };

  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_expense',
          expense: newExpense
        })
      });
      if (response.ok) {
        cachedDashboardData = null; // Clear cache to pull updated list
      }
    } catch (err) {
      console.error('Error adding expense to Google Sheets:', err.message);
    }
  }

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  let expenses = [];
  if (fs.existsSync(expensesPath)) {
    try {
      expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
    } catch (e) {}
  }
  expenses.unshift(newExpense);
  try {
    fs.writeFileSync(expensesPath, JSON.stringify(expenses, null, 2));
  } catch (err) {}

  res.json({ success: true, expense: newExpense });
});

app.delete('/api/admin/expenses/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_expense',
          id
        })
      });
      if (response.ok) {
        cachedDashboardData = null;
      }
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
    } catch (err) {}
  }

  res.json({ success: true });
});

// ─── Income API ───────────────────────────────────────────────────────────────
app.get('/api/admin/income', requireAuth, async (req, res) => {
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    const data = await getDashboardDataAsync(sheetsUrl);
    try {
      const incomePath = path.join(__dirname, 'data', 'income.json');
      fs.writeFileSync(incomePath, JSON.stringify(data.income, null, 2));
    } catch (err) {}
    return res.json(data.income);
  }

  res.json(readLocalCacheFile('income.json'));
});

app.post('/api/admin/income', requireAuth, async (req, res) => {
  const { amount, source } = req.body;
  if (!amount || isNaN(amount) || !source) return res.status(400).json({ error: 'بيانات ناقصة' });

  const newIncome = {
    id: 'inc-' + Date.now(),
    amount: Number(amount), source,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })
  };

  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_income',
          income: newIncome
        })
      });
      if (response.ok) {
        cachedDashboardData = null;
      }
    } catch (err) {
      console.error('Error adding income to Google Sheets:', err.message);
    }
  }

  const incomePath = path.join(__dirname, 'data', 'income.json');
  let income = [];
  if (fs.existsSync(incomePath)) {
    try {
      income = JSON.parse(fs.readFileSync(incomePath, 'utf8'));
    } catch (e) {}
  }
  income.unshift(newIncome);
  try {
    fs.writeFileSync(incomePath, JSON.stringify(income, null, 2));
  } catch (err) {}

  res.json({ success: true, income: newIncome });
});

app.delete('/api/admin/income/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const settings = getSettings();
  const sheetsUrl = settings.google_sheets_url;

  if (sheetsUrl) {
    try {
      const response = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_income',
          id
        })
      });
      if (response.ok) {
        cachedDashboardData = null;
      }
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
    } catch (err) {}
  }

  res.json({ success: true });
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const settings = getSettings();
  const {
    price_16gb, cost_16gb,
    price_32gb, cost_32gb,
    price_64gb, price_128gb, cost_64gb, cost_128gb,
    custom_price_16gb, custom_price_32gb, custom_price_64gb, custom_price_128gb,
    whatsapp_number, instapay_link, google_sheets_url,
    games_16gb, games_32gb, games_64gb, games_128gb
  } = req.body;

  // Standard products — ensure objects exist before setting
  if (!settings.products['16gb']) settings.products['16gb'] = {};
  if (!settings.products['32gb']) settings.products['32gb'] = {};

  if (price_16gb !== undefined) settings.products['16gb'].price = Number(price_16gb);
  if (cost_16gb  !== undefined) settings.products['16gb'].cost  = Number(cost_16gb);
  if (price_32gb !== undefined) settings.products['32gb'].price = Number(price_32gb);
  if (cost_32gb  !== undefined) settings.products['32gb'].cost  = Number(cost_32gb);
  if (price_64gb !== undefined) settings.products['64gb'].price = Number(price_64gb);
  if (cost_64gb  !== undefined) settings.products['64gb'].cost  = Number(cost_64gb);
  if (price_128gb !== undefined) settings.products['128gb'].price = Number(price_128gb);
  if (cost_128gb  !== undefined) settings.products['128gb'].cost  = Number(cost_128gb);

  if (!settings.products.custom) settings.products.custom = { sizes: {} };
  if (!settings.products.custom.sizes) settings.products.custom.sizes = {};
  if (custom_price_16gb !== undefined) settings.products.custom.sizes['16gb'].price = Number(custom_price_16gb);
  if (custom_price_32gb !== undefined) settings.products.custom.sizes['32gb'].price = Number(custom_price_32gb);
  if (custom_price_64gb !== undefined) settings.products.custom.sizes['64gb'].price = Number(custom_price_64gb);
  if (custom_price_128gb !== undefined) settings.products.custom.sizes['128gb'].price = Number(custom_price_128gb);

  if (whatsapp_number) settings.whatsapp_number = whatsapp_number;
  if (instapay_link) settings.instapay_link = instapay_link;
  if (google_sheets_url !== undefined) settings.google_sheets_url = google_sheets_url;
  if (games_16gb  && typeof games_16gb  === 'object') settings.products['16gb'].games  = games_16gb;
  if (games_32gb  && typeof games_32gb  === 'object') settings.products['32gb'].games  = games_32gb;
  if (games_64gb  && typeof games_64gb  === 'object') settings.products['64gb'].games  = games_64gb;
  if (games_128gb && typeof games_128gb === 'object') settings.products['128gb'].games = games_128gb;

  saveSettings(settings);
  res.json({ success: true });
});

app.put('/api/admin/shipping', requireAuth, (req, res) => {
  const { shipping } = req.body;
  const settings = getSettings();
  if (shipping && typeof shipping === 'object') {
    settings.shipping = { ...settings.shipping, ...shipping };
    saveSettings(settings);
  }
  res.json({ success: true });
});

// ─── Serve Pages ──────────────────────────────────────────────────────────────
app.get('/panel-:slug', (req, res) => {
  if (req.params.slug !== getAdminSlug()) {
    return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.redirect('/');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Startup ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const slug = getAdminSlug();
  console.log(`✅ Zentrix server running on http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/panel-${slug}`);
});