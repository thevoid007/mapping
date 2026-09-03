/* ============================================================
   MAPPING - Aplikasi Frontend
   Peta Leaflet + OpenStreetMap, geocoding Nominatim,
   manajemen titik, rute, dan integrasi database via Fetch API.
   ============================================================ */

'use strict';

// ---------- State aplikasi ----------
const App = {
  map: null,
  points: [],        // [{ id?, label, lat, lng, status }]
  markerLayer: null,
  routeLayer: null,
  distance: 0,
  committing: false, // mencegah re-entrancy pada geocoding
};

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

/** Format angka dengan pemisah ribuan. */
const fmtNum = (n) => Number(n).toLocaleString('id-ID');

/** Hitung jarak haversine (km) antar dua koordinat. */
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

/** Escape HTML untuk mencegah XSS. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/** Menampilkan toast notifikasi. */
function showToast(message, type = 'info', duration = 3200) {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, duration);
}

/** Menampilkan / menyembunyikan notice pada peta. */
function showMapNotice(message, type = 'info') {
  els.mapNoticeText.textContent = message;
  els.mapNotice.className = `map-notice ${type} glass`;
  els.mapNotice.hidden = false;
}

function hideMapNotice() {
  els.mapNotice.hidden = true;
}

/** Sleep sederhana. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// INISIALISASI PETA
// ============================================================

function initMap() {
  App.map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView(
    [-2.5489, 118.0149],
    5
  );

  // Tile layer OpenStreetMap (gratis, tanpa API key)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(App.map);

  App.markerLayer = L.layerGroup().addTo(App.map);
  App.routeLayer = L.layerGroup().addTo(App.map);

  // Klik peta -> tambah titik manual
  App.map.on('click', (e) => {
    // tambah titik dengan label dari input kosong; akan di-edit user
    addPointRow('', e.latlng.lat, e.latlng.lng);
  });
}

// ============================================================
// MANAJEMEN BARIS TITIK (DOM)
// ============================================================

/** Membuat deret data state dari semua baris di DOM. */
function collectRows() {
  return Array.from(els.pointsList.querySelectorAll('.point-row')).map((row, i) => ({
    index: i,
    el: row,
    input: row.querySelector('.point-input'),
    orderBadge: row.querySelector('.order-badge'),
    statusEl: row.querySelector('.point-status'),
  }));
}

/**
 * Tambah baris titik ke daftar.
 * @param {string} label  Label lokasi awal (opsional).
 * @param {number|null} lat  Latitude jika sudah diketahui.
 * @param {number|null} lng  Longitude jika sudah diketahui.
 */
function addPointRow(label = '', lat = null, lng = null) {
  const template = els.pointRowTemplate.content.cloneNode(true);
  const row = template.querySelector('.point-row');

  const input = row.querySelector('.point-input');
  input.value = label;

  els.pointsList.appendChild(row);
  attachRowEvents(row);

  // Selalu sinkronkan App.points dengan jumlah baris DOM.
  // Titik dengan koordinat langsung tercatat, tanpa koordinat diisi placeholder.
  App.points.push({
    label: label,
    lat,
    lng,
    status: lat != null && lng != null ? 'ok' : 'pending',
  });

  if (lat != null && lng != null) {
    markRowStatus(row, 'ok');
    renderMarkersAndRoute();
    input.focus();
  } else {
    markRowStatus(row, 'pending');
    input.focus();
  }

  updateOrderBadges();
  updateStats();
}

