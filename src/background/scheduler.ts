// ============================================
// 定时任务调度器
// 使用 chrome.alarms API 实现定时抓取新闻 → AI 生成文章 → 自动发布
// ============================================

import { getSettings, saveSettings, ScheduledTask, ContentCategory, CONTENT_CATEGORIES } from '../utils/storage';
// 直接导入 handleInitiateProcess，因为 background 不能通过 sendMessage 给自己发消息
import { handleInitiateProcess } from './index';

// 主检查 alarm 名称（每分钟检查一次是否有任务需要执行）
const CHECK_ALARM_NAME = 'memoraid_schedule_check';

// ============================================
// 任务实时日志系统
// 日志存储在 chrome.storage.local 中，UI 通过轮询读取实时显示
// ============================================

// 单条日志的类型
export interface TaskLogEntry {
  time: number;       // 时间戳
  level: 'info' | 'warn' | 'error' | 'success'; // 日志级别
  message: string;    // 日志内容
}

// 日志存储的 key 前缀（每个任务一个 key）
const LOG_STORAGE_PREFIX = 'task_log_';
// 每个任务最多保留的日志条数
const MAX_LOG_ENTRIES = 200;

/**
 * 向指定任务追加一条日志
 * 同时也输出到 console，方便调试
 */
async function taskLog(taskId: string, level: TaskLogEntry['level'], message: string) {
  const key = `${LOG_STORAGE_PREFIX}${taskId}`;
  // 同步输出到 console
  const prefix = `[Scheduler][${taskId.substring(0, 8)}]`;
  if (level === 'error') console.error(prefix, message);
  else if (level === 'warn') console.warn(prefix, message);
  else console.log(prefix, message);

  try {
    const result = await chrome.storage.local.get(key);
    const logs: TaskLogEntry[] = result[key] || [];
    logs.push({ time: Date.now(), level, message });
    // 超过上限时只保留最新的
    if (logs.length > MAX_LOG_ENTRIES) logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    await chrome.storage.local.set({ [key]: logs });
  } catch (e) {
    console.error('[Scheduler] 写入日志失败:', e);
  }
}

/**
 * 清空指定任务的日志（每次新执行前调用）
 */
async function clearTaskLog(taskId: string) {
  const key = `${LOG_STORAGE_PREFIX}${taskId}`;
  await chrome.storage.local.set({ [key]: [] });
}

// ============================================
// NewsNow API 相关配置
// 新闻源是 SPA 应用，content script 无法抓取动态渲染的内容
// 改为直接调用 NewsNow 的 API 获取结构化新闻数据
// ============================================

// NewsNow API 中的 source id 与内容偏好分类的映射关系
// 每个分类对应多个新闻源，执行时会随机选择一个源获取新闻
const CATEGORY_SOURCE_MAP: Record<ContentCategory, string[]> = {
  tech: ['36kr', 'ithome', 'sspai', 'juejin', 'hackernews', 'producthunt', 'github-trending-today'],
  society: ['zhihu', 'toutiao', 'thepaper', 'baidu', 'ifeng', 'tencent-hot', 'douban'],
  entertainment: ['douyin', 'bilibili-hot-search', 'bilibili-hot-video', 'kuaishou', 'douban', 'steam'],
  finance: ['wallstreetcn-hot', 'cls-hot', 'xueqiu-hotstock', 'jin10', 'fastbull'],
  sports: ['hupu'],
  science: ['solidot', 'sspai'],
  health: ['zhihu', 'toutiao'],
  education: ['zhihu', 'nowcoder'],
  crypto: ['wallstreetcn-hot', 'cls-hot', 'jin10', 'xueqiu-hotstock'],
};

/**
 * 初始化调度器
 * 在 background service worker 启动时调用
 */
export async function initScheduler() {
  console.log('[Scheduler] 初始化定时任务调度器...');

  // 创建一个每分钟触发的 alarm，用于检查是否有任务需要执行
  await chrome.alarms.create(CHECK_ALARM_NAME, {
    periodInMinutes: 1, // 每分钟检查一次
  });

  // 监听 alarm 触发事件
  chrome.alarms.onAlarm.addListener(handleAlarm);

  console.log('[Scheduler] 调度器已启动，每分钟检查一次任务');
}

/**
 * 处理 alarm 触发
 */
async function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name !== CHECK_ALARM_NAME) return;

  try {
    const settings = await getSettings();
    const tasks = settings.scheduledTasks || [];
    const enabledTasks = tasks.filter(t => t.enabled);

    if (enabledTasks.length === 0) return;

    const now = new Date();

    for (const task of enabledTasks) {
      if (shouldRunTask(task, now)) {
        console.log(`[Scheduler] 触发任务: ${task.name}`);
        await executeTask(task);
      }
    }
  } catch (error) {
    console.error('[Scheduler] 检查任务时出错:', error);
  }
}

/**
 * 判断任务是否应该在当前时间执行
 */
