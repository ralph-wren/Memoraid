-- 添加 execution_times 字段用于存储多个执行时间点
-- 格式：JSON 数组，例如 [{"hour":9,"minute":0},{"hour":12,"minute":0}]

ALTER TABLE scheduled_tasks ADD COLUMN execution_times TEXT;

-- 注释：
-- execution_times 存储 JSON 格式的时间数组
-- 如果为 NULL 或空，则使用 hour 和 minute 字段（向后兼容）
