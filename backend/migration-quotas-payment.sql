-- 用户额度表
CREATE TABLE IF NOT EXISTS user_quotas (
  user_id TEXT PRIMARY KEY,
  free_quota_remaining INTEGER DEFAULT 10,
  paid_quota_remaining INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 支付订单表
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  quota_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, paid, cancelled
  payment_url TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  paid_at INTEGER
);

-- 初始化现有用户的额度 (如果有用户的话)
INSERT OR IGNORE INTO user_quotas (user_id)
SELECT id FROM users;
