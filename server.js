const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/imgs', express.static(path.join(__dirname, 'imgs')));

// ─── Helper ───────────────────────────────────────────────────────────────────
function getSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}
function saveSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}
function generateOrderId() {
  return 'ZNT-' + Math.floor(1000 + Math.random() * 9000);
}

// ─── Google Sheets Helper ─────────────────────────────────────────────────────
async function sendToGoogleSheets(orderData) {
  const settings = getSettings();
  if (!settings.google_sheets_url) return { success: false, reason: 'no_url' };
  try {
    const res = await fetch(settings.google_sheets_url, {
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
    // Custom flash fields
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
    productLabel = `${sizeData.label} Flash`;  // e.g. "64GB Flash" — matches standard flash format
    isPersonal = is_personal_flash === true || is_personal_flash === 'true';
  } else {
    const productData = settings.products[product];
    if (!productData) return res.status(400).json({ error: 'المنتج غلط' });
    productPrice = productData.price;
    productLabel = productData.label;
    isPersonal = false;
  }

  // Custom flash: shipping is charged TWICE (once to collect the flash, once to deliver)
  const isCustom = product === 'custom';
  const effectiveShipping = isCustom ? shippingCost * 2 : shippingCost;
  const total = productPrice + effectiveShipping;

  // Flash type: custom = شخصية, standard = جديدة
  const flashType = isCustom ? 'Personal' : 'New';

  const orderId = generateOrderId();
  const orderData = {
    order_id: orderId,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    name,
    phone,
    whatsapp,
    product: productLabel,
    flash_size: isCustom ? flash_size : null,
    flash_type: flashType,
    is_personal_flash: isPersonal,
    product_price: productPrice,
    shipping_cost: effectiveShipping,
    total,
    payment,
    governorate,
    city,
    address,
    shipping_paid: true,                              // always true — customer pays shipping regardless
    product_paid: payment === 'instapay' ? true : false, // instapay: paid upfront; cash: collected on delivery
    status: 'Confirmed',
  };

  // Save order locally in data/orders.json
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
    success: true,
    order_id: orderId,
    shipping_cost: effectiveShipping,
    shipping_per_trip: shippingCost,
    is_double_shipping: isCustom,
    product_price: productPrice,
    product_label: productLabel,
    flash_type: flashType,
    is_personal_flash: isPersonal,
    total,
    whatsapp_number: settings.whatsapp_number,
    instapay_link: settings.instapay_link,
    payment
  });
});

// ─── Admin API ────────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const settings = getSettings();
  if (password === settings.admin_password) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'كلمة السر غلط' });
  }
});

app.get('/api/admin/settings', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });
  res.json(settings);
});

// GET /api/admin/orders
app.get('/api/admin/orders', async (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const ordersPath = path.join(__dirname, 'data', 'orders.json');

  if (settings.google_sheets_url) {
    try {
      const response = await fetch(settings.google_sheets_url);
      if (response.ok) {
        const orders = await response.json();
        if (Array.isArray(orders)) {
          // Cache locally
          fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
          return res.json(orders);
        }
      }
    } catch (e) {
      console.warn('⚠️ Could not fetch from Google Sheets, using local cache:', e.message);
    }
  }

  // Fallback to local file
  let orders = [];
  if (fs.existsSync(ordersPath)) {
    orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  }
  res.json(orders);
});

// PUT /api/admin/orders/:order_id
app.put('/api/admin/orders/:order_id', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const { order_id } = req.params;
  const { shipping_paid, product_paid } = req.body;

  const ordersPath = path.join(__dirname, 'data', 'orders.json');
  if (!fs.existsSync(ordersPath)) return res.status(404).json({ error: 'Orders database not found' });

  let orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  const idx = orders.findIndex(o => o.order_id === order_id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });

  if (shipping_paid !== undefined) orders[idx].shipping_paid = !!shipping_paid;
  if (product_paid !== undefined) orders[idx].product_paid = !!product_paid;

  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));

  // Sync update to Google Sheets
  sendToGoogleSheets({
    action: 'update',
    order_id,
    shipping_paid: orders[idx].shipping_paid,
    product_paid: orders[idx].product_paid
  });

  res.json({ success: true, order: orders[idx] });
});