/** Fokus ke input baris terakhir yang masih kosong. */
function focusLastInput() {
  const inputs = els.pointsList.querySelectorAll('.point-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

/** Menghapus baris titik (index berdasarkan posisi saat ini di DOM). */
function removePointRow(row) {
  const idx = indexOfRow(row);
  row.remove();
  if (idx >= 0 && idx < App.points.length) App.points.splice(idx, 1);
  updateOrderBadges();
  renderMarkersAndRoute();
  updateStats();

  if (row.dataset.query) {
    // membatalkan pending geocode (identifikasi via label)
    const q = row.dataset.query;
    pendingGeocodes.delete(q);
  }
}

/** Mendapatkan index baris dalam container. */
function indexOfRow(row) {
  return Array.from(els.pointsList.children).indexOf(row);
}

/** Memperbarui angka pada badge urutan setelah perubahan. */
function updateOrderBadges() {
  collectRows().forEach(({ orderBadge, input }) => {
    const idx = indexOfRow(input.closest('.point-row'));
    orderBadge.textContent = idx + 1;
    orderBadge.title = `Urutan ${idx + 1}`;
  });
}

/** Mengatur status visual baris. */
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

/** Attach semua event handler ke baris titik. */
function attachRowEvents(row) {
  const input = row.querySelector('.point-input');
  const upBtn = row.querySelector('.up-btn');
  const downBtn = row.querySelector('.down-btn');
  const removeBtn = row.querySelector('.remove-btn');

  // Geocoding saat mengetik (debounce)
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleGeocodeForRow(input.closest('.point-row'));
    }, 700);
  });

  // naik / turun urutan
  upBtn.addEventListener('click', () => moveRow(row, -1));
  downBtn.addEventListener('click', () => moveRow(row, 1));
  removeBtn.addEventListener('click', () => removePointRow(row));

  // drag & drop untuk mengubah urutan
  initDragDrop(row);
}

