let adminToken = '';  // JWT token stored in memory only (not localStorage)
let fullSettings = null;
let activeGamesTab = '16gb';

async function doLogin() {
  const pass = document.getElementById('passInput').value;
  const errEl = document.getElementById('loginErr');
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;  // keep token in memory only — never in localStorage
      errEl.style.display = 'none';
      errEl.textContent = 'كلمة السر غلط';
      await loadAdminSettings();
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      const savedTab = localStorage.getItem('activeDashboardTab') || 'overview';
      switchDashboardTab(savedTab);
    } else {
      errEl.textContent = data.error || 'كلمة السر غلط';
      errEl.style.display = 'block';
    }
  } catch(e) {
    errEl.style.display = 'block';
  }
}

function switchDashboardTab(tabId) {
  // Update tabs buttons active status
  document.querySelectorAll('.dashboard-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  // Update content active status
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `tab-content-${tabId}`) {
      content.style.display = tabId === 'prices' ? 'grid' : 'block';
      content.classList.add('active');
    } else {
      content.style.display = 'none';
      content.classList.remove('active');
    }
  });
  
  // Save active tab in localStorage
  localStorage.setItem('activeDashboardTab', tabId);
}

function logout() {
  adminToken = '';  // wipe token from memory
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('passInput').value = '';
}

// No auto-login — token lives in memory only
window.addEventListener('DOMContentLoaded', () => {
  // Nothing to restore — token is session-only
});

async function loadAdminSettings() {
  const res = await fetch('/api/admin/settings', { headers: { 'x-admin-token': adminToken } });
  fullSettings = await res.json();

  // Standard prices
  document.getElementById('price16').value  = fullSettings.products['16gb']?.price  || '';
  document.getElementById('cost16').value   = fullSettings.products['16gb']?.cost   || '';
  document.getElementById('price32').value  = fullSettings.products['32gb']?.price  || '';
  document.getElementById('cost32').value   = fullSettings.products['32gb']?.cost   || '';
  document.getElementById('price64').value  = fullSettings.products['64gb']?.price  || '';
  document.getElementById('cost64').value   = fullSettings.products['64gb']?.cost   || '';
  document.getElementById('price128').value = fullSettings.products['128gb']?.price || '';
  document.getElementById('cost128').value  = fullSettings.products['128gb']?.cost  || '';

  // Custom flash prices
  const customSizes = fullSettings.products?.custom?.sizes || {};
  document.getElementById('customPrice16').value  = customSizes['16gb']?.price || '';
  document.getElementById('customPrice32').value  = customSizes['32gb']?.price || '';
  document.getElementById('customPrice64').value  = customSizes['64gb']?.price || '';
  document.getElementById('customPrice128').value = customSizes['128gb']?.price || '';

  // Contact
  document.getElementById('waNum').value        = fullSettings.whatsapp_number || '';
  document.getElementById('instapayLink').value = fullSettings.instapay_link   || '';
  document.getElementById('sheetsUrl').value    = fullSettings.google_sheets_url || '';

  // Games editor
  renderGamesEditor('16gb');
  renderGamesEditor('32gb');
  renderGamesEditor('64gb');
  renderGamesEditor('128gb');

  // Shipping grid
  const grid = document.getElementById('shipGrid');
  grid.innerHTML = Object.entries(fullSettings.shipping).map(([gov, price]) =>
    `<div class="ship-item">
      <label>${gov}</label>
      <input type="number" id="ship_${gov}" value="${price}" placeholder="0" />
    </div>`
  ).join('');

  // Load dashboard data
  await loadDashboardData();
}

// ── GAMES EDITOR ──────────────────────────────────────────────────────────────
function renderGamesEditor(key) {
  const panel = document.getElementById('gamesPanel-' + key);
  const games = fullSettings.products[key]?.games || {};
  panel.innerHTML = Object.entries(games).map(([consoleName, gamesList]) =>
    renderConsoleEditor(key, consoleName, gamesList)
  ).join('');
}

