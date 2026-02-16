-- 添加 user_id 列到 accounts 表，用于用户隔离
-- 运行此脚本以升级数据库 schema

-- 1. 添加 user_id 列
ALTER TABLE accounts ADD COLUMN user_id TEXT;

-- 2. (可选) 将现有数据归属到特定用户（如果有的话）
-- UPDATE accounts SET user_id = 'your_user_id' WHERE user_id IS NULL;

-- 注意：在 Cloudflare D1 中，你需要通过 wrangler 命令行或 Dashboard 执行此 SQL
-- npx wrangler d1 execute memoraid-db --file=backend/migration-user-isolation.sql
