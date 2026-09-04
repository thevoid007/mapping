/* ============================================================
   MAPPING - Aplikasi Frontend
   Peta Leaflet + OpenStreetMap, geocoding Nominatim,
   manajemen multi-rute (tiap rute punya titik, radius, azimut,
   beam width sendiri), dan integrasi database.
   ============================================================ */

'use strict';

// ---------- State aplikasi ----------
const App = {
  map: null,
  routes: [],           // [{ id, name, color, visible, points: [{label,lat,lng,status,radius,azimuth,beamWidth}] }]
  activeRouteId: null,  // id rute yang sedang diedit di panel planner
  markerLayer: null,
  routeLayer: null,
  sectorLayer: null,
  dirLayer: null,
  distance: 0,
  committing: false,
};

// ---------- Pilihan warna per rute ----------
const ROUTE_COLORS = [
  '#3ec6ff', '#2ee59d', '#ff5c7a', '#ff7b00', '#e040fb',
  '#ffd54a', '#00e5ff', '#76ff03', '#ff4081', '#b2ff59',
];

let routeColorIdx = 0;
function nextRouteColor() {
  const c = ROUTE_COLORS[routeColorIdx % ROUTE_COLORS.length];
  routeColorIdx++;
  return c;
}

// ---------- Elemen DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  map: $('#map'),
  pointsList: $('#pointsList'),
  pointRowTemplate: $('#pointRowTemplate'),
  form: $('#pointForm'),
  tripName: $('#tripName'),
  tripDescription: $('#tripDescription'),
  btnMapAll: $('#btnMapAll'),
  btnClearAll: $('#btnClearAll'),
  btnAddPoint: $('#btnAddPoint'),
  btnSaveTrip: $('#btnSaveTrip'),
  btnAddRoute: $('#btnAddRoute'),
  routeTabs: $('#routeTabs'),
  stats: { points: $('#statPoints'), distance: $('#statDistance') },
  toast: $('#toast'),
  mapNotice: $('#mapNotice'),
  mapNoticeText: $('#mapNoticeText'),
  mapNoticeClose: $('#mapNoticeClose'),
  tabs: $$('[data-tab-btn]'),
  panels: $$('.tab-panel'),
  savedList: $('#savedList'),
  savedEmpty: $('#savedEmpty'),
};

// ============================================================
// UTILITAS
// ============================================================

const fmtNum = (n) => Number(n).toLocaleString('id-ID');

// Kunci akses ke rute aktif & poin aktif
function getActiveRoute() {
  return App.routes.find((r) => r.id === App.activeRouteId) || null;
}
function getActivePoints() {
  const r = getActiveRoute();
  return r ? r.points : [];
}
function setActivePoints(pts) {
  const r = getActiveRoute();
  if (r) r.points = pts;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showToast(message, type = 'info', duration = 3200) {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, duration);
}

function showMapNotice(message, type = 'info') {
  els.mapNoticeText.textContent = message;
  els.mapNotice.className = `map-notice ${type} glass`;
  els.mapNotice.hidden = false;
}

function hideMapNotice() {
  els.mapNotice.hidden = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// GEODESIK - Destination point dan sektor
// ============================================================

function destinationPoint(lat, lng, bearing, distanceM) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const brng = toRad(bearing);
  const angDist = distanceM / R;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngDist = Math.sin(angDist);
  const cosAngDist = Math.cos(angDist);

  const lat2 = Math.asin(
    sinLat1 * cosAngDist + cosLat1 * sinAngDist * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * sinAngDist * cosLat1,
      cosAngDist - sinLat1 * Math.sin(lat2)
    );

  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

function computeSectorPolygon(lat, lng, azimuth, beamWidth, radius) {
  const steps = Math.max(16, Math.ceil(Math.abs(beamWidth) / 3));
  const startAngle = azimuth - beamWidth / 2;
  const endAngle = azimuth + beamWidth / 2;
  const arc = endAngle - startAngle;
  const coords = [];

  coords.push([lng, lat]);

  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (arc * i) / steps;
    const normAngle = ((angle % 360) + 360) % 360;
    const pt = destinationPoint(lat, lng, normAngle, radius);
    coords.push([pt.lng, pt.lat]);
  }

  coords.push([lng, lat]);
  return coords;
}

// ============================================================
// INISIALISASI PETA
// ============================================================

function initMap() {
  App.map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView(
    [-2.5489, 118.0149],
    5
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(App.map);

  App.markerLayer = L.layerGroup().addTo(App.map);
  App.routeLayer = L.layerGroup().addTo(App.map);
  App.sectorLayer = L.layerGroup().addTo(App.map);
  App.dirLayer = L.layerGroup().addTo(App.map);

  initLayerControl();

  App.map.on('click', (e) => {
    addPointRow('', e.latlng.lat, e.latlng.lng);
  });
}

// ============================================================
// LAYER CONTROL
// ============================================================

function initLayerControl() {
  const ctrl = L.DomUtil.create('div', 'layer-ctrl');
  ctrl.innerHTML = `
    <div class="layer-ctrl-title">Layer</div>
    <label><input type="checkbox" checked data-layer-toggle="route"> Garis Rute</label>
    <label><input type="checkbox" checked data-layer-toggle="marker"> Marker Titik</label>
    <label><input type="checkbox" checked data-layer-toggle="sector"> Area Radius/Sektor</label>
  `;

  const CustomControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      L.DomEvent.disableClickPropagation(ctrl);
      L.DomEvent.disableScrollPropagation(ctrl);
      return ctrl;
    },
  });

  new CustomControl().addTo(App.map);

  ctrl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = cb.dataset.layerToggle;
      if (layer === 'route') {
        cb.checked ? App.routeLayer.addTo(App.map) : App.map.removeLayer(App.routeLayer);
      } else if (layer === 'marker') {
        cb.checked ? App.markerLayer.addTo(App.map) : App.map.removeLayer(App.markerLayer);
      } else if (layer === 'sector') {
        if (cb.checked) {
          App.sectorLayer.addTo(App.map);
          App.dirLayer.addTo(App.map);
        } else {
          App.map.removeLayer(App.sectorLayer);
          App.map.removeLayer(App.dirLayer);
        }
      }
    });
  });
}

