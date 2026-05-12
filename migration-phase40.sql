-- Phase 40 : GHL Migration
-- Table des sessions de migration (suivi, reprise, stats)
CREATE TABLE IF NOT EXISTS migration_sessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    source TEXT NOT NULL, -- 'ghl_csv' | 'ghl_api'
    status TEXT NOT NULL, -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    total_records INTEGER DEFAULT 0,
    imported_records INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    error_log_json TEXT,
    current_phase TEXT, -- Pour la reprise API
    current_cursor TEXT, -- Pour la reprise paginée
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Table de mapping d'idempotence
CREATE TABLE IF NOT EXISTS migration_id_map (
    intralys_resource TEXT NOT NULL, -- 'lead', 'conversation', 'message', 'pipeline', 'appointment'
    intralys_id TEXT NOT NULL,
    external_source TEXT NOT NULL, -- 'ghl'
    external_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, intralys_resource, external_source, external_id)
);

-- Table pour les tokens OAuth GHL
CREATE TABLE IF NOT EXISTS ghl_tokens (
    client_id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