function renderConsoleEditor(key, consoleName, gamesList) {
  const safeId = consoleName.replace(/[^a-zA-Z0-9]/g, '_');
  return `
    <div class="console-editor" id="ce-${key}-${safeId}" data-key="${key}" data-console="${consoleName}">
      <div class="console-editor-header">
        <div class="console-editor-name" style="display:flex;align-items:center;gap:6px;"><svg width='14' height='14'><use href='#ai-joystick' stroke='currentColor'/></svg>${consoleName}</div>
        <button class="btn-remove-console" onclick="removeConsole('${key}','${consoleName}')">حذف</button>
      </div>
      <textarea id="games-${key}-${safeId}" placeholder="كل لعبة في سطر...">${gamesList.join('\n')}</textarea>
      <div class="hint">كل لعبة في سطر منفصل</div>
    </div>`;
}

function switchGamesTab(key) {
  activeGamesTab = key;
  // Update panel visibility
  document.querySelectorAll('.games-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('gamesPanel-' + key);
  if (panel) panel.classList.add('active');
  // Update tab buttons by their onclick attribute
  document.querySelectorAll('.games-tab').forEach(t => {
    const fn = t.getAttribute('onclick') || '';
    t.classList.toggle('active', fn.includes(`'${key}'`));
  });
}

function addConsole() {
  const nameInput = document.getElementById('newConsoleName');
  const name = nameInput.value.trim();
  if (!name) return showToast('اكتب اسم الجهاز الأول', true);

  const panel = document.getElementById('gamesPanel-' + activeGamesTab);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = renderConsoleEditor(activeGamesTab, name, []);
  panel.appendChild(tempDiv.firstElementChild);

  nameInput.value = '';
  showToast('تمت الإضافة — اضغط حفظ لتأكيدها');
}

function removeConsole(key, consoleName) {
  const safeId = consoleName.replace(/[^a-zA-Z0-9]/g, '_');
  const el = document.getElementById(`ce-${key}-${safeId}`);
  if (el) el.remove();
  showToast('تم الحذف — اضغط حفظ لتأكيده');
}

function collectGamesData(key) {
  const panel = document.getElementById('gamesPanel-' + key);
  const editors = panel.querySelectorAll('.console-editor');
  const games = {};
  editors.forEach(ce => {
    const consoleName = ce.dataset.console;
    const safeId = consoleName.replace(/[^a-zA-Z0-9]/g, '_');
    const textarea = ce.querySelector('textarea');
    if (!textarea) return;
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) games[consoleName] = lines;
  });
  return games;
}

// ── SAVE FUNCTIONS ────────────────────────────────────────────────────────────
async function savePrices() {
  const body = {
    price_16gb:  document.getElementById('price16').value,
    cost_16gb:   document.getElementById('cost16').value,
    price_32gb:  document.getElementById('price32').value,
    cost_32gb:   document.getElementById('cost32').value,
    price_64gb:  document.getElementById('price64').value,
    cost_64gb:   document.getElementById('cost64').value,
    price_128gb: document.getElementById('price128').value,
    cost_128gb:  document.getElementById('cost128').value
  };
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    if (fullSettings) {
      if (!fullSettings.products['16gb']) fullSettings.products['16gb'] = {};
      if (!fullSettings.products['32gb']) fullSettings.products['32gb'] = {};
      if (!fullSettings.products['64gb']) fullSettings.products['64gb'] = {};
      if (!fullSettings.products['128gb']) fullSettings.products['128gb'] = {};
      fullSettings.products['16gb'].price  = Number(body.price_16gb);
      fullSettings.products['16gb'].cost   = Number(body.cost_16gb);
      fullSettings.products['32gb'].price  = Number(body.price_32gb);
      fullSettings.products['32gb'].cost   = Number(body.cost_32gb);
      fullSettings.products['64gb'].price  = Number(body.price_64gb);
      fullSettings.products['64gb'].cost   = Number(body.cost_64gb);
      fullSettings.products['128gb'].price = Number(body.price_128gb);
      fullSettings.products['128gb'].cost  = Number(body.cost_128gb);
    }
    showToast('تم حفظ الأسعار');
    await loadDashboardData();
  } else {
    showToast('❌ فيه مشكلة', true);
  }
}

