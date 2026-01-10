CREATE TABLE IF NOT EXISTS  users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS  settings (
  user_id TEXT PRIMARY KEY,
  encrypted_data TEXT NOT NULL,
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  error TEXT,
  stack TEXT,
  context TEXT,
  user_agent TEXT,
  url TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- API 密钥表：存储共享的 NVIDIA API 密钥
CREATE TABLE IF NOT EXISTS  api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'nvidia',
  api_key TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 用户-密钥分配表：记录每个用户分配的密钥
CREATE TABLE IF NOT EXISTS  user_api_key_assignments (
  user_id TEXT PRIMARY KEY,
  api_key_id INTEGER NOT NULL,
  assigned_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

-- 插入 5 个 NVIDIA API 密钥

