/**
 * Google Apps Script endpoint for AZ TECH order forms.
 * Paste this file into the Apps Script project attached to your orders spreadsheet.
 * Deploy it as a Web App (execute as you; access: anyone), then paste the /exec URL
 * into GOOGLE_SHEETS_WEB_APP_URL in server.js.
 */

const ORDERS_SHEET_NAME = 'Commandes';
const ORDERS_SPREADSHEET_ID = '1-8IlfZO8Pd17atBKQ7jG5N9AxS17kTTEf1_MCwlUrcU';
const ORDER_HEADERS = [
  'Référence', 'Date de réception', 'Prénom', 'Nom', 'Téléphone',
  'Adresse de livraison', 'ID produit', 'Produit', 'Quantité',
  'Prix unitaire (DH)', 'Total (DH)', 'Devise', 'Nom complet'
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
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const firstName = cleanText(data.firstName, 80);
    const lastName = cleanText(data.lastName, 80);
    const phone = cleanText(data.phone, 24);
    const address = cleanText(data.address, 500);
    const requestedItems = Array.isArray(data.items)
      ? data.items
      : [{ productId: data.productId, quantity: data.quantity }];

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
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new Error('Unknown product or invalid quantity.');
      }
      return { productId, quantity, product };
    });

    const spreadsheet = SpreadsheetApp.openById(ORDERS_SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(ORDERS_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(ORDERS_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(ORDER_HEADERS);
      sheet.setFrozenRows(1);
    } else if (!sheet.getRange(1, ORDER_HEADERS.length).getValue()) {
      sheet.getRange(1, ORDER_HEADERS.length).setValue('Nom complet');
    }

    const reference = Utilities.getUuid();
    const receivedAt = new Date();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const rows = orderItems.map(({ productId, quantity, product }) => [
      reference,
      receivedAt,
      safeCell(firstName),
      safeCell(lastName),
      safeCell(phone),
      safeCell(address),
      productId,
      product.title,
      quantity,
      product.price,
      product.price * quantity,
      'MAD',
      safeCell(fullName)
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);

    return ContentService.createTextOutput('OK');
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput('ERROR: ' + error.message);
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