function shouldRunTask(task: ScheduledTask, now: Date): boolean {
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0=周日, 1=周一...

  // 如果正在执行中，跳过
  if (task.lastRunStatus === 'running') return false;

  if (task.scheduleType === 'interval') {
    // 间隔模式：检查距离上次执行是否超过间隔时间
    const intervalMs = (task.intervalMinutes || 60) * 60 * 1000;
    const lastRun = task.lastRunTime || 0;
    return (now.getTime() - lastRun) >= intervalMs;
  }

  // daily 或 weekly 模式：检查是否到了指定时间
  // 只在指定的小时和分钟触发（允许 1 分钟误差）
  const isTimeMatch = currentHour === task.hour && currentMinute === task.minute;
  if (!isTimeMatch) return false;

  // 检查今天是否已经执行过（防止同一分钟内重复执行）
  if (task.lastRunTime) {
    const lastRunDate = new Date(task.lastRunTime);
    const isSameMinute = lastRunDate.getHours() === currentHour &&
      lastRunDate.getMinutes() === currentMinute &&
      lastRunDate.getDate() === now.getDate();
    if (isSameMinute) return false;
  }

  if (task.scheduleType === 'weekly') {
    // 周模式：检查今天是否在指定的周几列表中
    return (task.weekdays || []).includes(currentDay);
  }

  // daily 模式：每天都执行
  return true;
}

/**
 * 执行定时任务
 * 改进流程：通过 NewsNow API 获取新闻列表 → 选择一篇 → 打开文章页 → 触发生成+发布
 * 
 * 之前的方案是打开 SPA 页面用 content script 抓取 DOM，但 SPA 动态渲染导致抓不到内容
 * 现在改为直接调用 NewsNow 的 /api/s?id=xxx 接口获取结构化 JSON 数据，更可靠
 */
async function executeTask(task: ScheduledTask) {
  // 清空旧日志，开始新一轮执行
  await clearTaskLog(task.id);
  // 更新任务状态为执行中
  await updateTaskStatus(task.id, 'running');

  try {
    await taskLog(task.id, 'info', `🚀 开始执行任务: ${task.name}`);
    await taskLog(task.id, 'info', `📰 新闻源: ${task.newsSourceUrl}`);
    await taskLog(task.id, 'info', `🏷️ 内容偏好: ${task.categories.map(c => CONTENT_CATEGORIES[c]).join('、')}`);
    await taskLog(task.id, 'info', `📤 发布平台: ${task.platforms.join('、')}`);

    // 第一步：从新闻源 URL 中提取基础域名（用于 API 调用）
    const baseUrl = extractBaseUrl(task.newsSourceUrl);
    await taskLog(task.id, 'info', `🔗 API 基础地址: ${baseUrl}`);

    // 第二步：根据内容偏好分类，收集对应的 NewsNow source id 列表
    const sourceIds = getSourceIdsForCategories(task.categories);
    await taskLog(task.id, 'info', `📋 候选新闻源: ${sourceIds.join(', ')}`);

    if (sourceIds.length === 0) {
      throw new Error('没有匹配的新闻源，请检查内容偏好设置');
    }

    // 第三步：随机选择一个 source，调用 API 获取新闻列表
    let articles: Array<{ title: string; url: string }> = [];
    const shuffledSources = shuffleArray([...sourceIds]);

    for (const sourceId of shuffledSources) {
      try {
        await taskLog(task.id, 'info', `🔍 尝试获取新闻源: ${sourceId}...`);
        const result = await fetchNewsFromApi(baseUrl, sourceId);
        if (result.length > 0) {
          articles = result;
          await taskLog(task.id, 'success', `✅ 从 ${sourceId} 获取到 ${articles.length} 篇文章`);
          break;
        } else {
          await taskLog(task.id, 'warn', `⚠️ ${sourceId} 返回 0 篇文章，尝试下一个源`);
        }
      } catch (e: any) {
        await taskLog(task.id, 'warn', `⚠️ 源 ${sourceId} 获取失败: ${e.message}`);
      }
    }

    if (articles.length === 0) {
      throw new Error(`所有新闻源均获取失败，已尝试: ${shuffledSources.slice(0, 5).join(', ')}`);
    }

    // 第四步：随机选择一篇文章
    const selectedArticle = articles[Math.floor(Math.random() * Math.min(articles.length, 10))];
    await taskLog(task.id, 'success', `📝 选择文章: ${selectedArticle.title}`);
    await taskLog(task.id, 'info', `🔗 文章链接: ${selectedArticle.url}`);

    // 第五步：打开文章详情页
    await taskLog(task.id, 'info', `🌐 正在打开文章页面...`);
    const tab = await chrome.tabs.create({
      url: selectedArticle.url,
      active: false,
    });

    if (!tab.id) throw new Error('无法创建标签页');

    await waitForTabLoad(tab.id, 20000);
    await taskLog(task.id, 'success', `✅ 页面加载完成`);
    await new Promise(r => setTimeout(r, 5000));
    await taskLog(task.id, 'info', `⏳ 等待页面渲染完成`);

    // 第六步：依次发布到各平台
    // 直接调用 handleInitiateProcess，不能用 sendMessage（background 无法给自己发消息）
    for (const platform of task.platforms) {
      await taskLog(task.id, 'info', `📤 开始发布到: ${platform}...`);
      try {
        await taskLog(task.id, 'info', `⏳ 正在抓取内容、AI 生成文章并发布...`);
        // 直接调用，等待整个流程完成（包括抓取、AI 生成、发布）
        await handleInitiateProcess(platform, tab.id!);
        await taskLog(task.id, 'success', `✅ ${platform} 发布流程已完成`);
      } catch (e: any) {
        await taskLog(task.id, 'error', `❌ 发布到 ${platform} 失败: ${e.message}`);
      }
    }

    // 关闭文章标签页
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* 可能已关闭 */ }

    // 更新任务状态为成功
    await updateTaskStatus(task.id, 'success');
    await taskLog(task.id, 'success', `🎉 任务全部完成！`);

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icon-128.png'),
      title: '定时任务完成',
      message: `"${task.name}" 已执行完成，文章已发布到 ${task.platforms.length} 个平台`,
    });

  } catch (error: any) {
    await taskLog(task.id, 'error', `❌ 任务失败: ${error?.message || String(error)}`);
    await updateTaskStatus(task.id, 'failed', error?.message || String(error));

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icon-128.png'),
      title: '定时任务失败',
      message: `"${task.name}" 执行失败: ${error.message || '未知错误'}`,
    });
  }
}

