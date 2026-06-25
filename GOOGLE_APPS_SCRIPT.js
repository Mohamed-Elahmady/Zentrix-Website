// ═══════════════════════════════════════════════════════════════════════════════
// ZENTRIX — Google Apps Script
// Copy this entire file into Google Apps Script and deploy as Web App
// ═══════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Zentrix Orders');

    // Create sheet if not exists + add headers
    if (!sheet) {
      sheet = ss.insertSheet('Zentrix Orders');
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
    } else {
      // Sheet already exists — make sure col 17 header is there
      // (handles sheets created before Flash Type column was added)
      const col17Header = sheet.getRange(1, 17).getValue();
      if (!col17Header || col17Header === '') {
        const h = sheet.getRange(1, 17);
        h.setValue('Flash Type');
        h.setBackground('#0d1b2e');
        h.setFontColor('#c9a84c');
        h.setFontWeight('bold');
        h.setFontSize(11);
        h.setHorizontalAlignment('center');
        h.setVerticalAlignment('middle');
        h.setWrap(false);
      }
    }

    // Handle updates from Website Admin Panel
    if (data.action === 'update') {
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

    // Append order row
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
      // Both always start unchecked — admin manually checks when payment is confirmed
      false,   // shipping_paid (col 14)
      false,   // product_paid  (col 15)
      data.status          || 'Confirmed',
      data.flash_type      || 'New'
    ];

    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();

    // Force phone & whatsapp cols (4, 5) to plain text so '+20 ...' doesn't parse as formula
    sheet.getRange(lastRow, 4).setNumberFormat('@');
    sheet.getRange(lastRow, 5).setNumberFormat('@');
    sheet.getRange(lastRow, 4).setValue(data.phone || '');
    sheet.getRange(lastRow, 5).setValue(data.whatsapp || '');

    // Insert checkboxes in Shipping Paid (col 14) and Product Paid (col 15)
    sheet.getRange(lastRow, 14).insertCheckboxes();
    sheet.getRange(lastRow, 15).insertCheckboxes();

    // Dropdown validation for Status column (col 16)
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Confirmed', 'Shipped', 'Delivered'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(lastRow, 16).setDataValidation(statusRule);

    // Color-code the status cell
    applyStatusColor(sheet, lastRow, data.status || 'Confirmed');

    // Color-code Flash Type cell (col 17)
    applyFlashTypeColor(sheet, lastRow, data.flash_type || 'New');

    // Auto-resize all columns to fit content (17 cols)
    sheet.autoResizeColumns(1, 17);

    // Add 20px padding to each column
    for (let col = 1; col <= 17; col++) {
      const currentWidth = sheet.getColumnWidth(col);
      sheet.setColumnWidth(col, currentWidth + 20);
    }

    // Center + middle align everything, no wrap
    const allRange = sheet.getRange(1, 1, lastRow, 17);
    allRange.setHorizontalAlignment('center');
    allRange.setVerticalAlignment('middle');
    allRange.setWrap(false);

    // Compact row heights
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

// Apply background color based on status value
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

// Apply color to Flash Type column (col 17)
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

// Fix headers — run once manually to fix/update all headers including Flash Type
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

// Test function
function testSetup() {
  const testData = {
    order_id: 'ZNT-TEST',
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    name: 'Mohamed Test',
    phone: '01000000000',
    whatsapp: '01000000000',
    product: '64GB',
    product_price: 100,
    shipping_cost: 110,
    total: 210,
    payment: 'cash',
    shipping_paid: true,
    product_paid: false,
    status: 'Confirmed',
    flash_type: 'Personal',
    governorate: 'الشرقية',
    city: 'الزقازيق',
    address: 'شارع مثال - عمارة 1'
  };

  const e = { postData: { contents: JSON.stringify(testData) } };
  doPost(e);
  Logger.log('Test order inserted!');
}

// GET request handler: returns all orders as JSON
function doGet(e) {
  try {
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

    // Return in reverse order (newest first)
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