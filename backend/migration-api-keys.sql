-- 迁移脚本：添加 API 密钥表（不删除现有数据）
-- 运行命令: npx wrangler d1 execute memoraid-db --remote --file=migration-api-keys.sql

-- API 密钥表：存储共享的 NVIDIA API 密钥
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'nvidia',
  api_key TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 用户-密钥分配表：记录每个用户分配的密钥
CREATE TABLE IF NOT EXISTS user_api_key_assignments (
  user_id TEXT PRIMARY KEY,
  api_key_id INTEGER NOT NULL,
  assigned_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

-- 插入 5 个 NVIDIA API 密钥（如果不存在）
