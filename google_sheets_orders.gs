/**
 * Google Apps Script endpoint for AZ TECH order forms.
 * Paste this file into the Apps Script project attached to your orders spreadsheet.
 * Deploy it as a Web App (execute as you; access: anyone), then paste the /exec URL
 * into GOOGLE_SHEETS_WEB_APP_URL in server.js.
 */

const ORDERS_SHEET_NAME = 'Commandes';
const ORDERS_SPREADSHEET_ID = '1-8IlfZO8Pd17atBKQ7jG5N9AxS17kTTEf1_MCwlUrcU';
const ORDER_HEADERS = [
  'Prénom', 'Nom', 'Numéro de téléphone', 'Adresse de livraison',
  'Quantité', 'ARTICLE', 'Prix unitaire (DH)', 'Total (DH)',
  'Référence commande', 'Statut', 'Confirmée par', 'Livrée par',
  'Annulée par', 'Dernière modification'
];

// Keep these IDs and prices in sync with the product catalog.
// IDs 13-30 are sample listings; confirm their prices against real stock.
const ORDER_CATALOG = {
  1: { title: 'iPhone 15 Pro Max', price: 13999 },
  2: { title: 'Redmi Note 13 Pro', price: 2999 },
  3: { title: 'Galaxy S24 Ultra', price: 12900 },
  4: { title: 'Oppo Reno 11', price: 4200 },
  5: { title: 'EliteBook 840 G8', price: 9500 },
  6: { title: 'MacBook Air M2', price: 11900 },
  7: { title: 'ThinkPad T14', price: 8900 },
  8: { title: 'Surface Laptop 5', price: 12500 },
  9: { title: 'Machine à Café Magnifica', price: 4200 },
  10: { title: 'Airfryer XXL', price: 1899 },
  11: { title: 'Blender Chauffant', price: 850 },
  12: { title: 'Aspirateur Sans Fil V15', price: 7200 },
  13: { title: 'Galaxy A55 5G', price: 3799 },
  14: { title: 'iPhone 13 128 Go', price: 5499 },
  15: { title: 'Dell Latitude 5420', price: 6900 },
  16: { title: 'Lenovo IdeaPad Slim 3', price: 6200 },
  17: { title: 'Redmi Buds 5', price: 499 },
  18: { title: 'JBL Tune 520BT', price: 699 },
  19: { title: 'Chargeur USB-C 25W', price: 249 },
  20: { title: 'Montre connectée X8', price: 399 },
  21: { title: 'Samsung Crystal UHD 55 pouces', price: 6499 },
  22: { title: 'TCL QLED 55 pouces', price: 5799 },
  23: { title: 'LG UHD 50 pouces', price: 5499 },
  24: { title: 'Samsung Galaxy A35 5G', price: 3199 },
  25: { title: 'Redmi Note 14 Pro 5G', price: 3899 },
  26: { title: 'iPhone 15 128 Go', price: 8999 },
  27: { title: 'Google Pixel 8a 128 Go', price: 6199 },
  28: { title: 'OnePlus Nord CE4 Lite 5G', price: 2999 },
  29: { title: 'realme 12 Pro 5G', price: 3599 },
  30: { title: 'HONOR X9b 5G', price: 4199 }
};