// ============================================================
// MANAJEMEN RUTE (multi-rute)
// ============================================================

function createRoute(name, points = null) {
  const id = 'route-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const route = {
    id,
    name: name || 'Rute ' + (App.routes.length + 1),
    color: nextRouteColor(),
    visible: true,
    points: points || [],
  };
  App.routes.push(route);
  return route;
}

function addRoute() {
  // Simpan nama rute yang sedang aktif sebelum berpindah
  const prevActive = getActiveRoute();
  if (prevActive) prevActive.name = els.tripName.value.trim() || prevActive.name;

  const route = createRoute('Rute ' + (App.routes.length + 1));
  App.activeRouteId = route.id;
  loadRouteIntoPanel(route);
  renderRouteTabs();
  renderAllRoutes();
  showToast(`Rute "${route.name}" dibuat.`, 'success');
  els.tripName.focus();
  els.tripName.select();
}

function selectRoute(id) {
  // simpan dulu nama rute aktif yang sedang diedit
  const active = getActiveRoute();
  if (active) active.name = els.tripName.value.trim() || active.name;

  App.activeRouteId = id;
  const route = getActiveRoute();
  if (route) loadRouteIntoPanel(route);
  renderRouteTabs();
}

function deleteRoute(id) {
  const route = App.routes.find((r) => r.id === id);
  if (!route) return;

  openConfirm({
    title: 'Hapus Rute',
    text: `Hapus rute "${route.name}" dari peta? Tindakan ini hanya menghapus dari sesi, tidak dari database.`,
    okText: 'Ya, hapus',
    onOk: () => {
      const idx = App.routes.findIndex((r) => r.id === id);
      App.routes.splice(idx, 1);

      if (App.activeRouteId === id) {
        if (App.routes.length > 0) {
          App.activeRouteId = App.routes[Math.max(0, idx - 1)].id;
        } else {
          App.activeRouteId = null;
        }
      }

      if (App.activeRouteId) {
        const cur = getActiveRoute();
        loadRouteIntoPanel(cur);
      } else {
        addRoute(); // selalu minimal 1 rute
        return;
      }

      renderRouteTabs();
      renderAllRoutes();
      showToast(`Rute "${route.name}" dihapus.`, 'info');
    },
  });
}

function renderRouteTabs() {
  els.routeTabs.innerHTML = '';

  if (App.routes.length === 0) {
    els.routeTabs.innerHTML = '<div class="muted" style="padding:4px 2px">Belum ada rute. Tambahkan rute baru.</div>';
    return;
  }

  App.routes.forEach((r) => {
    const tab = document.createElement('div');
    tab.className = 'route-tab' + (r.id === App.activeRouteId ? ' active' : '');

    tab.innerHTML = `
      <span class="route-dot" style="background:${r.color}"></span>
      <span class="route-tab-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
      <span class="route-tab-toggle"><input type="checkbox" ${r.visible ? 'checked' : ''} title="Tampilkan/sembunyikan di peta"></span>
      <button type="button" class="route-tab-del" title="Hapus rute">✕</button>
    `;

    tab.querySelector('.route-tab-name').addEventListener('click', () => selectRoute(r.id));
    tab.querySelector('.route-dot').addEventListener('click', () => selectRoute(r.id));
    const visInput = tab.querySelector('input[type="checkbox"]');
    visInput.addEventListener('change', (e) => {
      e.stopPropagation();
      r.visible = visInput.checked;
      renderRouteTabs();
      renderAllRoutes();
      updateStats();
    });
    tab.querySelector('.route-tab-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRoute(r.id);
    });

    els.routeTabs.appendChild(tab);
  });
}

function loadRouteIntoPanel(route) {
  // Bersihkan panel dan isi dengan titik rute
  els.pointsList.innerHTML = '';
  els.tripName.value = route.name;

  // Rebuild DOM rows
  route.points.forEach((p) => {
    const template = els.pointRowTemplate.content.cloneNode(true);
    const row = template.querySelector('.point-row');
    const input = row.querySelector('.point-input');
    input.value = p.label || '';
    row.querySelector('.radius-input').value = p.radius || 300;
    row.querySelector('.azimuth-input').value = p.azimuth || 0;
    row.querySelector('.beam-input').value = p.beamWidth || 360;
    els.pointsList.appendChild(row);
    attachRowEvents(row);
    if (p.lat != null && p.lng != null) markRowStatus(row, 'ok');
    else markRowStatus(row, 'pending');
  });

  updateOrderBadges();
  updateStats();
}

// ============================================================
// MANAJEMEN BARIS TITIK (DOM)
// ============================================================

function collectRows() {
  return Array.from(els.pointsList.querySelectorAll('.point-row')).map((row, i) => ({
    index: i,
    el: row,
    input: row.querySelector('.point-input'),
    orderBadge: row.querySelector('.order-badge'),
    statusEl: row.querySelector('.point-status'),
    radiusInput: row.querySelector('.radius-input'),
    azimuthInput: row.querySelector('.azimuth-input'),
    beamInput: row.querySelector('.beam-input'),
    errorEl: row.querySelector('.point-error'),
  }));
}

