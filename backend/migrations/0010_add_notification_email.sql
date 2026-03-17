-- 添加通知邮箱字段到定时任务表
-- 用于在任务完成后发送邮件通知
ALTER TABLE scheduled_tasks ADD COLUMN notification_email TEXT;
