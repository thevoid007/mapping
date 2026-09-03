# 🗺 MAPPING — Interactive Route Planner

Aplikasi web berbasis **PHP + MySQL** yang menampilkan **peta interaktif OpenStreetMap** (via **Leaflet.js**) untuk merencanakan rute perjalanan antar titik. **100% gratis — tanpa API key berbayar.**

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🗺 **Peta OpenStreetMap** | Menggunakan Leaflet.js, gratis & open-source |
| 🔎 **Geocoding gratis** | Nominatim (OpenStreetMap) untuk mencari koordinat dari alamat |
| 📍 **Marker otomatis** | Setiap lokasi muncul sebagai titik bernomor di peta |
| ➖ **Garis rute** | Titik dihubungkan berurutan dari awal sampai akhir |
| 🧭 **Ubah urutan** | Drag & drop, atau tombol ↑ / ↓ |
| ➕➖ **Tambah/hapus titik** | Dinamis, jumlah input bisa ditambah / dikurangi |
| 🗑 **Kosongkan semua** | Hapus seluruh titik sekaligus |
| 🧾 **Lihat koordinat** | Latitude & longitude setiap titik |
| 💾 **Simpan rute** | Simpan perjalanan ke database MySQL |
| 📂 **Muat rute** | Muat kembali rute yang tersimpan |
| 🗑 **Hapus rute** | Hapus data rute dari database |
| ⚡ **Tanpa reload** | Semua operasi via AJAX / Fetch API |

---

## 📦 Struktur Proyek

```
mapping/
├── index.php                 ← Halaman utama
├── config/
│   └── database.php          ← Konfigurasi koneksi MySQL + helper
├── api/
│   └── trips.php             ← REST API CRUD rute (JSON)
├── database/
│   └── mapping_db.sql        ← SQL pembuatan database & tabel + data contoh
├── assets/
│   ├── css/
│   │   └── style.css         ← Stylesheet (modern/futuristik)
│   └── js/
│       └── app.js            ← Logika aplikasi (Leaflet, geocoding, dll)
└── README.md                 ← Petunjuk instalasi ini
```

---

## 🚀 Petunjuk Instalasi di XAMPP

### 1. Salin folder proyek ke htdocs

Salin seluruh folder `mapping` ke:

```
C:\xampp\htdocs\mapping
```

Pastikan struktur di atas sesuai (folder `config`, `api`, `database`, `assets`, dan file `index.php`).

### 2. Nyalakan Apache & MySQL

- Buka **XAMPP Control Panel**.
- Klik **Start** pada **Apache** dan **MySQL**.

### 3. Buat database lewat phpMyAdmin

1. Buka browser ke: [`http://localhost/phpmyadmin`](http://localhost/phpmyadmin)
2. Klik menu **Import** di bagian atas.
3. Klik **Choose File**, pilih:
   ```
   C:\xampp\htdocs\mapping\database\mapping_db.sql
   ```
4. Klik **Go / Import**.

   Jika berhasil, database `mapping_db` akan dibuat beserta 2 tabel (`trips` & `trip_points`) dan 1 data contoh.

   > **Alternatif (tanpa import):** buka tab **SQL** di phpMyAdmin, tempel seluruh isi `mapping_db.sql`, lalu klik **Go**.

### 4. (Opsional) Sesuaikan konfigurasi database

Buka `config/database.php` dan pastikan nilainya sesuai XAMPP:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'mapping_db');
define('DB_USER', 'root');
define('DB_PASS', '');   // default XAMPP kosong
```

> Jika password MySQL Anda berbeda, ubah `DB_PASS`.

### 5. Jalankan aplikasi

Buka browser dan akses:

```
http://localhost/mapping/
```

---

## 🧪 Cara Menggunakan

1. **Tab Planner** — isi **Nama Perjalanan**, lalu masukkan lokasi pada kolom "Lokasi / Titik Perjalanan".
2. Setiap kolom akan **otomatis dicari** koordinatnya (geocoding Nominatim) setelah berhenti mengetik (~0,7 dtk).
3. Klik **”Tandai Semua di Peta”** untuk memproses semua lokasi & menampilkan marker + garis rute.
4. **Urutan** bisa diubah dengan **drag & drop** atau tombol **↑ / ↓**.
5. Klik **”Simpan ke Database”** untuk menyimpan rute.
6. Buka tab **Rute Tersimpan** untuk memuat / melihat koordinat / menghapus rute.
7. **Trik**: klik langsung pada peta untuk menambah titik manual pada posisi tersebut.

> **Catatan geocoding:** Nominatim membatasi ~1 request/detik. Aplikasi memberi jeda otomatis agar tetap sopan ke layanan gratis. Untuk banyak titik, prosesnya berurutan dan sedikit lebih lambat.

---

## 🛡 Keamanan yang Diterapkan

- **Prepared statements (PDO)** untuk semua query SQL — mencegah SQL injection.
- **Validasi input** di sisi klien (JS) **dan** sisi server (PHP).
- **Validasi rentang koordinat** geografis (lat ±90, lng ±180).
- **Pembatasan panjang** karakter pada nama/deskripsi/label.
- **Escape HTML** (`escapeHtml`) untuk semua output yang dirender ke DOM — mencegah XSS.
- **Response JSON** dengan status HTTP yang tepat.
- **Transaksi** pada penyimpanan multi-baris untuk menjaga konsistensi data.
- **Perlindungan duplication** — geocoding tidak diulang untuk query yang sama.

---

## 🖥 Teknologi

- **PHP 7.4+ / 8.x** (PDO MySQL)
- **MySQL / MariaDB**
- **Leaflet.js 1.9.4** — peta interaktif
- **OpenStreetMap Tiles** — tile peta gratis
- **Nominatim** — geocoding gratis
- **Vanilla JS** (Fetch API) — tanpa framework
- **CSS3** — modern, responsif, futuristik

---

## ❓ Pertanyaan Umum

**Q: Peta tidak muncul?**
Pastikan internet aktif (tile OSM & Leaflet dimuat dari CDN). Coba muat ulang halaman.

**Q: Lokasi tidak ditemukan?**
Periksa ejaan, gunakan nama yang lebih umum (mis. "Monas Jakarta" bukan singkatan), atau klik langsung peta.

**Q: Database error?**
Pastikan MySQL aktif dan `mapping_db` sudah diimport, serta kredensial di `config/database.php` benar.

**Q: Rute tidak tersimpan?**
Pastikan semua titik sudah berstatus **✓** (ditemukan koordinatnya) dan isi nama perjalanan.

---

Dibuat dengan ❤ untuk perencanaan perjalanan sederhana menggunakan teknologi open-source.