function doGet() {
  return ContentService.createTextOutput('AZ TECH orders endpoint is ready.');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing order data.');
    }
    const data = JSON.parse(e.postData.contents);
    lock.waitLock(10000);
    const sheet = getOrdersSheet();

    if (data.operation === 'status') {
      updateOrderStatus(sheet, data);
      return ContentService.createTextOutput('OK');
    }

    const firstName = cleanText(data.firstName || data.prenom || data.first_name, 80);
    const lastName = cleanText(data.lastName || data.nom || data.last_name, 80);
    const phone = cleanText(data.phone || data.telephone || data.mobile, 24);
    const address = cleanText(data.address || data.adresse, 500);
    const customer = data.customer || {};
    const customerFirstName = cleanText(customer.firstName, 80);
    const customerLastName = cleanText(customer.lastName, 80);
    const customerPhone = cleanText(customer.phone, 24);
    const customerAddress = cleanText(customer.address, 500);
    const requestedItems = Array.isArray(data.items)
      ? data.items
      : [{
          productId: data.productId,
          product: data.product || data.article,
          unitPrice: data.unitPrice,
          quantity: data.quantity
        }];

    const resolvedFirstName = customerFirstName || firstName;
    const resolvedLastName = customerLastName || lastName;
    const resolvedPhone = customerPhone || phone;
    const resolvedAddress = customerAddress || address;
    if (!resolvedFirstName || !resolvedLastName || !resolvedAddress || !/^\+?[0-9 ()\-]{8,24}$/.test(resolvedPhone)) {
      throw new Error('Missing or invalid customer details.');
    }
    if (requestedItems.length < 1 || requestedItems.length > 50) {
      throw new Error('The order must contain between 1 and 50 products.');
    }
    const orderItems = requestedItems.map(item => {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      const product = ORDER_CATALOG[productId];
      const suppliedPrice = item.unitPrice == null ? NaN : Number(item.unitPrice);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new Error('Unknown product or invalid quantity.');
      }
      const title = cleanText(item.product || item.title || (product && product.title), 160);
      const price = Number.isFinite(suppliedPrice) && suppliedPrice >= 0
        ? suppliedPrice
        : (product ? product.price : NaN);
      if (!title || !Number.isFinite(price) || price < 0) {
        throw new Error('Product name or price is missing.');
      }
      return { quantity, title, price };
    });

    if (data.operation === 'update') {
      replaceOrderRows(sheet, data, {
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        phone: resolvedPhone,
        address: resolvedAddress
      }, orderItems);
      return ContentService.createTextOutput('OK');
    }

    appendOrderRows(sheet, data, {
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      phone: resolvedPhone,
      address: resolvedAddress
    }, orderItems);

    return ContentService.createTextOutput('OK');
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput('ERROR: ' + error.message);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function getOrdersSheet() {
  const spreadsheet = SpreadsheetApp.openById(ORDERS_SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(ORDERS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  for (let column = 1; column <= ORDER_HEADERS.length; column++) {
    if (!sheet.getRange(1, column).getValue()) {
      sheet.getRange(1, column).setValue(ORDER_HEADERS[column - 1]);
    }
  }
  return sheet;
}

function makeOrderRow(data, customer, item) {
  const now = new Date();
  return [
    safeCell(customer.firstName),
    safeCell(customer.lastName),
    safeCell(customer.phone),
    safeCell(customer.address),
    item.quantity,
    safeCell(item.title),
    item.price,
    item.price * item.quantity,
    safeCell(data.orderId),
    safeCell(data.status || 'pending'),
    safeCell(data.confirmedBy || ''),
    safeCell(data.deliveredBy || ''),
    safeCell(data.cancelledBy || ''),
    data.updatedAt ? new Date(data.updatedAt) : now
  ];
}

function appendOrderRows(sheet, data, customer, items) {
  if (!data.orderId) throw new Error('Order reference is missing.');
  const rows = items.map(item => makeOrderRow(data, customer, item));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
}

function findOrderRows(sheet, orderId) {
  if (!orderId) throw new Error('Order reference is missing.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Order not found in the sheet.');
  return sheet.getRange(2, 9, lastRow - 1, 1).getValues()
    .map((row, index) => row[0] === orderId ? index + 2 : null)
    .filter(row => row !== null);
}

function updateOrderStatus(sheet, data) {
  const validStatuses = ['pending', 'confirmed', 'delivered', 'cancelled'];
  if (validStatuses.indexOf(data.status) === -1) throw new Error('Invalid order status.');
  const rows = findOrderRows(sheet, data.orderId);
  const updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
  rows.forEach(row => {
    sheet.getRange(row, 10, 1, 5).setValues([[
      data.status,
      data.confirmedBy || '',
      data.deliveredBy || '',
      data.cancelledBy || '',
      updatedAt
    ]]);
  });
}

function replaceOrderRows(sheet, data, customer, items) {
  if (!Array.isArray(items) || items.length < 1) throw new Error('Order items are missing.');
  const matchingRows = findOrderRows(sheet, data.orderId);
  const rows = items.map(item => makeOrderRow(data, customer, item));
  const commonCount = Math.min(matchingRows.length, rows.length);
  for (let index = 0; index < commonCount; index++) {
    sheet.getRange(matchingRows[index], 1, 1, ORDER_HEADERS.length).setValues([rows[index]]);
  }
  if (rows.length > matchingRows.length) {
    const newRows = rows.slice(matchingRows.length);
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, ORDER_HEADERS.length).setValues(newRows);
  } else if (matchingRows.length > rows.length) {
    matchingRows.slice(rows.length).sort((a, b) => b - a).forEach(row => sheet.deleteRow(row));
  }
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeCell(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
