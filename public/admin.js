
const socket = io();
let screens = [];
let playlists = [];
let assets = [];
let branding = null;
let selectedPlaylistId = null;
let selectedThemeScreenId = null;
let dragIndex = null;
let currentTab = 'overview';

const widgetTypes = ['weather','announcements','rss','calendar','breakfast','lunch','sports','html','pdf','image','video'];

function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.tab-section').forEach(panel => panel.classList.toggle('active', panel.dataset.tabPanel === name));
}

socket.on('admin:update', loadData);
socket.on('emergency:update', loadEmergency);

async function api(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(url, { headers, ...options });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json();
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function slugify(value = '') {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function getAssetsByKind(kind) {
  if (kind === 'image') return assets.filter(a => (a.mime_type || '').startsWith('image/'));
  if (kind === 'video') return assets.filter(a => (a.mime_type || '').startsWith('video/'));
  if (kind === 'pdf') return assets.filter(a => (a.mime_type || '').includes('pdf') || a.kind === 'pdf');
  return assets;
}

function assetOptions(kind, selectedValue = '', allowBlank = true) {
  const rows = getAssetsByKind(kind);
  return `${allowBlank ? '<option value="">Select uploaded file…</option>' : ''}${rows.map(a => `<option value="${escapeHtml(a.url)}" ${(a.url || '') === (selectedValue || '') ? 'selected' : ''}>${escapeHtml(a.original_name)}</option>`).join('')}`;
}

function playlistOptions(selectedId = null, allowBlank = false) {
  return `${allowBlank ? '<option value="">Select playlist…</option>' : ''}${playlists.map(p => `<option value="${p.id}" ${Number(selectedId) === Number(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}`;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function loadData() {
  [screens, playlists, assets, branding] = await Promise.all([
    api('/api/screens'),
    api('/api/playlists'),
    api('/api/assets'),
    api('/api/branding')
  ]);
  if (!selectedPlaylistId && playlists.length) selectedPlaylistId = playlists[0].id;
  if (!selectedThemeScreenId && screens.length) selectedThemeScreenId = screens[0].id;
  renderMetrics();
  renderScreens();
  renderAssets();
  renderBranding();
  renderPlaylistSelectors();
  renderThemeSelector();
  renderPlaylistEditor();
  renderThemeEditor();
  renderMenusEditor();
  renderAnnouncementsEditor();
  await loadEmergency();
}

function renderMetrics() {
  document.getElementById('metricScreens').textContent = screens.length;
  document.getElementById('metricOnline').textContent = screens.filter(s => s.status === 'online').length;
  document.getElementById('metricPlaylists').textContent = playlists.length;
  document.getElementById('metricAssets').textContent = assets.length;
}

function renderScreens() {
  const html = screens.length ? `
    <div class="screen-card-grid">
      ${screens.map(screen => {
        const themeCount = Object.keys(screen.theme || {}).filter(key => screen.theme[key]).length;
        const schedule = Array.isArray(screen.schedule) ? screen.schedule : [];
        return `
          <div class="screen-card">
            <div class="screen-card-head">
              <div>
                <div class="screen-name">${escapeHtml(screen.name)}</div>
                <div class="help">${escapeHtml(screen.location || 'No location set')}</div>
              </div>
              <span class="badge ${screen.status}">${screen.status}</span>
            </div>

            <div class="screen-preview-shell">
              <iframe class="screen-preview-frame" src="/display/${escapeHtml(screen.slug)}?preview=1" loading="lazy"></iframe>
            </div>

            <div class="screen-meta-grid">
              <div>
                <label>Default Playlist</label>
                <select onchange="updateScreenPlaylist(${screen.id}, this.value)">${playlistOptions(screen.playlist_id)}</select>
              </div>
              <div>
                <label>Screen URL</label>
                <div class="mini-code">/display/${escapeHtml(screen.slug)}</div>
              </div>
            </div>

            <div class="space-top">
              <label>Schedule blocks (one line each: Days|Start|End|Playlist)</label>
              <textarea class="schedule-editor" oninput="updateScreenScheduleText(${screen.id}, this.value)" placeholder="Mon-Fri|06:00|09:30|Cafeteria Menus">${escapeHtml(scheduleToText(screen.schedule || []))}</textarea>
              <div class="help">Example: Mon-Fri|06:00|09:30|Cafeteria Menus</div>
            </div>

            <div class="row wrap-row space-top">
              <button class="secondary" onclick="saveScreenSchedule(${screen.id})">Save Schedule</button>
              <button class="secondary" onclick="window.open('/display/${escapeHtml(screen.slug)}','_blank')">Open Live View</button>
              <span class="pill ${themeCount ? '' : 'muted-pill'}">${themeCount ? `${themeCount} style override${themeCount > 1 ? 's' : ''}` : 'Using default style'}</span>
              <span class="pill muted-pill">${screen.last_seen ? `Seen ${new Date(screen.last_seen).toLocaleString()}` : 'Never connected yet'}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '<div class="help">No screens created yet.</div>';
  document.getElementById('screensTable').innerHTML = html;
}

function scheduleToText(schedule = []) {
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (schedule || []).map(entry => {
    const days = Array.isArray(entry.days) && entry.days.length
      ? compressDays(entry.days.map(Number).sort((a,b) => a-b), dayNames)
      : 'Everyday';
    const playlist = playlists.find(p => Number(p.id) === Number(entry.playlist_id));
    return `${days}|${entry.start || '00:00'}|${entry.end || '23:59'}|${playlist?.name || entry.playlist_id || ''}`;
  }).join('\n');
}

function compressDays(days, names) {
  const all = 'Everyday';
  if (JSON.stringify(days) === JSON.stringify([1,2,3,4,5])) return 'Mon-Fri';
  if (JSON.stringify(days) === JSON.stringify([0,6])) return 'Weekend';
  if (JSON.stringify(days) === JSON.stringify([0,1,2,3,4,5,6])) return all;
  return days.map(d => names[d] || '').filter(Boolean).join(',');
}

function parseDayToken(token) {
  const map = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  token = String(token || '').trim().toLowerCase();
  if (!token) return null;
  if (token === 'everyday' || token === 'daily' || token === 'all') return [0,1,2,3,4,5,6];
  if (token === 'weekday' || token === 'weekdays' || token === 'mon-fri') return [1,2,3,4,5];
  if (token === 'weekend') return [0,6];
  if (token.includes('-')) {
    const [a,b] = token.split('-').map(x => x.trim().slice(0,3));
    if (map[a] == null || map[b] == null) return [];
    const out = [];
    let cur = map[a];
    while (true) {
      out.push(cur);
      if (cur === map[b]) break;
      cur = (cur + 1) % 7;
      if (out.length > 7) break;
    }
    return out;
  }
  return token.split(',').map(x => map[x.trim().slice(0,3)]).filter(x => x != null);
}

function scheduleTextToRows(text = '') {
  const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);
  return lines.map(line => {
    const [daysText = '', start = '00:00', end = '23:59', playlistName = ''] = line.split('|').map(x => x.trim());
    const days = parseDayToken(daysText);
    const playlist = playlists.find(p => p.name.toLowerCase() === playlistName.toLowerCase()) || playlists.find(p => String(p.id) === playlistName);
    return {
      label: playlist?.name || playlistName,
      days: Array.isArray(days) ? days : [],
      start,
      end,
      playlist_id: playlist?.id || null
    };
  }).filter(row => row.playlist_id);
}

function updateScreenScheduleText(id, value) {
  const screen = screens.find(s => Number(s.id) === Number(id));
  if (!screen) return;
  screen.schedule = scheduleTextToRows(value);
  screen.__scheduleText = value;
}

async function saveScreenSchedule(id) {
  const screen = screens.find(s => Number(s.id) === Number(id));
  if (!screen) return;
  await saveScreen(screen);
  showToast('Screen schedule saved');
  await loadData();
}

function renderAssets() {
  const html = assets.length ? assets.map(asset => {
    const isImage = (asset.mime_type || '').startsWith('image/');
    const isVideo = (asset.mime_type || '').startsWith('video/');
    const isPdf = (asset.mime_type || '').includes('pdf') || asset.kind === 'pdf';
    return `
      <div class="asset-row asset-preview-row">
        <div class="asset-main">
          <div><strong>${escapeHtml(asset.original_name)}</strong> <span class="badge active">${escapeHtml(asset.kind || 'file')}</span></div>
          <div class="help">${escapeHtml(asset.mime_type || '')} • ${Math.round((asset.file_size || 0) / 1024)} KB</div>
          <div class="asset-url">${escapeHtml(asset.url)}</div>
        </div>
        <div class="asset-preview">
          ${isImage ? `<img src="${escapeHtml(asset.url)}" class="asset-thumb large-thumb" />` : ''}
          ${isVideo ? `<video src="${escapeHtml(asset.url)}" class="asset-thumb large-thumb" muted controls preload="metadata"></video>` : ''}
          ${isPdf ? `<div class="asset-pdf-pill big-pill">PDF</div>` : ''}
        </div>
        <div class="row wrap-row">
          <button class="secondary" onclick="copyText('${escapeHtml(asset.url)}')">Copy URL</button>
          ${isImage ? `<button class="secondary" onclick="useAssetAsLogo('${escapeHtml(asset.url)}')">Use as Logo</button>` : ''}
        </div>
      </div>
    `;
  }).join('') : '<div class="help">No assets uploaded yet.</div>';
  document.getElementById('assetsList').innerHTML = html;
}

function renderBranding() {
  if (!branding) return;
  document.getElementById('brandSchoolName').value = branding.schoolName || '';
  document.getElementById('brandSlogan').value = branding.slogan || '';
  document.getElementById('brandBackgroundColor').value = branding.backgroundColor || '#0f172a';
  document.getElementById('brandAccentColor').value = branding.accentColor || '#f97316';
  document.getElementById('brandPanelColor').value = branding.panelColor || '#111827';
  document.getElementById('brandTextColor').value = branding.textColor || '#f9fafb';
  document.getElementById('brandLogoUrl').value = branding.logoUrl || '';
}

function renderPlaylistSelectors() {
  const options = playlistOptions();
  document.getElementById('playlistSelect').innerHTML = options;
  document.getElementById('newScreenPlaylist').innerHTML = options;
  if (selectedPlaylistId) document.getElementById('playlistSelect').value = String(selectedPlaylistId);
}

function renderThemeSelector() {
  const options = screens.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.slug)})</option>`).join('');
  document.getElementById('screenThemeSelect').innerHTML = options;
  if (selectedThemeScreenId) document.getElementById('screenThemeSelect').value = String(selectedThemeScreenId);
}

function selectPlaylist() {
  selectedPlaylistId = Number(document.getElementById('playlistSelect').value);
  renderPlaylistEditor();
}

function selectThemeScreen() {
  selectedThemeScreenId = Number(document.getElementById('screenThemeSelect').value);
  renderThemeEditor();
}

function currentThemeScreen() {
  return screens.find(s => Number(s.id) === Number(selectedThemeScreenId));
}

function renderThemeEditor() {
  const screen = currentThemeScreen();
  if (!screen) return;
  const merged = { ...branding, ...(screen.theme || {}) };
  document.getElementById('themeSchoolName').value = screen.theme?.schoolName || '';
  document.getElementById('themeSlogan').value = screen.theme?.slogan || '';
  document.getElementById('themeBackgroundColor').value = merged.backgroundColor || '#0f172a';
  document.getElementById('themeAccentColor').value = merged.accentColor || '#f97316';
  document.getElementById('themePanelColor').value = merged.panelColor || '#111827';
  document.getElementById('themeTextColor').value = merged.textColor || '#f9fafb';
  document.getElementById('themeLogoUrl').value = screen.theme?.logoUrl || '';
}

function getCurrentPlaylist() {
  return playlists.find(p => Number(p.id) === Number(selectedPlaylistId));
}

function getTickerSpeedControl(idx, cfg, label = 'Crawler speed (seconds)') {
  const speed = Number(cfg.tickerSpeedSec || 18);
  return `
    <div>
      <label>${label}</label>
      <input type="number" min="8" max="60" step="1" value="${speed}" oninput="updateItemConfig(${idx}, 'tickerSpeedSec', Number(this.value || 18))" />
      <div class="help">Higher number = slower crawl.</div>
    </div>
  `;
}

function renderPlaylistEditor() {
  const playlist = getCurrentPlaylist();
  if (!playlist) {
    document.getElementById('playlistItems').innerHTML = '<div class="help">No playlist selected.</div>';
    document.getElementById('playlistName').value = '';
    return;
  }
  document.getElementById('playlistName').value = playlist.name;
  document.getElementById('playlistItems').innerHTML = playlist.items.map((item, idx) => renderWidgetEditorCard(item, idx)).join('');
}

function renderWidgetEditorCard(item, idx) {
  const label = item.widget_type.charAt(0).toUpperCase() + item.widget_type.slice(1);
  return `
    <div class="item-row draggable-row" draggable="true" data-idx="${idx}" ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event)" ondragend="handleDragEnd(event)">
      <div class="widget-card-top">
        <div class="row">
          <div class="drag-handle">⠿</div>
          <span class="pill">${escapeHtml(label)} slide</span>
        </div>
        <button class="secondary" onclick="removePlaylistItem(${idx})">Remove</button>
      </div>
      <div class="grid grid-3 compact-grid">
        <div>
          <label>Slide Type</label>
          <select onchange="onTypeChanged(${idx}, this.value)">
            ${widgetTypes.map(type => `<option value="${type}" ${item.widget_type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Slide Title</label>
          <input value="${escapeHtml(item.title || '')}" oninput="updateItemField(${idx}, 'title', this.value)" />
        </div>
        <div>
          <label>Seconds On Screen</label>
          <input type="number" min="5" value="${Number(item.duration_seconds || 30)}" oninput="updateItemField(${idx}, 'duration_seconds', Number(this.value || 30))" />
        </div>
      </div>
      <div class="widget-builder-grid">
        <div>
          <div class="builder-panel">
            <div class="builder-panel-title">Slide Builder</div>
            ${renderWidgetBuilder(item, idx)}
          </div>
        </div>
        <div>
          <div class="builder-panel preview-panel">
            <div class="builder-panel-title">Preview</div>
            <div class="widget-admin-preview">${buildWidgetPreview(item)}</div>
          </div>
        </div>
      </div>
      <details class="advanced-box">
        <summary>Advanced JSON</summary>
        <textarea oninput="updateItemJson(${idx}, this.value)">${escapeHtml(JSON.stringify(item.config || {}, null, 2))}</textarea>
      </details>
    </div>
  `;
}

function renderWidgetBuilder(item, idx) {
  const cfg = item.config || {};
  const bulletText = Array.isArray(cfg.items) ? cfg.items.join('\n') : '';
  const eventsText = Array.isArray(cfg.events) ? cfg.events.map(e => `${e.date || ''}|${e.text || ''}`).join('\n') : '';

  switch (item.widget_type) {
    case 'weather':
      return `
        <div class="grid grid-2 compact-grid">
          <div><label>Location Label</label><input value="${escapeHtml(cfg.locationName || '')}" oninput="updateItemConfig(${idx}, 'locationName', this.value)" /></div>
          <div><label>Show Weather Icon Panel</label><select onchange="updateItemConfig(${idx}, 'showIconPanel', this.value === 'true')"><option value="true" ${cfg.showIconPanel !== false ? 'selected' : ''}>Yes</option><option value="false" ${cfg.showIconPanel === false ? 'selected' : ''}>No</option></select></div>
          <div><label>Latitude</label><input type="number" step="0.0001" value="${cfg.latitude ?? 31.3382}" oninput="updateItemConfig(${idx}, 'latitude', Number(this.value || 0))" /></div>
          <div><label>Longitude</label><input type="number" step="0.0001" value="${cfg.longitude ?? -94.7291}" oninput="updateItemConfig(${idx}, 'longitude', Number(this.value || 0))" /></div>
        </div>`;
    case 'announcements':
    case 'sports':
    case 'breakfast':
    case 'lunch':
      return `
        <div class="stack gap-16">
          <div><label>${item.widget_type === 'sports' ? 'Games / updates' : 'Items'} — one line per item</label><textarea oninput="updateListConfig(${idx}, 'items', this.value)">${escapeHtml(bulletText)}</textarea></div>
          <div class="grid grid-2 compact-grid">
            ${getTickerSpeedControl(idx, cfg)}
          </div>
        </div>`;
    case 'rss':
      return `
        <div class="grid grid-2 compact-grid">
          <div class="grid-span-2"><label>RSS Feed URL</label><input value="${escapeHtml(cfg.url || '')}" oninput="updateItemConfig(${idx}, 'url', this.value)" placeholder="https://feeds.feedburner.com/Edutopia" /></div>
          <div><label>Ticker Title</label><input value="${escapeHtml(cfg.title || '')}" oninput="updateItemConfig(${idx}, 'title', this.value)" /></div>
          ${getTickerSpeedControl(idx, cfg)}
        </div>`;
    case 'calendar':
      return `
        <div class="grid grid-1 compact-grid">
          <div><label>Events — one per line, format: Day|Text</label><textarea oninput="updateEventsConfig(${idx}, this.value)">${escapeHtml(eventsText)}</textarea></div>
          <div class="grid grid-2 compact-grid">${getTickerSpeedControl(idx, cfg)}</div>
        </div>`;
    case 'pdf':
      return `
        <div class="grid grid-2 compact-grid">
          <div class="grid-span-2"><label>Uploaded PDF</label><select onchange="updateItemConfig(${idx}, 'url', this.value)">${assetOptions('pdf', cfg.url || '')}</select></div>
          <div><label>Or PDF URL</label><input value="${escapeHtml(cfg.url || '')}" oninput="updateItemConfig(${idx}, 'url', this.value)" placeholder="/uploads/menu.pdf" /></div>
          <div><label>Frame Style</label><select onchange="updateItemConfig(${idx}, 'pageMode', this.value)"><option value="fit-page" ${(cfg.pageMode || 'fit-page') === 'fit-page' ? 'selected' : ''}>Fit full page</option><option value="fit-width" ${cfg.pageMode === 'fit-width' ? 'selected' : ''}>Fill width</option></select></div>
          <div><label>Hide Title for More Space</label><select onchange="updateItemConfig(${idx}, 'hideTitle', this.value === 'true')"><option value="true" ${cfg.hideTitle ? 'selected' : ''}>Yes</option><option value="false" ${!cfg.hideTitle ? 'selected' : ''}>No</option></select></div>
        </div>`;
    case 'image':
      return `
        <div class="grid grid-2 compact-grid">
          <div class="grid-span-2"><label>Uploaded Image</label><select onchange="updateItemConfig(${idx}, 'url', this.value)">${assetOptions('image', cfg.url || '')}</select></div>
          <div><label>Or Image URL</label><input value="${escapeHtml(cfg.url || '')}" oninput="updateItemConfig(${idx}, 'url', this.value)" placeholder="/uploads/graphic.png" /></div>
          <div><label>Fit Style</label><select onchange="updateItemConfig(${idx}, 'fit', this.value)"><option value="contain" ${(cfg.fit || 'contain') === 'contain' ? 'selected' : ''}>Contain</option><option value="cover" ${cfg.fit === 'cover' ? 'selected' : ''}>Cover</option></select></div>
        </div>`;
    case 'video':
      return `
        <div class="grid grid-2 compact-grid">
          <div class="grid-span-2"><label>Uploaded Video</label><select onchange="updateItemConfig(${idx}, 'url', this.value)">${assetOptions('video', cfg.url || '')}</select></div>
          <div><label>Or Video URL</label><input value="${escapeHtml(cfg.url || '')}" oninput="updateItemConfig(${idx}, 'url', this.value)" placeholder="/uploads/welcome.mp4" /></div>
          <div><label>Muted Loop</label><select onchange="updateItemConfig(${idx}, 'muted', this.value === 'true')"><option value="true" ${cfg.muted !== false ? 'selected' : ''}>Yes</option><option value="false" ${cfg.muted === false ? 'selected' : ''}>No</option></select></div>
        </div>`;
    case 'html':
      return `<div><label>Custom HTML</label><textarea oninput="updateItemConfig(${idx}, 'html', this.value)">${escapeHtml(cfg.html || '')}</textarea></div>`;
    default:
      return '<div class="help">Choose a slide type to start building.</div>';
  }
}

function buildWidgetPreview(item) {
  const cfg = item.config || {};
  if (item.widget_type === 'weather') {
    return `<div class="mini-weather"><strong>${escapeHtml(cfg.locationName || 'Weather')}</strong><div class="help">Live forecast • °F • ${cfg.showIconPanel === false ? 'text only' : 'icon panel on right'}</div><div class="mini-preview-box">72° / Sunny</div></div>`;
  }
  if (item.widget_type === 'image' && cfg.url) {
    return `<img src="${escapeHtml(cfg.url)}" class="asset-thumb large-thumb" />`;
  }
  if (item.widget_type === 'video' && cfg.url) {
    return `<video src="${escapeHtml(cfg.url)}" class="asset-thumb large-thumb" muted controls preload="metadata"></video>`;
  }
  if (item.widget_type === 'pdf') {
    return `<div class="asset-pdf-pill big-pill">PDF<br><span class="help">${escapeHtml(cfg.hideTitle ? 'title hidden' : 'title shown')}</span></div>`;
  }
  if (item.widget_type === 'calendar') {
    const rows = Array.isArray(cfg.events) ? cfg.events.slice(0, 4).map(x => `<div>• <strong>${escapeHtml(x.date || '')}</strong> ${escapeHtml(x.text || '')}</div>`).join('') : '<div class="help">No events yet.</div>';
    return `<div class="mini-list">${rows}</div>`;
  }
  if (['announcements','breakfast','lunch','sports'].includes(item.widget_type)) {
    const rows = Array.isArray(cfg.items) ? cfg.items.slice(0, 4).map(x => `<div>• ${escapeHtml(x)}</div>`).join('') : '<div class="help">No items yet.</div>';
    return `<div class="mini-list">${rows}<div class="help">Crawler: ${Number(cfg.tickerSpeedSec || 18)}s</div></div>`;
  }
  if (item.widget_type === 'rss') {
    return `<div class="mini-list"><div><strong>${escapeHtml(cfg.title || 'RSS Headlines')}</strong></div><div>• Feed URL: ${escapeHtml(cfg.url || 'Not set')}</div><div class="help">Crawler: ${Number(cfg.tickerSpeedSec || 18)}s</div></div>`;
  }
  if (item.widget_type === 'html') {
    return `<div class="mini-list"><div>Custom HTML slide</div><div class="help">${escapeHtml((cfg.html || '').slice(0, 120))}</div></div>`;
  }
  return '<div class="help">Slide preview will appear here.</div>';
}

function presetConfig(type) {
  if (type === 'weather') return { locationName: 'Lufkin, TX', latitude: 31.3382, longitude: -94.7291, showIconPanel: true };
  if (type === 'breakfast') return { title: 'Breakfast Menu', items: ['Monday: Pancakes', 'Tuesday: Cereal', 'Wednesday: Breakfast Pizza'], tickerSpeedSec: 20 };
  if (type === 'lunch') return { title: 'Lunch Menu', items: ['Monday: Crispitos', 'Tuesday: Chicken Sandwich', 'Wednesday: Spaghetti'], tickerSpeedSec: 20 };
  if (type === 'pdf') return { title: 'Menu PDF', url: '', pageMode: 'fit-page', hideTitle: true };
  if (type === 'image') return { title: 'Image Slide', url: '', fit: 'contain' };
  if (type === 'video') return { title: 'Video Slide', url: '', muted: true };
  if (type === 'calendar') return { title: 'Upcoming Events', events: [{ date: 'Mon', text: 'Board meeting 6:00 PM' }, { date: 'Tue', text: 'Track meet 4:30 PM' }], tickerSpeedSec: 22 };
  if (type === 'rss') return { title: 'Latest Headlines', url: 'https://feeds.feedburner.com/Edutopia', tickerSpeedSec: 28 };
  if (type === 'sports') return { title: 'Sports Update', items: ['Varsity baseball 6:00 PM', 'Softball practice 4:15 PM'], tickerSpeedSec: 24 };
  if (type === 'announcements') return { title: 'Announcements', items: ['Welcome to campus.', 'Have a great day.'], tickerSpeedSec: 18 };
  return { title: 'New Widget', items: ['Edit slide content here.'] };
}

function addPlaylistItem() {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items.push({ widget_type: 'announcements', title: 'New Widget', duration_seconds: 30, config: presetConfig('announcements') });
  renderPlaylistEditor();
}

function addPreset(type) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items.push({ widget_type: type, title: type.charAt(0).toUpperCase() + type.slice(1), duration_seconds: 20, config: presetConfig(type) });
  renderPlaylistEditor();
}

function removePlaylistItem(idx) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items.splice(idx, 1);
  renderPlaylistEditor();
}

function updateItemField(idx, field, value) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items[idx][field] = value;
}

function updateItemConfig(idx, key, value) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items[idx].config = playlist.items[idx].config || {};
  playlist.items[idx].config[key] = value;
  renderPlaylistEditor();
}

function updateListConfig(idx, key, value) {
  const lines = String(value || '').split('\n').map(x => x.trim()).filter(Boolean);
  updateItemConfig(idx, key, lines);
}

function updateEventsConfig(idx, value) {
  const rows = String(value || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [date, ...rest] = line.split('|');
    return { date: (date || '').trim(), text: rest.join('|').trim() };
  });
  updateItemConfig(idx, 'events', rows);
}

function updateItemJson(idx, value) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  try {
    playlist.items[idx].config = JSON.parse(value || '{}');
  } catch {
    return;
  }
  renderPlaylistEditor();
}

function onTypeChanged(idx, type) {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  playlist.items[idx].widget_type = type;
  if (!playlist.items[idx].title || playlist.items[idx].title === 'New Widget') playlist.items[idx].title = type.charAt(0).toUpperCase() + type.slice(1);
  playlist.items[idx].config = presetConfig(type);
  renderPlaylistEditor();
}

function handleDragStart(event) {
  dragIndex = Number(event.currentTarget.dataset.idx);
  event.currentTarget.classList.add('dragging');
}
function handleDragOver(event) { event.preventDefault(); }
function handleDrop(event) {
  event.preventDefault();
  const dropIndex = Number(event.currentTarget.dataset.idx);
  const playlist = getCurrentPlaylist();
  if (!playlist || dragIndex === null || dragIndex === dropIndex) return;
  const [moved] = playlist.items.splice(dragIndex, 1);
  playlist.items.splice(dropIndex, 0, moved);
  dragIndex = null;
  renderPlaylistEditor();
}
function handleDragEnd(event) {
  dragIndex = null;
  event.currentTarget.classList.remove('dragging');
}

async function saveScreen(screen) {
  await api(`/api/screens/${screen.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      slug: screen.slug,
      name: screen.name,
      location: screen.location,
      playlist_id: Number(screen.playlist_id),
      theme: screen.theme || {},
      schedule: screen.schedule || []
    })
  });
}

async function updateScreenPlaylist(id, playlistId) {
  const screen = screens.find(s => s.id === id);
  if (!screen) return;
  screen.playlist_id = Number(playlistId);
  await saveScreen(screen);
  showToast('Screen updated');
  await loadData();
}

async function createScreen() {
  const name = document.getElementById('newScreenName').value.trim();
  const slugInput = document.getElementById('newScreenSlug');
  const slug = slugify(slugInput.value.trim() || name);
  const location = document.getElementById('newScreenLocation').value.trim();
  const playlist_id = Number(document.getElementById('newScreenPlaylist').value || 0);
  if (!name || !slug) return showToast('Add a screen name first');
  await api('/api/screens', { method: 'POST', body: JSON.stringify({ slug, name, location, playlist_id, theme: {}, schedule: [] }) });
  document.getElementById('newScreenName').value = '';
  document.getElementById('newScreenSlug').value = '';
  document.getElementById('newScreenLocation').value = '';
  showToast('Screen created');
  await loadData();
}

async function newPlaylist() {
  const name = prompt('New playlist name:');
  if (!name) return;
  const created = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  selectedPlaylistId = created.id;
  showToast('Playlist created');
  await loadData();
}

async function savePlaylist() {
  const playlist = getCurrentPlaylist();
  if (!playlist) return;
  const name = document.getElementById('playlistName').value.trim() || playlist.name;
  await api(`/api/playlists/${playlist.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      items: playlist.items.map((item) => ({
        widget_type: item.widget_type,
        title: item.title || '',
        duration_seconds: Number(item.duration_seconds || 30),
        config: item.config || {}
      }))
    })
  });
  showToast('Playlist saved');
  await loadData();
}

async function saveBranding() {
  await api('/api/branding', {
    method: 'PUT',
    body: JSON.stringify({
      schoolName: document.getElementById('brandSchoolName').value,
      slogan: document.getElementById('brandSlogan').value,
      backgroundColor: document.getElementById('brandBackgroundColor').value,
      accentColor: document.getElementById('brandAccentColor').value,
      panelColor: document.getElementById('brandPanelColor').value,
      textColor: document.getElementById('brandTextColor').value,
      logoUrl: document.getElementById('brandLogoUrl').value
    })
  });
  showToast('Branding saved');
  await loadData();
}

async function saveScreenTheme() {
  const screen = currentThemeScreen();
  if (!screen) return;
  screen.theme = {
    schoolName: document.getElementById('themeSchoolName').value.trim(),
    slogan: document.getElementById('themeSlogan').value.trim(),
    backgroundColor: document.getElementById('themeBackgroundColor').value,
    accentColor: document.getElementById('themeAccentColor').value,
    panelColor: document.getElementById('themePanelColor').value,
    textColor: document.getElementById('themeTextColor').value,
    logoUrl: document.getElementById('themeLogoUrl').value.trim()
  };
  await saveScreen(screen);
  showToast('Per-screen style saved');
  await loadData();
}

async function clearScreenTheme() {
  const screen = currentThemeScreen();
  if (!screen) return;
  screen.theme = {};
  await saveScreen(screen);
  showToast('Per-screen style reset');
  await loadData();
}

async function loadEmergency() {
  const emergency = await api('/api/emergency');
  document.getElementById('emergencyTitle').value = emergency.title || '';
  document.getElementById('emergencyMessage').value = emergency.message || '';
}

async function saveEmergency(active) {
  await api('/api/emergency', {
    method: 'PUT',
    body: JSON.stringify({
      active,
      title: document.getElementById('emergencyTitle').value,
      message: document.getElementById('emergencyMessage').value
    })
  });
  showToast(active ? 'Emergency override activated' : 'Emergency override cleared');
}

async function uploadAsset() {
  const fileInput = document.getElementById('assetFile');
  const file = fileInput.files[0];
  if (!file) return showToast('Choose a file first');
  const form = new FormData();
  form.append('kind', document.getElementById('assetKind').value);
  form.append('file', file);
  await api('/api/assets', { method: 'POST', body: form });
  fileInput.value = '';
  showToast('Media uploaded');
  await loadData();
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  showToast('Copied');
}

function useAssetAsLogo(url) {
  document.getElementById('brandLogoUrl').value = url;
  showToast('Logo URL inserted');
}

function setLogoFromLatest() {
  const latest = getAssetsByKind('image')[0];
  if (!latest) return showToast('Upload a logo image first');
  document.getElementById('brandLogoUrl').value = latest.url;
  showToast('Latest logo selected');
}

function getWidgetsByType(types = []) {
  const out = [];
  playlists.forEach(playlist => {
    (playlist.items || []).forEach((item, idx) => {
      if (types.includes(item.widget_type)) out.push({ playlist, item, idx });
    });
  });
  return out;
}

function renderMenusEditor() {
  const rows = getWidgetsByType(['breakfast','lunch','pdf']);
  document.getElementById('menusEditor').innerHTML = rows.length ? rows.map((row, i) => renderSpecialEditorCard(row, i, 'menus')).join('') : '<div class="help">No breakfast, lunch, or PDF menu slides found yet.</div>';
}

function renderAnnouncementsEditor() {
  const rows = getWidgetsByType(['announcements','rss','calendar','sports']);
  document.getElementById('announcementsEditor').innerHTML = rows.length ? rows.map((row, i) => renderSpecialEditorCard(row, i, 'announcements')).join('') : '<div class="help">No announcements or crawler slides found yet.</div>';
}

function renderSpecialEditorCard(row, index, mode) {
  const item = row.item;
  const cfg = item.config || {};
  const title = item.title || cfg.title || item.widget_type;
  const lines = Array.isArray(cfg.items) ? cfg.items.join('\n') : '';
  const events = Array.isArray(cfg.events) ? cfg.events.map(e => `${e.date || ''}|${e.text || ''}`).join('\n') : '';
  return `
    <div class="item-row" style="margin-bottom:14px">
      <div class="widget-card-top">
        <div class="row"><span class="pill">${escapeHtml(item.widget_type)}</span><span class="pill muted-pill">${escapeHtml(row.playlist.name)}</span></div>
        <button class="secondary" onclick="focusPlaylist(${row.playlist.id})">Open playlist</button>
      </div>
      <div class="grid grid-2 compact-grid">
        <div><label>Slide Title</label><input value="${escapeHtml(title)}" oninput="updateSpecialField(${row.playlist.id}, ${row.idx}, 'title', this.value, '${mode}')" /></div>
        <div><label>Seconds On Screen</label><input type="number" min="5" value="${Number(item.duration_seconds || 30)}" oninput="updateSpecialField(${row.playlist.id}, ${row.idx}, 'duration_seconds', Number(this.value || 30), '${mode}')" /></div>
      </div>
      ${item.widget_type === 'pdf' ? `
        <div class="grid grid-2 compact-grid">
          <div><label>Uploaded PDF</label><select onchange="updateSpecialConfig(${row.playlist.id}, ${row.idx}, 'url', this.value, '${mode}')">${assetOptions('pdf', cfg.url || '')}</select></div>
          <div><label>Frame Style</label><select onchange="updateSpecialConfig(${row.playlist.id}, ${row.idx}, 'pageMode', this.value, '${mode}')"><option value="fit-page" ${(cfg.pageMode || 'fit-page') === 'fit-page' ? 'selected' : ''}>Fit full page</option><option value="fit-width" ${cfg.pageMode === 'fit-width' ? 'selected' : ''}>Fill width</option></select></div>
        </div>
      ` : ''}
      ${['breakfast','lunch','announcements','sports'].includes(item.widget_type) ? `
        <div><label>Items — one per line</label><textarea oninput="updateSpecialList(${row.playlist.id}, ${row.idx}, this.value, '${mode}')">${escapeHtml(lines)}</textarea></div>
        <div class="grid grid-2 compact-grid">${getSpecialTickerSpeedHtml(row, mode)}</div>
      ` : ''}
      ${item.widget_type === 'rss' ? `
        <div class="grid grid-2 compact-grid">
          <div><label>RSS Feed URL</label><input value="${escapeHtml(cfg.url || '')}" oninput="updateSpecialConfig(${row.playlist.id}, ${row.idx}, 'url', this.value, '${mode}')" /></div>
          ${getSpecialTickerSpeedHtml(row, mode)}
        </div>
      ` : ''}
      ${item.widget_type === 'calendar' ? `
        <div><label>Events — one per line (Day|Text)</label><textarea oninput="updateSpecialEvents(${row.playlist.id}, ${row.idx}, this.value, '${mode}')">${escapeHtml(events)}</textarea></div>
        <div class="grid grid-2 compact-grid">${getSpecialTickerSpeedHtml(row, mode)}</div>
      ` : ''}
      <div class="row wrap-row" style="margin-top:12px">
        <button onclick="saveSpecificPlaylist(${row.playlist.id}, '${mode}')">Save ${escapeHtml(row.playlist.name)}</button>
      </div>
    </div>
  `;
}

function getSpecialTickerSpeedHtml(row, mode) {
  const cfg = row.item.config || {};
  return `
    <div>
      <label>Crawler speed (seconds)</label>
      <input type="number" min="8" max="60" step="1" value="${Number(cfg.tickerSpeedSec || 18)}" oninput="updateSpecialConfig(${row.playlist.id}, ${row.idx}, 'tickerSpeedSec', Number(this.value || 18), '${mode}')" />
      <div class="help">Higher number = slower crawl.</div>
    </div>
  `;
}

function updateSpecialField(playlistId, idx, field, value, mode) {
  const playlist = playlists.find(p => Number(p.id) === Number(playlistId));
  if (!playlist) return;
  playlist.items[idx][field] = value;
  if (mode === 'menus') renderMenusEditor();
  if (mode === 'announcements') renderAnnouncementsEditor();
}

function updateSpecialConfig(playlistId, idx, key, value, mode) {
  const playlist = playlists.find(p => Number(p.id) === Number(playlistId));
  if (!playlist) return;
  playlist.items[idx].config = playlist.items[idx].config || {};
  playlist.items[idx].config[key] = value;
  if (mode === 'menus') renderMenusEditor();
  if (mode === 'announcements') renderAnnouncementsEditor();
}

function updateSpecialList(playlistId, idx, value, mode) {
  updateSpecialConfig(playlistId, idx, 'items', String(value || '').split('\n').map(x => x.trim()).filter(Boolean), mode);
}
function updateSpecialEvents(playlistId, idx, value, mode) {
  const rows = String(value || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [date, ...rest] = line.split('|');
    return { date: (date || '').trim(), text: rest.join('|').trim() };
  });
  updateSpecialConfig(playlistId, idx, 'events', rows, mode);
}

async function saveSpecificPlaylist(playlistId, mode) {
  const playlist = playlists.find(p => Number(p.id) === Number(playlistId));
  if (!playlist) return;
  await api(`/api/playlists/${playlist.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: playlist.name,
      items: playlist.items.map((item) => ({
        widget_type: item.widget_type,
        title: item.title || '',
        duration_seconds: Number(item.duration_seconds || 30),
        config: item.config || {}
      }))
    })
  });
  showToast(`Saved ${playlist.name}`);
  await loadData();
  if (mode === 'menus') showTab('menus');
  if (mode === 'announcements') showTab('announcements');
}

function focusPlaylist(playlistId) {
  selectedPlaylistId = Number(playlistId);
  renderPlaylistSelectors();
  renderPlaylistEditor();
  showTab('playlists');
}

window.showTab = showTab;
window.loadData = loadData;
window.selectPlaylist = selectPlaylist;
window.selectThemeScreen = selectThemeScreen;
window.updateScreenPlaylist = updateScreenPlaylist;
window.createScreen = createScreen;
window.newPlaylist = newPlaylist;
window.savePlaylist = savePlaylist;
window.saveBranding = saveBranding;
window.saveScreenTheme = saveScreenTheme;
window.clearScreenTheme = clearScreenTheme;
window.saveEmergency = saveEmergency;
window.uploadAsset = uploadAsset;
window.copyText = copyText;
window.useAssetAsLogo = useAssetAsLogo;
window.setLogoFromLatest = setLogoFromLatest;
window.addPlaylistItem = addPlaylistItem;
window.addPreset = addPreset;
window.removePlaylistItem = removePlaylistItem;
window.updateItemField = updateItemField;
window.updateItemConfig = updateItemConfig;
window.updateListConfig = updateListConfig;
window.updateEventsConfig = updateEventsConfig;
window.updateItemJson = updateItemJson;
window.onTypeChanged = onTypeChanged;
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.handleDragEnd = handleDragEnd;
window.updateScreenScheduleText = updateScreenScheduleText;
window.saveScreenSchedule = saveScreenSchedule;
window.updateSpecialField = updateSpecialField;
window.updateSpecialConfig = updateSpecialConfig;
window.updateSpecialList = updateSpecialList;
window.updateSpecialEvents = updateSpecialEvents;
window.saveSpecificPlaylist = saveSpecificPlaylist;
window.focusPlaylist = focusPlaylist;

loadData().catch(err => showToast(err.message));