function addPointRow(label = '', lat = null, lng = null, radius = 300, azimuth = 0, beamWidth = 360) {
  const template = els.pointRowTemplate.content.cloneNode(true);
  const row = template.querySelector('.point-row');

  const input = row.querySelector('.point-input');
  input.value = label;

  row.querySelector('.radius-input').value = radius;
  row.querySelector('.azimuth-input').value = azimuth;
  row.querySelector('.beam-input').value = beamWidth;

  els.pointsList.appendChild(row);
  attachRowEvents(row);

  const pts = getActivePoints();
  pts.push({
    label,
    lat,
    lng,
    status: lat != null && lng != null ? 'ok' : 'pending',
    radius: parseFloat(radius) || 300,
    azimuth: parseFloat(azimuth) || 0,
    beamWidth: parseFloat(beamWidth) || 360,
  });
  setActivePoints(pts);

  if (lat != null && lng != null) {
    markRowStatus(row, 'ok');
    renderAllRoutes();
    input.focus();
  } else {
    markRowStatus(row, 'pending');
    input.focus();
  }

  updateOrderBadges();
  updateStats();
}

function focusLastInput() {
  const inputs = els.pointsList.querySelectorAll('.point-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function removePointRow(row) {
  const idx = indexOfRow(row);
  row.remove();
  const pts = getActivePoints();
  if (idx >= 0 && idx < pts.length) pts.splice(idx, 1);
  setActivePoints(pts);
  updateOrderBadges();
  renderAllRoutes();
  updateStats();

  if (row.dataset.query) {
    const q = row.dataset.query;
    pendingGeocodes.delete(q);
  }
}

function indexOfRow(row) {
  return Array.from(els.pointsList.children).indexOf(row);
}

function updateOrderBadges() {
  collectRows().forEach(({ orderBadge, input }) => {
    const idx = indexOfRow(input.closest('.point-row'));
    orderBadge.textContent = idx + 1;
    orderBadge.title = `Urutan ${idx + 1}`;
  });
}

function markRowStatus(row, status) {
  const statusEl = row.querySelector('.point-status');
  const input = row.querySelector('.point-input');

  statusEl.className = 'point-status';
  if (status === 'ok') {
    statusEl.textContent = '✓';
    statusEl.classList.add('ok');
    input.style.borderColor = '';
  } else if (status === 'err') {
    statusEl.textContent = '!';
    statusEl.classList.add('err');
    input.style.borderColor = 'var(--danger)';
  } else if (status === 'loading') {
    statusEl.textContent = '◌';
    statusEl.classList.add('loading');
  } else {
    statusEl.textContent = '';
    input.style.borderColor = '';
  }
}

function showRowError(row, msg) {
  const el = row.querySelector('.point-error');
  const errEl = row.querySelector('.radius-input, .azimuth-input, .beam-input');
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
    if (errEl) errEl.classList.add('invalid');
  } else {
    el.textContent = '';
    el.hidden = true;
    row.querySelectorAll('.field-input').forEach(i => i.classList.remove('invalid'));
  }
}

function attachRowEvents(row) {
  const input = row.querySelector('.point-input');
  const upBtn = row.querySelector('.up-btn');
  const downBtn = row.querySelector('.down-btn');
  const removeBtn = row.querySelector('.remove-btn');
  const focusBtn = row.querySelector('.focus-btn');

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleGeocodeForRow(input.closest('.point-row'));
    }, 700);
  });

  upBtn.addEventListener('click', () => moveRow(row, -1));
  downBtn.addEventListener('click', () => moveRow(row, 1));
  removeBtn.addEventListener('click', () => removePointRow(row));
  focusBtn.addEventListener('click', () => focusPoint(indexOfRow(row)));

  let fieldDebounce;
  const onFieldInput = () => {
    clearTimeout(fieldDebounce);
    fieldDebounce = setTimeout(() => {
      const rRow = input.closest('.point-row');
      const idx = indexOfRow(rRow);
      const pts = getActivePoints();
      if (idx < 0 || idx >= pts.length) return;

      const r = parseFloat(row.querySelector('.radius-input').value);
      const a = parseFloat(row.querySelector('.azimuth-input').value);
      const b = parseFloat(row.querySelector('.beam-input').value);

      const errors = validatePointFields(r, a, b);
      if (errors.length) {
        showRowError(rRow, errors.join(' '));
      } else {
        showRowError(rRow, '');
        pts[idx].radius = r;
        pts[idx].azimuth = a;
        pts[idx].beamWidth = b;
      }

      renderAllRoutes();
      updateStats();
    }, 200);
  };

  row.querySelector('.radius-input').addEventListener('input', onFieldInput);
  row.querySelector('.azimuth-input').addEventListener('input', onFieldInput);
  row.querySelector('.beam-input').addEventListener('input', onFieldInput);

  initDragDrop(row);
}

function validatePointFields(r, a, b) {
  const e = [];
  if (isNaN(r) || r <= 0) e.push('Radius harus > 0.');
  if (isNaN(a) || a < 0 || a > 360) e.push('Azimut 0-360°.');
  if (isNaN(b) || b <= 0 || b > 360) e.push('Beam 1-360°.');
  return e;
}

// ============================================================
// GEOCODING
// ============================================================

