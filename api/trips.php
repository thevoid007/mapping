<?php

/**
 * API REST sederhana untuk CRUD rute/perjalanan.
 *
 * Endpoint:
 *   GET  api/trips.php?action=list            -> daftar semua rute (dengan jumlah titik)
 *   GET  api/trips.php?action=get&id={id}     -> detail rute beserta titik-titiknya
 *   POST api/trips.php                        -> simpan rute baru
 *   DELETE api/trips.php?action=delete&id={id}-> hapus rute
 *
 * Semua response berbentuk JSON.
 */

require_once __DIR__ . '/../config/database.php';

// Hanya menerima request dari aplikasi ini (header X-Requested-With)
// (dasar; keamanan lebih lanjut via session dapat ditambahkan)
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: same-origin');

try {
    $pdo = getDbConnection();
} catch (PDOException $e) {
    logError('DB connection: ' . $e->getMessage());
    jsonResponse(['success' => false, 'error' => 'Tidak dapat terhubung ke database.'], 500);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? trim($_GET['action']) : '';

switch ($method) {
    case 'GET':
        handleGet($pdo, $action);
        break;
    case 'POST':
        handlePost($pdo);
        break;
    case 'DELETE':
        handleDelete($pdo, $action);
        break;
    default:
        jsonResponse(['success' => false, 'error' => 'Metode tidak diizinkan.'], 405);
}

// ============================================================
// HANDLER
// ============================================================

/** Menangani permintaan GET. */
function handleGet(PDO $pdo, string $action): void
{
    try {
        if ($action === 'get') {
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
            if (!$id || $id <= 0) {
                jsonResponse(['success' => false, 'error' => 'ID tidak valid.'], 400);
            }
            getTripDetail($pdo, $id);
            return;
        }

        // default: list
        listTrips($pdo);
    } catch (PDOException $e) {
        logError('GET trips: ' . $e->getMessage());
        jsonResponse(['success' => false, 'error' => 'Gagal mengambil data.'], 500);
    }
}

/** Menangani permintaan POST (simpan rute). */
function handlePost(PDO $pdo): void
{
    try {
        $data = getJsonBody();

        $name = isset($data['name']) ? trim((string) $data['name']) : '';
        $description = isset($data['description']) ? trim((string) $data['description']) : '';
        $points = isset($data['points']) && is_array($data['points']) ? $data['points'] : [];

        // ---- Validasi ----
        if (mb_strlen($name) === 0) {
            jsonResponse(['success' => false, 'error' => 'Nama perjalanan wajib diisi.'], 422);
        }
        if (mb_strlen($name) > 191) {
            jsonResponse(['success' => false, 'error' => 'Nama perjalanan maksimal 191 karakter.'], 422);
        }
        if (mb_strlen($description) > 500) {
            jsonResponse(['success' => false, 'error' => 'Deskripsi maksimal 500 karakter.'], 422);
        }
        if (count($points) === 0) {
            jsonResponse(['success' => false, 'error' => 'Rute harus memiliki minimal satu titik.'], 422);
        }
        if (count($points) > 200) {
            jsonResponse(['success' => false, 'error' => 'Maksimal 200 titik per rute.'], 422);
        }

        // Validasi setiap titik
        $cleanPoints = [];
        foreach ($points as $i => $p) {
            $label = isset($p['label']) ? trim((string) $p['label']) : '';
            $lat = isset($p['latitude']) ? $p['latitude'] : null;
            $lng = isset($p['longitude']) ? $p['longitude'] : null;

            if (mb_strlen($label) === 0) {
                jsonResponse(['success' => false, 'error' => "Titik ke-" . ($i + 1) . ": label wajib diisi."], 422);
            }
            if (mb_strlen($label) > 255) {
                jsonResponse(['success' => false, 'error' => "Titik ke-" . ($i + 1) . ": label maksimal 255 karakter."], 422);
            }
            if (!is_numeric($lat) || !is_numeric($lng)) {
                jsonResponse(['success' => false, 'error' => "Titik ke-" . ($i + 1) . ": koordinat tidak valid."], 422);
            }

            $lat = (float) $lat;
            $lng = (float) $lng;

            // Validasi rentang koordinat geografis
            if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
                jsonResponse(['success' => false, 'error' => "Titik ke-" . ($i + 1) . ": koordinat di luar rentang yang valid."], 422);
            }

            $cleanPoints[] = [
                'label' => $label,
                'lat' => $lat,
                'lng' => $lng,
            ];
        }

        // ---- Simpan dalam transaksi ----
        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            'INSERT INTO trips (name, description) VALUES (:name, :description)'
        );
        $stmt->execute([
            ':name' => $name,
            ':description' => $description !== '' ? $description : null,
        ]);
        $tripId = (int) $pdo->lastInsertId();

        $stmtPoint = $pdo->prepare(
            'INSERT INTO trip_points (trip_id, sequence, label, latitude, longitude)
             VALUES (:trip_id, :sequence, :label, :latitude, :longitude)'
        );

        foreach ($cleanPoints as $i => $p) {
            $stmtPoint->execute([
                ':trip_id' => $tripId,
                ':sequence' => $i + 1,
                ':label' => $p['label'],
                ':latitude' => $p['lat'],
                ':longitude' => $p['lng'],
            ]);
        }

        $pdo->commit();

        logError('Saved trip #' . $tripId . ' "' . $name . '" with ' . count($cleanPoints) . ' points.');

        jsonResponse([
            'success' => true,
            'message' => 'Rute berhasil disimpan.',
            'id' => $tripId,
            'name' => $name,
            'point_count' => count($cleanPoints),
        ], 201);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        logError('Insert trip: ' . $e->getMessage());
        jsonResponse(['success' => false, 'error' => 'Database error saat menyimpan rute.'], 500);
    }
}

