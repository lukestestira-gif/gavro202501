const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Load local .env without adding a dependency. Netlify reads its own environment variables.
const localEnvFile = path.join(__dirname, '.env');
if (fs.existsSync(localEnvFile)) {
  for (const line of fs.readFileSync(localEnvFile, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const split = value.indexOf('=');
    if (split < 1) continue;
    const key = value.slice(0, split).trim();
    const val = value.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'GavroStart!ChangeMe';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const sessions = new Map();

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = {
      settings: {
        salonName: 'GAVRO BARBER',
        heroTitle: 'Stil koji ostavlja utisak.',
        heroSubtitle: 'Premium šišanje, fade, brada i kompletan barber tretman. Zakaži svoj termin za manje od minuta.',
        phone: '',
        address: '',
        instagram: 'https://www.instagram.com/hairstyle_by_gavro/',
        accent: '#84b5f5',
        currency: 'RSD',
        openingHours: 'Pon–Sub 09:00–20:00 · Nedelja zatvoreno',
        aboutTitle: 'Nije samo šišanje. To je tvoj ritual.',
        aboutText: 'GAVRO je barber studio posvećen preciznom šišanju, čistim linijama i detaljima. Izaberi svoj stil i rezerviši termin bez nepotrebnog čekanja.', appTitle: 'GAVRO u džepu.', appText: 'Sačuvaj GAVRO na početnom ekranu telefona i zakaži termin bez traženja linka.'
      },
      services: [
        { id: 'svc_fade', name: 'Fade', description: 'Precizan prelaz i završni styling.', duration: 40, price: 1200, cost: 0, active: true },
        { id: 'svc_beard', name: 'Uređivanje brade', description: 'Oblikovanje brade i precizne konture.', duration: 20, price: 600, cost: 0, active: true }
      ],
      barbers: [
        { id: 'barber_gavro', name: 'Gavro', role: 'Barber', initials: 'G', color: '#84b5f5', workStart:'09:00', workEnd:'20:00', workDays:[1,2,3,4,5,6], photo:'', bio:'Precizno šišanje, fade i detaljan završni styling.', active: true }
      ],
      bookings: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}
function readDb() {
  ensureData();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.settings = db.settings || {};
  db.services = Array.isArray(db.services) ? db.services : [];
  db.barbers = Array.isArray(db.barbers) ? db.barbers : [];
  db.bookings = Array.isArray(db.bookings) ? db.bookings : [];
  db.gallery = Array.isArray(db.gallery) ? db.gallery : [];
  db.settings.heroImage = db.settings.heroImage || '';
  db.settings.appTitle = db.settings.appTitle || 'GAVRO u džepu.';
  db.settings.appText = db.settings.appText || 'Sačuvaj GAVRO na početnom ekranu telefona i zakaži termin bez traženja linka.';
  db.barbers = db.barbers.map(b => ({ photo:'', bio:'', ...b }));
  return db;
}
function writeDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
function json(res, status, obj, headers = {}) { send(res, status, obj, headers); }
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return [decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))];
  }));
}
function getSession(req) {
  const sid = parseCookies(req).sid;
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(sid); return null; }
  s.expires = Date.now() + SESSION_TTL_MS;
  return s;
}
function requireAdmin(req, res) {
  if (!getSession(req)) { json(res, 401, { error: 'Niste prijavljeni.' }); return false; }
  return true;
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Prevelik zahtev')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Neispravan JSON')); }
    });
    req.on('error', reject);
  });
}
function safeText(v, max = 200) { return String(v ?? '').trim().slice(0, max); }
function number(v, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function publicData(db) {
  return { settings: db.settings, services: db.services.filter(x => x.active), barbers: db.barbers.filter(x => x.active), gallery: db.gallery.filter(x => x.active) };
}
function dayKey(iso) { return String(iso || '').slice(0, 10); }
function toMinutes(hhmm) { const [h,m] = String(hhmm).split(':').map(Number); return h * 60 + m; }
function overlaps(startA, durationA, startB, durationB) { const a=toMinutes(startA), b=toMinutes(startB); return a < b + Number(durationB || 30) && b < a + Number(durationA || 30); }
function dateWeekday(iso) { const [y,m,d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); }
function barberWorksOn(barber, date) { const days = Array.isArray(barber.workDays) && barber.workDays.length ? barber.workDays.map(Number) : [1,2,3,4,5,6]; return days.includes(dateWeekday(date)); }
function slotFitsShift(barber, date, time, duration) { if (!barber || !barber.active || !barberWorksOn(barber,date)) return false; const start=toMinutes(time), shiftStart=toMinutes(barber.workStart||'09:00'), shiftEnd=toMinutes(barber.workEnd||'20:00'); return start >= shiftStart && start + Number(duration||30) <= shiftEnd; }
function isBarberFree(db, barber, date, time, duration, ignoreId='') { return slotFitsShift(barber,date,time,duration) && !db.bookings.some(b => b.id!==ignoreId && b.date===date && b.barberId===barber.id && b.status!=='cancelled' && overlaps(time,duration,b.time,b.duration)); }
function clientClock(offsetValue) { const offset=Math.max(-840,Math.min(840,Number(offsetValue)||0)); const d=new Date(Date.now()-offset*60000); return { date:d.toISOString().slice(0,10), minutes:d.getUTCHours()*60+d.getUTCMinutes() }; }
function metrics(db) {
  const today = new Date().toISOString().slice(0,10);
  const month = today.slice(0,7);
  const completed = db.bookings.filter(b => b.status === 'completed');
  const revenue = completed.reduce((s,b) => s + Number(b.price || 0), 0);
  const profit = completed.reduce((s,b) => s + Number(b.price || 0) - Number(b.cost || 0), 0);
  const monthCompleted = completed.filter(b => String(b.date).startsWith(month));
  const monthRevenue = monthCompleted.reduce((s,b) => s + Number(b.price || 0), 0);
  const monthProfit = monthCompleted.reduce((s,b) => s + Number(b.price || 0) - Number(b.cost || 0), 0);
  const upcoming = db.bookings.filter(b => ['pending','confirmed'].includes(b.status) && b.date >= today).length;
  const todayBookings = db.bookings.filter(b => b.date === today && b.status !== 'cancelled').length;
  return { totalBookings: db.bookings.length, todayBookings, upcoming, revenue, profit, monthRevenue, monthProfit };
}
function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.webp':'image/webp'})[ext] || 'application/octet-stream';
}
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const db = readDb();

  if (method === 'GET' && p === '/api/public') return json(res, 200, publicData(db));

  if (method === 'GET' && p === '/api/availability') {
    const date = safeText(url.searchParams.get('date'), 10);
    const barberId = safeText(url.searchParams.get('barberId'), 80);
    const serviceId = safeText(url.searchParams.get('serviceId'), 80);
    const svc = db.services.find(s => s.id === serviceId && s.active);
    const clock=clientClock(url.searchParams.get('tzOffset'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !svc) return json(res, 400, { error: 'Nedostaju podaci.' });
    if (date < clock.date) return json(res, 200, { slots: [] });
    const barbers = barberId === 'any' ? db.barbers.filter(b => b.active) : db.barbers.filter(b => b.id === barberId && b.active);
    if (!barbers.length) return json(res, 200, { slots: [] });
    const minStart = Math.min(...barbers.map(b=>toMinutes(b.workStart||'09:00')));
    const maxEnd = Math.max(...barbers.map(b=>toMinutes(b.workEnd||'20:00')));
    const slots=[];
    for (let mins=minStart; mins<maxEnd; mins+=15) {
      const time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
      if(date===clock.date && mins < clock.minutes + 15) continue;
      const available = barbers.filter(b=>isBarberFree(db,b,date,time,svc.duration));
      if (available.length) slots.push({ time, barberIds: available.map(b=>b.id) });
    }
    return json(res, 200, { slots });
  }

  if (method === 'POST' && p === '/api/bookings') {
    const body = await readBody(req);
    const service = db.services.find(s => s.id === safeText(body.serviceId, 80) && s.active);
    let barber = body.barberId === 'any' ? null : db.barbers.find(b => b.id === safeText(body.barberId,80) && b.active);
    const date = safeText(body.date,10), time = safeText(body.time,5);
    const clock=clientClock(body.tzOffset);
    const name = safeText(body.name,100), phone = safeText(body.phone,50), note = safeText(body.note,400);
    if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || name.length < 2 || phone.length < 5) return json(res,400,{error:'Popunite sva obavezna polja.'});
    if (date < clock.date) return json(res,400,{error:'Datum mora biti danas ili u budućnosti.'});
    if (toMinutes(time)%15!==0) return json(res,400,{error:'Termin mora biti na 15 minuta.'});
    if (date===clock.date && toMinutes(time) < clock.minutes + 15) return json(res,400,{error:'Izaberite termin koji još nije počeo.'});
    if (!barber) {
      const candidates = db.barbers.filter(b=>b.active);
      barber = candidates.find(b => isBarberFree(db,b,date,time,service.duration));
    }
    if (!barber || !slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu. Izaberite drugi termin.'});
    if (!isBarberFree(db,barber,date,time,service.duration)) return json(res,409,{error:'Termin je upravo zauzet. Izaberite drugi.'});
    const cancelToken = crypto.randomBytes(32).toString('hex');
    const booking = { id:id('bk'), createdAt:nowIso(), name, phone, note, serviceId:service.id, serviceName:service.name, barberId:barber.id, barberName:barber.name, date, time, duration:service.duration, price:service.price, cost:Number(service.cost||0), status:'pending', cancelTokenHash:tokenHash(cancelToken) };
    db.bookings.push(booking); writeDb(db);
    const { cancelTokenHash, ...publicBooking } = booking;
    return json(res,201,{ ok:true, booking:publicBooking, cancelToken });
  }

  if (method === 'POST' && p === '/api/my-bookings') {
    const body = await readBody(req);
    const entries = Array.isArray(body.bookings) ? body.bookings.slice(0,30) : [];
    const found = entries.map(entry => {
      const booking = db.bookings.find(b => b.id === safeText(entry.id,100) && b.cancelTokenHash && b.cancelTokenHash === tokenHash(entry.token));
      if (!booking) return null;
      const { cancelTokenHash, ...safeBooking } = booking;
      return safeBooking;
    }).filter(Boolean).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    return json(res,200,{bookings:found});
  }

  if (method === 'POST' && /^\/api\/bookings\/[^/]+\/cancel$/.test(p)) {
    const bookingId = p.split('/')[3];
    const body = await readBody(req);
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking || !booking.cancelTokenHash || booking.cancelTokenHash !== tokenHash(body.token)) return json(res,404,{error:'Rezervacija nije pronađena ili link za upravljanje nije važeći.'});
    if (!['pending','confirmed'].includes(booking.status)) return json(res,409,{error:'Ovaj termin više ne može da se otkaže.'});
    const clock = clientClock(body.tzOffset);
    if (booking.date < clock.date || (booking.date === clock.date && toMinutes(booking.time) <= clock.minutes)) return json(res,409,{error:'Termin koji je već počeo ne može da se otkaže online.'});
    booking.status='cancelled'; booking.cancelledAt=nowIso(); writeDb(db);
    const { cancelTokenHash, ...safeBooking } = booking;
    return json(res,200,{ok:true,booking:safeBooking});
  }

  if (method === 'POST' && p === '/api/admin/login') {
    const body = await readBody(req);
    const u = safeText(body.username,100), pass = String(body.password || '');
    const goodUser = crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(u).digest('hex')), Buffer.from(crypto.createHash('sha256').update(ADMIN_USER).digest('hex')));
    const goodPass = crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(pass).digest('hex')), Buffer.from(crypto.createHash('sha256').update(ADMIN_PASS).digest('hex')));
    if (!goodUser || !goodPass) return json(res,401,{error:'Pogrešan username ili lozinka.'});
    const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid,{ user:u, expires:Date.now()+SESSION_TTL_MS });
    return json(res,200,{ok:true},{'Set-Cookie':`sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS/1000}`});
  }
  if (method === 'POST' && p === '/api/admin/logout') {
    const sid = parseCookies(req).sid; if (sid) sessions.delete(sid);
    return json(res,200,{ok:true},{'Set-Cookie':'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
  }
  if (method === 'GET' && p === '/api/admin/session') return json(res,200,{authenticated:!!getSession(req)});

  if (p.startsWith('/api/admin/') && !requireAdmin(req,res)) return;

  if (method === 'GET' && p === '/api/admin/dashboard') {
    return json(res,200,{ metrics:metrics(db), bookings:[...db.bookings].map(({cancelTokenHash,...b})=>b).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)), settings:db.settings, services:db.services, barbers:db.barbers, gallery:db.gallery });
  }
  if (method === 'PUT' && p === '/api/admin/settings') {
    const body = await readBody(req);
    db.settings = {
      ...db.settings,
      salonName:safeText(body.salonName,80), heroTitle:safeText(body.heroTitle,120), heroSubtitle:safeText(body.heroSubtitle,300),
      phone:safeText(body.phone,60), address:safeText(body.address,120), instagram:safeText(body.instagram,80),
      accent:/^#[0-9a-fA-F]{6}$/.test(String(body.accent)) ? body.accent : db.settings.accent,
      currency:safeText(body.currency,10)||'RSD', openingHours:safeText(body.openingHours,160), aboutTitle:safeText(body.aboutTitle,120), aboutText:safeText(body.aboutText,500),
      heroImage:safeText(body.heroImage ?? db.settings.heroImage,500), appTitle:safeText(body.appTitle ?? db.settings.appTitle,120), appText:safeText(body.appText ?? db.settings.appText,400)
    };
    writeDb(db); return json(res,200,{ok:true,settings:db.settings});
  }
  if (method === 'POST' && p === '/api/admin/services') {
    const b=await readBody(req); const service={id:id('svc'),name:safeText(b.name,80),description:safeText(b.description,200),duration:number(b.duration,15,240),price:number(b.price,0,1000000),cost:number(b.cost,0,1000000),active:b.active!==false};
    if(!service.name) return json(res,400,{error:'Naziv usluge je obavezan.'}); db.services.push(service); writeDb(db); return json(res,201,{ok:true,service});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/services/')) {
    const sid=p.split('/').pop(); const i=db.services.findIndex(x=>x.id===sid); if(i<0)return json(res,404,{error:'Usluga nije pronađena.'}); const b=await readBody(req);
    db.services[i]={...db.services[i],name:safeText(b.name,80),description:safeText(b.description,200),duration:number(b.duration,15,240),price:number(b.price,0,1000000),cost:number(b.cost,0,1000000),active:!!b.active}; writeDb(db); return json(res,200,{ok:true,service:db.services[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/services/')) { const sid=p.split('/').pop(); db.services=db.services.filter(x=>x.id!==sid); writeDb(db); return json(res,200,{ok:true}); }

  if (method === 'POST' && p === '/api/admin/barbers') {
    const b=await readBody(req); const name=safeText(b.name,80); if(!name)return json(res,400,{error:'Ime barbera je obavezno.'}); const barber={id:id('barber'),name,role:safeText(b.role,80)||'Barber',initials:safeText(b.initials,3).toUpperCase()||name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),color:/^#[0-9a-fA-F]{6}$/.test(String(b.color))?b.color:'#d8a45d',workStart:/^\d{2}:\d{2}$/.test(String(b.workStart))?b.workStart:'09:00',workEnd:/^\d{2}:\d{2}$/.test(String(b.workEnd))?b.workEnd:'20:00',workDays:Array.isArray(b.workDays)?b.workDays.map(Number).filter(x=>x>=0&&x<=6):[1,2,3,4,5,6],photo:safeText(b.photo,500),bio:safeText(b.bio,300),active:b.active!==false}; db.barbers.push(barber); writeDb(db); return json(res,201,{ok:true,barber});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/barbers/')) {
    const bid=p.split('/').pop(); const i=db.barbers.findIndex(x=>x.id===bid); if(i<0)return json(res,404,{error:'Barber nije pronađen.'}); const b=await readBody(req); db.barbers[i]={...db.barbers[i],name:safeText(b.name,80),role:safeText(b.role,80),initials:safeText(b.initials,3).toUpperCase(),color:/^#[0-9a-fA-F]{6}$/.test(String(b.color))?b.color:(db.barbers[i].color||'#d8a45d'),workStart:/^\d{2}:\d{2}$/.test(String(b.workStart))?b.workStart:(db.barbers[i].workStart||'09:00'),workEnd:/^\d{2}:\d{2}$/.test(String(b.workEnd))?b.workEnd:(db.barbers[i].workEnd||'20:00'),workDays:Array.isArray(b.workDays)?b.workDays.map(Number).filter(x=>x>=0&&x<=6):(db.barbers[i].workDays||[1,2,3,4,5,6]),photo:safeText(b.photo ?? db.barbers[i].photo,500),bio:safeText(b.bio ?? db.barbers[i].bio,300),active:!!b.active}; writeDb(db); return json(res,200,{ok:true,barber:db.barbers[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/barbers/')) { const bid=p.split('/').pop(); db.barbers=db.barbers.filter(x=>x.id!==bid); writeDb(db); return json(res,200,{ok:true}); }

  if (method === 'POST' && p === '/api/admin/upload') {
    const b = await readBody(req, 12 * 1024 * 1024);
    const raw = String(b.data || '');
    const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res,400,{error:'Podržane su JPG, PNG i WEBP slike.'});
    const buf = Buffer.from(match[2], 'base64');
    if (!buf.length || buf.length > 4 * 1024 * 1024) return json(res,400,{error:'Slika mora biti manja od 4 MB.'});
    const ext = match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg';
    const uploadDir = path.join(PUBLIC_DIR,'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
    const filename = `${id('photo')}${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buf);
    return json(res,201,{ok:true,url:`/uploads/${filename}`});
  }

  if (method === 'POST' && p === '/api/admin/gallery') {
    const b=await readBody(req); const image=safeText(b.image,500);
    if(!image)return json(res,400,{error:'Dodajte sliku.'});
    const item={id:id('gal'),title:safeText(b.title,100)||'Naš rad',caption:safeText(b.caption,220),image,barberId:safeText(b.barberId,80),active:b.active!==false};
    db.gallery.push(item); writeDb(db); return json(res,201,{ok:true,item});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/gallery/')) {
    const gid=p.split('/').pop(); const i=db.gallery.findIndex(x=>x.id===gid); if(i<0)return json(res,404,{error:'Slika nije pronađena.'});
    const b=await readBody(req); db.gallery[i]={...db.gallery[i],title:safeText(b.title,100)||db.gallery[i].title,caption:safeText(b.caption,220),image:safeText(b.image||db.gallery[i].image,500),barberId:safeText(b.barberId,80),active:!!b.active};
    writeDb(db); return json(res,200,{ok:true,item:db.gallery[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/gallery/')) {
    const gid=p.split('/').pop(); db.gallery=db.gallery.filter(x=>x.id!==gid); writeDb(db); return json(res,200,{ok:true});
  }

  if (method === 'POST' && p === '/api/admin/bookings') {
    const b=await readBody(req); const service=db.services.find(x=>x.id===safeText(b.serviceId,80)); const barber=db.barbers.find(x=>x.id===safeText(b.barberId,80));
    const name=safeText(b.name,100), phone=safeText(b.phone,50), date=safeText(b.date,10), time=safeText(b.time,5), note=safeText(b.note,400); const allowed=['pending','confirmed','completed','cancelled']; const status=allowed.includes(b.status)?b.status:'confirmed';
    if(!service||!barber||name.length<2||phone.length<3||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)) return json(res,400,{error:'Popunite sve podatke za termin.'});
    if(status!=='cancelled' && !slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu.'}); if(status!=='cancelled' && !isBarberFree(db,barber,date,time,service.duration)) return json(res,409,{error:'Barber već ima termin u tom periodu.'});
    const booking={id:id('bk'),createdAt:nowIso(),name,phone,note,serviceId:service.id,serviceName:service.name,barberId:barber.id,barberName:barber.name,date,time,duration:service.duration,price:service.price,cost:Number(service.cost||0),status}; db.bookings.push(booking); writeDb(db); return json(res,201,{ok:true,booking});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/bookings/')) {
    const bid=p.split('/').pop(); const i=db.bookings.findIndex(x=>x.id===bid); if(i<0)return json(res,404,{error:'Zakazivanje nije pronađeno.'}); const b=await readBody(req); const current=db.bookings[i]; const allowed=['pending','confirmed','completed','cancelled'];
    const service=db.services.find(x=>x.id===safeText(b.serviceId||current.serviceId,80)); const barber=db.barbers.find(x=>x.id===safeText(b.barberId||current.barberId,80)); const date=/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))?b.date:current.date; const time=/^\d{2}:\d{2}$/.test(String(b.time))?b.time:current.time; const status=allowed.includes(b.status)?b.status:current.status;
    if(!service||!barber)return json(res,400,{error:'Barber ili usluga ne postoje.'}); if(status!=='cancelled'&&!slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu.'}); if(status!=='cancelled'&&!isBarberFree(db,barber,date,time,service.duration,current.id))return json(res,409,{error:'Barber već ima termin u tom periodu.'});
    db.bookings[i]={...current,name:safeText(b.name||current.name,100),phone:safeText(b.phone||current.phone,50),note:safeText(b.note??current.note,400),serviceId:service.id,serviceName:service.name,barberId:barber.id,barberName:barber.name,date,time,duration:service.duration,price:service.price,cost:Number(service.cost||0),status}; writeDb(db); return json(res,200,{ok:true,booking:db.bookings[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/bookings/')) { const bid=p.split('/').pop(); db.bookings=db.bookings.filter(x=>x.id!==bid); writeDb(db); return json(res,200,{ok:true}); }

  return json(res,404,{error:'Ruta nije pronađena.'});
}

ensureData();
const server = http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
    if(url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    if (url.pathname === '/admin') { req.url='/admin.html'; return serveStatic(req,res,'/admin.html') || send(res,404,'Not found'); }
    if(serveStatic(req,res,url.pathname)) return;
    send(res,404,'Not found');
  } catch(err) { console.error(err); if(!res.headersSent) json(res,500,{error:'Greška na serveru.'}); else res.end(); }
});
server.listen(PORT,HOST,()=>console.log(`Barber site: http://localhost:${PORT} | Admin: http://localhost:${PORT}/admin`));
