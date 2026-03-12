-- 添加用户额度和支付系统表
-- 执行命令: npx wrangler d1 execute memoraid-db --remote --file=backend/migrate-add-quotas.sql

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
  status TEXT DEFAULT 'pending',
  payment_url TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  paid_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- AI使用日志表
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  generated_id TEXT,
  platform TEXT,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- 初始化现有用户的额度
INSERT OR IGNORE INTO user_quotas (user_id)
SELECT id FROM users;
