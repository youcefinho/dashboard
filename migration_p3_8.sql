-- Migration P3.8: Payments & Invoicing
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  lead_id TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'draft', -- draft, sent, paid, cancelled
  stripe_invoice_id TEXT,
  payment_url TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  code TEXT NOT NULL,
  discount_amount REAL,
  discount_percent REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
