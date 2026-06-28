// ── STATE ─────────────────────────────────────────────────────────────────────
let settings = null;
let selectedProduct = null;   // '64gb' | '128gb' | 'custom'
let selectedPayment = null;
let selectedFlashSize = null; // for custom: '16gb' | '32gb' | '64gb' | '128gb'
let modalProduct = null;

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();
    renderProducts();
    populateGovDropdown();
    buildStrip();
    // Set contact button WhatsApp link from settings
    const contactBtn = document.getElementById('headerContactBtn');
    if (contactBtn && settings.whatsapp_number) {
      contactBtn.href = `https://wa.me/${settings.whatsapp_number}`;
    }
  } catch(e) {
    console.error('Failed to load settings', e);
  }
}

// ── CONSOLES STRIP ────────────────────────────────────────────────────────────
function buildStrip() {
  const consoles = ['PlayStation 1','PlayStation 2','Super Nintendo','Sega Genesis','Nintendo 64','Game Boy Advance','Arcade','PSP','Nintendo DS','Atari','NES / Famicom','Sega CD','Neo Geo'];
  const track = document.getElementById('stripTrack');
  const doubled = [...consoles, ...consoles];
  track.innerHTML = doubled.map(c =>
    `<div class="strip-item"><div class="strip-dot"></div><span>${c}</span></div>`
  ).join('');
}

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('cardsGrid');
  const custom = settings.products.custom;
  const sizes = custom ? custom.sizes : {};

  // Standard cards
  const standardCards = ['64gb', '128gb'].map(key => {
    const p = settings.products[key];
    const badges = {
      '64gb':  `<svg width="12" height="12"><use href="#icon-usb" stroke="currentColor"/></svg> الفلاشة الأساسية`,
      '128gb': `<svg width="12" height="12"><use href="#icon-star"/></svg> الأرشيف الكامل`
    };
    const isPopular = key === '128gb';
    const priceHtml = p.price > 0
      ? `<div class="card-price">${p.price.toLocaleString('en-US')} جنيه </div>`
      : `<div class="card-price"><span style="font-size:.85rem;color:var(--grey)">السعر قريباً</span></div>`;
    return `
      <div class="product-card" id="card-${key}">
        <div class="card-badge ${isPopular ? 'popular' : ''}">${badges[key]}</div>
        <div class="card-size">${key.toUpperCase()}</div>
        <div class="card-desc">${p.description}</div>
        <div class="card-stats">
          <div class="card-stat">
            <div class="card-stat-num">${p.games_count}</div>
            <div class="card-stat-label">لعبة</div>
          </div>
          <div class="card-stat">
            <div class="card-stat-num">${p.consoles}</div>
            <div class="card-stat-label">جهاز</div>
          </div>
        </div>
        ${priceHtml}
        <button class="btn-view-games" onclick="openGamesModal('${key}')">
          <svg width="16" height="16" style="color:currentColor"><use href="#icon-gamepad" stroke="currentColor"/></svg>
          شوف الألعاب الجوه
        </button>
        <button class="btn-select" onclick="selectProduct('${key}')">اختار الفلاشة ✦</button>
      </div>`;
  }).join('');

  // Custom card
  const sizeBtnsHtml = Object.entries(sizes).map(([sz, data]) =>
    `<button class="size-btn" id="sz-${sz}" onclick="selectFlashSize('${sz}')">${data.label}</button>`
  ).join('');

  const customCard = `
    <div class="product-card custom-card" id="card-custom">
      <div class="card-badge custom-badge">
        <svg width="12" height="12"><use href="#icon-envelope" stroke="currentColor"/></svg>
        فلاشتك الشخصية
      </div>
      <div class="card-size" style="font-size:2rem;">Personal Flash</div>
      <div class="card-desc">${custom ? custom.description : 'بتبعتلنا فلاشتك وإحنا بنحط عليها الألعاب'}</div>

      <div class="flash-size-selector">
        <div class="flash-size-label">اختار حجم فلاشتك اللي هتبعتها:</div>
        <div class="size-btns">${sizeBtnsHtml}</div>
      </div>

      <div style="background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:.82rem;color:#c4b5fd;line-height:1.5;display:flex;align-items:flex-start;gap:8px;">
        <svg width="16" height="16" style="flex-shrink:0;margin-top:2px"><use href="#icon-package" stroke="currentColor"/></svg>
        <span>هتبعتلنا فلاشتك مع الطلب، وإحنا بنحط عليها الألعاب ونرجعهالك مع التوصيل.</span>
      </div>

      <div class="custom-price-display" id="customPriceDisplay">اختار حجم الفلاشة</div>

      <button class="btn-select custom-select" id="btn-custom-select" onclick="selectCustomProduct()" disabled>
        اطلب الآن ✦
      </button>
    </div>`;

  grid.innerHTML = standardCards + customCard;
  updateCustomSelectBtn();
}