// DELETE /api/admin/orders/:order_id
app.delete('/api/admin/orders/:order_id', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const { order_id } = req.params;

  const ordersPath = path.join(__dirname, 'data', 'orders.json');
  if (!fs.existsSync(ordersPath)) return res.status(404).json({ error: 'Orders database not found' });

  let orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  const filtered = orders.filter(o => o.order_id !== order_id);

  if (orders.length === filtered.length) return res.status(404).json({ error: 'Order not found' });

  fs.writeFileSync(ordersPath, JSON.stringify(filtered, null, 2));
  res.json({ success: true });
});

// GET /api/admin/expenses
app.get('/api/admin/expenses', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  let expenses = [];
  if (fs.existsSync(expensesPath)) {
    expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
  }
  res.json(expenses);
});

// POST /api/admin/expenses
app.post('/api/admin/expenses', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const { amount, reason } = req.body;
  if (!amount || isNaN(amount) || !reason) return res.status(400).json({ error: 'بيانات ناقصة' });

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  let expenses = [];
  if (fs.existsSync(expensesPath)) {
    expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
  }

  const newExpense = {
    id: 'exp-' + Date.now(),
    amount: Number(amount),
    reason,
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })
  };

  expenses.unshift(newExpense);
  fs.writeFileSync(expensesPath, JSON.stringify(expenses, null, 2));
  res.json({ success: true, expense: newExpense });
});

// DELETE /api/admin/expenses/:id
app.delete('/api/admin/expenses/:id', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  const expensesPath = path.join(__dirname, 'data', 'expenses.json');
  if (!fs.existsSync(expensesPath)) return res.status(404).json({ error: 'Expenses database not found' });

  let expenses = JSON.parse(fs.readFileSync(expensesPath, 'utf8'));
  const filtered = expenses.filter(e => String(e.id) !== String(id));

  if (expenses.length === filtered.length) return res.status(404).json({ error: 'Expense not found' });

  fs.writeFileSync(expensesPath, JSON.stringify(filtered, null, 2));
  res.json({ success: true });
});

app.put('/api/admin/settings', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const {
    price_64gb, price_128gb,
    cost_64gb, cost_128gb,
    custom_price_16gb, custom_price_32gb, custom_price_64gb, custom_price_128gb,
    whatsapp_number, instapay_link, google_sheets_url,
    games_64gb, games_128gb
  } = req.body;

  // Standard flash prices
  if (price_64gb !== undefined) settings.products['64gb'].price = Number(price_64gb);
  if (price_128gb !== undefined) settings.products['128gb'].price = Number(price_128gb);
  if (cost_64gb !== undefined) settings.products['64gb'].cost = Number(cost_64gb);
  if (cost_128gb !== undefined) settings.products['128gb'].cost = Number(cost_128gb);

  // Custom flash prices
  if (!settings.products.custom) settings.products.custom = { sizes: {} };
  if (!settings.products.custom.sizes) settings.products.custom.sizes = {};
  if (custom_price_16gb !== undefined) settings.products.custom.sizes['16gb'].price = Number(custom_price_16gb);
  if (custom_price_32gb !== undefined) settings.products.custom.sizes['32gb'].price = Number(custom_price_32gb);
  if (custom_price_64gb !== undefined) settings.products.custom.sizes['64gb'].price = Number(custom_price_64gb);
  if (custom_price_128gb !== undefined) settings.products.custom.sizes['128gb'].price = Number(custom_price_128gb);

  // Contact info
  if (whatsapp_number) settings.whatsapp_number = whatsapp_number;
  if (instapay_link) settings.instapay_link = instapay_link;
  if (google_sheets_url !== undefined) settings.google_sheets_url = google_sheets_url;

  // Games lists for packages
  if (games_64gb && typeof games_64gb === 'object') {
    settings.products['64gb'].games = games_64gb;
  }
  if (games_128gb && typeof games_128gb === 'object') {
    settings.products['128gb'].games = games_128gb;
  }

  saveSettings(settings);
  res.json({ success: true });
});

app.put('/api/admin/shipping', (req, res) => {
  const { password } = req.headers;
  const settings = getSettings();
  if (password !== settings.admin_password) return res.status(401).json({ error: 'Unauthorized' });

  const { shipping } = req.body;
  if (shipping && typeof shipping === 'object') {
    settings.shipping = { ...settings.shipping, ...shipping };
    saveSettings(settings);
  }
  res.json({ success: true });
});

// ─── Serve Pages ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Zentrix server running on http://localhost:${PORT}`);
});