-- 添加单次生成文章数量和自定义提示词字段
-- 用于支持 AI 从热榜中选择指定数量的话题

-- 添加 article_count 字段（单次生成文章数量，默认 1）
ALTER TABLE scheduled_tasks ADD COLUMN article_count INTEGER DEFAULT 1;

-- 添加 custom_prompt 字段（自定义提示词，用于 AI 选择话题）
ALTER TABLE scheduled_tasks ADD COLUMN custom_prompt TEXT;