// ── CUSTOM FLASH SIZE ─────────────────────────────────────────────────────────
function selectFlashSize(sz) {
  selectedFlashSize = sz;
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sz-' + sz)?.classList.add('active');
  updateCustomPriceDisplay();
  updateCustomSelectBtn();
}

function updateCustomPriceDisplay() {
  const disp = document.getElementById('customPriceDisplay');
  if (!disp) return;
  if (!selectedFlashSize) {
    disp.textContent = 'اختار حجم الفلاشة';
    return;
  }
  const sizeData = settings.products.custom?.sizes?.[selectedFlashSize];
  if (!sizeData) return;
  disp.textContent = `${sizeData.price.toLocaleString('en-US')} جنيه`;
}

function updateCustomSelectBtn() {
  const btn = document.getElementById('btn-custom-select');
  if (!btn) return;
  btn.disabled = !selectedFlashSize;
}

function selectCustomProduct() {
  if (!selectedFlashSize) return;
  selectedProduct = 'custom';

  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('card-custom')?.classList.add('selected');

  const sizeData = settings.products.custom?.sizes?.[selectedFlashSize];
  const banner = document.getElementById('selectedBanner');
  banner.classList.add('custom-banner');
  document.getElementById('spbName').className = 'spb-name custom-name';
  document.getElementById('spbName').textContent = `Custom Flash — ${sizeData.label}`;
  document.getElementById('spbGames').textContent = 'فلاشتك الشخصية — هنحط عليها الألعاب';

  document.getElementById('personalFlashNotice').classList.add('show');

  const orderSec = document.getElementById('orderSection');
  orderSec.classList.add('visible');
  setTimeout(() => { document.getElementById('order-anchor').scrollIntoView({ behavior: 'smooth' }); }, 80);
  updateShippingPreview();
}

