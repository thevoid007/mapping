-- ============================================================
-- MAPPING - Database SQL
-- Interactive Trip / Route Mapping with OpenStreetMap & Leaflet
-- Import file ini melalui phpMyAdmin
-- ============================================================

CREATE DATABASE IF NOT EXISTS `mapping_db`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `mapping_db`;

-- ------------------------------------------------------------
-- Table: trips (perjalanan/rute)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `trips` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL COMMENT 'Nama perjalanan / rute',
  `description` VARCHAR(500) DEFAULT NULL COMMENT 'Deskripsi opsional',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trips_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: trip_points (titik-titik pada sebuah perjalanan)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `trip_points` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trip_id` INT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Urutan titik (mulai 1)',
  `label` VARCHAR(255) NOT NULL COMMENT 'Nama lokasi / alamat',
  `latitude` DECIMAL(10, 7) NOT NULL,
  `longitude` DECIMAL(10, 7) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trip_sequence` (`trip_id`, `sequence`),
  KEY `idx_trip_id` (`trip_id`),
  CONSTRAINT `fk_trip_points_trip`
    FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Data contoh (opsional - bisa dihapus)
-- ============================================================
INSERT INTO `trips` (`name`, `description`) VALUES
('Demo: Jakarta ke Bandung', 'Contoh rute perjalanan darat Jakarta - Bandung');

SET @demo_trip = LAST_INSERT_ID();

INSERT INTO `trip_points` (`trip_id`, `sequence`, `label`, `latitude`, `longitude`) VALUES
(@demo_trip, 1, 'Monumen Nasional (Jakarta)',        -6.1753924,  106.8271528),
(@demo_trip, 2, 'Gedung Sate (Bandung)',              -6.9010781,  107.6185961),
(@demo_trip, 3, 'Kawah Putih (Ciwidey)',              -7.1661000,  107.4041000),
(@demo_trip, 4, 'Tangkuban Perahu (Lembang)',         -6.7712000,  107.6059000);
