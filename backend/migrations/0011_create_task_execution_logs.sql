-- 定时任务执行记录表
-- 用于存储每次定时任务的执行详情
CREATE TABLE IF NOT EXISTS task_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增ID
  task_id TEXT NOT NULL,                  -- 关联的任务ID
  user_id TEXT NOT NULL,                  -- 用户ID
  task_name TEXT NOT NULL,                -- 任务名称（冗余存储，方便查询）
  status TEXT NOT NULL,                   -- 执行状态：success/failed/running
  started_at INTEGER NOT NULL,            -- 开始时间戳（毫秒）
  completed_at INTEGER,                   -- 完成时间戳（毫秒）
  duration INTEGER,                       -- 执行时长（毫秒）
  articles_generated INTEGER DEFAULT 0,   -- 生成的文章数量
  articles_published INTEGER DEFAULT 0,   -- 成功发布的文章数量
  error_message TEXT,                     -- 错误信息
  details TEXT,                           -- 详细信息（JSON格式）
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 为任务ID创建索引
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_task_id ON task_execution_logs(task_id);

-- 为用户ID创建索引
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_user_id ON task_execution_logs(user_id);

-- 为状态创建索引
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_status ON task_execution_logs(status);

-- 为开始时间创建索引（用于排序和时间范围查询）
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_started_at ON task_execution_logs(started_at);