/**
 * 从新闻源 URL 中提取基础域名
 * 例如 https://cryptonews.dpdns.org/c/hottest → https://cryptonews.dpdns.org
 */
function extractBaseUrl(newsSourceUrl: string): string {
  try {
    const url = new URL(newsSourceUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    // 如果 URL 解析失败，直接返回原始 URL 去掉路径部分
    return newsSourceUrl.replace(/\/[^/]*$/, '');
  }
}

/**
 * 根据内容偏好分类，获取对应的 NewsNow source id 列表
 * 会去重，避免同一个源被查询多次
 */
function getSourceIdsForCategories(categories: ContentCategory[]): string[] {
  const sourceSet = new Set<string>();
  for (const cat of categories) {
    const sources = CATEGORY_SOURCE_MAP[cat] || [];
    sources.forEach(s => sourceSet.add(s));
  }
  return Array.from(sourceSet);
}

/**
 * 调用 NewsNow API 获取指定源的新闻列表
 * @param baseUrl 新闻站基础 URL（如 https://cryptonews.dpdns.org）
 * @param sourceId NewsNow 的 source id（如 zhihu, 36kr, toutiao 等）
 * @returns 文章列表 [{title, url}]
 */
async function fetchNewsFromApi(baseUrl: string, sourceId: string): Promise<Array<{ title: string; url: string }>> {
  const apiUrl = `${baseUrl}/api/s?id=${encodeURIComponent(sourceId)}`;
  console.log(`[Scheduler] 调用 API: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Memoraid-Scheduler/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: HTTP ${response.status}`);
  }

  const data = await response.json();

  // NewsNow API 返回格式: { status: "success", id: "xxx", items: [{id, title, url, extra}] }
  if (data.status !== 'success' && data.status !== 'cache') {
    throw new Error(`API 返回错误: ${data.message || data.status || '未知错误'}`);
  }

  const items = data.items || [];
  // 过滤掉没有 URL 的条目，并提取 title 和 url
  return items
    .filter((item: any) => item.url && item.title)
    .map((item: any) => ({
      title: item.title,
      url: item.url,
    }));
}

/**
 * 随机打乱数组顺序（Fisher-Yates 洗牌算法）
 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId: number, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeout);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * 更新任务执行状态
 * @param taskId 任务 ID
 * @param status 执行状态
 * @param errorMessage 失败时的错误信息（可选）
 */
async function updateTaskStatus(taskId: string, status: 'success' | 'failed' | 'running', errorMessage?: string) {
  const settings = await getSettings();
  const tasks = settings.scheduledTasks || [];
  const updatedTasks = tasks.map(t =>
    t.id === taskId
      ? {
          ...t,
          lastRunTime: Date.now(),
          lastRunStatus: status,
          // 成功或执行中时清空错误信息，失败时保存错误信息
          lastRunError: status === 'failed' ? (errorMessage || '未知错误') : undefined,
        }
      : t
  );
  await saveSettings({ ...settings, scheduledTasks: updatedTasks });
}

/**
 * 手动立即执行指定任务（由 popup 的"立即执行"按钮触发）
 * @param taskId 要执行的任务 ID
 */
export async function runTaskById(taskId: string) {
  const settings = await getSettings();
  const tasks = settings.scheduledTasks || [];
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    console.error(`[Scheduler] 未找到任务: ${taskId}`);
    return;
  }

  console.log(`[Scheduler] 手动触发任务: ${task.name}`);
  // 异步执行，不阻塞消息响应
  executeTask(task);
}
