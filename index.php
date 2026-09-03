<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MAPPING &mdash; Interactive Route Planner</title>
    <meta name="description" content="Peta interaktif OpenStreetMap untuk merencanakan rute perjalanan antar titik. Gratis, tanpa API key.">

    <!-- Leaflet CSS & JS (open-source, tanpa API key) -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.min.css" crossorigin="">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<div class="app">

    <!-- =================== AREA PETA =================== -->
    <main class="map-area">
        <div id="map" class="map-canvas"></div>

        <header class="map-header glass">
            <div class="brand">
                <span class="brand-mark">◉</span>
                <div>
                    <h1>MAPPING</h1>
                    <p>Interactive Route Planner &mdash; OpenStreetMap</p>
                </div>
            </div>
            <div class="map-stats" id="mapStats">
                <span class="stat"><b id="statPoints">0</b> titik</span>
                <span class="stat"><b id="statDistance">0</b> km</span>
            </div>
        </header>

        <div id="mapNotice" class="map-notice glass" hidden>
            <span class="notice-icon">◈</span>
            <span id="mapNoticeText"></span>
            <button class="notice-close" id="mapNoticeClose" aria-label="Tutup">&times;</button>
        </div>
    </main>

    <!-- =================== PANEL KANAN =================== -->
    <aside class="side-panel" id="sidePanel">

        <div class="panel-tabs" id="panelTabs">
            <button class="tab active" data-tab="planner" data-tab-btn>Planner</button>
            <button class="tab" data-tab="saved" data-tab-btn>Rute Tersimpan</button>
            <button class="tab" data-tab="about" data-tab-btn>Info</button>
        </div>

        <!-- ============ TAB: PLANNER ============ -->
        <section class="tab-panel active" id="tab-planner">

            <div class="panel-head">
                <h2>Rencanakan Rute</h2>
                <p>Masukkan lokasi secara berurutan &mdash; titik pertama menjadi titik awal.</p>
            </div>

            <!-- Form input titik -->
            <form id="pointForm" autocomplete="off" novalidate>
                <div class="form-row label-double">
                    <label for="tripName">Nama Perjalanan</label>
                    <input type="text" id="tripName" name="tripName"
                           placeholder="cth: Mudik Bandung" maxlength="191" required>
                </div>

                <label class="form-label">Lokasi / Titik Perjalanan</label>

                <div id="pointsList"></div>

                <div class="actions">
                    <div class="btn-row">
                        <button type="button" class="btn btn-ghost" id="btnAddPoint">＋ Tambah Titik</button>
                        <button type="button" class="btn btn-ghost" id="btnClearAll">🗑 Kosongkan Semua</button>
                    </div>
                    <button type="submit" class="btn btn-primary btn-block" id="btnMapAll">
                        <span class="btn-icon">📍</span> Tandai Semua di Peta
                    </button>
                </div>
            </form>

            <!-- Simpan / muat rute -->
            <div class="save-box glass">
                <h3>Simpan Rute Ini</h3>
                <p class="muted">Simpan titik-titik yang sudah masuk ke peta ke database.</p>
                <textarea id="tripDescription" rows="2"
                          placeholder="Deskripsi (opsional)"></textarea>
                <button type="button" class="btn btn-secondary btn-block" id="btnSaveTrip">
                    💾 Simpan ke Database
                </button>
            </div>

            <p class="credit">Peta: Leaflet + OpenStreetMap &middot; Geocoding: Nominatim &mdash; 100% gratis.</p>
        </section>

        <!-- ============ TAB: RUTE TERSIMPAN ============ -->
        <section class="tab-panel" id="tab-saved">
            <div class="panel-head">
                <h2>Rute Tersimpan</h2>
                <p>Muat atau hapus perjalanan yang pernah disimpan.</p>
            </div>

            <div id="savedList" class="saved-list"></div>

            <p id="savedEmpty" class="empty-state" hidden>
                <span class="empty-icon">🗺</span><br>
                Belum ada rute tersimpan.<br>
                Simpan rute pertama Anda dari tab Planner.
            </p>
        </section>

        <!-- ============ TAB: INFO ============ -->
        <section class="tab-panel" id="tab-about">
            <div class="panel-head">
                <h2>Tentang Aplikasi</h2>
            </div>
            <div class="about-content">
                <p><strong>MAPPING</strong> adalah perencana rute perjalanan berbasis web yang
                berjalan penuh di <strong>PHP + MySQL</strong> dan dijalankan lokal via <strong>XAMPP</strong>.</p>
                <ul>
                    <li>🗺 Peta menggunakan <strong>OpenStreetMap</strong> (Leaflet.js) &mdash; gratis, tanpa API key.</li>
                    <li>🔎 Pencarian lokasi melalui <strong>Nominatim</strong> geocoding (OpenStreetMap).</li>
                    <li>📦 Titik otomatis dihubungkan menjadi rute sesuai urutan input.</li>
                    <li>💾 Rute dapat disimpan / dimuat / dihapus dari database MySQL.</li>
                    <li>⚡ Semua interaksi dinamis via AJAX / Fetch API tanpa reload.</li>
                </ul>
                <p class="muted">Petunjuk instalasi lengkap tersedia di file <code>README.md</code>.</p>
            </div>
        </section>
    </aside>

</div>

<!-- Modal konfirmasi -->
<div id="modalOverlay" class="modal-overlay" hidden>
    <div class="modal glass">
        <h3 id="modalTitle">Konfirmasi</h3>
        <p id="modalText"></p>
        <div class="modal-actions">
            <button class="btn btn-ghost" id="modalCancel">Batal</button>
            <button class="btn btn-danger" id="modalOk">Ya, lanjutkan</button>
        </div>
    </div>
</div>

<!-- Toast notifikasi -->
<div id="toast" class="toast" hidden></div>

<!-- Template baris titik -->
<template id="pointRowTemplate">
    <div class="point-row" draggable="true">
        <span class="order-badge">1</span>
        <input type="text" class="point-input" placeholder="Masukkan nama lokasi atau alamat..."
               aria-label="Nama lokasi" required maxlength="255">
        <span class="point-status"></span>
        <button type="button" class="icon-btn last-btn" title="Tandai sebagai titik terakhir / lanjutkan">◉</button>
        <button type="button" class="icon-btn up-btn" title="Naikkan urutan">↑</button>
        <button type="button" class="icon-btn down-btn" title="Turunkan urutan">↓</button>
        <button type="button" class="icon-btn remove-btn" title="Hapus titik">✕</button>
    </div>
</template>

<!-- Leaflet JS -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<!-- Aplikasi -->
<script src="assets/js/app.js"></script>
</body>
</html>
