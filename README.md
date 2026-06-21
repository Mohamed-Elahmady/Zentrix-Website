# 🎮 ZENTRIX — Retro Games USB Store

## متطلبات التشغيل
- Node.js 18+
- npm

---

## تشغيل المشروع

```bash
cd zentrix
npm install
npm start
```

الموقع هيشتغل على: http://localhost:3000
Admin Panel على: http://localhost:3000/admin

---

## إعداد Google Sheets (مهم)

### 1. افتح Google Sheets جديد
### 2. من القائمة: Extensions → Apps Script
### 3. انسخ محتوى ملف `GOOGLE_APPS_SCRIPT.js` كله في المحرر
### 4. Save → Deploy → New Deployment
- Type: Web App
- Execute as: **Me**
- Who has access: **Anyone**
### 5. انسخ الـ URL الناتج
### 6. ادخل على Admin Panel (localhost:3000/admin)
### 7. في خانة "Google Sheets Web App URL" — الصق الـ URL واحفظ

---

## إعداد Admin Panel

1. افتح: http://localhost:3000/admin
2. كلمة السر الافتراضية: **zentrix2025**
3. غيّر الأسعار ورقم الواتساب ورابط Instapay
4. الصق Google Sheets URL

### تغيير كلمة سر Admin
في ملف `data/settings.json` غيّر قيمة `admin_password`

---

## هيكل الملفات

```
zentrix/
├── server.js              ← Express server
├── package.json
├── data/
│   └── settings.json      ← الأسعار والإعدادات
├── public/
│   ├── index.html         ← موقع العميل
│   └── admin.html         ← لوحة الإدارة
└── GOOGLE_APPS_SCRIPT.js  ← للـ Google Sheets
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/settings | إعدادات المنتجات والشحن |
| POST | /api/order | تسجيل طلب جديد |
| POST | /api/admin/login | تسجيل دخول Admin |
| GET | /api/admin/settings | كل الإعدادات (Admin) |
| PUT | /api/admin/settings | تحديث الأسعار والبيانات |
| PUT | /api/admin/shipping | تحديث أسعار الشحن |

---

## رقم الطلب
كل طلب بياخد رقم تلقائي بالشكل: **ZNT-XXXX**

---

## النشر على الإنترنت (Deployment)
اقترح استخدام:
- **Railway.app** أو **Render.com** للـ Node.js (مجاني)
- أو **VPS** مع Nginx

---

## الألوان
- Navy: `#0d1b2e`
- Gold: `#c9a84c`