async function handleGeocodeForRow(row) {
  const input = row.querySelector('.point-input');
  const query = input.value.trim();

  if (App.committing || !query) {
    markRowStatus(row, 'pending');
    input.title = '';
    row.dataset.query = '';
    return;
  }

  const pts = getActivePoints();
  const existing = pts[indexOfRow(row)];
  if (existing && existing.label === query && existing.status === 'ok') return;

  const coord = parseCoordinates(query);
  if (coord.ok) {
    const idx = indexOfRow(row);
    const cur = pts[idx] || {};
    pts[idx] = {
      label: `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,
      lat: coord.lat,
      lng: coord.lng,
      status: 'ok',
      radius: cur.radius || 300,
      azimuth: cur.azimuth || 0,
      beamWidth: cur.beamWidth || 360,
    };
    markRowStatus(row, 'ok');
    renderAllRoutes();
    updateStats();
    row.dataset.query = '';
    return;
  }

  row.dataset.query = query;
  markRowStatus(row, 'loading');

  try {
    const result = await geocode(query);
    if (!row.isConnected || row.dataset.query !== query) return;

    if (!result) {
      markRowStatus(row, 'err');
      row.dataset.query = '';
      input.title = 'Lokasi tidak ditemukan';
      showToast(`Lokasi "${query}" tidak ditemukan.`, 'error');
      return;
    }

    const idx = indexOfRow(row);
    const cur = pts[idx] || {};
    pts[idx] = {
      label: result.label || query,
      lat: result.lat,
      lng: result.lng,
      status: 'ok',
      radius: cur.radius || 300,
      azimuth: cur.azimuth || 0,
      beamWidth: cur.beamWidth || 360,
    };
    markRowStatus(row, 'ok');
    renderAllRoutes();
    updateStats();
    row.dataset.query = '';
  } catch (err) {
    if (row.isConnected) {
      markRowStatus(row, 'err');
      input.title = 'Gagal mencari lokasi';
      showToast('Gagal menghubungi layanan geocoding. Coba lagi.', 'error');
    }
  }
}

const pendingGeocodes = new Set();

async function geocode(query) {
  const cacheKey = 'geo:' + query.toLowerCase();
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const entry = JSON.parse(cached);
      if (Date.now() - entry.t < 3600e3) return entry.data;
    } catch (_) {}
  }

  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    'accept-language': 'id',
    addressdetails: '0',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  pendingGeocodes.add(query.toLowerCase());

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'id' },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error('Geocoding HTTP ' + res.status);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0];
    const result = {
      label: first.display_name || query,
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
    };
    if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
      sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: result }));
    }
    return result;
  } finally {
    clearTimeout(timeout);
    pendingGeocodes.delete(query.toLowerCase());
  }
}

function parseCoordinates(query) {
  const t = query.trim();
  if (!t) return { ok: false };

  const parts = t.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) return { ok: false };

  const lat = parseFloat(parts[0].replace(/[^\d.\-]/g, ''));
  const lng = parseFloat(parts[1].replace(/[^\d.\-]/g, ''));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false };

  return { ok: true, lat, lng };
}

// ============================================================
// RENDER PETA - SEMUA RUTE
// ============================================================

function renderAllRoutes() {
  App.markerLayer.clearLayers();
  App.routeLayer.clearLayers();
  App.sectorLayer.clearLayers();
  App.dirLayer.clearLayers();

  // Simpan dulu nama rute aktif dari input
  const active = getActiveRoute();
  if (active) active.name = els.tripName.value.trim() || active.name;

  const visibleRoutes = App.routes.filter((r) => r.visible);

  let allBounds = L.latLngBounds([]);
  let added = false;

  visibleRoutes.forEach((route) => {
    const pts = route.points.filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null);
    if (pts.length === 0) return;
    added = true;

    const color = route.color;

    // --- Marker ---
    pts.forEach((p, i) => {
      const kind = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'mid';
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="custom-marker">
            <div class="pin ${kind}" style="background:linear-gradient(135deg, ${color}, ${shadeColor(color)})"><span>${i + 1}</span></div>
            <div class="tail"></div>
          </div>`,
        iconSize: [30, 38],
        iconAnchor: [15, 38],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(App.markerLayer);

      const bwDeg = p.beamWidth || 360;
      const azDeg = p.azimuth || 0;
      const rad = p.radius || 300;
      const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
      const dirIdx = Math.round(azDeg / 45) % 8;

      const popupHtml = `
        <div class="popup-title">${escapeHtml(route.name)} &mdash; Titik ${i + 1} ${i === 0 ? '(Awal)' : i === pts.length - 1 ? '(Akhir)' : ''}</div>
        <div class="popup-coords">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
        <div class="popup-label" style="margin-top:6px">Radius: ${fmtNum(rad)} m | Azimut: ${fmtNum(azDeg)}° (${dirs[dirIdx]})</div>
        <div class="popup-label">Beam Width: ${fmtNum(bwDeg)}°</div>`;
      marker.bindPopup(popupHtml);

      marker.on('click', () => {
        App.map.panTo([p.lat, p.lng]);
      });

      allBounds.extend([p.lat, p.lng]);
    });

    // --- Garis Rute (warna rute) ---
    if (pts.length >= 2) {
      const latlngs = pts.map((p) => [p.lat, p.lng]);

      L.polyline(latlngs, {
        color: color,
        weight: 9,
        opacity: 0.22,
        lineCap: 'round',
      }).addTo(App.routeLayer);

      const line = L.polyline(latlngs, {
        color: color,
        weight: 5,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(App.routeLayer);

      line.bindPopup(`<div class="popup-title">${escapeHtml(route.name)}</div><div class="popup-coords">${pts.length} titik</div>`);
    }

    // --- Area per titik rute ini ---
    pts.forEach((p, i) => {
      const bw = p.beamWidth || 360;
      const az = p.azimuth || 0;
      const rad = p.radius || 300;

      if (bw >= 360) {
        const circle = L.circle([p.lat, p.lng], {
          radius: rad,
          color: color,
          fillColor: color,
          fillOpacity: 0.12,
          weight: 2,
          opacity: 0.55,
          dashArray: '6 4',
        }).addTo(App.sectorLayer);
        const b = circle.getBounds();
        allBounds.extend(b.getSouthWest());
        allBounds.extend(b.getNorthEast());
      } else {
        const coords = computeSectorPolygon(p.lat, p.lng, az, bw, rad);

        L.polygon(coords.map((c) => [c[1], c[0]]), {
          color: color,
          fillColor: color,
          fillOpacity: 0.18,
          weight: 2,
          opacity: 0.6,
        }).addTo(App.sectorLayer);

        L.polygon(coords.map((c) => [c[1], c[0]]), {
          color: color,
          weight: 1.5,
          opacity: 0.45,
          fillOpacity: 0,
          dashArray: '4 3',
        }).addTo(App.sectorLayer);

        const poly = coords.map((c) => [c[1], c[0]]);
        poly.forEach((ll) => allBounds.extend(ll));
      }

      // Garis arah azimut (oranye kontras, sama untuk semua rute)
      const AZ_COLOR = '#ff7b00';
      const dirEnd = destinationPoint(p.lat, p.lng, az, rad);

      L.polyline([[p.lat, p.lng], [dirEnd.lat, dirEnd.lng]], {
        color: '#ffffff',
        weight: 5,
        opacity: 0.6,
      }).addTo(App.dirLayer);

      L.polyline([[p.lat, p.lng], [dirEnd.lat, dirEnd.lng]], {
        color: AZ_COLOR,
        weight: 3,
        opacity: 0.95,
      }).addTo(App.dirLayer);
    });
  });

  // --- Jarak total: jumlah jarak tiap rute (per rute, tidak digabung antar rute) ---
  let total = 0;
  visibleRoutes.forEach((route) => {
    const rpts = route.points.filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null);
    for (let i = 1; i < rpts.length; i++) {
      total += haversineKm(rpts[i - 1].lat, rpts[i - 1].lng, rpts[i].lat, rpts[i].lng);
    }
  });
  App.distance = total;

  updateStats();
}

function shadeColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = 0.65;
  return '#' + [r, g, b].map((c) => Math.round(c * f).toString(16).padStart(2, '0')).join('');
}

function fitMapToRoutes() {
  const bounds = L.latLngBounds([]);
  let added = false;

  App.routes.forEach((route) => {
    if (!route.visible) return;
    route.points.forEach((p) => {
      if (p && p.status === 'ok' && p.lat != null && p.lng != null) {
        const rad = p.radius || 300;
        const rDeg = rad / 111320;
        bounds.extend([p.lat - rDeg * 1.2, p.lng - rDeg * 1.8]);
        bounds.extend([p.lat + rDeg * 1.2, p.lng + rDeg * 1.8]);
        added = true;
      }
    });
  });

  if (added && bounds.isValid()) {
    App.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }
}

function updateStats() {
  const totalPoints = App.routes.reduce((acc, r) => acc + r.points.length, 0);
  els.stats.points.textContent = fmtNum(totalPoints);
  els.stats.distance.textContent = App.distance >= 0.05 ? fmtNum(App.distance.toFixed(1)) : '0,0';
}

// ============================================================
// FOKUS AREA TITIK
// ============================================================

function focusPoint(idx) {
  const pts = getActivePoints();
  const p = pts[idx];
  if (!p || p.status !== 'ok' || p.lat == null || p.lng == null) return;

  const rad = p.radius || 300;
  const bw = p.beamWidth || 360;
  const rDeg = rad / 111320;
  const pad = bw < 360 ? rDeg * 1.4 : rDeg * 1.2;

  const bounds = L.latLngBounds([
    [p.lat - pad, p.lng - pad * 1.5],
    [p.lat + pad, p.lng + pad * 1.5],
  ]);
  App.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true });
}

// ============================================================
// DRAF & DROP (Ubah urutan titik)
// ============================================================

function initDragDrop(row) {
  let dragged = null;

  row.addEventListener('dragstart', (e) => {
    dragged = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', indexOfRow(row) + '');
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.classList.add('drag-over');
  });

  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (dragged && dragged !== row) {
      reorderPoints(dragged, row);
    }
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    collectRows().forEach((r) => r.el.classList.remove('drag-over'));
  });
}

function reorderPoints(fromRow, toRow) {
  const fromIdx = indexOfRow(fromRow);
  const toIdx = indexOfRow(toRow);

  if (fromIdx === toIdx) return;

  if (fromIdx < toIdx) toRow.after(fromRow);
  else toRow.before(fromRow);

  syncPointsFromDom();
  renderAllRoutes();
  updateOrderBadges();
}

function moveRow(row, delta) {
  const idx = indexOfRow(row);
  const target = idx + delta;
  if (target < 0 || target >= els.pointsList.children.length) return;

  const rows = Array.from(els.pointsList.children);
  const targetRow = rows[target];
  if (delta < 0) targetRow.before(row);
  else targetRow.after(row);

  syncPointsFromDom();
  renderAllRoutes();
  updateOrderBadges();
}

