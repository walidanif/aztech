# Google Sheets order setup

The storefront sends submitted orders to its `/api/orders` endpoint, which forwards them to the Google Apps Script web app and only confirms success after receiving `OK`. Orders are written to the `Commandes` tab in the spreadsheet with ID `1-8IlfZO8Pd17atBKQ7jG5N9AxS17kTTEf1_MCwlUrcU`. Each product is recorded on its own row with the customer's name, product, quantity, unit price, and line total. A combined `Nom complet` column is added after the existing columns.

After changing `google_sheets_orders.gs`, paste the whole file into the Apps Script project's `Code.gs`, save, then open **Deploy > Manage deployments > Edit**, select **New version**, and deploy. The live deployment should answer `AZ TECH orders endpoint is ready.` when opened with GET. It must execute as the spreadsheet owner and allow access to anyone, including people not signed in. If it redirects to Google sign-in, the storefront displays an error instead of falsely reporting that the order was sent. To use a different deployment, update `GOOGLE_SHEETS_WEB_APP_URL` in `server.js`.

The first received order creates the `Commandes` tab and its column headers. Product IDs and prices are checked in `google_sheets_orders.gs`; keep `ORDER_CATALOG` in sync with the storefront catalogue and confirm the sample listings (IDs 13-23) against actual stock.