// ── GAMES MODAL ───────────────────────────────────────────────────────────────
function openGamesModal(key) {
  modalProduct = key;
  const p = settings.products[key];
  document.getElementById('modalTitle').textContent = `ألعاب فلاشة ${key.toUpperCase()} — ${p.games_count} لعبة`;
  let html = '';
  for (const [console_, games] of Object.entries(p.games)) {
    html += `<div class="console-section">
      <div class="console-name">${console_}</div>
      <div class="games-grid">${games.map(g => `<div class="game-tag">${g}</div>`).join('')}</div>
    </div>`;
  }
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('gamesModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('gamesModal').classList.remove('open');
  document.body.style.overflow = '';
}

function selectFromModal() {
  closeModal();
  if (modalProduct) selectProduct(modalProduct);
}
document.getElementById('gamesModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ── PRODUCT SELECT (standard) ─────────────────────────────────────────────────
function selectProduct(key) {
  selectedProduct = key;
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('card-' + key)?.classList.add('selected');

  const p = settings.products[key];
  const banner = document.getElementById('selectedBanner');
  banner.classList.remove('custom-banner');
  document.getElementById('spbName').className = 'spb-name';
  document.getElementById('spbName').textContent = p.label;
  document.getElementById('spbGames').textContent = `${p.games_count} لعبة — ${p.consoles} جهاز`;
  document.getElementById('personalFlashNotice').classList.remove('show');

  const orderSec = document.getElementById('orderSection');
  orderSec.classList.add('visible');
  setTimeout(() => { document.getElementById('order-anchor').scrollIntoView({ behavior: 'smooth' }); }, 80);
  updateShippingPreview();
}

// ── DROPDOWN ──────────────────────────────────────────────────────────────────
function populateGovDropdown() {
  const sel = document.getElementById('f_gov');
  Object.keys(settings.shipping).forEach(gov => {
    const opt = document.createElement('option');
    opt.value = gov; opt.textContent = gov;
    sel.appendChild(opt);
  });
}
function onGovChange() { updateShippingPreview(); }

function updateShippingPreview() {
  const gov = document.getElementById('f_gov').value;
  const preview = document.getElementById('shippingPreview');
  if (!gov || !selectedProduct) { preview.classList.remove('show'); return; }

  let shippingCost = settings.shipping[gov] || 0;
  let productPrice = 0;

  if (selectedProduct === 'custom') {
    productPrice = settings.products.custom?.sizes?.[selectedFlashSize]?.price || 0;
    shippingCost = shippingCost * 2; // Doubled shipping for custom round trip
  } else {
    productPrice = settings.products[selectedProduct].price;
  }

  document.getElementById('govLabel').textContent = gov + (selectedProduct === 'custom' ? ' (شحن رايح جاي)' : '');
  document.getElementById('shippingVal').textContent = shippingCost + ' جنيه';
  document.getElementById('productPriceVal').textContent = productPrice > 0 ? productPrice.toLocaleString('en-US') + ' جنيه' : 'يحدده الأدمن';
  preview.classList.add('show');
}

// ── PAYMENT ───────────────────────────────────────────────────────────────────
function selectPayment(method) {
  selectedPayment = method;
  document.getElementById('optCash').classList.toggle('active', method === 'cash');
  document.getElementById('optInstapay').classList.toggle('active', method === 'instapay');
  document.getElementById('cashNotice').classList.toggle('show', method === 'cash');
}

// ── PHONE VALIDATION ──────────────────────────────────────────────────────────
function sanitizePhone(input) {
  // Convert Arabic/Eastern-Arabic digits to English
  let v = input.value
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0);
  // Keep only digits
  v = v.replace(/[^0-9]/g, '');
  input.value = v;
  // Clear error while typing
  const errId = input.id === 'f_phone' ? 'err_phone' : 'err_whatsapp';
  document.getElementById(errId).textContent = '';
  input.classList.remove('input-err');
}

function validatePhone(input, errId) {
  const v = input.value.trim();
  const errEl = document.getElementById(errId);
  // Must be 11 digits starting with 01
  if (!/^01[0-9]{9}$/.test(v)) {
    errEl.textContent = 'رقم غير صحيح — أدخل 11 رقم يبدأ بـ 01';
    input.classList.add('input-err');
    return false;
  }
  errEl.textContent = '';
  input.classList.remove('input-err');
  return true;
}

// ── SUBMIT ────────────────────────────────────────────────────────────────────
async function submitOrder() {
  if (!selectedProduct) return alert('اختار الفلاشة الأول');
  if (selectedProduct === 'custom' && !selectedFlashSize) return alert('اختار حجم الفلاشة');
  if (!selectedPayment) return alert('اختار طريقة الدفع');

  const name     = document.getElementById('f_name').value.trim();
  const phone    = document.getElementById('f_phone').value.trim();
  const whatsapp = document.getElementById('f_whatsapp').value.trim();
  const gov      = document.getElementById('f_gov').value;
  const city     = document.getElementById('f_city').value.trim();
  const address  = document.getElementById('f_address').value.trim();

  if (!name || !phone || !whatsapp || !gov || !city || !address) {
    return alert('من فضلك اكمل كل البيانات المطلوبة');
  }

  // Validate phone formats
  const phoneOk    = validatePhone(document.getElementById('f_phone'),    'err_phone');
  const whatsappOk = validatePhone(document.getElementById('f_whatsapp'), 'err_whatsapp');
  if (!phoneOk || !whatsappOk) return;

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" style="animation:spin 1s linear infinite"><use href="#icon-loading" stroke="currentColor"/></svg> جاري إرسال الطلب...`;

  const body = {
    name, phone, whatsapp,
    governorate: gov, city, address,
    product: selectedProduct,
    payment: selectedPayment
  };
  if (selectedProduct === 'custom') {
    body.flash_size = selectedFlashSize;
    body.is_personal_flash = true;
  }

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      showSuccessModal(data, name, gov);
    } else {
      alert('حصل خطأ: ' + (data.error || 'حاول تاني'));
    }
  } catch(e) {
    alert('فيه مشكلة في الاتصال، حاول تاني');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ تأكيد الطلب';
  }
}