/** Handler geocoding untuk baris tertentu. */
async function handleGeocodeForRow(row) {
  const input = row.querySelector('.point-input');
  const query = input.value.trim();

  if (App.committing || !query) {
    markRowStatus(row, 'pending');
    input.title = '';
    row.dataset.query = '';
    return;
  }

  const existing = App.points[indexOfRow(row)];
  if (existing && existing.label === query && existing.status === 'ok') {
    // Tidak berubah -> jangan geocode ulang
    return;
  }

  // Jika input berupa koordinat "lat, lng" -> gunakan langsung tanpa geocoding
  const coord = parseCoordinates(query);
  if (coord.ok) {
    const idx = indexOfRow(row);
    App.points[idx] = {
      label: `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,
      lat: coord.lat,
      lng: coord.lng,
      status: 'ok',
    };
    markRowStatus(row, 'ok');
    renderMarkersAndRoute();
    updateStats();
    row.dataset.query = '';
    return;
  }

  row.dataset.query = query;
  markRowStatus(row, 'loading');

  try {
    const result = await geocode(query);
    // Pastikan baris masih ada dan query belum berubah
    if (!row.isConnected || row.dataset.query !== query) return;

    if (!result) {
      markRowStatus(row, 'err');
      row.dataset.query = '';
      input.title = 'Lokasi tidak ditemukan';
      showToast(`Lokasi "${query}" tidak ditemukan.`, 'error');
      return;
    }

    const idx = indexOfRow(row);
    App.points[idx] = {
      label: result.label || query,
      lat: result.lat,
      lng: result.lng,
      status: 'ok',
    };
    markRowStatus(row, 'ok');
    renderMarkersAndRoute();
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

// ---------- Pending geocode set (untuk pembatalan) ----------
const pendingGeocodes = new Set();

// ============================================================
// GEOCODING (Nominatim - OpenStreetMap, gratis)
// ============================================================

/**
 * Mencari koordinat dari sebuah query alamat/lokasi.
 * Menggunakan Nominatim. Wajib menyertakan User-Agent sesuai aturan.
 * Hasil yang sama di-cache di sessionStorage selama 1 jam.
 */
async function geocode(query) {
  const cacheKey = 'geo:' + query.toLowerCase();
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const entry = JSON.parse(cached);
      if (Date.now() - entry.t < 3600e3) return entry.data;
    } catch (_) { /* abaikan cache rusak */ }
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

/**
 * Mendeteksi apakah input berupa koordinat "lat, lng" atau "lat lng".
 * Mengembalikan { lat, lng, ok } jika valid, atau { ok:false } jika bukan.
 * @param {string} query
 */
function parseCoordinates(query) {
  const t = query.trim();
  if (!t) return { ok: false };

  // Pisahkan berdasarkan koma atau spasi, tapi hati-hati dengan minus
  const parts = t.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) return { ok: false };

  const lat = parseFloat(parts[0].replace(/[^\d.\-]/g, ''));
  const lng = parseFloat(parts[1].replace(/[^\d.\-]/g, ''));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false };

  return { ok: true, lat, lng };
}

// ============================================================
// RENDER PETA (MARKER + RUTE)
// ============================================================

/** Membangun kembali seluruh marker dan garis rute di peta. */
function renderMarkersAndRoute() {
  App.markerLayer.clearLayers();
  App.routeLayer.clearLayers();

  const pts = App.points.filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null);
  const latlngs = pts.map((p) => [p.lat, p.lng]);

  // Marker dengan divIcon
  pts.forEach((p, i) => {
    const kind = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'mid';
    const icon = L.divIcon({
      className: '',
      html: `
        <div class="custom-marker">
          <div class="pin ${kind}"><span>${i + 1}</span></div>
          <div class="tail"></div>
        </div>`,
      iconSize: [30, 38],
      iconAnchor: [15, 38],
    });

    const marker = L.marker([p.lat, p.lng], { icon }).addTo(App.markerLayer);

    const popupHtml = `
      <div class="popup-title">${escapeHtml(p.label)}</div>
      <div class="popup-label">Titik #${i + 1} ${i === 0 ? '(Awal)' : i === pts.length - 1 ? '(Akhir)' : ''}</div>
      <div class="popup-coords">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>`;
    marker.bindPopup(popupHtml);

    marker.on('click', () => {
      App.map.panTo([p.lat, p.lng]);
    });
  });

  // Garis rute berurutan (garis lurus, tidak putus-putus)
  if (latlngs.length >= 2) {
    const line = L.polyline(latlngs, {
      color: '#3ec6ff',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(App.routeLayer);

    // garis tipis sebagai pendukung agar rute lebih jelas
    L.polyline(latlngs, {
      color: '#7c5cff',
      weight: 9,
      opacity: 0.25,
      lineCap: 'round',
    }).addTo(App.routeLayer);

    line.bindPopup(`<div class="popup-title">Rute</div><div class="popup-coords">${pts.length} titik</div>`);
  }

  // Hitung jarak total
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) {
    total += haversineKm(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]);
  }
  App.distance = total;

  updateStats();
}

/** Menyesuaikan tampilan peta agar semua titik terlihat. */
function fitMapToPoints() {
  const pts = App.points.filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null);
  if (pts.length === 0) return;

  if (pts.length === 1) {
    App.map.setView([pts[0].lat, pts[0].lng], 13);
    return;
  }

  const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
  App.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
}

function updateStats() {
  els.stats.points.textContent = fmtNum(App.points.length);
  els.stats.distance.textContent = App.distance >= 0.05 ? fmtNum(App.distance.toFixed(1)) : '0,0';
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

/** Menukar posisi dua baris di DOM lalu sinkronkan state. */
function reorderPoints(fromRow, toRow) {
  const fromIdx = indexOfRow(fromRow);
  const toIdx = indexOfRow(toRow);

  if (fromIdx === toIdx) return;

  if (fromIdx < toIdx) toRow.after(fromRow);
  else toRow.before(fromRow);

  syncPointsFromDom();
  renderMarkersAndRoute();
  updateOrderBadges();
}

/** Memindahkan baris naik/turun satu langkah. */
function moveRow(row, delta) {
  const idx = indexOfRow(row);
  const target = idx + delta;
  if (target < 0 || target >= els.pointsList.children.length) return;

  const rows = Array.from(els.pointsList.children);
  const targetRow = rows[target];
  if (delta < 0) targetRow.before(row);
  else targetRow.after(row);

  syncPointsFromDom();
  renderMarkersAndRoute();
  updateOrderBadges();
}

/** Menyinkronkan App.points agar sesuai urutan DOM. */
function syncPointsFromDom() {
  const newPoints = collectRows().map(({ input }) => {
    const idx = indexOfRow(input.closest('.point-row'));
    return App.points[idx] || { label: input.value.trim(), lat: null, lng: null, status: 'pending' };
  });
  App.points = newPoints;
}

// ============================================================
// AJAX / FETCH API KE BACKEND PHP
// ============================================================

async function apiFetch(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch (_) { data = null; }

  if (!res.ok || !data) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

// ============================================================
// LOGIKA UTAMA
// ============================================================

/** Validasi input sebelum proses. Mengembalikan daftar error. */
function validateTrip() {
  const errors = [];
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

  rows.forEach(({ input, statusEl }) => {
    const val = input.value.trim();
    if (!val) {
      errors.push(`Titik ke-${indexOfRow(input.closest('.point-row')) + 1}: lokasi wajib diisi.`);
    }
  });

  // Periksa koordinat tersedia
  const unresolved = rows.filter(({ input }) => {
    const idx = indexOfRow(input.closest('.point-row'));
    const p = App.points[idx];
    return !(p && p.status === 'ok' && p.lat != null && p.lng != null);
  });
  if (unresolved.length > 0) {
    errors.push('Beberapa lokasi belum ditemukan koordinatnya. Periksa kembali.');
  }

  return errors;
}

/** Mengumpulkan data titik valid dari state. */
function getValidPoints() {
  return App.points
    .filter((p) => p && p.status === 'ok' && p.lat != null && p.lng != null)
    .map((p) => ({ label: p.label, latitude: p.lat, longitude: p.lng }));
}

// ============================================================
// EVENT: FORM
// ============================================================

/** Handler submit form -> geocode semua & render peta. */
async function handleSubmit(e) {
  e.preventDefault();

  const rows = collectRows();

  if (rows.length === 0) {
    showToast('Tambahkan minimal satu lokasi terlebih dahulu.', 'error');
    return;
  }

  // kosongkan status agar di-resolve ulang
  App.committing = true;
  els.btnMapAll.disabled = true;
  els.btnMapAll.textContent = 'Mencari lokasi…';

  try {
    // Untuk setiap baris belum berstatus ok, lakukan geocode (dengan throttle)
    for (const { input, statusEl } of rows) {
      const idx = indexOfRow(input.closest('.point-row'));
      const existing = App.points[idx];
      const query = input.value.trim();

      if (!query) {
        markRowStatus(input.closest('.point-row'), 'err');
        continue;
      }

      if (existing && existing.label === query && existing.status === 'ok') {
        markRowStatus(input.closest('.point-row'), 'ok');
        continue; // sudah ter-resolve
      }

      // Jika input berupa koordinat "lat, lng" -> gunakan langsung tanpa geocoding
      const coord = parseCoordinates(query);
      if (coord.ok) {
        App.points[idx] = {
          label: `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,
          lat: coord.lat,
          lng: coord.lng,
          status: 'ok',
        };
        markRowStatus(input.closest('.point-row'), 'ok');
        continue;
      }

      markRowStatus(input.closest('.point-row'), 'loading');

      try {
        const result = await geocode(query);
        if (result) {
          App.points[idx] = { label: result.label || query, lat: result.lat, lng: result.lng, status: 'ok' };
          markRowStatus(input.closest('.point-row'), 'ok');
        } else {
          markRowStatus(input.closest('.point-row'), 'err');
        }
      } catch (err) {
        markRowStatus(input.closest('.point-row'), 'err');
      }

      // Throttle untuk menghormati nominatim (1 req/detik)
      await sleep(1100);
    }

    renderMarkersAndRoute();
    fitMapToPoints();

    const failed = collectRows().filter(({ input }) => {
      const idx = indexOfRow(input.closest('.point-row'));
      const p = App.points[idx];
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

/** Kosongkan seluruh daftar titik. */
function clearAllPoints(confirm = true) {
  const doClear = () => {
    els.pointsList.innerHTML = '';
    App.points = [];
    App.distance = 0;
    renderMarkersAndRoute();
    updateStats();
    hideMapNotice();
    showToast('Semua titik telah dikosongkan.', 'info');
  };

  if (!confirm) { doClear(); return; }

  if (App.points.length === 0) return;
  openConfirm({
    title: 'Kosongkan Semua?',
    text: 'Seluruh titik yang sudah dimasukkan akan dihapus dari daftar dan peta. Lanjutkan?',
    okText: 'Ya, kosongkan',
    onOk: doClear,
  });
}

// ============================================================
// SIMPAN & MUAT RUTE (DATABASE)
// ============================================================

/** Menyimpan rute saat ini ke database. */
async function saveTrip() {
  const errors = validateTrip();
  if (errors.length > 0) {
    showToast(errors[0], 'error');
    return;
  }

  const points = getValidPoints();

  els.btnSaveTrip.disabled = true;
  els.btnSaveTrip.textContent = 'Menyimpan…';

  try {
    const data = await apiFetch('api/trips.php', 'POST', {
      name: els.tripName.value.trim(),
      description: els.tripDescription.value.trim(),
      points,
    });

    showToast(`Rute "${data.name}" berhasil disimpan (ID: ${data.id}).`, 'success');
    loadSavedTrips();
    // update input nama agar memakai nama yang tersimpan (jika duplikat ditangani server)
    els.tripName.value = data.name;
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  } finally {
    els.btnSaveTrip.disabled = false;
    els.btnSaveTrip.textContent = '💾 Simpan ke Database';
  }
}

/** Memuat daftar rute tersimpan dari database. */
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

/** Render satu kartu rute tersimpan. */
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

/** Menghitung jarak rute dari daftar point (untuk kartu). */
function calcRouteDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(
      parseFloat(points[i - 1].latitude),
      parseFloat(points[i - 1].longitude),
      parseFloat(points[i].latitude),
      parseFloat(points[i].longitude)
    );
  }
  return total;
}

