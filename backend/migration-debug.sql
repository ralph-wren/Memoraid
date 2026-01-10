-- 远程调试系统数据库表

-- 调试命令表：存储待执行的调试命令
CREATE TABLE IF NOT EXISTS debug_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verification_code TEXT NOT NULL,
  command_type TEXT NOT NULL,
  command_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER
);

-- 调试结果表：存储命令执行结果
CREATE TABLE IF NOT EXISTS debug_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id INTEGER NOT NULL,
  verification_code TEXT NOT NULL,
  result_type TEXT NOT NULL,
  result_data TEXT,
  screenshot_base64 TEXT,
  execution_time INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (command_id) REFERENCES debug_commands(id)
);

-- 调试会话表：管理活跃的调试会话
CREATE TABLE IF NOT EXISTS debug_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verification_code TEXT NOT NULL UNIQUE,
  plugin_info TEXT,
  is_active INTEGER DEFAULT 1,
  last_heartbeat INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_debug_commands_code_status ON debug_commands(verification_code, status);
CREATE INDEX IF NOT EXISTS idx_debug_results_command ON debug_results(command_id);
CREATE INDEX IF NOT EXISTS idx_debug_sessions_code ON debug_sessions(verification_code);
