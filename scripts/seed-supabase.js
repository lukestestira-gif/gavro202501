const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'gavro-uploads';

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
}
async function uploadIfLocal(sb, value) {
  const input = String(value || '');
  if (!input.startsWith('/uploads/') && !input.startsWith('/images/')) return input;
  const localPath = path.join(ROOT, 'public', input.replace(/^\//, ''));
  if (!fs.existsSync(localPath)) throw new Error(`Nedostaje lokalna slika: ${localPath}`);
  const ext = path.extname(localPath).slice(1).toLowerCase() || 'jpg';
  const storagePath = `seed/${path.basename(localPath)}`;
  const buffer = fs.readFileSync(localPath);
  const { error } = await sb.storage.from(BUCKET).upload(storagePath, buffer, { contentType: contentType(localPath), upsert: true, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
async function main() {
  loadEnvFile();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.includes('PASTE_')) throw new Error('Podesi SUPABASE_URL i SUPABASE_SECRET_KEY (ili stariji SUPABASE_SERVICE_ROLE_KEY) u .env pre pokretanja skripte.');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));

  const { error: settingsError } = await sb.from('site_settings').upsert({ id: 1, data: db.settings, updated_at: new Date().toISOString() });
  if (settingsError) throw settingsError;

  const services = (db.services || []).map((s, i) => ({ id: s.id, name: s.name, description: s.description || '', duration: Number(s.duration), price: Number(s.price || 0), cost: Number(s.cost || 0), active: s.active !== false, sort_order: i }));
  if (services.length) { const { error } = await sb.from('services').upsert(services); if (error) throw error; }

  const barbers = [];
  for (const [i, b] of (db.barbers || []).entries()) {
    barbers.push({ id: b.id, name: b.name, role: b.role || 'Barber', initials: b.initials || '', color: b.color || '#84b5f5', work_start: b.workStart || '09:00', work_end: b.workEnd || '20:00', work_days: b.workDays || [1,2,3,4,5,6], photo: await uploadIfLocal(sb, b.photo || ''), bio: b.bio || '', active: b.active !== false, sort_order: i });
  }
  if (barbers.length) { const { error } = await sb.from('barbers').upsert(barbers); if (error) throw error; }

  const gallery = [];
  for (const [i, g] of (db.gallery || []).entries()) {
    gallery.push({ id: g.id, title: g.title || 'Naš rad', caption: g.caption || '', image: await uploadIfLocal(sb, g.image || ''), barber_id: g.barberId || null, active: g.active !== false, sort_order: i });
  }
  if (gallery.length) { const { error } = await sb.from('gallery').upsert(gallery); if (error) throw error; }

  const bookings = (db.bookings || []).map(b => ({ id: b.id, created_at: b.createdAt || new Date().toISOString(), name: b.name, phone: b.phone, note: b.note || '', service_id: b.serviceId, service_name: b.serviceName, barber_id: b.barberId, barber_name: b.barberName, booking_date: b.date, start_time: b.time, duration: Number(b.duration), price: Number(b.price || 0), cost: Number(b.cost || 0), status: b.status || 'pending', cancel_token_hash: b.cancelTokenHash || null, cancelled_at: b.cancelledAt || null }));
  if (bookings.length) { const { error } = await sb.from('bookings').upsert(bookings); if (error) throw error; }

  console.log('GAVRO je povezan sa Supabase bazom.');
  console.log(`Usluge: ${services.length}; barber-i: ${barbers.length}; slike galerije: ${gallery.length}; preneti termini: ${bookings.length}.`);
  console.log('Proveri sajt i cene pre nego što podeliš javni link.');
}
main().catch(error => { console.error('Greška pri povezivanju:', error.message || error); process.exitCode = 1; });