async function saveCustomPrices() {
  const body = {
    custom_price_16gb:  document.getElementById('customPrice16').value,
    custom_price_32gb:  document.getElementById('customPrice32').value,
    custom_price_64gb:  document.getElementById('customPrice64').value,
    custom_price_128gb: document.getElementById('customPrice128').value
  };
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify(body)
  });
  showToast(res.ok ? 'تم حفظ أسعار Custom Flash' : 'فيه مشكلة', !res.ok);
}

async function saveContact() {
  const body = {
    whatsapp_number: document.getElementById('waNum').value,
    instapay_link:   document.getElementById('instapayLink').value,
    google_sheets_url: document.getElementById('sheetsUrl').value
  };
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify(body)
  });
  showToast(res.ok ? 'تم حفظ البيانات' : 'فيه مشكلة', !res.ok);
}

async function saveGames() {
  const games_16gb  = collectGamesData('16gb');
  const games_32gb  = collectGamesData('32gb');
  const games_64gb  = collectGamesData('64gb');
  const games_128gb = collectGamesData('128gb');
  const body = { games_16gb, games_32gb, games_64gb, games_128gb };
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    // Update local state
    fullSettings.products['16gb'].games  = games_16gb;
    fullSettings.products['32gb'].games  = games_32gb;
    fullSettings.products['64gb'].games  = games_64gb;
    fullSettings.products['128gb'].games = games_128gb;
    showToast('تم حفظ الألعاب');
  } else {
    showToast('فيه مشكلة', true);
  }
}

async function saveShipping() {
  const shipping = {};
  Object.keys(fullSettings.shipping).forEach(gov => {
    const val = document.getElementById('ship_' + gov)?.value;
    if (val) shipping[gov] = Number(val);
  });
  const res = await fetch('/api/admin/shipping', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ shipping })
  });
  showToast(res.ok ? 'تم حفظ الشحن' : 'فيه مشكلة', !res.ok);
}

function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  const icon = isErr
    ? `<svg width="14" height="14" style="flex-shrink:0"><use href="#ai-x" stroke="white"/></svg>`
    : `<svg width="14" height="14" style="flex-shrink:0"><use href="#ai-check" stroke="white"/></svg>`;
  t.innerHTML = `<span style="display:flex;align-items:center;gap:7px;">${icon}${msg}</span>`;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => t.className = 'toast', 2800);
}

// ── DASHBOARD LOGIC ──────────────────────────────────────────────────────────
let ordersList = [];
let expensesList = [];
let incomeList = [];
let financeChart = null;

async function loadDashboardData() {
  try {
    const [ordersRes, expensesRes, incomeRes] = await Promise.all([
      fetch('/api/admin/orders',  { headers: { 'x-admin-token': adminToken } }),
      fetch('/api/admin/expenses',{ headers: { 'x-admin-token': adminToken } }),
      fetch('/api/admin/income',  { headers: { 'x-admin-token': adminToken } })
    ]);
    ordersList   = await ordersRes.json();
    expensesList = await expensesRes.json();
    incomeList   = await incomeRes.json();
    
    updateDashboardUI();
  } catch(e) {
    console.error('Error loading dashboard data:', e);
  }
}

