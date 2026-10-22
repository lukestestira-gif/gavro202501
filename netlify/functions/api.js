const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'gavro-uploads';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const DEFAULT_SETTINGS = {
  salonName: 'GAVRO BARBER',
  heroTitle: 'Dobar fade se vidi. Dobar barber se pamti.',
  heroSubtitle: 'Precizno šišanje, fade i uređivanje brade. Izaberi uslugu, pogledaj slobodne termine i rezerviši online.',
  phone: '',
  address: '',
  instagram: 'https://www.instagram.com/hairstyle_by_gavro/',
  accent: '#84b5f5',
  currency: 'RSD',
  openingHours: 'Pon–Sub 09:00–20:00 · Nedelja zatvoreno',
  aboutTitle: 'Nije samo šišanje. To je tvoj ritual.',
  aboutText: 'GAVRO je barber studio posvećen preciznom šišanju, čistim linijama i detaljima. Izaberi svoj stil i rezerviši termin bez nepotrebnog čekanja.',
  appTitle: 'GAVRO u džepu.',
  appText: 'Sačuvaj GAVRO na početnom ekranu telefona i zakaži termin bez traženja linka.',
  heroImage: ''
};

let supabaseClient;
function supabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase nije podešen. Dodaj SUPABASE_URL i SUPABASE_SECRET_KEY (ili SUPABASE_SERVICE_ROLE_KEY) u Netlify environment variables.');
  supabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return supabaseClient;
}

