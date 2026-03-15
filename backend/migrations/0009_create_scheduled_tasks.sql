-- 定时任务表
-- 用于存储用户的定时发布任务配置
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,                    -- 任务唯一标识（UUID）
  user_id TEXT NOT NULL,                  -- 用户ID（匿名ID）
  enabled INTEGER NOT NULL DEFAULT 1,     -- 是否启用（0=禁用, 1=启用）
  name TEXT NOT NULL,                     -- 任务名称
  schedule_type TEXT NOT NULL,            -- 调度类型：daily/weekly/interval
  hour INTEGER NOT NULL,                  -- 执行小时（0-23）
  minute INTEGER NOT NULL,                -- 执行分钟（0-59）
  weekdays TEXT,                          -- 周几执行（JSON数组，如 "[1,3,5]"），仅 weekly 类型
  interval_minutes INTEGER,               -- 间隔分钟数，仅 interval 类型
  news_source_type TEXT NOT NULL,         -- 新闻源类型：newsnow/tophub
  news_source_url TEXT NOT NULL,          -- 新闻源 URL
  tophub_node_id TEXT,                    -- 今日热榜的 node_id，仅 tophub 类型
  categories TEXT NOT NULL,               -- 内容偏好分类（JSON数组，如 "[\"tech\",\"finance\"]"）
  platforms TEXT NOT NULL,                -- 发布平台（JSON数组，如 "[\"weixin\",\"toutiao\"]"）
  last_run_time INTEGER,                  -- 上次执行时间戳（毫秒）
  last_run_status TEXT,                   -- 上次执行状态：success/failed/running
  last_run_error TEXT,                    -- 上次执行失败的错误信息
  created_at INTEGER NOT NULL,            -- 创建时间戳（毫秒）
  updated_at INTEGER NOT NULL             -- 更新时间戳（毫秒）
);

-- 为用户ID创建索引，加速查询
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);

-- 为启用状态创建索引，加速查询启用的任务
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
