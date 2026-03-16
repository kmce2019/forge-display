const params = new URLSearchParams(window.location.search);
const previewMode = params.get('preview') === '1';

const socket = io();
const slug = window.location.pathname.split('/').pop();
let bundle = null;
let currentIndex = 0;
let rotateTimer = null;
let tickerTimer = null;

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function api(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadBundle() {
  bundle = await api(`/api/screen/${slug}/bundle`);
  applyBranding(bundle.branding);
  renderEmergency(bundle.emergency);
  currentIndex = 0;
  rotate();
}

socket.emit('screen:join', slug);
socket.on('screen:update', (nextBundle) => {
  bundle = nextBundle;
  applyBranding(bundle.branding);
  renderEmergency(bundle.emergency);
  currentIndex = 0;
  rotate();
});

function applyBranding(branding = {}) {
  document.documentElement.style.setProperty('--bg', branding.backgroundColor || '#0f172a');
  document.documentElement.style.setProperty('--accent', branding.accentColor || '#f97316');
  document.documentElement.style.setProperty('--panel', branding.panelColor || '#111827');
  document.documentElement.style.setProperty('--text', branding.textColor || '#f9fafb');
  document.body.classList.toggle('preview-mode', previewMode);
  document.getElementById('brandBar').innerHTML = `
    <div class="brand-left">
      ${branding.logoUrl ? `<img class="brand-logo" src="${escapeHtml(branding.logoUrl)}" alt="logo" />` : ''}
      <div>
        <div class="brand-name">${escapeHtml(branding.schoolName || 'IdleScreens Pro')}</div>
        <div class="brand-slogan">${escapeHtml(branding.slogan || '')}</div>
      </div>
    </div>
    <div class="brand-right">${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
  `;
}

function renderEmergency(emergency = {}) {
  const overlay = document.getElementById('emergencyOverlay');
  if (!emergency.active) {
    overlay.innerHTML = '';
    return;
  }
  overlay.innerHTML = `
    <div class="emergency">
      <div>
        <div class="emergency-title">${escapeHtml(emergency.title || 'Emergency')}</div>
        <div class="emergency-message">${escapeHtml(emergency.message || '')}</div>
      </div>
    </div>
  `;
}

function weatherCodeMeta(code = 0, isDay = 1) {
  const map = {
    0: { label: 'Clear', icon: isDay ? '☀️' : '🌙' },
    1: { label: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' },
    2: { label: 'Partly cloudy', icon: '⛅' },
    3: { label: 'Cloudy', icon: '☁️' },
    45: { label: 'Fog', icon: '🌫️' },
    48: { label: 'Fog', icon: '🌫️' },
    51: { label: 'Light drizzle', icon: '🌦️' },
    53: { label: 'Drizzle', icon: '🌦️' },
    55: { label: 'Heavy drizzle', icon: '🌧️' },
    61: { label: 'Light rain', icon: '🌦️' },
    63: { label: 'Rain', icon: '🌧️' },
    65: { label: 'Heavy rain', icon: '⛈️' },
    71: { label: 'Light snow', icon: '🌨️' },
    73: { label: 'Snow', icon: '🌨️' },
    75: { label: 'Heavy snow', icon: '❄️' },
    80: { label: 'Rain showers', icon: '🌦️' },
    81: { label: 'Rain showers', icon: '🌧️' },
    82: { label: 'Heavy showers', icon: '⛈️' },
    95: { label: 'Thunderstorm', icon: '⛈️' }
  };
  return map[code] || { label: 'Weather', icon: '🌤️' };
}

function setTicker(text = 'IdleScreens Pro', seconds = 18) {
  const el = document.getElementById('tickerText');
  const ticker = document.querySelector('.ticker');
  if (previewMode) {
    ticker.style.display = 'none';
    return;
  }
  ticker.style.display = '';
  el.textContent = text;
  const duration = Math.max(8, Number(seconds || 18));
  el.style.animationDuration = `${duration}s`;
}

async function renderWidget(item) {
  const root = document.getElementById('widgetRoot');
  root.classList.remove('pdf-mode');
  const cfg = item.config || {};
  if (item.widget_type === 'weather') {
    try {
      const weather = await api(`/api/weather?lat=${cfg.latitude}&lon=${cfg.longitude}`);
      const current = weather.current || {};
      const meta = weatherCodeMeta(current.weather_code, current.is_day);
      const hi = weather.daily?.temperature_2m_max?.[0];
      const lo = weather.daily?.temperature_2m_min?.[0];
      root.innerHTML = `
        <div class="weather-split">
          <div class="weather-left">
            <div class="widget-title">${escapeHtml(cfg.locationName || item.title || 'Weather')}</div>
            <div class="widget-big">${Math.round(current.temperature_2m || 0)}°F</div>
            <div class="widget-muted">${escapeHtml(meta.label)} • Wind ${Math.round(current.wind_speed_10m || 0)} mph</div>
            <div class="weather-range">High ${Math.round(hi || 0)}° • Low ${Math.round(lo || 0)}°</div>
          </div>
          <div class="weather-right ${cfg.showIconPanel === false ? 'hidden' : ''}">
            <div class="weather-icon">${meta.icon}</div>
            <div class="weather-caption">${escapeHtml(meta.label)}</div>
          </div>
        </div>
      `;
      setTicker(`${cfg.locationName || 'Weather'} • ${meta.label} • ${Math.round(current.temperature_2m || 0)}°F`, Number(cfg.tickerSpeedSec || 18));
      return;
    } catch (err) {
      root.innerHTML = `<div class="widget-title">Weather unavailable</div><div class="widget-muted">${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  if (item.widget_type === 'announcements' || item.widget_type === 'breakfast' || item.widget_type === 'lunch' || item.widget_type === 'sports' || item.widget_type === 'calendar') {
    const list = cfg.items || cfg.events || [];
    root.innerHTML = `
      <div class="widget-title">${escapeHtml(cfg.title || item.title || 'Updates')}</div>
      <div class="widget-list">${list.map((entry) => `<div>• ${escapeHtml(typeof entry === 'string' ? entry : `${entry.date || ''} ${entry.text || ''}`.trim())}</div>`).join('')}</div>
    `;
    setTicker((cfg.title || item.title || 'Updates') + ' • ' + list.map((entry) => typeof entry === 'string' ? entry : `${entry.date || ''} ${entry.text || ''}`.trim()).join(' • '), Number(cfg.tickerSpeedSec || 18));
    return;
  }

  if (item.widget_type === 'rss') {
    try {
      const feed = await api(`/api/rss?url=${encodeURIComponent(cfg.url || '')}`);
      root.innerHTML = `
        <div class="widget-title">${escapeHtml(cfg.title || feed.title || item.title || 'Headlines')}</div>
        <div class="widget-list">${(feed.items || []).slice(0, 5).map((x) => `<div>• ${escapeHtml(x.title)}</div>`).join('')}</div>
      `;
      setTicker((feed.items || []).map((x) => x.title).join(' • '), Number(cfg.tickerSpeedSec || 28));
      return;
    } catch (err) {
      root.innerHTML = `<div class="widget-title">RSS unavailable</div><div class="widget-muted">${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  if (item.widget_type === 'html') {
    root.innerHTML = cfg.html || '<div class="widget-title">HTML Widget</div>';
    setTicker(item.title || 'Custom HTML', Number(cfg.tickerSpeedSec || 18));
    return;
  }

  if (item.widget_type === 'image') {
    root.innerHTML = `
      <div class="widget-title">${escapeHtml(cfg.title || item.title || 'Image')}</div>
      <div class="media-frame"><img class="media-image" src="${escapeHtml(cfg.url || '')}" /></div>
    `;
    setTicker(cfg.title || item.title || 'Image slide', Number(cfg.tickerSpeedSec || 18));
    return;
  }

  if (item.widget_type === 'video') {
    root.innerHTML = `
      <div class="widget-title">${escapeHtml(cfg.title || item.title || 'Video')}</div>
      <div class="media-frame"><video class="media-video" src="${escapeHtml(cfg.url || '')}" autoplay muted loop playsinline controls></video></div>
    `;
    setTicker(cfg.title || item.title || 'Video slide', Number(cfg.tickerSpeedSec || 18));
    return;
  }

  if (item.widget_type === 'pdf') {
    root.classList.add('pdf-mode');
    root.innerHTML = `
      <div class="pdf-widget">
        ${cfg.hideTitle ? '' : `<div class="pdf-header">${escapeHtml(cfg.title || item.title || 'PDF')}</div>`}
        <div class="pdf-stage"><canvas id="pdfCanvas" class="pdf-canvas"></canvas></div>
      </div>
    `;
    setTicker(cfg.title || item.title || 'PDF slide', Number(cfg.tickerSpeedSec || 18));
    renderPdfToCanvas(cfg.url, cfg.pageMode || 'fit-page');
    return;
  }

  root.innerHTML = `<div class="widget-title">${escapeHtml(item.title || item.widget_type)}</div><div class="widget-muted">No renderer yet.</div>`;
  setTicker(item.title || item.widget_type, Number(cfg.tickerSpeedSec || 18));
}

async function renderPdfToCanvas(url, pageMode = 'fit-page') {
  const canvas = document.getElementById('pdfCanvas');
  if (!canvas || !url) {
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }
  if (!window['pdfjsLib']) {
    canvas.outerHTML = `<iframe class="widget-embed" src="${escapeHtml(url)}#view=FitH"></iframe>`;
    return;
  }
  const pdf = await window['pdfjsLib'].getDocument(url).promise;
  const page = await pdf.getPage(1);
  const parent = document.querySelector('.pdf-stage');
  const baseViewport = page.getViewport({ scale: 1 });
  const widthScale = (parent.clientWidth * 0.999) / baseViewport.width;
  const heightScale = (parent.clientHeight * 0.999) / baseViewport.height;
  const scale = pageMode === 'fit-width' ? widthScale : Math.min(widthScale, heightScale);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: context, viewport }).promise;
}

function rotate() {
  if (!bundle?.playlist?.items?.length) {
    document.getElementById('widgetRoot').innerHTML = '<div class="widget-title">No playlist items assigned</div>';
    return;
  }
  clearTimeout(rotateTimer);
  const item = bundle.playlist.items[currentIndex % bundle.playlist.items.length];
  renderWidget(item);
  rotateTimer = setTimeout(() => {
    currentIndex = (currentIndex + 1) % bundle.playlist.items.length;
    rotate();
  }, (Number(item.duration_seconds || 30) * 1000));
}

setInterval(() => {
  fetch(`/api/screen/${slug}/heartbeat`, { method: 'POST' }).catch(() => {});
  const right = document.querySelector('.brand-right');
  if (right) right.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}, 15000);

window.addEventListener('resize', () => {
  const current = bundle?.playlist?.items?.[currentIndex % (bundle?.playlist?.items?.length || 1)];
  if (current?.widget_type === 'pdf') renderPdfToCanvas(current.config?.url, current.config?.pageMode || 'fit-page');
});

if (previewMode) {
  const ticker = document.querySelector('.ticker'); if (ticker) ticker.style.display = 'none';
}

loadBundle().catch((err) => {
  document.getElementById('widgetRoot').innerHTML = `<div class="widget-title">Display load failed</div><div class="widget-muted">${escapeHtml(err.message)}</div>`;
});
