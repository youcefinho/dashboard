-- Phase 35: Onboarding & Launch Beta

-- Users and Clients columns already exist.

-- Beta Invites
CREATE TABLE IF NOT EXISTS beta_invite_codes (
    code TEXT PRIMARY KEY,
    used_by_user TEXT,
    used_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    rating INTEGER,
    comment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- NPS Responses
CREATE TABLE IF NOT EXISTS nps_responses (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    score INTEGER,
    comment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