function json(statusCode, data, headers = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(data) };
}
function safeText(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function number(value, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function toMinutes(value) { const [h, m] = String(value || '00:00').slice(0, 5).split(':').map(Number); return h * 60 + m; }
function timeText(value) { return String(value || '').slice(0, 5); }
function overlaps(startA, durationA, startB, durationB) { const a = toMinutes(startA), b = toMinutes(startB); return a < b + Number(durationB || 30) && b < a + Number(durationA || 30); }
function dateWeekday(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); }
function barberWorksOn(barber, date) { const days = Array.isArray(barber.workDays) && barber.workDays.length ? barber.workDays.map(Number) : [1, 2, 3, 4, 5, 6]; return days.includes(dateWeekday(date)); }
function slotFitsShift(barber, date, time, duration) {
  if (!barber || !barber.active || !barberWorksOn(barber, date)) return false;
  const start = toMinutes(time), shiftStart = toMinutes(barber.workStart || '09:00'), shiftEnd = toMinutes(barber.workEnd || '20:00');
  return start >= shiftStart && start + Number(duration || 30) <= shiftEnd;
}
function clientClock(offsetValue) {
  const raw = Number(offsetValue);
  const offset = Number.isFinite(raw) ? Math.max(-840, Math.min(840, raw)) : 0;
  const d = new Date(Date.now() - offset * 60000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function publicBooking(row) {
  if (!row) return null;
  const { cancel_token_hash, cancelled_at, ...rest } = row;
  return {
    id: rest.id, createdAt: rest.created_at || rest.createdAt, name: rest.name, phone: rest.phone, note: rest.note || '',
    serviceId: rest.service_id || rest.serviceId, serviceName: rest.service_name || rest.serviceName,
    barberId: rest.barber_id || rest.barberId, barberName: rest.barber_name || rest.barberName,
    date: rest.booking_date || rest.date, time: timeText(rest.start_time || rest.time), duration: Number(rest.duration || 30),
    price: Number(rest.price || 0), cost: Number(rest.cost || 0), status: rest.status
  };
}
function serviceFromRow(row) { return { id: row.id, name: row.name, description: row.description || '', duration: Number(row.duration), price: Number(row.price), cost: Number(row.cost || 0), active: row.active !== false, sortOrder: Number(row.sort_order || 0) }; }
function barberFromRow(row) { return { id: row.id, name: row.name, role: row.role || 'Barber', initials: row.initials || '', color: row.color || '#84b5f5', workStart: timeText(row.work_start || row.workStart || '09:00'), workEnd: timeText(row.work_end || row.workEnd || '20:00'), workDays: (row.work_days || row.workDays || [1,2,3,4,5,6]).map(Number), photo: row.photo || '', bio: row.bio || '', active: row.active !== false, sortOrder: Number(row.sort_order || 0) }; }
function galleryFromRow(row) { return { id: row.id, title: row.title || '', caption: row.caption || '', image: row.image || '', barberId: row.barber_id || row.barberId || '', active: row.active !== false, sortOrder: Number(row.sort_order || 0) }; }
function serviceToRow(s, index = 0) { return { id: s.id, name: safeText(s.name, 80), description: safeText(s.description, 200), duration: number(s.duration, 15, 240), price: number(s.price, 0, 1000000), cost: number(s.cost, 0, 1000000), active: s.active !== false, sort_order: Number(s.sortOrder ?? index) || 0 }; }
function barberToRow(b, index = 0) { return { id: b.id, name: safeText(b.name, 80), role: safeText(b.role, 80) || 'Barber', initials: safeText(b.initials, 3).toUpperCase() || safeText(b.name, 80).split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(), color: /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? b.color : '#84b5f5', work_start: /^\d{2}:\d{2}$/.test(String(b.workStart)) ? b.workStart : '09:00', work_end: /^\d{2}:\d{2}$/.test(String(b.workEnd)) ? b.workEnd : '20:00', work_days: Array.isArray(b.workDays) ? b.workDays.map(Number).filter(x => x >= 0 && x <= 6) : [1,2,3,4,5,6], photo: safeText(b.photo, 1000), bio: safeText(b.bio, 300), active: b.active !== false, sort_order: Number(b.sortOrder ?? index) || 0 }; }
function galleryToRow(g, index = 0) { return { id: g.id, title: safeText(g.title, 100) || 'Naš rad', caption: safeText(g.caption, 220), image: safeText(g.image, 1000), barber_id: safeText(g.barberId, 80) || null, active: g.active !== false, sort_order: Number(g.sortOrder ?? index) || 0 }; }
function bookingToRow(b) { return { id: b.id, created_at: b.createdAt || nowIso(), name: b.name, phone: b.phone, note: b.note || '', service_id: b.serviceId, service_name: b.serviceName, barber_id: b.barberId, barber_name: b.barberName, booking_date: b.date, start_time: b.time, duration: Number(b.duration), price: Number(b.price || 0), cost: Number(b.cost || 0), status: b.status || 'pending', cancel_token_hash: b.cancelTokenHash || null, cancelled_at: b.cancelledAt || null }; }
async function queryOrThrow(query) { const { data, error } = await query; if (error) throw error; return data; }
async function loadDb() {
  const sb = supabase();
  const [settingResult, serviceResult, barberResult, galleryResult, bookingResult] = await Promise.all([
    sb.from('site_settings').select('data').eq('id', 1).maybeSingle(),
    sb.from('services').select('*').order('sort_order', { ascending: true }),
    sb.from('barbers').select('*').order('sort_order', { ascending: true }),
    sb.from('gallery').select('*').order('sort_order', { ascending: true }),
    sb.from('bookings').select('*').order('booking_date', { ascending: false }).order('start_time', { ascending: false })
  ]);
  for (const r of [settingResult, serviceResult, barberResult, galleryResult, bookingResult]) if (r.error) throw r.error;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(settingResult.data?.data || {}) },
    services: (serviceResult.data || []).map(serviceFromRow),
    barbers: (barberResult.data || []).map(barberFromRow),
    gallery: (galleryResult.data || []).map(galleryFromRow),
    bookings: (bookingResult.data || []).map(publicBooking),
    rawBookings: bookingResult.data || []
  };
}
async function getService(idValue, includeInactive = false) {
  const { data, error } = await supabase().from('services').select('*').eq('id', idValue).maybeSingle();
  if (error) throw error;
  if (!data || (!includeInactive && !data.active)) return null;
  return serviceFromRow(data);
}
async function getBarber(idValue, includeInactive = false) {
  const { data, error } = await supabase().from('barbers').select('*').eq('id', idValue).maybeSingle();
  if (error) throw error;
  if (!data || (!includeInactive && !data.active)) return null;
  return barberFromRow(data);
}
async function bookingsForDate(date) {
  const { data, error } = await supabase().from('bookings').select('*').eq('booking_date', date).neq('status', 'cancelled');
  if (error) throw error;
  return (data || []).map(publicBooking);
}
function isBarberFree(barber, bookings, date, time, duration, ignoreId = '') {
  return slotFitsShift(barber, date, time, duration) && !bookings.some(b => b.id !== ignoreId && b.date === date && b.barberId === barber.id && b.status !== 'cancelled' && overlaps(time, duration, b.time, b.duration));
}
function cookieMap(event) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  return Object.fromEntries(cookie.split(';').map(x => x.trim()).filter(Boolean).map(pair => { const i = pair.indexOf('='); return [decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))]; }));
}
function sessionSecret() { return process.env.SESSION_SECRET || ''; }
function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifySession(event) {
  const token = cookieMap(event).gavro_admin;
  if (!token || !sessionSecret()) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return Boolean(data.user && data.exp > Math.floor(Date.now() / 1000)); } catch { return false; }
}
function metrics(db) {
  const today = localToday(), month = today.slice(0, 7);
  const completed = db.bookings.filter(b => b.status === 'completed');
  const revenue = completed.reduce((sum, b) => sum + Number(b.price || 0), 0);
  const profit = completed.reduce((sum, b) => sum + Number(b.price || 0) - Number(b.cost || 0), 0);
  const monthCompleted = completed.filter(b => String(b.date).startsWith(month));
  return { totalBookings: db.bookings.length, todayBookings: db.bookings.filter(b => b.date === today && b.status !== 'cancelled').length, upcoming: db.bookings.filter(b => ['pending', 'confirmed'].includes(b.status) && b.date >= today).length, revenue, profit, monthRevenue: monthCompleted.reduce((sum, b) => sum + Number(b.price || 0), 0), monthProfit: monthCompleted.reduce((sum, b) => sum + Number(b.price || 0) - Number(b.cost || 0), 0) };
}
function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Neispravan JSON zahtev.'), { statusCode: 400 }); }
}
function pathFromEvent(event) {
  let pathname = event.path || '/';
  try { if (event.rawUrl) pathname = new URL(event.rawUrl).pathname; } catch {}
  if (pathname.startsWith('/.netlify/functions/api')) pathname = pathname.slice('/.netlify/functions/api'.length) || '/';
  if (!pathname.startsWith('/api/')) pathname = `/api${pathname === '/' ? '/public' : pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  return pathname;
}
function timeEnd(time, duration) { const n = toMinutes(time) + Number(duration || 0); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
function compareSecret(input, expected) { const a = crypto.createHash('sha256').update(String(input || '')).digest(); const b = crypto.createHash('sha256').update(String(expected || '')).digest(); return crypto.timingSafeEqual(a, b); }

async function route(event, pathname, method, body, query) {
  const sb = supabase();
  if (method === 'GET' && pathname === '/api/public') {
    const db = await loadDb();
    return json(200, { settings: db.settings, services: db.services.filter(x => x.active), barbers: db.barbers.filter(x => x.active), gallery: db.gallery.filter(x => x.active) });
  }

  if (method === 'GET' && pathname === '/api/availability') {
    const date = safeText(query.get('date'), 10), barberId = safeText(query.get('barberId'), 80), serviceId = safeText(query.get('serviceId'), 80);
    const service = await getService(serviceId);
    const clock = clientClock(query.get('tzOffset'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !service) return json(400, { error: 'Nedostaju podaci.' });
    if (date < clock.date) return json(200, { slots: [] });
    let barbers;
    if (barberId === 'any') {
      const { data, error } = await sb.from('barbers').select('*').eq('active', true).order('sort_order', { ascending: true });
      if (error) throw error;
      barbers = (data || []).map(barberFromRow);
    } else {
      const barber = await getBarber(barberId);
      barbers = barber ? [barber] : [];
    }
    if (!barbers.length) return json(200, { slots: [] });
    const bookings = await bookingsForDate(date);
    const minStart = Math.min(...barbers.map(b => toMinutes(b.workStart || '09:00')));
    const maxEnd = Math.max(...barbers.map(b => toMinutes(b.workEnd || '20:00')));
    const slots = [];
    for (let mins = minStart; mins < maxEnd; mins += 15) {
      const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      if (date === clock.date && mins < clock.minutes + 15) continue;
      const available = barbers.filter(b => isBarberFree(b, bookings, date, time, service.duration));
      if (available.length) slots.push({ time, barberIds: available.map(b => b.id) });
    }
    return json(200, { slots });
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    const service = await getService(safeText(body.serviceId, 80));
    const date = safeText(body.date, 10), time = safeText(body.time, 5), clock = clientClock(body.tzOffset);
    const name = safeText(body.name, 100), phone = safeText(body.phone, 50), note = safeText(body.note, 400);
    if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || name.length < 2 || phone.length < 5) return json(400, { error: 'Popunite sva obavezna polja.' });
    if (date < clock.date) return json(400, { error: 'Datum mora biti danas ili u budućnosti.' });
    if (toMinutes(time) % 15 !== 0) return json(400, { error: 'Termin mora biti na 15 minuta.' });
    if (date === clock.date && toMinutes(time) < clock.minutes + 15) return json(400, { error: 'Izaberite termin koji još nije počeo.' });
    let candidates = [];
    if (body.barberId === 'any') {
      const { data, error } = await sb.from('barbers').select('*').eq('active', true).order('sort_order', { ascending: true });
      if (error) throw error;
      candidates = (data || []).map(barberFromRow);
    } else {
      const barber = await getBarber(safeText(body.barberId, 80));
      if (barber) candidates = [barber];
    }
    if (!candidates.length) return json(409, { error: 'Izabrani barber trenutno nije dostupan.' });
    const existing = await bookingsForDate(date);
    const cancelToken = crypto.randomBytes(32).toString('hex');
    let inserted = null;
    let lastConflict = false;
    for (const barber of candidates) {
      if (!isBarberFree(barber, existing, date, time, service.duration)) continue;
      const booking = { id: id('bk'), createdAt: nowIso(), name, phone, note, serviceId: service.id, serviceName: service.name, barberId: barber.id, barberName: barber.name, date, time, duration: service.duration, price: service.price, cost: service.cost, status: 'pending', cancelTokenHash: tokenHash(cancelToken) };
      const { data, error } = await sb.from('bookings').insert(bookingToRow(booking)).select('*').single();
      if (!error) { inserted = publicBooking(data); break; }
      if (error.code === '23P01' || error.code === '23505') { lastConflict = true; continue; }
      throw error;
    }
    if (!inserted) return json(409, { error: lastConflict ? 'Termin je upravo zauzet. Izaberite drugi.' : 'Nema slobodnog termina za izabrano vreme.' });
    return json(201, { ok: true, booking: inserted, cancelToken });
  }

  if (method === 'POST' && pathname === '/api/my-bookings') {
    const entries = Array.isArray(body.bookings) ? body.bookings.slice(0, 30) : [];
    const ids = [...new Set(entries.map(x => safeText(x.id, 100)).filter(Boolean))];
    if (!ids.length) return json(200, { bookings: [] });
    const { data, error } = await sb.from('bookings').select('*').in('id', ids);
    if (error) throw error;
    const tokens = new Map(entries.map(x => [safeText(x.id, 100), tokenHash(x.token)]));
    const result = (data || []).filter(row => row.cancel_token_hash && row.cancel_token_hash === tokens.get(row.id)).map(publicBooking).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return json(200, { bookings: result });
  }

  const cancelMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    const bookingId = decodeURIComponent(cancelMatch[1]);
    const { data: row, error: findError } = await sb.from('bookings').select('*').eq('id', bookingId).maybeSingle();
    if (findError) throw findError;
    if (!row || !row.cancel_token_hash || row.cancel_token_hash !== tokenHash(body.token)) return json(404, { error: 'Rezervacija nije pronađena ili podaci za upravljanje nisu važeći.' });
    if (!['pending', 'confirmed'].includes(row.status)) return json(409, { error: 'Ovaj termin više ne može da se otkaže.' });
    const clock = clientClock(body.tzOffset);
    const date = String(row.booking_date), time = timeText(row.start_time);
    if (date < clock.date || (date === clock.date && toMinutes(time) <= clock.minutes)) return json(409, { error: 'Termin koji je već počeo ne može da se otkaže online.' });
    const { data, error } = await sb.from('bookings').update({ status: 'cancelled', cancelled_at: nowIso() }).eq('id', bookingId).select('*').single();
    if (error) throw error;
    return json(200, { ok: true, booking: publicBooking(data) });
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || '';
    if (!adminPass || !sessionSecret()) return json(503, { error: 'Admin nije podešen. Dodaj ADMIN_PASS i SESSION_SECRET u Netlify environment variables.' });
    const userOk = compareSecret(safeText(body.username, 100), adminUser);
    const passOk = compareSecret(String(body.password || ''), adminPass);
    if (!userOk || !passOk) return json(401, { error: 'Pogrešno korisničko ime ili lozinka.' });
    const token = signSession(adminUser);
    const secure = (event.headers?.['x-forwarded-proto'] || '').includes('https') || Boolean(process.env.URL && process.env.CONTEXT !== 'dev');
    const cookie = `gavro_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
    return json(200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (method === 'POST' && pathname === '/api/admin/logout') {
    const secure = (event.headers?.['x-forwarded-proto'] || '').includes('https') || Boolean(process.env.URL && process.env.CONTEXT !== 'dev');
    return json(200, { ok: true }, { 'Set-Cookie': `gavro_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}` });
  }
  if (method === 'GET' && pathname === '/api/admin/session') return json(200, { authenticated: verifySession(event) });
  if (pathname.startsWith('/api/admin/') && !verifySession(event)) return json(401, { error: 'Niste prijavljeni.' });

  if (method === 'GET' && pathname === '/api/admin/dashboard') {
    const db = await loadDb();
    return json(200, { metrics: metrics(db), bookings: db.bookings, settings: db.settings, services: db.services, barbers: db.barbers, gallery: db.gallery });
  }
  if (method === 'PUT' && pathname === '/api/admin/settings') {
    const db = await loadDb();
    const next = { ...db.settings,
      salonName: safeText(body.salonName, 80) || 'GAVRO BARBER', heroTitle: safeText(body.heroTitle, 120), heroSubtitle: safeText(body.heroSubtitle, 300),
      phone: safeText(body.phone, 60), address: safeText(body.address, 120), instagram: safeText(body.instagram, 300),
      accent: /^#[0-9a-fA-F]{6}$/.test(String(body.accent)) ? body.accent : db.settings.accent,
      currency: safeText(body.currency, 10) || 'RSD', openingHours: safeText(body.openingHours, 160), aboutTitle: safeText(body.aboutTitle, 120), aboutText: safeText(body.aboutText, 500),
      heroImage: safeText(body.heroImage ?? db.settings.heroImage, 1000), appTitle: safeText(body.appTitle ?? db.settings.appTitle, 120), appText: safeText(body.appText ?? db.settings.appText, 400)
    };
    const { error } = await sb.from('site_settings').upsert({ id: 1, data: next, updated_at: nowIso() });
    if (error) throw error;
    return json(200, { ok: true, settings: next });
  }

  if (method === 'POST' && pathname === '/api/admin/services') {
    const service = { id: id('svc'), name: safeText(body.name, 80), description: safeText(body.description, 200), duration: number(body.duration, 15, 240), price: number(body.price, 0, 1000000), cost: number(body.cost, 0, 1000000), active: body.active !== false };
    if (!service.name) return json(400, { error: 'Naziv usluge je obavezan.' });
    const { error } = await sb.from('services').insert(serviceToRow(service));
    if (error) throw error;
    return json(201, { ok: true, service });
  }
  const serviceMatch = pathname.match(/^\/api\/admin\/services\/([^/]+)$/);
  if (serviceMatch && method === 'PUT') {
    const serviceId = decodeURIComponent(serviceMatch[1]);
    const current = await getService(serviceId, true);
    if (!current) return json(404, { error: 'Usluga nije pronađena.' });
    const next = { ...current, name: safeText(body.name, 80), description: safeText(body.description, 200), duration: number(body.duration, 15, 240), price: number(body.price, 0, 1000000), cost: number(body.cost, 0, 1000000), active: !!body.active };
    if (!next.name) return json(400, { error: 'Naziv usluge je obavezan.' });
    const { error } = await sb.from('services').upsert(serviceToRow(next, current.sortOrder));
    if (error) throw error;
    return json(200, { ok: true, service: next });
  }
  if (serviceMatch && method === 'DELETE') {
    const { error } = await sb.from('services').delete().eq('id', decodeURIComponent(serviceMatch[1]));
    if (error) throw error;
    return json(200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/admin/barbers') {
    const name = safeText(body.name, 80);
    if (!name) return json(400, { error: 'Ime barbera je obavezno.' });
    const barber = { id: id('barber'), ...body, name };
    const row = barberToRow(barber);
    const { error } = await sb.from('barbers').insert(row);
    if (error) throw error;
    return json(201, { ok: true, barber: barberFromRow(row) });
  }
  const barberMatch = pathname.match(/^\/api\/admin\/barbers\/([^/]+)$/);
  if (barberMatch && method === 'PUT') {
    const barberId = decodeURIComponent(barberMatch[1]);
    const current = await getBarber(barberId, true);
    if (!current) return json(404, { error: 'Barber nije pronađen.' });
    const next = { ...current, ...body, id: barberId, name: safeText(body.name, 80), role: safeText(body.role, 80), workStart: safeText(body.workStart, 5) || current.workStart, workEnd: safeText(body.workEnd, 5) || current.workEnd, active: !!body.active };
    if (!next.name) return json(400, { error: 'Ime barbera je obavezno.' });
    const row = barberToRow(next, current.sortOrder);
    const { error } = await sb.from('barbers').upsert(row);
    if (error) throw error;
    return json(200, { ok: true, barber: barberFromRow(row) });
  }
  if (barberMatch && method === 'DELETE') {
    const { error } = await sb.from('barbers').delete().eq('id', decodeURIComponent(barberMatch[1]));
    if (error) throw error;
    return json(200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/admin/upload') {
    const raw = String(body.data || ''), match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(400, { error: 'Podržane su JPG, PNG i WEBP slike.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) return json(400, { error: 'Slika mora biti manja od 4 MB.' });
    const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${id('photo')}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(fileName, buffer, { contentType: match[1], upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(fileName);
    return json(201, { ok: true, url: data.publicUrl });
  }

  if (method === 'POST' && pathname === '/api/admin/gallery') {
    const galleryItem = { id: id('gal'), title: safeText(body.title, 100) || 'Naš rad', caption: safeText(body.caption, 220), image: safeText(body.image, 1000), barberId: safeText(body.barberId, 80), active: body.active !== false };
    if (!galleryItem.image) return json(400, { error: 'Dodajte sliku.' });
    const row = galleryToRow(galleryItem);
    const { error } = await sb.from('gallery').insert(row);
    if (error) throw error;
    return json(201, { ok: true, item: galleryFromRow(row) });
  }
  const galleryMatch = pathname.match(/^\/api\/admin\/gallery\/([^/]+)$/);
  if (galleryMatch && method === 'PUT') {
    const galleryId = decodeURIComponent(galleryMatch[1]);
    const { data: currentRow, error: findError } = await sb.from('gallery').select('*').eq('id', galleryId).maybeSingle();
    if (findError) throw findError;
    if (!currentRow) return json(404, { error: 'Slika nije pronađena.' });
    const current = galleryFromRow(currentRow);
    const next = { ...current, title: safeText(body.title, 100) || current.title, caption: safeText(body.caption, 220), image: safeText(body.image || current.image, 1000), barberId: safeText(body.barberId, 80), active: !!body.active };
    const row = galleryToRow(next, current.sortOrder);
    const { error } = await sb.from('gallery').upsert(row);
    if (error) throw error;
    return json(200, { ok: true, item: galleryFromRow(row) });
  }
  if (galleryMatch && method === 'DELETE') {
    const { error } = await sb.from('gallery').delete().eq('id', decodeURIComponent(galleryMatch[1]));
    if (error) throw error;
    return json(200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/admin/bookings') {
    const service = await getService(safeText(body.serviceId, 80), true);
    const barber = await getBarber(safeText(body.barberId, 80), true);
    const name = safeText(body.name, 100), phone = safeText(body.phone, 50), date = safeText(body.date, 10), time = safeText(body.time, 5), note = safeText(body.note, 400);
    const status = ['pending', 'confirmed', 'completed', 'cancelled'].includes(body.status) ? body.status : 'confirmed';
    if (!service || !barber || name.length < 2 || phone.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return json(400, { error: 'Popunite sve podatke za termin.' });
    if (status !== 'cancelled') {
      const existing = await bookingsForDate(date);
      if (!isBarberFree(barber, existing, date, time, service.duration)) return json(409, { error: 'Barber već ima termin u tom periodu ili ne radi tada.' });
    }
    const booking = { id: id('bk'), createdAt: nowIso(), name, phone, note, serviceId: service.id, serviceName: service.name, barberId: barber.id, barberName: barber.name, date, time, duration: service.duration, price: service.price, cost: service.cost, status };
    const { data, error } = await sb.from('bookings').insert(bookingToRow(booking)).select('*').single();
    if (error?.code === '23P01') return json(409, { error: 'Barber već ima termin u tom periodu.' });
    if (error) throw error;
    return json(201, { ok: true, booking: publicBooking(data) });
  }
  const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/);
  if (bookingMatch && method === 'PUT') {
    const bookingId = decodeURIComponent(bookingMatch[1]);
    const { data: currentRow, error: findError } = await sb.from('bookings').select('*').eq('id', bookingId).maybeSingle();
    if (findError) throw findError;
    if (!currentRow) return json(404, { error: 'Zakazivanje nije pronađeno.' });
    const current = publicBooking(currentRow);
    const service = await getService(safeText(body.serviceId || current.serviceId, 80), true);
    const barber = await getBarber(safeText(body.barberId || current.barberId, 80), true);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : current.date;
    const time = /^\d{2}:\d{2}$/.test(String(body.time || '')) ? body.time : current.time;
    const status = ['pending', 'confirmed', 'completed', 'cancelled'].includes(body.status) ? body.status : current.status;
    if (!service || !barber) return json(400, { error: 'Barber ili usluga ne postoje.' });
    if (status !== 'cancelled') {
      const existing = (await bookingsForDate(date)).filter(x => x.id !== bookingId);
      if (!isBarberFree(barber, existing, date, time, service.duration)) return json(409, { error: 'Barber već ima termin u tom periodu ili ne radi tada.' });
    }
    const next = { ...current, name: safeText(body.name || current.name, 100), phone: safeText(body.phone || current.phone, 50), note: safeText(body.note ?? current.note, 400), serviceId: service.id, serviceName: service.name, barberId: barber.id, barberName: barber.name, date, time, duration: service.duration, price: service.price, cost: service.cost, status };
    const { data, error } = await sb.from('bookings').update(bookingToRow({ ...next, cancelTokenHash: currentRow.cancel_token_hash })).eq('id', bookingId).select('*').single();
    if (error?.code === '23P01') return json(409, { error: 'Barber već ima termin u tom periodu.' });
    if (error) throw error;
    return json(200, { ok: true, booking: publicBooking(data) });
  }
  if (bookingMatch && method === 'DELETE') {
    const { error } = await sb.from('bookings').delete().eq('id', decodeURIComponent(bookingMatch[1]));
    if (error) throw error;
    return json(200, { ok: true });
  }

  return json(404, { error: 'Ruta nije pronađena.' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  try {
    const pathname = pathFromEvent(event);
    const method = event.httpMethod || 'GET';
    const body = parseBody(event);
    const url = new URL(event.rawUrl || pathname, 'https://netlify.local');
    return await route(event, pathname, method, body, url.searchParams);
  } catch (error) {
    console.error('GAVRO API error:', error.message || error);
    const status = Number(error.statusCode) || (String(error.code || '') === '23P01' ? 409 : 500);
    const message = status === 500 && !process.env.NETLIFY_DEV ? 'Greška na serveru. Proveri Supabase podešavanja i logove funkcije.' : (error.message || 'Greška na serveru.');
    return json(status, { error: message });
  }
};