function updateDashboardUI() {
  // 1. Calculate stats
  let totalSalesIncome = 0; // product revenue from orders
  let totalShipping = 0;
  let totalCostOfGoods = 0;
  ordersList.forEach(order => {
    if (order.product_paid) {
      totalSalesIncome += Number(order.product_price || 0);
      const isNewFlash = order.flash_type === 'New';
      if (isNewFlash && order.product) {
        if (order.product.includes('16GB')) {
          totalCostOfGoods += Number(fullSettings?.products['16gb']?.cost || 0);
        } else if (order.product.includes('32GB')) {
          totalCostOfGoods += Number(fullSettings?.products['32gb']?.cost || 0);
        } else if (order.product.includes('64GB')) {
          totalCostOfGoods += Number(fullSettings?.products['64gb']?.cost || 0);
        } else if (order.product.includes('128GB')) {
          totalCostOfGoods += Number(fullSettings?.products['128gb']?.cost || 0);
        }
      }
    }
    if (order.shipping_paid) totalShipping += Number(order.shipping_cost || 0);
  });
  
  // Manual income (capital / funding)
  let totalManualIncome = 0;
  incomeList.forEach(inc => { totalManualIncome += Number(inc.amount || 0); });

  let totalExpenses = 0;
  expensesList.forEach(exp => {
    totalExpenses += Number(exp.amount || 0);
  });

  const totalIncome = totalSalesIncome; // used in stats cards (products revenue)
  const netProfit = totalSalesIncome - totalCostOfGoods;
  const totalIncomeWithShipping = totalSalesIncome + totalShipping;
  
  // cash on hand = sales income + manual income - expenses
  const cashOnHand = totalSalesIncome + totalManualIncome - totalExpenses;

  // Update stats cards
  document.getElementById('stat-income').textContent = 'EGP ' + totalIncome.toLocaleString('en-US');
  document.getElementById('stat-income-with-shipping').textContent = 'EGP ' + totalIncomeWithShipping.toLocaleString('en-US');
  document.getElementById('stat-expenses').textContent = 'EGP ' + totalExpenses.toLocaleString('en-US');
  
  const cashEl = document.getElementById('stat-cash');
  cashEl.textContent = 'EGP ' + cashOnHand.toLocaleString('en-US');
  cashEl.style.color = cashOnHand >= 0 ? 'var(--purple-light)' : 'var(--danger)';

  const profitValEl = document.getElementById('stat-profit');
  const profitIconEl = document.getElementById('stat-profit-icon');
  profitValEl.textContent = 'EGP ' + netProfit.toLocaleString('en-US');
  const profitSvg = document.getElementById('stat-profit-svg');
  if (netProfit >= 0) {
    profitValEl.style.color = 'var(--success)';
    profitIconEl.style.color = 'var(--success)';
    if (profitSvg) profitSvg.innerHTML = '<use href="#ai-trending-up" stroke="currentColor"/>';
  } else {
    profitValEl.style.color = 'var(--danger)';
    profitIconEl.style.color = 'var(--danger)';
    if (profitSvg) profitSvg.innerHTML = '<use href="#ai-trending-down" stroke="currentColor"/>';
  }
  
  // 2. Render orders table
  document.getElementById('orders-count').textContent = ordersList.length + ' طلب';
  const ordersTbody = document.getElementById('ordersTableBody');
  if (ordersList.length === 0) {
    ordersTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--grey); padding: 30px;">لا توجد طلبات مسجلة بعد</td></tr>`;
  } else {
    ordersTbody.innerHTML = ordersList.map(o => {
      return `
        <tr>
          <td style="font-family: monospace; font-weight: bold; color: var(--gold);">${o.order_id}</td>
          <td style="font-size: 0.8rem; color: var(--grey);">${o.timestamp}</td>
          <td>
            <div style="font-weight: 500;">${o.name}</div>
            <div style="font-size: 0.75rem; color: var(--grey); margin-top:2px;">
              <a href="https://wa.me/${o.whatsapp}" target="_blank" style="color: var(--success); text-decoration: none; display:inline-flex; align-items:center; gap:4px;"><svg width='12' height='12'><use href='#ai-chat' stroke='currentColor'/></svg>${o.phone}</a>
            </div>
          </td>
          <td>${o.governorate} — ${o.city}<div style="font-size:0.75rem; color: var(--grey); margin-top:2px;">${o.address}</div></td>
          <td>
            <span style="font-weight: 500;">${o.product}</span>
            ${o.flash_size ? `<span style="font-size: 0.75rem; color: var(--purple-light); display:block; margin-top:2px;">(${o.flash_size})</span>` : ''}
          </td>
          <td style="font-weight: bold; color: var(--white);">EGP ${Number(o.total || 0).toLocaleString('en-US')}</td>
          <td style="text-align: center;">
            <input type="checkbox" class="admin-checkbox" ${o.shipping_paid ? 'checked' : ''} onchange="toggleOrderPayment('${o.order_id}', 'shipping_paid', this.checked)">
            <div style="font-size:0.65rem; margin-top:3px; color: var(--gold);">Instapay ✓</div>
          </td>
          <td style="text-align: center;">
            <input type="checkbox" class="admin-checkbox" ${o.product_paid ? 'checked' : ''} onchange="toggleOrderPayment('${o.order_id}', 'product_paid', this.checked)">
            <div style="font-size:0.65rem; margin-top:3px; color: ${o.payment === 'instapay' ? 'var(--gold)' : 'var(--grey)'};">
              ${o.payment === 'instapay' ? 'Instapay ✓' : 'كاش عند التسليم'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  
  // 3. Render expenses table
  const expensesTbody = document.getElementById('expensesTableBody');
  if (expensesList.length === 0) {
    expensesTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--grey); padding: 15px;">لا توجد مصاريف مسجلة</td></tr>`;
  } else {
    expensesTbody.innerHTML = expensesList.map(e => {
      return `
        <tr>
          <td>${e.reason}</td>
          <td style="font-weight: bold; color: var(--danger);">EGP ${Number(e.amount || 0).toLocaleString('en-US')}</td>
          <td style="font-size: 0.75rem; color: var(--grey);">${e.timestamp.split(',')[0]}</td>
          <td style="text-align: center;">
            <button class="btn-action" onclick="deleteExpense('${e.id}')">حذف</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 3b. Render income table
  const incomeTbody = document.getElementById('incomeTableBody');
  if (incomeList.length === 0) {
    incomeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--grey); padding: 15px;">لا توجد إيرادات مسجلة</td></tr>`;
  } else {
    incomeTbody.innerHTML = incomeList.map(i => {
      return `
        <tr>
          <td>${i.source}</td>
          <td style="font-weight: bold; color: var(--success);">EGP ${Number(i.amount || 0).toLocaleString('en-US')}</td>
          <td style="font-size: 0.75rem; color: var(--grey);">${i.timestamp.split(',')[0]}</td>
          <td style="text-align: center;">
            <button class="btn-action" onclick="deleteIncome('${i.id}')">حذف</button>
          </td>
        </tr>
      `;
    }).join('');
  }
  
  // 4. Update Chart
  const ctx = document.getElementById('financeChart').getContext('2d');
  if (financeChart) {
    financeChart.destroy();
  }
  financeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['إجمالي الإيرادات بالشحن', 'إجمالي الإيرادات', 'صافي الأرباح', 'إجمالي المصاريف', 'الفلوس اللي معايا', 'رأس المال / تمويل'],
      datasets: [{
        label: 'المبلغ بـ EGP',
        data: [totalIncomeWithShipping, totalIncome, netProfit, totalExpenses, cashOnHand, totalManualIncome],
        backgroundColor: [
          'rgba(45, 140, 240, 0.45)',
          'rgba(201, 168, 76, 0.45)',
          'rgba(39, 174, 96, 0.45)',
          'rgba(192, 57, 43, 0.45)',
          'rgba(124, 58, 237, 0.45)',
          'rgba(249, 115, 22, 0.45)'
        ],
        borderColor: [
          '#2d8cf0',
          '#c9a84c',
          '#27ae60',
          '#c0392b',
          '#7c3aed',
          '#f97316'
        ],
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#f0e8d8',
            font: { family: 'Tajawal', size: 12 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ' ' + context.label + ': EGP ' + context.raw.toLocaleString('en-US');
            }
          }
        }
      }
    }
  });
}

