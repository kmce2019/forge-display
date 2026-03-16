const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const Parser = require('rss-parser');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const parser = new Parser();
const PORT = Number(process.env.PORT || 3000);

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

let db;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage });

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

async function hasColumn(tableName, columnName) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function initDb() {
  db = await open({
    filename: path.join(dataDir, 'idlescreens.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS screens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      location TEXT,
      playlist_id INTEGER,
      theme_json TEXT,
      schedule_json TEXT,
      last_seen TEXT,
      status TEXT DEFAULT 'offline'
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      widget_type TEXT NOT NULL,
      title TEXT,
      config_json TEXT,
      duration_seconds INTEGER DEFAULT 30,
      position INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      original_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  if (!await hasColumn('screens', 'theme_json')) {
    await db.exec('ALTER TABLE screens ADD COLUMN theme_json TEXT');
  }
  if (!await hasColumn('screens', 'schedule_json')) {
    await db.exec('ALTER TABLE screens ADD COLUMN schedule_json TEXT');
  }

  const playlistCount = (await db.get('SELECT COUNT(*) AS count FROM playlists')).count;
  if (playlistCount === 0) {
    const morningPlaylist = await db.run('INSERT INTO playlists (name) VALUES (?)', ['Morning Campus Playlist']);
    const mealPlaylist = await db.run('INSERT INTO playlists (name) VALUES (?)', ['Cafeteria Menus']);
    const morningId = Number(morningPlaylist.lastID);
    const mealId = Number(mealPlaylist.lastID);

    const insertItemSql = `
      INSERT INTO playlist_items (playlist_id, widget_type, title, config_json, duration_seconds, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await db.run(insertItemSql, [morningId, 'weather', 'Local Weather', JSON.stringify({
      locationName: 'Lufkin, TX', latitude: 31.3382, longitude: -94.7291, showIconPanel: true
    }), 20, 1]);

    await db.run(insertItemSql, [morningId, 'announcements', 'District Announcements', JSON.stringify({
      title: 'Announcements',
      items: [
        'Welcome to campus.',
        'Staff meeting at 3:45 PM in the library.',
        'Chromebook collection begins Friday.'
      ],
      crawlSpeed: 28
    }), 30, 2]);

    await db.run(insertItemSql, [morningId, 'rss', 'Education News', JSON.stringify({
      title: 'Latest Headlines',
      url: 'https://feeds.feedburner.com/Edutopia',
      crawlSpeed: 42
    }), 25, 3]);

    await db.run(insertItemSql, [morningId, 'calendar', 'Calendar', JSON.stringify({
      title: 'Upcoming Events',
      events: [
        { date: 'Mon', text: 'Board meeting - 6:00 PM' },
        { date: 'Tue', text: 'Track meet - 4:30 PM' },
        { date: 'Fri', text: 'Early release day' }
      ],
      crawlSpeed: 30
    }), 25, 4]);

    await db.run(insertItemSql, [mealId, 'breakfast', 'Breakfast Menu', JSON.stringify({
      title: 'Breakfast Menu',
      items: ['Monday: Breakfast Pizza', 'Tuesday: Sausage Biscuit', 'Wednesday: Pancakes']
    }), 20, 1]);

    await db.run(insertItemSql, [mealId, 'lunch', 'Lunch Menu', JSON.stringify({
      title: 'Lunch Menu',
      items: ['Monday: Crispitos', 'Tuesday: Chicken Sandwich', 'Wednesday: Spaghetti']
    }), 20, 2]);

    await db.run(insertItemSql, [mealId, 'pdf', 'Meal Calendar PDF', JSON.stringify({
      title: 'Meal Calendar PDF',
      url: '',
      fit: 'contain',
      pageMode: 'fit-page',
      note: 'Upload a breakfast or lunch PDF in Assets, then select it in Menus.'
    }), 25, 3]);

    await db.run(insertItemSql, [mealId, 'sports', 'Sports', JSON.stringify({
      title: 'Sports Update',
      items: ['Varsity Baseball vs Crockett - 6:00 PM', 'Lady Sandiettes softball practice - 4:15 PM'],
      crawlSpeed: 34
    }), 25, 4]);

    const schoolDaySchedule = JSON.stringify([
      { label: 'Breakfast', days: [1,2,3,4,5], start: '06:00', end: '09:30', playlist_id: mealId },
      { label: 'Lunch', days: [1,2,3,4,5], start: '10:30', end: '14:00', playlist_id: mealId },
      { label: 'Announcements', days: [1,2,3,4,5], start: '07:30', end: '16:30', playlist_id: morningId }
    ]);

    await db.run(
      'INSERT INTO screens (slug, name, location, playlist_id, theme_json, schedule_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['front-office', 'Front Office', 'Main office', morningId, JSON.stringify({}), JSON.stringify([]), 'offline']
    );
    await db.run(
      'INSERT INTO screens (slug, name, location, playlist_id, theme_json, schedule_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['gym-tv', 'Gym TV', 'Gym commons', morningId, JSON.stringify({}), JSON.stringify([]), 'offline']
    );
    await db.run(
      'INSERT INTO screens (slug, name, location, playlist_id, theme_json, schedule_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['cafeteria', 'Cafeteria', 'Cafeteria', mealId, JSON.stringify({ accentColor: '#f59e0b' }), schoolDaySchedule, 'offline']
    );
  }

  await upsertSetting('emergency_override', { active: false, title: '', message: '' });
  await upsertSetting('branding', {
    schoolName: 'IdleScreens Pro',
    slogan: 'Your message, everywhere.',
    backgroundColor: '#0f172a',
    accentColor: '#f97316',
    panelColor: '#111827',
    textColor: '#f9fafb',
    logoUrl: ''
  });
}

async function upsertSetting(key, defaultValue) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(defaultValue)]);
  }
}

async function readSetting(key, fallback = null) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row?.value) return fallback;
  return safeJsonParse(row.value, fallback);
}

async function writeSetting(key, value) {
  const payload = JSON.stringify(value);
  const existing = await db.get('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) await db.run('UPDATE settings SET value = ? WHERE key = ?', [payload, key]);
  else await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, payload]);
}

async function getBranding() {
  return await readSetting('branding', {
    schoolName: 'IdleScreens Pro',
    slogan: 'Your message, everywhere.',
    backgroundColor: '#0f172a',
    accentColor: '#f97316',
    panelColor: '#111827',
    textColor: '#f9fafb',
    logoUrl: ''
  });
}

function normalizeScreen(row) {
  return {
    ...row,
    theme: safeJsonParse(row.theme_json, {}),
    schedule: safeJsonParse(row.schedule_json, [])
  };
}

function parseClockToMinutes(value = '') {
  const [h, m] = String(value).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function getActivePlaylistForScreen(screen) {
  const schedule = Array.isArray(screen.schedule) ? screen.schedule : [];
  if (!schedule.length) return screen.playlist_id;
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const match = schedule.find((entry) => {
    const days = Array.isArray(entry.days) ? entry.days.map(Number) : [];
    const start = parseClockToMinutes(entry.start || '00:00');
    const end = parseClockToMinutes(entry.end || '23:59');
    const dayOk = !days.length || days.includes(day);
    if (!dayOk) return false;
    if (end >= start) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  });
  return Number(match?.playlist_id || screen.playlist_id);
}

async function getAssets() {
  const rows = await db.all('SELECT * FROM assets ORDER BY created_at DESC');
  return rows.map(row => ({
    ...row,
    url: `/uploads/${row.file_name}`
  }));
}

async function getPlaylistWithItems(playlistId) {
  const playlist = await db.get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
  if (!playlist) return null;
  const items = await db.all(
    'SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, id ASC',
    [playlistId]
  );
  return {
    ...playlist,
    items: items.map((item) => ({
      ...item,
      config: safeJsonParse(item.config_json, {})
    }))
  };
}

function mergeTheme(globalBranding, screenTheme = {}) {
  return { ...globalBranding, ...(screenTheme || {}) };
}

async function getScreenBundle(slug) {
  const rawScreen = await db.get('SELECT * FROM screens WHERE slug = ?', [slug]);
  if (!rawScreen) return null;
  const screen = normalizeScreen(rawScreen);
  return {
    screen,
    playlist: await getPlaylistWithItems(getActivePlaylistForScreen(screen)),
    emergency: await readSetting('emergency_override', { active: false, title: '', message: '' }),
    branding: mergeTheme(await getBranding(), screen.theme)
  };
}

async function broadcastAllScreens() {
  const screens = await db.all('SELECT slug FROM screens');
  for (const s of screens) {
    io.to(`screen:${s.slug}`).emit('screen:update', await getScreenBundle(s.slug));
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), version: '1.6.0' });
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/display/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/api/screens', async (_req, res) => {
  const rows = (await db.all('SELECT * FROM screens ORDER BY name ASC')).map(normalizeScreen);
  res.json(rows);
});

app.post('/api/screens', async (req, res) => {
  const { slug, name, location = '', playlist_id = null, theme = {}, schedule = [] } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });

  const result = await db.run(
    'INSERT INTO screens (slug, name, location, playlist_id, theme_json, schedule_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [slug, name, location, playlist_id, JSON.stringify(theme || {}), JSON.stringify(schedule || []), 'offline']
  );

  const created = normalizeScreen(await db.get('SELECT * FROM screens WHERE id = ?', [result.lastID]));
  io.emit('admin:update');
  res.status(201).json(created);
});

app.put('/api/screens/:id', async (req, res) => {
  const { id } = req.params;
  const { slug, name, location = '', playlist_id = null, theme = {}, schedule = [] } = req.body;
  await db.run(
    'UPDATE screens SET slug = ?, name = ?, location = ?, playlist_id = ?, theme_json = ?, schedule_json = ? WHERE id = ?',
    [slug, name, location, playlist_id, JSON.stringify(theme || {}), JSON.stringify(schedule || []), id]
  );

  const updated = normalizeScreen(await db.get('SELECT * FROM screens WHERE id = ?', [id]));
  io.emit('admin:update');
  if (updated?.slug) {
    io.to(`screen:${updated.slug}`).emit('screen:update', await getScreenBundle(updated.slug));
  }
  res.json(updated);
});

app.get('/api/playlists', async (_req, res) => {
  const rows = await db.all('SELECT * FROM playlists ORDER BY name ASC');
  const out = [];
  for (const p of rows) out.push(await getPlaylistWithItems(p.id));
  res.json(out);
});

app.post('/api/playlists', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = await db.run('INSERT INTO playlists (name) VALUES (?)', [name]);
  const created = await getPlaylistWithItems(result.lastID);
  io.emit('admin:update');
  res.status(201).json(created);
});

app.put('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;
  const { name, items } = req.body;
  if (!name || !Array.isArray(items)) {
    return res.status(400).json({ error: 'name and items[] are required' });
  }

  await db.exec('BEGIN');
  try {
    await db.run('UPDATE playlists SET name = ? WHERE id = ?', [name, id]);
    await db.run('DELETE FROM playlist_items WHERE playlist_id = ?', [id]);
    const insertSql = `
      INSERT INTO playlist_items (playlist_id, widget_type, title, config_json, duration_seconds, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await db.run(insertSql, [
        id,
        item.widget_type,
        item.title || '',
        JSON.stringify(item.config || {}),
        Number(item.duration_seconds || 30),
        index + 1
      ]);
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  io.emit('admin:update');
  const affectedScreens = await db.all('SELECT slug FROM screens WHERE playlist_id = ?', [id]);
  for (const s of affectedScreens) {
    io.to(`screen:${s.slug}`).emit('screen:update', await getScreenBundle(s.slug));
  }
  res.json(await getPlaylistWithItems(id));
});

app.get('/api/screen/:slug/bundle', async (req, res) => {
  const bundle = await getScreenBundle(req.params.slug);
  if (!bundle) return res.status(404).json({ error: 'screen not found' });
  res.json(bundle);
});

app.post('/api/screen/:slug/heartbeat', async (req, res) => {
  const { slug } = req.params;
  const now = new Date().toISOString();
  await db.run('UPDATE screens SET last_seen = ?, status = ? WHERE slug = ?', [now, 'online', slug]);
  io.emit('admin:update');
  res.json({ ok: true, last_seen: now });
});

app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&temperature_unit=fahrenheit&wind_speed_unit=mph&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch weather', detail: String(err.message || err) });
  }
});

app.get('/api/rss', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const feed = await parser.parseURL(url);
    res.json({
      title: feed.title,
      items: (feed.items || []).slice(0, 8).map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch RSS feed', detail: String(err.message || err) });
  }
});

app.get('/api/emergency', async (_req, res) => {
  res.json(await readSetting('emergency_override', { active: false, title: '', message: '' }));
});

app.put('/api/emergency', async (req, res) => {
  const payload = {
    active: Boolean(req.body.active),
    title: String(req.body.title || ''),
    message: String(req.body.message || '')
  };

  await writeSetting('emergency_override', payload);
  io.emit('emergency:update', payload);
  io.emit('admin:update');
  await broadcastAllScreens();
  res.json(payload);
});

app.get('/api/branding', async (_req, res) => {
  res.json(await getBranding());
});

app.put('/api/branding', async (req, res) => {
  const current = await getBranding();
  const payload = {
    ...current,
    schoolName: String(req.body.schoolName || ''),
    slogan: String(req.body.slogan || ''),
    backgroundColor: String(req.body.backgroundColor || current.backgroundColor),
    accentColor: String(req.body.accentColor || current.accentColor),
    panelColor: String(req.body.panelColor || current.panelColor),
    textColor: String(req.body.textColor || current.textColor),
    logoUrl: String(req.body.logoUrl || '')
  };
  await writeSetting('branding', payload);
  io.emit('admin:update');
  await broadcastAllScreens();
  res.json(payload);
});

app.get('/api/assets', async (_req, res) => {
  res.json(await getAssets());
});

app.post('/api/assets', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const kind = (req.body.kind || 'file').toString();
  const createdAt = new Date().toISOString();
  const result = await db.run(`
    INSERT INTO assets (kind, original_name, file_name, mime_type, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [kind, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, createdAt]);

  const asset = await db.get('SELECT * FROM assets WHERE id = ?', [result.lastID]);
  const payload = { ...asset, url: `/uploads/${asset.file_name}` };
  io.emit('admin:update');
  res.status(201).json(payload);
});

io.on('connection', (socket) => {
  socket.on('screen:join', async (slug) => {
    socket.join(`screen:${slug}`);
    const bundle = await getScreenBundle(slug);
    if (bundle) socket.emit('screen:update', bundle);
  });
});

setInterval(async () => {
  if (!db) return;
  const cutoff = Date.now() - 60 * 1000;
  const screens = await db.all('SELECT * FROM screens');
  let changed = false;
  for (const screen of screens) {
    const isOnline = screen.last_seen && new Date(screen.last_seen).getTime() >= cutoff;
    const nextStatus = isOnline ? 'online' : 'offline';
    if (screen.status !== nextStatus) {
      await db.run('UPDATE screens SET status = ? WHERE id = ?', [nextStatus, screen.id]);
      changed = true;
    }
  }
  if (changed) io.emit('admin:update');
}, 15000);

async function start() {
  await initDb();
  server.listen(PORT, () => {
    console.log(`IdleScreens Pro v1.6 listening on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start IdleScreens Pro:', error);
  process.exit(1);
});
