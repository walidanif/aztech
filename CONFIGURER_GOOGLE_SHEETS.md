# Google Sheets order setup

The storefront sends submitted orders directly to the configured Google Apps Script web app. It writes each order to the `Commandes` tab in the spreadsheet with ID `1-8IlfZO8Pd17atBKQ7jG5N9AxS17kTTEf1_MCwlUrcU`. The active web app URL is configured in `index.html`.

To point the storefront at a different deployment, replace `GOOGLE_SHEETS_WEB_APP_URL` in `index.html` with that deployment's `/exec` URL. The Apps Script deployment must execute as the spreadsheet owner and allow access to anyone, including people not signed in.

The first received order creates the `Commandes` tab and its column headers. Product IDs and prices are checked in `google_sheets_orders.gs`; keep `ORDER_CATALOG` in sync with the storefront catalogue and confirm the sample listings (IDs 13-23) against actual stock.