async function toggleOrderPayment(orderId, type, checked) {
  try {
    const body = {};
    body[type] = checked;
    
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const order = ordersList.find(o => o.order_id === orderId);
      if (order) {
        order[type] = checked;
      }
      updateDashboardUI();
      showToast('تم تحديث حالة الدفع للطلب');
    } else {
      showToast('حدث خطأ أثناء التحديث', true);
    }
  } catch(e) {
    showToast('حدث خطأ أثناء التحديث', true);
  }
}

async function deleteOrder(orderId) {
  if (!confirm(`هل أنت متأكد من حذف الطلب ${orderId}؟`)) return;
  try {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) {
      ordersList = ordersList.filter(o => o.order_id !== orderId);
      updateDashboardUI();
      showToast('تم حذف الطلب بنجاح');
    } else {
      showToast('حدث خطأ أثناء الحذف', true);
    }
  } catch(e) {
    showToast('حدث خطأ أثناء الحذف', true);
  }
}

async function addExpense() {
  const amountInput = document.getElementById('expAmount');
  const reasonInput = document.getElementById('expReason');
  
  const amount = Number(amountInput.value);
  const reason = reasonInput.value.trim();
  
  if (!amount || amount <= 0 || !reason) {
    return showToast('يرجى ملء الحقول بقيم صحيحة', true);
  }

  // ── حساب الرصيد المتاح الحالي ──
  const totalSales = ordersList.reduce((sum, o) => sum + Number(o.product_price || 0), 0);
  const totalManual = incomeList.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const totalSpent  = expensesList.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const currentCash = totalSales + totalManual - totalSpent;

  if (amount > currentCash) {
    return showToast(
      `❌ الرصيد غير كافي! المتاح: EGP ${currentCash.toLocaleString('en-US')} — المطلوب: EGP ${amount.toLocaleString('en-US')}`,
      true
    );
  }
  
  try {
    const res = await fetch('/api/admin/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ amount, reason })
    });
    if (res.ok) {
      const data = await res.json();
      expensesList.unshift(data.expense);
      updateDashboardUI();
      
      amountInput.value = '';
      reasonInput.value = '';
      showToast('تم إضافة المصروف بنجاح');
    } else {
      showToast('حدث خطأ أثناء الإضافة', true);
    }
  } catch(e) {
    showToast('حدث خطأ أثناء الإضافة', true);
  }
}