function syncPointsFromDom() {
  const rows = collectRows();
  const newPoints = rows.map(({ input, radiusInput, azimuthInput, beamInput }) => {
    const idx = indexOfRow(input.closest('.point-row'));
    const old = getActivePoints()[idx];

    const rVal = parseFloat(radiusInput.value);
    const aVal = parseFloat(azimuthInput.value);
    const bVal = parseFloat(beamInput.value);

    if (old) {
      return {
        ...old,
        label: input.value.trim() || old.label,
        radius: isNaN(rVal) ? old.radius : rVal,
        azimuth: isNaN(aVal) ? old.azimuth : aVal,
        beamWidth: isNaN(bVal) ? old.beamWidth : bVal,
      };
    }
    return {
      label: input.value.trim(),
      lat: null,
      lng: null,
      status: 'pending',
      radius: isNaN(rVal) ? 300 : rVal,
      azimuth: isNaN(aVal) ? 0 : aVal,
      beamWidth: isNaN(bVal) ? 360 : bVal,
    };
  });
  setActivePoints(newPoints);
}

// ============================================================
// Penyimpanan lokal untuk versi GitHub Pages
// ============================================================

async function apiFetch(url, method = 'GET', body = null) {
  const storageKey = 'mapping-trips';
  const trips = JSON.parse(localStorage.getItem(storageKey) || '[]');
  const query = new URL(url, window.location.href).searchParams;

  if (method === 'POST') {
    const trip = {
      id: Date.now(),
      name: body.name,
      description: body.description || '',
      points: body.points || [],
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    if (trips.some((item) => item.name === trip.name)) trip.name += ' (baru)';
    trips.unshift(trip);
    localStorage.setItem(storageKey, JSON.stringify(trips));
    return trip;
  }

  if (method === 'DELETE') {
    const remaining = trips.filter((trip) => String(trip.id) !== query.get('id'));
    localStorage.setItem(storageKey, JSON.stringify(remaining));
    return { success: true };
  }

  if (query.get('action') === 'get') {
    const trip = trips.find((item) => String(item.id) === query.get('id'));
    if (!trip) throw new Error('Rute tidak ditemukan.');
    return { trip };
  }

  return { trips };
}

// ============================================================
// LOGIKA UTAMA
// ============================================================

function validateActiveRoute() {
  const errors = [];
  const route = getActiveRoute();
  const name = els.tripName.value.trim();

  if (!name) {
    errors.push('Nama perjalanan wajib diisi.');
  } else if (name.length > 191) {
    errors.push('Nama perjalanan maksimal 191 karakter.');
  }

  const rows = collectRows();
  if (rows.length === 0) {
    errors.push('Tambahkan minimal satu lokasi.');
  }

  rows.forEach(({ input, radiusInput, azimuthInput, beamInput, el }) => {
    const val = input.value.trim();
    if (!val) {
      errors.push(`Titik ke-${indexOfRow(el) + 1}: lokasi wajib diisi.`);
    }

    const idx = indexOfRow(el);
    const p = getActivePoints()[idx];
    if (!(p && p.status === 'ok' && p.lat != null && p.lng != null)) {
      errors.push(`Titik ke-${idx + 1}: koordinat belum valid.`);
    }

    const r = parseFloat(radiusInput.value);
    const a = parseFloat(azimuthInput.value);
    const b = parseFloat(beamInput.value);
    const fieldErrs = validatePointFields(r, a, b);
    if (fieldErrs.length) {
      errors.push(`Titik ke-${idx + 1}: ${fieldErrs.join(' ')}`);
    }
  });

  return errors;
}

function getValidPoints(route) {
  return route.points
    .filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null)
    .map((p) => ({
      label: p.label,
      latitude: p.lat,
      longitude: p.lng,
      radius: p.radius || 300,
      azimuth: p.azimuth || 0,
      beamWidth: p.beamWidth || 360,
    }));
}

// ============================================================
// EVENT: FORM
// ============================================================