/** Memuat rute tersimpan ke dalam planner (memindahkan ke tab Planner). */
async function loadTripIntoPlanner(trip) {
  // Pindah ke tab planner
  switchTab('planner');

  // bersihkan form lama
  els.pointsList.innerHTML = '';
  App.points = [];

  els.tripName.value = trip.name;
  els.tripDescription.value = trip.description || '';

  try {
    // Ambil detail point dari database
    const detail = await apiFetch('api/trips.php?action=get&id=' + trip.id, 'GET');
    const tripDetail = detail.trip || {};
    const pts = tripDetail.points || [];

    pts.forEach((p) => {
      addPointRow(
        p.label,
        parseFloat(p.latitude),
        parseFloat(p.longitude)
      );
    });

    renderMarkersAndRoute();
    fitMapToPoints();
    showToast(`Rute "${trip.name}" dimuat (${pts.length} titik).`, 'success');
  } catch (err) {
    showToast('Gagal memuat rute: ' + err.message, 'error');
  }
}

/** Menampilkan modal daftar koordinat sebuah rute tersimpan. */
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
      html += `<div class="coord-line">
        <b>#${i + 1}</b> ${escapeHtml(p.label)}<br>
        <span class="coord-val">${parseFloat(p.latitude).toFixed(6)}, ${parseFloat(p.longitude).toFixed(6)}</span>
      </div>`;
    });

    openInfoModal('Koordinat Rute', html);
  } catch (err) {
    showToast('Gagal mengambil koordinat.', 'error');
  }
}

/** Menghapus rute dari database (dengan konfirmasi). */
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
    overlay.removeEventListener('click', () => {});
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

  // Tambah satu baris titik awal
  addPointRow('', null, null);

  // Form
  els.form.addEventListener('submit', handleSubmit);
  els.btnClearAll.addEventListener('click', () => clearAllPoints(true));
  els.btnAddPoint.addEventListener('click', () => {
    addPointRow('', null, null);
    focusLastInput();
  });
  els.btnSaveTrip.addEventListener('click', saveTrip);
  els.mapNoticeClose.addEventListener('click', hideMapNotice);

  // Tabs
  els.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Keyboard: Enter pada input tidak menambah titik baru secara tidak sengaja
  // (form submit menangani itu).

  // Simpan rute dengan Ctrl+S pada tab planner
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (els.tabs[0].classList.contains('active')) saveTrip();
    }
  });
}

// Jalankan saat DOM siap
document.addEventListener('DOMContentLoaded', init);