async function addIncome() {
  const amountInput = document.getElementById('incAmount');
  const sourceInput = document.getElementById('incSource');
  
  const amount = Number(amountInput.value);
  const source = sourceInput.value.trim();
  
  if (!amount || amount <= 0 || !source) {
    return showToast('يرجى ملء الحقول بقيم صحيحة', true);
  }
  
  try {
    const res = await fetch('/api/admin/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ amount, source })
    });
    if (res.ok) {
      const data = await res.json();
      incomeList.unshift(data.income);
      updateDashboardUI();
      
      amountInput.value = '';
      sourceInput.value = '';
      showToast('تم إضافة الإيراد بنجاح');
    } else {
      showToast('حدث خطأ أثناء الإضافة', true);
    }
  } catch(e) {
    showToast('حدث خطأ أثناء الإضافة', true);
  }
}

async function deleteExpense(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return;
  try {
    const res = await fetch(`/api/admin/expenses/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) {
      expensesList = expensesList.filter(e => String(e.id) !== String(id));
      updateDashboardUI();
      showToast('تم حذف المصروف بنجاح');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'حدث خطأ أثناء الحذف', true);
    }
  } catch(e) {
    showToast('حدث خطأ في الاتصال بالسيرفر', true);
  }
}

async function deleteIncome(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الإيراد؟')) return;
  try {
    const res = await fetch(`/api/admin/income/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) {
      incomeList = incomeList.filter(i => String(i.id) !== String(id));
      updateDashboardUI();
      showToast('تم حذف الإيراد بنجاح');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'حدث خطأ أثناء الحذف', true);
    }
  } catch(e) {
    showToast('حدث خطأ في الاتصال بالسيرفر', true);
  }
}

function switchFinTab(tab) {
  document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.fin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('finTab-' + tab).classList.add('active');
  document.getElementById('finPanel-' + tab).classList.add('active');
}