async function handleSubmit(e) {
  e.preventDefault();

  const rows = collectRows();

  if (rows.length === 0) {
    showToast('Tambahkan minimal satu lokasi terlebih dahulu.', 'error');
    return;
  }

  App.committing = true;
  els.btnMapAll.disabled = true;
  els.btnMapAll.textContent = 'Mencari lokasi…';

  try {
    const pts = getActivePoints();

    for (const { input, el } of rows) {
      const idx = indexOfRow(el);
      const existing = pts[idx];
      const query = input.value.trim();

      if (!query) {
        markRowStatus(el, 'err');
        continue;
      }

      if (existing && existing.label === query && existing.status === 'ok') {
        markRowStatus(el, 'ok');
        continue;
      }

      const coord = parseCoordinates(query);
      if (coord.ok) {
        const cur = pts[idx] || {};
        pts[idx] = {
          label: `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,
          lat: coord.lat,
          lng: coord.lng,
          status: 'ok',
          radius: cur.radius || 300,
          azimuth: cur.azimuth || 0,
          beamWidth: cur.beamWidth || 360,
        };
        markRowStatus(el, 'ok');
        continue;
      }

      markRowStatus(el, 'loading');

      try {
        const result = await geocode(query);
        if (result) {
          const cur = pts[idx] || {};
          pts[idx] = {
            label: result.label || query,
            lat: result.lat,
            lng: result.lng,
            status: 'ok',
            radius: cur.radius || 300,
            azimuth: cur.azimuth || 0,
            beamWidth: cur.beamWidth || 360,
          };
          markRowStatus(el, 'ok');
        } else {
          markRowStatus(el, 'err');
        }
      } catch (err) {
        markRowStatus(el, 'err');
      }

      await sleep(1100);
    }

    setActivePoints(pts);
    renderAllRoutes();
    fitMapToRoutes();

    const failed = collectRows().filter(({ el }) => {
      const idx = indexOfRow(el);
      const p = pts[idx];
      return !(p && p.status === 'ok');
    });

    if (failed.length === 0) {
      showToast('Semua lokasi berhasil ditemukan!', 'success');
    } else {
      showToast(`${failed.length} lokasi tidak ditemukan koordinatnya.`, 'error');
    }
  } finally {
    App.committing = false;
    els.btnMapAll.disabled = false;
    els.btnMapAll.textContent = '📍 Tandai Semua di Peta';
  }
}

function clearAllPoints(confirm = true) {
  const doClear = () => {
    els.pointsList.innerHTML = '';
    setActivePoints([]);
    App.distance = 0;
    renderAllRoutes();
    updateStats();
    hideMapNotice();
    showToast('Semua titik rute aktif telah dikosongkan.', 'info');
  };

  if (!confirm) { doClear(); return; }

  if (getActivePoints().length === 0) return;
  openConfirm({
    title: 'Kosongkan Semua?',
    text: 'Seluruh titik rute aktif akan dihapus dari daftar dan peta. Lanjutkan?',
    okText: 'Ya, kosongkan',
    onOk: doClear,
  });
}

// ============================================================
// SIMPAN & MUAT RUTE
// ============================================================

async function saveTrip() {
  const active = getActiveRoute();
  if (!active) return;

  const errors = validateActiveRoute();
  if (errors.length > 0) {
    showToast(errors[0], 'error');
    return;
  }

  const points = getValidPoints(active);

  els.btnSaveTrip.disabled = true;
  els.btnSaveTrip.textContent = 'Menyimpan…';

  try {
    const data = await apiFetch('api/trips.php', 'POST', {
      name: els.tripName.value.trim(),
      description: els.tripDescription.value.trim(),
      points,
    });

    showToast(`Rute "${data.name}" berhasil disimpan di browser.`, 'success');
    loadSavedTrips();
    els.tripName.value = data.name;
    active.name = data.name;
    renderRouteTabs();
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  } finally {
    els.btnSaveTrip.disabled = false;
    els.btnSaveTrip.textContent = '💾 Simpan di Browser';
  }
}

async function loadSavedTrips() {
  els.savedList.innerHTML = '<div class="loader"><div class="spinner"></div>Memuat…</div>';
  els.savedEmpty.hidden = true;

  try {
    const data = await apiFetch('api/trips.php?action=list', 'GET');
    const trips = data.trips || [];

    els.savedList.innerHTML = '';
    if (trips.length === 0) {
      els.savedEmpty.hidden = false;
      return;
    }

    trips.forEach((t) => renderSavedCard(t));
  } catch (err) {
    els.savedList.innerHTML = '<div class="loader">Gagal memuat rute tersimpan.</div>';
  }
}

function renderSavedCard(trip) {
  const card = document.createElement('div');
  card.className = 'saved-card';

  const points = Array.isArray(trip.points) ? trip.points : [];
  const dist = calcRouteDistance(points);

  card.innerHTML = `
    <div class="saved-card-head">
      <h3 title="${escapeHtml(trip.name)}">${escapeHtml(trip.name)}</h3>
    </div>
    <div class="saved-meta">
      <span>📍 ${points.length} titik</span>
      <span>📏 ${dist > 0 ? fmtNum(dist.toFixed(1)) : '—'} km</span>
      <span>🗓 ${escapeHtml(trip.created_at || '')}</span>
    </div>
    <div class="saved-actions">
      <button class="btn btn-secondary load-btn">📂 Muat</button>
      <button class="btn btn-ghost coords-btn">🧭 Lihat Koordinat</button>
      <button class="btn btn-danger delete-btn">🗑 Hapus</button>
    </div>`;

  card.querySelector('.load-btn').addEventListener('click', () => loadTripIntoPlanner(trip));
  card.querySelector('.coords-btn').addEventListener('click', () => showCoordsModal(trip));
  card.querySelector('.delete-btn').addEventListener('click', () =>
    deleteTrip(trip.id, trip.name)
  );

  els.savedList.appendChild(card);
}

function calcRouteDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(
      parseFloat(points[i - 1].latitude || points[i - 1].lat),
      parseFloat(points[i - 1].longitude || points[i - 1].lng),
      parseFloat(points[i].latitude || points[i].lat),
      parseFloat(points[i].longitude || points[i].lng)
    );
  }
  return total;
}

async function loadTripIntoPlanner(trip) {
  switchTab('planner');

  // Simpan nama rute yang sedang aktif sebelum membuat rute baru
  const prevActive = getActiveRoute();
  if (prevActive) prevActive.name = els.tripName.value.trim() || prevActive.name;

  try {
    const detail = await apiFetch('api/trips.php?action=get&id=' + trip.id, 'GET');
    const tripDetail = detail.trip || {};
    const pts = tripDetail.points || [];

    // Tambah sebagai rute baru (tidak menghapus rute aktif), supaya bisa tampil bersamaan
    const route = createRoute(trip.name);
    route.points = pts.map((p) => ({
      label: p.label,
      lat: parseFloat(p.latitude || p.lat),
      lng: parseFloat(p.longitude || p.lng),
      status: (p.latitude != null || p.lat != null) ? 'ok' : 'pending',
      radius: parseFloat(p.radius) || 300,
      azimuth: parseFloat(p.azimuth) || 0,
      beamWidth: parseFloat(p.beamWidth) || 360,
    }));

    App.activeRouteId = route.id;
    loadRouteIntoPanel(route);
    renderRouteTabs();
    renderAllRoutes();
    fitMapToRoutes();
    showToast(`Rute "${trip.name}" dimuat (${pts.length} titik).`, 'success');
  } catch (err) {
    showToast('Gagal memuat rute: ' + err.message, 'error');
  }
}

async function showCoordsModal(trip) {
  try {
    const detail = await apiFetch('api/trips.php?action=get&id=' + trip.id, 'GET');
    const tripDetail = detail.trip || {};
    const pts = tripDetail.points || [];

    let html = `<strong>${escapeHtml(trip.name)}</strong><br><br>`;
    if (pts.length === 0) {
      html += 'Rute ini tidak memiliki titik.';
    }
    pts.forEach((p, i) => {
      const r = parseFloat(p.radius) || 300;
      const a = parseFloat(p.azimuth) || 0;
      const b = parseFloat(p.beamWidth) || 360;
      html += `<div class="coord-line">
        <b>#${i + 1}</b> ${escapeHtml(p.label)}<br>
        <span class="coord-val">${parseFloat(p.latitude || p.lat).toFixed(6)}, ${parseFloat(p.longitude || p.lng).toFixed(6)}</span>
        <span class="coord-val">Radius: ${fmtNum(r)} m | Azimut: ${fmtNum(a)}° | Beam: ${fmtNum(b)}°</span>
      </div>`;
    });

    openInfoModal('Koordinat Rute', html);
  } catch (err) {
    showToast('Gagal mengambil koordinat.', 'error');
  }
}

function deleteTrip(id, name) {
  openConfirm({
    title: 'Hapus Rute',
    text: `Yakin ingin menghapus rute "${name}" dari database? Tindakan ini tidak dapat dibatalkan.`,
    okText: 'Ya, hapus',
    onOk: async () => {
      try {
        await apiFetch('api/trips.php?action=delete&id=' + id, 'DELETE');
        showToast(`Rute "${name}" telah dihapus.`, 'success');
        loadSavedTrips();
      } catch (err) {
        showToast('Gagal menghapus: ' + err.message, 'error');
      }
    },
  });
}

// ============================================================
// MODAL
// ============================================================

function openConfirm({ title, text, okText = 'Ya, lanjutkan', onOk }) {
  const overlay = $('#modalOverlay');
  $('#modalTitle').textContent = title;
  $('#modalText').innerHTML = escapeHtml(text);
  $('#modalOk').textContent = okText;

  overlay.hidden = false;

  const close = () => { overlay.hidden = true; cleanup(); };
  const okHandler = () => {
    close();
    if (typeof onOk === 'function') onOk();
  };
  const escHandler = (e) => { if (e.key === 'Escape') close(); };

  function cleanup() {
    $('#modalOk').removeEventListener('click', okHandler);
    $('#modalCancel').removeEventListener('click', close);
    overlay.removeEventListener('click', backDrop);
    document.removeEventListener('keydown', escHandler);
  }

  const backDrop = (e) => { if (e.target === overlay) close(); };

  $('#modalOk').addEventListener('click', okHandler);
  $('#modalCancel').addEventListener('click', close);
  overlay.addEventListener('click', backDrop);
  document.addEventListener('keydown', escHandler);
}

function openInfoModal(title, html) {
  const overlay = $('#modalOverlay');
  $('#modalTitle').textContent = title;
  $('#modalText').innerHTML = html;
  $('#modalText').style.textAlign = 'left';
  $('#modalText').style.fontSize = '13px';
  $('#modalText').style.lineHeight = '1.7';
  $('#modalText').style.maxHeight = '60vh';
  $('#modalText').style.overflowY = 'auto';
  $('#modalOk').textContent = 'Tutup';
  $('#modalOk').classList.remove('btn-danger');
  $('#modalOk').classList.add('btn-secondary');

  overlay.hidden = false;

  const close = () => {
    overlay.hidden = true;
    $('#modalText').style.textAlign = '';
    $('#modalText').style.fontSize = '';
    $('#modalText').style.maxHeight = '';
    $('#modalText').style.overflowY = '';
    $('#modalOk').classList.remove('btn-secondary');
    $('#modalOk').classList.add('btn-danger');
    $('#modalOk').removeEventListener('click', close);
    $('#modalCancel').removeEventListener('click', close);
    overlay.removeEventListener('click', backDrop);
    document.removeEventListener('keydown', escHandler);
  };
  const backDrop = (e) => { if (e.target === overlay) close(); };
  const escHandler = (e) => { if (e.key === 'Escape') close(); };

  $('#modalOk').addEventListener('click', close);
  $('#modalCancel').addEventListener('click', close);
  overlay.addEventListener('click', backDrop);
  document.addEventListener('keydown', escHandler);
}

// ============================================================
// TAB PANEL
// ============================================================

function switchTab(name) {
  els.tabs.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  els.panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === 'tab-' + name);
  });

  if (name === 'saved') loadSavedTrips();
}

// ============================================================
// INIT & BINDINGS
// ============================================================

function init() {
  initMap();

  // Buat rute pertama
  const first = createRoute('Rute 1');
  App.activeRouteId = first.id;
  loadRouteIntoPanel(first);
  renderRouteTabs();
  addPointRow('', null, null);

  els.form.addEventListener('submit', handleSubmit);
  els.btnClearAll.addEventListener('click', () => clearAllPoints(true));
  els.btnAddPoint.addEventListener('click', () => {
    addPointRow('', null, null);
    focusLastInput();
  });
  els.btnSaveTrip.addEventListener('click', saveTrip);
  els.btnAddRoute.addEventListener('click', addRoute);
  els.mapNoticeClose.addEventListener('click', hideMapNotice);

  els.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (els.tabs[0].classList.contains('active')) saveTrip();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
