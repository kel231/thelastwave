# The Last Wave (test mode)
Requires Node 18+. No npm install needed.
    node server.js   then open http://localhost:3000
Test payments: Mobile money PIN 1234 (numbers ending 0000 are declined). Bank: any 10-digit account, OTP 123456.
Gate page: http://localhost:3000/#/admin , staff key defaults to "lastwave-admin" (set ADMIN_KEY env var to change).
Prices are in server.js (TICKETS). Set SECRET env var before any real use.
