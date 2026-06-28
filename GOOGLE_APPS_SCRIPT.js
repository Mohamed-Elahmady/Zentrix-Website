// ═══════════════════════════════════════════════════════════════════════════════
// ZENTRIX — Google Apps Script
// Copy this entire file into Google Apps Script and deploy as Web App
// ═══════════════════════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    // 1. GET ALL DASHBOARD DATA (Combined to prevent Vercel timeouts)
    if (action === 'get_dashboard') {
      const ordersSheet = getOrCreateSheet('Zentrix Orders');
      const expensesSheet = getOrCreateSheet('Zentrix Expenses', ['Expense ID', 'Amount', 'Reason', 'Timestamp']);
      const incomeSheet = getOrCreateSheet('Zentrix Income', ['Income ID', 'Amount', 'Source', 'Timestamp']);

      // A. Parse Orders
      const ordersValues = ordersSheet.getDataRange().getValues();
      const orders = [];
      if (ordersValues.length > 1) {
        for (let i = 1; i < ordersValues.length; i++) {
          const row = ordersValues[i];
          if (!row[0]) continue;
          orders.push({
            order_id:      row[0]  || '',
            timestamp:     row[1]  || '',
            name:          row[2]  || '',
            phone:         row[3]  || '',
            whatsapp:      row[4]  || '',
            product:       row[5]  || '',
            product_price: Number(row[6]  || 0),
            shipping_cost: Number(row[7]  || 0),
            total:         Number(row[8]  || 0),
            payment:       String(row[9]  || '').toLowerCase(),
            governorate:   row[10] || '',
            city:          row[11] || '',
            address:       row[12] || '',
            shipping_paid: row[13] === true || row[13] === 'true',
            product_paid:  row[14] === true || row[14] === 'true',
            status:        row[15] || 'Confirmed',
            flash_type:    row[16] || 'New'
          });
        }
        orders.reverse();
      }

      // B. Parse Expenses
      const expensesValues = expensesSheet.getDataRange().getValues();
      const expenses = [];
      if (expensesValues.length > 1) {
        for (let i = 1; i < expensesValues.length; i++) {
          const row = expensesValues[i];
          if (!row[0]) continue;
          expenses.push({
            id: row[0],
            amount: Number(row[1] || 0),
            reason: row[2] || '',
            timestamp: row[3] || ''
          });
        }
        expenses.reverse();
      }

      // C. Parse Income
      const incomeValues = incomeSheet.getDataRange().getValues();
      const income = [];
      if (incomeValues.length > 1) {
        for (let i = 1; i < incomeValues.length; i++) {
          const row = incomeValues[i];
          if (!row[0]) continue;
          income.push({
            id: row[0],
            amount: Number(row[1] || 0),
            source: row[2] || '',
            timestamp: row[3] || ''
          });
        }
        income.reverse();
      }

      return ContentService
        .createTextOutput(JSON.stringify({ orders, expenses, income }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. GET SETTINGS
    if (action === 'get_settings') {
      const sheet = getOrCreateSheet('Zentrix Settings', ['Settings JSON']);
      const value = sheet.getRange(2, 1).getValue();
      let settings = {};
      if (value) {
        settings = JSON.parse(value);
      }
      return ContentService
        .createTextOutput(JSON.stringify(settings))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. GET EXPENSES (Single Sheet Fetch)
    if (action === 'get_expenses') {
      const sheet = getOrCreateSheet('Zentrix Expenses', ['Expense ID', 'Amount', 'Reason', 'Timestamp']);
      const values = sheet.getDataRange().getValues();
      const expenses = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (!row[0]) continue;
        expenses.push({
          id: row[0],
          amount: Number(row[1] || 0),
          reason: row[2] || '',
          timestamp: row[3] || ''
        });
      }
      expenses.reverse();
      return ContentService
        .createTextOutput(JSON.stringify(expenses))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 4. GET INCOME (Single Sheet Fetch)
    if (action === 'get_income') {
      const sheet = getOrCreateSheet('Zentrix Income', ['Income ID', 'Amount', 'Source', 'Timestamp']);
      const values = sheet.getDataRange().getValues();
      const income = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (!row[0]) continue;
        income.push({
          id: row[0],
          amount: Number(row[1] || 0),
          source: row[2] || '',
          timestamp: row[3] || ''
        });
      }
      income.reverse();
      return ContentService
        .createTextOutput(JSON.stringify(income))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 5. GET ORDERS (Default / Fallback)
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Zentrix Orders');
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) {
      return ContentService
        .createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const orders = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row[0]) continue; // Skip empty rows
      
      const order = {
        order_id:      row[0]  || '',
        timestamp:     row[1]  || '',
        name:          row[2]  || '',
        phone:         row[3]  || '',
        whatsapp:      row[4]  || '',
        product:       row[5]  || '',
        product_price: Number(row[6]  || 0),
        shipping_cost: Number(row[7]  || 0),
        total:         Number(row[8]  || 0),
        payment:       String(row[9]  || '').toLowerCase(),
        governorate:   row[10] || '',
        city:          row[11] || '',
        address:       row[12] || '',
        shipping_paid: row[13] === true || row[13] === 'true',
        product_paid:  row[14] === true || row[14] === 'true',
        status:        row[15] || 'Confirmed',
        flash_type:    row[16] || 'New'
      };
      orders.push(order);
    }

    orders.reverse();

    return ContentService
      .createTextOutput(JSON.stringify(orders))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 1. SAVE SETTINGS
    if (data.action === 'save_settings') {
      const sheet = getOrCreateSheet('Zentrix Settings', ['Settings JSON']);
      sheet.getRange(2, 1).setValue(JSON.stringify(data.settings));
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, message: 'Settings saved successfully' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. ADD EXPENSE
    if (data.action === 'add_expense') {
      const sheet = getOrCreateSheet('Zentrix Expenses', ['Expense ID', 'Amount', 'Reason', 'Timestamp']);
      const row = [
        data.expense.id,
        Number(data.expense.amount),
        data.expense.reason,
        data.expense.timestamp
      ];
      sheet.appendRow(row);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, message: 'Expense added successfully' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. DELETE EXPENSE
    if (data.action === 'delete_expense') {
      const sheet = getOrCreateSheet('Zentrix Expenses', ['Expense ID', 'Amount', 'Reason', 'Timestamp']);
      const values = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.id)) {
          foundRow = i + 1;
          break;
        }
      }
      if (foundRow !== -1) {
        sheet.deleteRow(foundRow);
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Expense deleted successfully' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Expense not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 4. ADD INCOME
    if (data.action === 'add_income') {
      const sheet = getOrCreateSheet('Zentrix Income', ['Income ID', 'Amount', 'Source', 'Timestamp']);
      const row = [
        data.income.id,
        Number(data.income.amount),
        data.income.source,
        data.income.timestamp
      ];
      sheet.appendRow(row);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, message: 'Income added successfully' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 5. DELETE INCOME
    if (data.action === 'delete_income') {
      const sheet = getOrCreateSheet('Zentrix Income', ['Income ID', 'Amount', 'Source', 'Timestamp']);
      const values = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.id)) {
          foundRow = i + 1;
          break;
        }
      }
      if (foundRow !== -1) {
        sheet.deleteRow(foundRow);
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Income record deleted successfully' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Income record not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 6. DELETE ORDER
    if (data.action === 'delete_order') {
      const sheet = getOrCreateSheet('Zentrix Orders');
      const values = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.order_id)) {
          foundRow = i + 1;
          break;
        }
      }
      if (foundRow !== -1) {
        sheet.deleteRow(foundRow);
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Order deleted successfully' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Order not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 7. UPDATE ORDER (shipping_paid, product_paid, status)
    if (data.action === 'update') {
      const sheet = getOrCreateSheet('Zentrix Orders');
      const values = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === data.order_id) {
          foundRow = i + 1; // 1-indexed row number
          break;
        }
      }
      if (foundRow !== -1) {
        if (data.shipping_paid !== undefined) {
          sheet.getRange(foundRow, 14).setValue(data.shipping_paid);
        }
        if (data.product_paid !== undefined) {
          sheet.getRange(foundRow, 15).setValue(data.product_paid);
        }
        if (data.status !== undefined) {
          sheet.getRange(foundRow, 16).setValue(data.status);
          applyStatusColor(sheet, foundRow, data.status);
        }
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Updated successfully' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Order not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 8. APPEND NEW ORDER (Default Behavior)
    const sheet = getOrCreateSheet('Zentrix Orders', [
      'Order ID', 'Timestamp', 'Name', 'Phone', 'WhatsApp',
      'Product', 'Product Price', 'Shipping Cost', 'Total',
      'Payment', 'Governorate', 'City', 'Address',
      'Shipping Paid', 'Product Paid', 'Status', 'Flash Type'
    ]);

    const row = [
      data.order_id        || '',
      data.timestamp       || new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
      data.name            || '',
      data.phone           || '',
      data.whatsapp        || '',
      data.product         || '',
      data.product_price   || 0,
      data.shipping_cost   || 0,
      data.total           || 0,
      data.payment === 'cash' ? 'Cash' : 'Instapay',
      data.governorate     || '',
      data.city            || '',
      data.address         || '',
      false,   // shipping_paid
      false,   // product_paid
      data.status          || 'Confirmed',
      data.flash_type      || 'New'
    ];

    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();

    sheet.getRange(lastRow, 4).setNumberFormat('@');
    sheet.getRange(lastRow, 5).setNumberFormat('@');
    sheet.getRange(lastRow, 4).setValue(data.phone || '');
    sheet.getRange(lastRow, 5).setValue(data.whatsapp || '');

    sheet.getRange(lastRow, 14).insertCheckboxes();
    sheet.getRange(lastRow, 15).insertCheckboxes();

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Confirmed', 'Shipped', 'Delivered'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(lastRow, 16).setDataValidation(statusRule);

    applyStatusColor(sheet, lastRow, data.status || 'Confirmed');
    applyFlashTypeColor(sheet, lastRow, data.flash_type || 'New');

    sheet.autoResizeColumns(1, 17);
    for (let col = 1; col <= 17; col++) {
      const currentWidth = sheet.getColumnWidth(col);
      sheet.setColumnWidth(col, currentWidth + 20);
    }

    const allRange = sheet.getRange(1, 1, lastRow, 17);
    allRange.setHorizontalAlignment('center');
    allRange.setVerticalAlignment('middle');
    allRange.setWrap(false);

    sheet.setRowHeightsForced(1, 1, 35);
    if (lastRow > 1) sheet.setRowHeightsForced(2, lastRow, 30);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#0d1b2e');
      headerRange.setFontColor('#c9a84c');
      headerRange.setFontWeight('bold');
      headerRange.setFontSize(11);
      headerRange.setHorizontalAlignment('center');
      headerRange.setVerticalAlignment('middle');
      headerRange.setWrap(false);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function applyStatusColor(sheet, row, status) {
  const cell = sheet.getRange(row, 16);
  const colors = {
    'Confirmed': '#1a3a5c',
    'Shipped':   '#7d5a00',
    'Delivered': '#1a4a2e'
  };
  const textColors = {
    'Confirmed': '#5b9bd5',
    'Shipped':   '#c9a84c',
    'Delivered': '#2ecc71'
  };
  cell.setBackground(colors[status] || '#1a3a5c');
  cell.setFontColor(textColors[status] || '#5b9bd5');
  cell.setFontWeight('bold');
}

function applyFlashTypeColor(sheet, row, flashType) {
  const cell = sheet.getRange(row, 17);
  if (flashType === 'Personal') {
    cell.setBackground('#4a2d00');
    cell.setFontColor('#c9a84c');
  } else {
    cell.setBackground('#0d2e1f');
    cell.setFontColor('#2ecc71');
  }
  cell.setFontWeight('bold');
}

function fixHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Zentrix Orders');
  if (!sheet) { Logger.log('Sheet not found!'); return; }

  const headers = [
    'Order ID', 'Timestamp', 'Name', 'Phone', 'WhatsApp',
    'Product', 'Product Price', 'Shipping Cost', 'Total',
    'Payment', 'Governorate', 'City', 'Address',
    'Shipping Paid', 'Product Paid', 'Status', 'Flash Type'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#0d1b2e');
  headerRange.setFontColor('#c9a84c');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  headerRange.setWrap(false);
  sheet.setFrozenRows(1);
  sheet.setRowHeightsForced(1, 1, 35);

  Logger.log('Headers fixed — Flash Type column added in col 17.');
}