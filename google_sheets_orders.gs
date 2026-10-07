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
  'Quantité', 'ARTICLE', 'Prix unitaire (DH)', 'Total (DH)'
];

// Keep these IDs and prices in sync with the products array in the HTML file.
// IDs 13-23 were added as sample listings; confirm their prices against real stock.
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
  23: { title: 'LG UHD 50 pouces', price: 5499 }
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
    const firstName = cleanText(data.firstName || data.prenom || data.first_name, 80);
    const lastName = cleanText(data.lastName || data.nom || data.last_name, 80);
    const phone = cleanText(data.phone || data.telephone || data.mobile, 24);
    const address = cleanText(data.address || data.adresse, 500);
    const requestedItems = Array.isArray(data.items)
      ? data.items
      : [{
          productId: data.productId,
          product: data.product || data.article,
          unitPrice: data.unitPrice,
          quantity: data.quantity
        }];

    if (!firstName || !lastName || !address || !/^\+?[0-9 ()\-]{8,24}$/.test(phone)) {
      throw new Error('Missing or invalid customer details.');
    }
    if (requestedItems.length < 1 || requestedItems.length > 50) {
      throw new Error('The order must contain between 1 and 50 products.');
    }
    const orderItems = requestedItems.map(item => {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      const product = ORDER_CATALOG[productId];
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new Error('Unknown product or invalid quantity.');
      }
      const title = cleanText(item.product || item.title || (product && product.title), 160);
      const price = product ? product.price : Number(item.unitPrice);
      if (!title || !Number.isFinite(price) || price < 0) {
        throw new Error('Product name or price is missing.');
      }
      return { quantity, title, price };
    });

    lock.waitLock(10000);
    const spreadsheet = SpreadsheetApp.openById(ORDERS_SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(ORDERS_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(ORDERS_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(ORDER_HEADERS);
      sheet.setFrozenRows(1);
    } else {
      if (!sheet.getRange(1, 7).getValue()) {
        sheet.getRange(1, 7).setValue(ORDER_HEADERS[6]);
      }
      if (!sheet.getRange(1, 8).getValue()) {
        sheet.getRange(1, 8).setValue(ORDER_HEADERS[7]);
      }
    }

    const rows = orderItems.map(({ quantity, title, price }) => [
      safeCell(firstName),
      safeCell(lastName),
      safeCell(phone),
      safeCell(address),
      quantity,
      safeCell(title),
      price,
      price * quantity
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);

    return ContentService.createTextOutput('OK');
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput('ERROR: ' + error.message);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
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