// ── SUCCESS MODAL ─────────────────────────────────────────────────────────────
function showSuccessModal(data, name, gov) {
  document.getElementById('successOrderId').textContent = data.order_id;

  const isCash = data.payment === 'cash';
  const productPrice = data.product_price > 0 ? data.product_price : '—';
  const total = data.product_price > 0 ? data.product_price + data.shipping_cost : '—';
  const isPersonal = data.is_personal_flash;

  if (isCash) {
    document.getElementById('successMsg').textContent =
      `تم استلام طلبك يا ${name}! يرجى دفع رسوم الشحن مقدماً لتأكيد الطلب، وباقي الحساب عند الاستلام.`;
    document.getElementById('paymentDetailBox').innerHTML = `
      <div class="pdb-row"><span class="pdb-label">رقم الطلب</span><span class="pdb-val">${data.order_id}</span></div>
      <div class="pdb-row"><span class="pdb-label">المنتج</span><span class="pdb-val">${data.product_label}</span></div>
      ${isPersonal ? `<div class="pdb-row"><span class="pdb-label">نوع الفلاشة</span><span class="pdb-val" style="color:#a78bfa;">فلاشة شخصية</span></div>` : ''}
      <div class="pdb-row"><span class="pdb-label">طريقة الدفع</span><span class="pdb-val">كاش عند الاستلام</span></div>
      <div class="pdb-row"><span class="pdb-label">رسوم الشحن (تدفع الآن)</span><span class="pdb-val" style="color: #2ecc71;">${data.shipping_cost} جنيه</span></div>
      <div class="pdb-row"><span class="pdb-label">حساب المنتج (عند الاستلام)</span><span class="pdb-val">${productPrice > 0 ? productPrice + ' جنيه' : 'يحدده الأدمن'}</span></div>
    `;
  } else {
    document.getElementById('successMsg').textContent =
      `تم استلام طلبك يا ${name}! يرجى دفع المبلغ كاملاً عبر Instapay لتأكيد الطلب.`;
    document.getElementById('paymentDetailBox').innerHTML = `
      <div class="pdb-row"><span class="pdb-label">رقم الطلب</span><span class="pdb-val">${data.order_id}</span></div>
      <div class="pdb-row"><span class="pdb-label">المنتج</span><span class="pdb-val">${data.product_label}</span></div>
      ${isPersonal ? `<div class="pdb-row"><span class="pdb-label">نوع الفلاشة</span><span class="pdb-val" style="color:#a78bfa;">فلاشة شخصية</span></div>` : ''}
      <div class="pdb-row"><span class="pdb-label">طريقة الدفع</span><span class="pdb-val">Instapay بالكامل</span></div>
      <div class="pdb-row"><span class="pdb-label">المبلغ المطلوب (يدفع الآن)</span><span class="pdb-val" style="color: #2ecc71;">${total !== '—' ? total + ' جنيه' : 'يحدده الأدمن'}</span></div>
    `;
  }

  const waMsg = isPersonal
    ? (isCash
      ? `مرحبا، عايز أأكد طلبي 🎮\n\nرقم الطلب: ${data.order_id}\nالمنتج: ${data.product_label}\nنوع الفلاشة: فلاشة شخصية\nالاسم: ${name}\nالمحافظة: ${gov}\n\nأنا حولت رسوم الشحن (${data.shipping_cost} جنيه) مقدماً عبر Instapay.\n*مرفق صورة إيصال الدفع (الاسكرين شوت).*`
      : `مرحبا، عايز أأكد طلبي 🎮\n\nرقم الطلب: ${data.order_id}\nالمنتج: ${data.product_label}\nنوع الفلاشة: فلاشة شخصية\nالاسم: ${name}\nالمحافظة: ${gov}\n\nأنا حولت المبلغ كاملاً (${total} جنيه) مقدماً عبر Instapay.\n*مرفق صورة إيصال الدفع (الاسكرين شوت).*`)
    : (isCash
      ? `مرحبا، عايز أأكد طلبي 🎮\n\nرقم الطلب: ${data.order_id}\nالمنتج: ${data.product_label}\nالاسم: ${name}\nالمحافظة: ${gov}\n\nأنا حولت رسوم الشحن (${data.shipping_cost} جنيه) مقدماً عبر Instapay.\n*مرفق صورة إيصال الدفع (الاسكرين شوت).*`
      : `مرحبا، عايز أأكد طلبي 🎮\n\nرقم الطلب: ${data.order_id}\nالمنتج: ${data.product_label}\nالاسم: ${name}\nالمحافظة: ${gov}\n\nأنا حولت المبلغ كاملاً (${total} جنيه) مقدماً عبر Instapay.\n*مرفق صورة إيصال الدفع (الاسكرين شوت).*`);

  document.getElementById('instapayPayBtn').href = data.instapay_link;
  document.getElementById('whatsappLink').href = `https://wa.me/${data.whatsapp_number}?text=${encodeURIComponent(waMsg)}`;
  document.getElementById('successModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function resetOrder() {
  document.getElementById('successModal').classList.remove('open');
  document.body.style.overflow = '';
  selectedProduct = null; selectedPayment = null;
  selectedFlashSize = null;
  document.getElementById('orderSection').classList.remove('visible');
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('optCash').classList.remove('active');
  document.getElementById('optInstapay').classList.remove('active');
  document.getElementById('cashNotice').classList.remove('show');
  document.getElementById('shippingPreview').classList.remove('show');
  document.getElementById('personalFlashNotice').classList.remove('show');
  ['f_name','f_phone','f_whatsapp','f_city','f_address'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f_gov').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Spin animation for loading icon
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

init();
