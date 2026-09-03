<?php

/**
 * Konfigurasi Koneksi Database MySQL
 * Sesuaikan nilai-nilai berikut dengan pengaturan XAMPP Anda.
 * Default XAMPP: host=localhost, user=root, password=(kosong)
 */

define('DB_HOST', 'localhost');
define('DB_NAME', 'mapping_db');
define('DB_USER', 'root');
define('DB_PASS', '');          // default XAMPP: kosong
define('DB_CHARSET', 'utf8mb4');

/**
 * Mendapatkan koneksi PDO ke database.
 * @return PDO
 * @throws PDOException jika koneksi gagal
 */
function getDbConnection(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        DB_HOST,
        DB_NAME,
        DB_CHARSET
    );

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);

    return $pdo;
}

/**
 * Mengirimkan response JSON ke klien dan menghentikan eksekusi.
 *
 * @param mixed $data Data yang akan dikirim sebagai JSON.
 * @param int   $statusCode Status HTTP (200 default).
 */
function jsonResponse($data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Mendapatkan body JSON dari request.
 * @return array
 */
function getJsonBody(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

    if (!is_array($data)) {
        return [];
    }

    return $data;
}

/**
 * Menulis log error sederhana ke file (di luar folder publik umumnya).
 * Berguna untuk debugging tanpa menampilkan detail pada klien.
 *
 * @param string $message Pesan error.
 */
function logError(string $message): void
{
    $logDir = __DIR__ . '/../logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
    @file_put_contents($logDir . '/error.log', $line, FILE_APPEND);
}
