-- 添加密码验证支持
-- 1. 添加密码哈希列
ALTER TABLE users ADD COLUMN password_hash TEXT;
-- 2. 添加强制修改密码标志
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;

-- 3. 插入默认管理员账户 (admin / 123456)
-- 密码哈希需要后端计算，这里先插入占位符，后端初始化时会检查并更新
-- 或者我们在这里直接插入一个预计算的哈希值
-- 假设使用简单的 SHA-256 哈希作为初始实现（为了演示），实际应该用 bcrypt/argon2
-- 但 D1 SQL 不支持复杂哈希函数，所以我们在应用层处理初始化
-- 这里只修改 Schema