/** Menangani permintaan DELETE (hapus rute). */
function handleDelete(PDO $pdo, string $action): void
{
    if ($action !== 'delete') {
        jsonResponse(['success' => false, 'error' => 'Aksi tidak dikenali.'], 400);
    }

    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id || $id <= 0) {
        jsonResponse(['success' => false, 'error' => 'ID tidak valid.'], 400);
    }

    try {
        $stmt = $pdo->prepare('DELETE FROM trips WHERE id = :id');
        $stmt->execute([':id' => $id]);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['success' => false, 'error' => 'Rute tidak ditemukan.'], 404);
        }

        logError('Deleted trip #' . $id);
        jsonResponse(['success' => true, 'message' => 'Rute berhasil dihapus.', 'id' => $id]);
    } catch (PDOException $e) {
        logError('Delete trip: ' . $e->getMessage());
        jsonResponse(['success' => false, 'error' => 'Gagal menghapus rute.'], 500);
    }
}

// ============================================================
// BANTUAN
// ============================================================

/** Menampilkan daftar semua rute beserta jumlah titik. */
function listTrips(PDO $pdo): void
{
    $sql = '
        SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
               (SELECT COUNT(*) FROM trip_points tp WHERE tp.trip_id = t.id) AS point_count,
               (SELECT MIN(tp.latitude) FROM trip_points tp WHERE tp.trip_id = t.id) AS min_lat,
               (SELECT MIN(tp.longitude) FROM trip_points tp WHERE tp.trip_id = t.id) AS min_lng,
               (SELECT MAX(tp.latitude) FROM trip_points tp WHERE tp.trip_id = t.id) AS max_lat,
               (SELECT MAX(tp.longitude) FROM trip_points tp WHERE tp.trip_id = t.id) AS max_lng
        FROM trips t
        ORDER BY t.updated_at DESC
    ';

    $stmt = $pdo->query($sql);
    $trips = $stmt->fetchAll();

    // Sertakan koordinat setiap titik juga (ringan untuk jumlah kecil)
    $directional = [];
    foreach ($trips as &$t) {
        $stmtP = $pdo->prepare(
            'SELECT sequence, label, latitude, longitude
             FROM trip_points WHERE trip_id = :trip_id ORDER BY sequence ASC'
        );
        $stmtP->execute([':trip_id' => $t['id']]);
        $t['points'] = $stmtP->fetchAll();
        $t['point_count'] = (int) $t['point_count'];
    }
    unset($t);

    jsonResponse(['success' => true, 'trips' => $trips]);
}

/** Menampilkan detail satu rute beserta titik-titiknya. */
function getTripDetail(PDO $pdo, int $id): void
{
    $stmt = $pdo->prepare('SELECT id, name, description, created_at FROM trips WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $trip = $stmt->fetch();

    if (!$trip) {
        jsonResponse(['success' => false, 'error' => 'Rute tidak ditemukan.'], 404);
    }

    $stmtP = $pdo->prepare(
        'SELECT sequence, label, latitude, longitude
         FROM trip_points WHERE trip_id = :trip_id ORDER BY sequence ASC'
    );
    $stmtP->execute([':trip_id' => $id]);
    $trip['points'] = $stmtP->fetchAll();

    jsonResponse(['success' => true, 'trip' => $trip]);
}
