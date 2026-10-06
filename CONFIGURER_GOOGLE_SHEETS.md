# Google Sheets order setup

The order form uses WhatsApp until a Google Apps Script URL is configured. The included script is already pointed at your spreadsheet ID (`1-8IlfZO8Pd17atBKQ7jG5N9AxS17kTTEf1_MCwlUrcU`). After setup, it writes each order to the `Commandes` tab.

1. Open or create the Google Sheet that should receive orders.
2. In the sheet, choose **Extensions > Apps Script**.
3. Replace the contents of `Code.gs` with `google_sheets_orders.gs` and save.
4. Choose **Deploy > New deployment > Web app**.
5. Set **Execute as: Me** and access to **Anyone**, including people not signed in, then deploy and authorize.
6. Copy the deployed web app URL ending in `/exec`.
7. Replace `PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` in `electro_salam_e_commerce.html` with that URL.

The first received order creates the `Commandes` tab and its column headers. Product IDs and prices are also checked in the script. The added listings and prices (IDs 13-23) are examples; confirm them against actual stock before publishing.
