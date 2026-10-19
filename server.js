// The Last Wave: backend (no npm install needed, Node 18+). Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, DB = path.join(__dirname, 'data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'lastwave-admin'; // staff key for the gate page
const SECRET = process.env.SECRET || 'dev-only-secret';
const load = () => fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : { users: [], orders: [] };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

// Ticket prices in USD (change freely)
const TICKETS = [
  { id: 'early', name: 'Early Wave', price: 15, perks: 'General beach access, all stages' },
  { id: 'general', name: 'General', price: 25, perks: 'General beach access, all stages' },
  { id: 'vip', name: 'VIP Shoreline', price: 60, perks: 'Front-stage zone, VIP bar, fast entry' },
  { id: 'cabana', name: 'Cabana (4 people)', price: 220, perks: 'Private cabana, bottle service, VIP for 4' },
];
const MOMO = { orange: 'Orange Money', mtn: 'MTN MoMo' };
const BANKS = ['Ecobank Liberia', 'GTBank Liberia', 'UBA Liberia', 'Access Bank Liberia'];

const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const sign = id => { const b = Buffer.from(JSON.stringify({ id, exp: Date.now() + 6048e5 })).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = t => { try { const [b, s] = t.split('.');
  if (s !== crypto.createHmac('sha256', SECRET).update(b).digest('base64url')) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p.id : null; } catch { return null; } };
const code = () => 'LW-' + crypto.randomBytes(4).toString('hex').toUpperCase();

function pay(b) { // TEST MODE ONLY: no real money moves
  if (b.method === 'momo') {
    if (!MOMO[b.provider]) return 'Choose Orange Money or MTN MoMo.';
    if (!/^\d{9,10}$/.test(b.phone || '')) return 'Enter a valid mobile number (9-10 digits).';
    if (b.phone.endsWith('0000')) return 'Declined: insufficient funds (test number).';
    if (b.pin !== '1234') return 'Declined: wrong PIN. In test mode use 1234.';
  } else if (b.method === 'bank') {
    if (!BANKS.includes(b.bank)) return 'Choose a bank.';
    if (!/^\d{10}$/.test(b.account || '')) return 'Enter a 10-digit account number.';
    if (b.otp !== '123456') return 'Declined: wrong OTP. In test mode use 123456.';
  } else return 'Choose a payment method.';
  return null;
}

const MIME = { '.html': 'text/html', '.jpg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript' };
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) { // static files
    const f = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    return fs.createReadStream(f).pipe(res);
  }
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: 'Bad JSON' }); }
    const db = load(), route = req.method + ' ' + url.pathname;
    if (route === 'GET /api/config') return send(res, 200, { tickets: TICKETS, momo: MOMO, banks: BANKS, testMode: true });
    if (url.pathname.startsWith('/api/admin/')) { // gate staff only
      if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 401, { error: 'Wrong staff key.' });
      const all = db.orders.flatMap(o => o.lines.map(l => ({ o, l })));
      if (route === 'GET /api/admin/stats') {
        const sold = all.reduce((s, x) => s + x.l.codes.length, 0), used = all.reduce((s, x) => s + Object.keys(x.l.used || {}).length, 0);
        return send(res, 200, { sold, admitted: used, remaining: sold - used });
      }
      if (route === 'POST /api/admin/scan') {
        const c = String(b.code || '').trim().toUpperCase(), hit = all.find(x => x.l.codes.includes(c));
        if (!hit) return send(res, 200, { status: 'invalid', code: c });
        const u = db.users.find(x => x.id === hit.o.userId), info = { code: c, ticket: hit.l.name, holder: u ? u.name : 'Unknown', order: hit.o.id };
        hit.l.used = hit.l.used || {};
        if (hit.l.used[c]) return send(res, 200, { status: 'used', usedAt: hit.l.used[c], ...info });
        if (b.admit) { hit.l.used[c] = new Date().toISOString(); save(db); return send(res, 200, { status: 'admitted', ...info }); }
        return send(res, 200, { status: 'valid', ...info });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (route === 'POST /api/signup') {
      const email = (b.email || '').trim().toLowerCase();
      if (!b.name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter your name and a valid email.' });
      if ((b.password || '').length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (db.users.some(u => u.email === email)) return send(res, 409, { error: 'That email already has an account. Log in instead.' });
      const salt = crypto.randomBytes(8).toString('hex');
      const u = { id: crypto.randomUUID(), name: b.name.trim(), email, salt, pw: hash(b.password, salt) };
      db.users.push(u); save(db); return send(res, 200, { token: sign(u.id), user: { name: u.name, email } });
    }
    if (route === 'POST /api/login') {
      const u = db.users.find(x => x.email === (b.email || '').trim().toLowerCase());
      if (!u || hash(b.password || '', u.salt) !== u.pw) return send(res, 401, { error: 'Wrong email or password.' });
      return send(res, 200, { token: sign(u.id), user: { name: u.name, email: u.email } });
    }
    const uid = verify((req.headers.authorization || '').replace('Bearer ', ''));
    const user = db.users.find(u => u.id === uid);
    if (!user) return send(res, 401, { error: 'Please log in first.' });
    if (route === 'GET /api/orders') return send(res, 200, db.orders.filter(o => o.userId === uid));
    if (route === 'POST /api/checkout') {
      const items = (b.items || []).filter(i => i.qty > 0 && TICKETS.some(t => t.id === i.id));
      if (!items.length) return send(res, 400, { error: 'Pick at least one ticket.' });
      const err = pay(b); if (err) return send(res, 402, { error: err });
      const lines = items.map(i => { const t = TICKETS.find(x => x.id === i.id), q = Math.min(10, i.qty | 0);
        return { id: t.id, name: t.name, qty: q, price: t.price, codes: Array.from({ length: q }, code) }; });
      const o = { id: 'ORD-' + crypto.randomBytes(3).toString('hex').toUpperCase(), userId: uid, lines,
        total: lines.reduce((s, l) => s + l.price * l.qty, 0), method: b.method === 'momo' ? MOMO[b.provider] : b.bank,
        test: true, at: new Date().toISOString() };
      db.orders.push(o); save(db); return send(res, 200, o);
    }
    send(res, 404, { error: 'Not found' });
  });
}).listen(PORT, () => console.log('The Last Wave running: http://localhost:' + PORT + ' (TEST MODE)'));
