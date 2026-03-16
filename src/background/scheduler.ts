// ============================================
// 定时任务调度器
// 使用 chrome.alarms API 实现定时抓取新闻 → AI 生成文章 → 自动发布
// ============================================

import { getSettings, ScheduledTask, ContentCategory, CONTENT_CATEGORIES } from '../utils/storage';
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
// 扩充覆盖范围：新增汽车、游戏、旅行、美食、数码、国际、军事、房产分类
const CATEGORY_SOURCE_MAP: Record<ContentCategory, string[]> = {
  tech: ['36kr', 'ithome', 'sspai', 'juejin', 'hackernews', 'producthunt', 'github-trending-today', 'oschina', 'v2ex', 'cnbeta'],
  society: ['zhihu', 'toutiao', 'thepaper', 'baidu', 'ifeng', 'tencent-hot', 'douban', 'weibo', 'netease-news'],
  entertainment: ['douyin', 'bilibili-hot-search', 'bilibili-hot-video', 'kuaishou', 'douban', 'steam', 'weibo', 'maoyan'],
  finance: ['wallstreetcn-hot', 'cls-hot', 'xueqiu-hotstock', 'jin10', 'fastbull', 'eastmoney', 'yicai'],
  sports: ['hupu', 'zhibo8', 'dongqiudi'],
  science: ['solidot', 'sspai', 'zhihu', 'guokr'],
  health: ['zhihu', 'toutiao', 'dxy'],
  education: ['zhihu', 'nowcoder', 'juejin', 'csdn'],
  crypto: ['wallstreetcn-hot', 'cls-hot', 'jin10', 'xueqiu-hotstock', 'coindesk', 'cointelegraph'],
  auto: ['autohome', 'dongchedi', 'yiche', 'zhihu'],           // 汽车
  gaming: ['steam', 'bilibili-hot-search', '3dmgame', 'gamersky', 'nga'], // 游戏
  travel: ['mafengwo', 'ctrip', 'zhihu', 'xiaohongshu'],       // 旅行
  food: ['dianping', 'xiachufang', 'zhihu', 'xiaohongshu'],    // 美食
  digital: ['ithome', 'sspai', 'zol', 'smzdm', 'cnbeta'],     // 数码
  world: ['bbc', 'reuters', 'zaobao', 'ftchinese', 'ifeng'],   // 国际
  military: ['thepaper', 'ifeng', 'toutiao', 'zhihu'],         // 军事
  realestate: ['zhihu', 'toutiao', 'cls-hot', 'thepaper'],     // 房产
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

  // 验证 alarm 是否创建成功
  const alarm = await chrome.alarms.get(CHECK_ALARM_NAME);
  if (alarm) {
    console.log('[Scheduler] ✅ 调度器已启动，每分钟检查一次任务');
    console.log('[Scheduler] 下次触发时间:', new Date(alarm.scheduledTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  } else {
    console.error('[Scheduler] ❌ Alarm 创建失败！');
  }
}

/**
 * 处理 alarm 触发
 */
async function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name !== CHECK_ALARM_NAME) return;

  console.log('[Scheduler] ⏰ Alarm 触发，开始检查任务...');

  try {
    // 从后端 API 获取任务列表
    const settings = await getSettings();
    const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
    const anonymousId = settings.anonymousId;

    // 构建认证 headers
    const headers: Record<string, string> = {};
    if (settings.sync?.token) {
      headers['Authorization'] = `Bearer ${settings.sync.token}`;
    } else if (anonymousId) {
      headers['X-Anonymous-ID'] = anonymousId;
    }

    console.log('[Scheduler] 正在从后端获取任务列表...');
    const response = await fetch(`${backendUrl}/api/scheduled-tasks`, {
      headers,
    });

    if (!response.ok) {
      console.error(`[Scheduler] 获取任务列表失败: ${response.status}`);
      return;
    }

    const data = await response.json();
    const tasks = data.tasks || [];
    const enabledTasks = tasks.filter((t: ScheduledTask) => t.enabled);

    console.log(`[Scheduler] 获取到 ${tasks.length} 个任务，其中 ${enabledTasks.length} 个已启用`);

    if (enabledTasks.length === 0) {
      console.log('[Scheduler] 未执行任务: 没有启用的任务');
      return;
    }

    // 获取中国时区的当前时间（UTC+8）
    const now = new Date();
    const chinaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    console.log(`[Scheduler] 当前中国时间: ${chinaTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (${chinaTime.getHours()}:${chinaTime.getMinutes()})`);

    for (const task of enabledTasks) {
      const shouldRun = shouldRunTask(task, chinaTime);
      console.log(`[Scheduler] 任务 "${task.name}": ${shouldRun ? '✅ 满足执行条件' : '❌ 不满足执行条件'}`);
      if (shouldRun) {
        console.log(`[Scheduler] 🚀 触发任务: ${task.name}`);
        await executeTask(task);
      }
    }
  } catch (error) {
    console.error('[Scheduler] 检查任务时出错:', error);
  }
}

/**
 * 判断任务是否应该在当前时间执行
 * @param task 任务配置
 * @param now 当前时间（中国时区）
 */
function shouldRunTask(task: ScheduledTask, now: Date): boolean {
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0=周日, 1=周一...

  // 获取执行时间列表（优先使用 executionTimes，否则使用 hour/minute）
  const executionTimes = task.executionTimes && task.executionTimes.length > 0
    ? task.executionTimes
    : [{ hour: task.hour, minute: task.minute }];

  console.log(`[Scheduler] 检查任务 "${task.name}": 类型=${task.scheduleType}, 执行时间=${executionTimes.map(t => `${t.hour}:${t.minute}`).join(', ')}, 当前时间=${currentHour}:${currentMinute}`);

  // 如果正在执行中，跳过
  if (task.lastRunStatus === 'running') {
    console.log(`[Scheduler] 任务 "${task.name}" 正在执行中，跳过`);
    return false;
  }

  if (task.scheduleType === 'interval') {
    // 间隔模式：检查距离上次执行是否超过间隔时间
    const intervalMs = (task.intervalMinutes || 60) * 60 * 1000;
    const lastRun = task.lastRunTime || 0;
    const timeSinceLastRun = now.getTime() - lastRun;
    console.log(`[Scheduler] 间隔模式: 距上次执行 ${Math.floor(timeSinceLastRun / 60000)} 分钟，需要 ${task.intervalMinutes || 60} 分钟`);
    return timeSinceLastRun >= intervalMs;
  }

  // daily 或 weekly 模式：检查是否到了任意一个指定时间
  // 遍历所有执行时间点，只要有一个匹配就触发
  let isTimeMatch = false;
  for (const time of executionTimes) {
    if (currentHour === time.hour && currentMinute === time.minute) {
      isTimeMatch = true;
      break;
    }
  }
  
  console.log(`[Scheduler] 时间匹配: ${isTimeMatch} (当前=${currentHour}:${currentMinute})`);
  
  if (!isTimeMatch) return false;

  // 检查今天是否已经执行过（防止同一分钟内重复执行）
  if (task.lastRunTime) {
    const lastRunDate = new Date(task.lastRunTime);
    const isSameMinute = lastRunDate.getHours() === currentHour &&
      lastRunDate.getMinutes() === currentMinute &&
      lastRunDate.getDate() === now.getDate();
    if (isSameMinute) {
      console.log(`[Scheduler] 任务 "${task.name}" 在当前分钟已执行过，跳过`);
      return false;
    }
  }

  if (task.scheduleType === 'weekly') {
    // 周模式：检查今天是否在指定的周几列表中
    const isWeekdayMatch = (task.weekdays || []).includes(currentDay);
    console.log(`[Scheduler] 周模式: 今天是周${currentDay}, 设定周几=${task.weekdays}, 匹配=${isWeekdayMatch}`);
    return isWeekdayMatch;
  }

  // daily 模式：每天都执行
  console.log(`[Scheduler] 每日模式: 满足执行条件`);
  return true;
}

/**
 * 执行定时任务
 * 支持两种模式：
 * 1. 单篇模式：随机选择一篇文章生成
 * 2. AI 选择模式：让 AI 从热榜中选择指定数量的话题生成多篇文章
 */
async function executeTask(task: ScheduledTask) {
  // 清空旧日志，开始新一轮执行
  await clearTaskLog(task.id);
  // 更新任务状态为执行中
  await updateTaskStatus(task.id, 'running');

  // 追踪任务打开的所有标签页 ID
  const taskTabIds: number[] = [];

  try {
    await taskLog(task.id, 'info', `🚀 开始执行任务: ${task.name}`);
    await taskLog(task.id, 'info', `📰 新闻源类型: ${task.newsSourceType === 'tophub' ? '今日热榜' : 'NewsNow'}`);
    await taskLog(task.id, 'info', `📤 发布平台: ${task.platforms.join('、')}`);
    
    const articleCount = task.articleCount || 1;
    await taskLog(task.id, 'info', `📝 生成文章数量: ${articleCount} 篇`);

    let articles: Array<{ title: string; url: string }> = [];

    // 根据新闻源类型选择不同的获取方式
    if (task.newsSourceType === 'tophub') {
      // 今日热榜：通过页面抓取
      articles = await fetchFromTophub(task);
    } else {
      // NewsNow：通过 API
      articles = await fetchFromNewsNow(task);
    }

    if (articles.length === 0) {
      throw new Error('未获取到任何文章');
    }

    // 选择要处理的文章列表
    let selectedArticles: Array<{ title: string; url: string }> = [];

    // 始终使用 AI 选择话题（即使只选 1 篇）
    await taskLog(task.id, 'info', `🤖 正在调用 AI 选择话题...`);
    selectedArticles = await selectArticlesWithAI(task, articles, articleCount);
    await taskLog(task.id, 'success', `✅ AI 已选择 ${selectedArticles.length} 个话题`);

    // 循环处理每个选中的文章
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedArticles.length; i++) {
      const article = selectedArticles[i];
      await taskLog(task.id, 'info', `\n📝 [${i + 1}/${selectedArticles.length}] 处理话题: ${article.title}`);
      await taskLog(task.id, 'info', `🔗 文章链接: ${article.url}`);

      try {
        // 打开文章详情页
        await taskLog(task.id, 'info', `🌐 正在打开文章页面...`);
        const tab = await chrome.tabs.create({
          url: article.url,
          active: false,
        });

        if (!tab.id) throw new Error('无法创建标签页');

        // 记录任务打开的标签页 ID
        taskTabIds.push(tab.id);

        // 等待页面加载，增加超时时间到 30 秒，并添加重试机制
        try {
          await waitForTabLoad(tab.id, 30000);
          await taskLog(task.id, 'success', `✅ 页面加载完成`);
        } catch (loadError: any) {
          // 如果加载超时，重试一次
          await taskLog(task.id, 'warn', `⚠️ 页面加载超时，正在重试...`);
          try {
            // 刷新页面
            await chrome.tabs.reload(tab.id);
            await waitForTabLoad(tab.id, 30000);
            await taskLog(task.id, 'success', `✅ 页面加载完成（重试成功）`);
          } catch (retryError: any) {
            // 重试失败，抛出错误
            throw new Error(`页面加载失败: ${retryError.message || '超时'}`);
          }
        }
        
        await new Promise(r => setTimeout(r, 5000));
        await taskLog(task.id, 'info', `⏳ 等待页面渲染完成`);

        // 依次发布到各平台
        for (const platform of task.platforms) {
          await taskLog(task.id, 'info', `📤 开始发布到: ${platform}...`);
          try {
            await taskLog(task.id, 'info', `⏳ 正在抓取内容、AI 生成文章并发布...`);
            // 传递 isScheduledTask = true，标识这是定时任务，强制自动发布
            await handleInitiateProcess(platform, tab.id!, true);
            await taskLog(task.id, 'success', `✅ ${platform} 发布流程已完成`);
          } catch (e: any) {
            await taskLog(task.id, 'error', `❌ 发布到 ${platform} 失败: ${e.message}`);
          }
        }

        // 注意：不在这里关闭标签页，统一在任务结束时关闭

        successCount++;
        await taskLog(task.id, 'success', `✅ [${i + 1}/${selectedArticles.length}] 话题处理完成`);

        // 如果还有下一篇，等待一段时间避免频率过高
        if (i < selectedArticles.length - 1) {
          await taskLog(task.id, 'info', `⏳ 等待 10 秒后处理下一篇...`);
          await new Promise(r => setTimeout(r, 10000));
        }

      } catch (e: any) {
        failCount++;
        await taskLog(task.id, 'error', `❌ [${i + 1}/${selectedArticles.length}] 话题处理失败: ${e.message}`);
      }
    }

    // 更新任务状态为成功
    await updateTaskStatus(task.id, 'success');
    await taskLog(task.id, 'success', `\n🎉 任务全部完成！成功 ${successCount} 篇，失败 ${failCount} 篇`);

    // 关闭所有任务打开的页面（清理现场）
    await taskLog(task.id, 'info', `🧹 正在关闭任务打开的 ${taskTabIds.length} 个页面...`);
    await closeAllTaskTabs(taskTabIds);
    await taskLog(task.id, 'success', `✅ 页面已全部关闭`);

  } catch (error: any) {
    await taskLog(task.id, 'error', `❌ 任务失败: ${error?.message || String(error)}`);
    await updateTaskStatus(task.id, 'failed', error?.message || String(error));

    // 关闭所有任务打开的页面（清理现场）
    await taskLog(task.id, 'info', `🧹 正在关闭任务打开的 ${taskTabIds.length} 个页面...`);
    await closeAllTaskTabs(taskTabIds);
    await taskLog(task.id, 'success', `✅ 页面已全部关闭`);
  }
}

/**
 * 从 NewsNow 获取新闻列表（原有逻辑）
 */
async function fetchFromNewsNow(task: ScheduledTask): Promise<Array<{ title: string; url: string }>> {
  await taskLog(task.id, 'info', `📰 新闻源: ${task.newsSourceUrl}`);
  await taskLog(task.id, 'info', `🏷️ 内容偏好: ${task.categories.map(c => CONTENT_CATEGORIES[c]).join('、')}`);

  const baseUrl = extractBaseUrl(task.newsSourceUrl);
  await taskLog(task.id, 'info', `🔗 API 基础地址: ${baseUrl}`);

  const sourceIds = getSourceIdsForCategories(task.categories);
  await taskLog(task.id, 'info', `📋 候选新闻源: ${sourceIds.join(', ')}`);

  if (sourceIds.length === 0) {
    throw new Error('没有匹配的新闻源，请检查内容偏好设置');
  }

  const shuffledSources = shuffleArray([...sourceIds]);
  let articles: Array<{ title: string; url: string }> = [];

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

  return articles;
}

/**
 * 从今日热榜获取新闻列表
 * 通过打开页面并注入脚本抓取 DOM 内容
 */
async function fetchFromTophub(task: ScheduledTask): Promise<Array<{ title: string; url: string }>> {
  const nodeId = task.tophubNodeId || '';
  if (!nodeId) {
    throw new Error('今日热榜 node_id 未配置');
  }

  const tophubUrl = `https://tophub.today/n/${nodeId}`;
  await taskLog(task.id, 'info', `📰 今日热榜: ${tophubUrl}`);
  await taskLog(task.id, 'info', `🔍 正在打开热榜页面...`);

  // 创建一个隐藏标签页打开今日热榜
  const tab = await chrome.tabs.create({
    url: tophubUrl,
    active: false,
  });

  if (!tab.id) throw new Error('无法创建标签页');

  try {
    // 等待页面加载
    await waitForTabLoad(tab.id, 15000);
    await taskLog(task.id, 'success', `✅ 页面加载完成`);
    
    // 等待页面渲染
    await new Promise(r => setTimeout(r, 3000));
    await taskLog(task.id, 'info', `⏳ 正在抓取热榜数据...`);

    // 注入脚本抓取页面数据
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 今日热榜的 DOM 结构：表格第二列的链接
        // 使用更精确的选择器：table tbody tr td:nth-child(2) a
        const items = document.querySelectorAll('table tbody tr td:nth-child(2) a');
        const articles: Array<{ title: string; url: string }> = [];
        
        items.forEach((item) => {
          const link = item as HTMLAnchorElement;
          const title = link.textContent?.trim() || '';
          const url = link.href || '';
          
          // 过滤掉无效的链接（标题太短或没有URL）
          if (title && url && title.length > 3) {
            articles.push({ title, url });
          }
        });
        
        return articles;
      },
    });

    // 关闭今日热榜标签页
    await chrome.tabs.remove(tab.id);

    const articles = results[0]?.result || [];
    
    if (articles.length === 0) {
      throw new Error('未能从页面抓取到热榜数据，可能页面结构已变化');
    }

    await taskLog(task.id, 'success', `✅ 成功抓取到 ${articles.length} 条热榜`);
    return articles;

  } catch (error: any) {
    // 确保关闭标签页
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* 忽略 */ }
    throw error;
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
 * 关闭所有任务相关的标签页
 * 只关闭本次任务打开的标签页，不影响用户手动打开的页面
 */
async function closeAllTaskTabs(taskTabIds: number[]): Promise<void> {
  try {
    if (taskTabIds.length === 0) {
      console.log('[Scheduler] 没有需要关闭的标签页');
      return;
    }

    // 过滤出仍然存在的标签页
    const existingTabs = await chrome.tabs.query({});
    const existingTabIds = new Set(existingTabs.map(tab => tab.id));
    
    const tabsToClose = taskTabIds.filter(id => existingTabIds.has(id));

    // 批量关闭标签页
    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
      console.log(`[Scheduler] 已关闭 ${tabsToClose.length} 个任务标签页`);
    }
  } catch (error) {
    console.error('[Scheduler] 关闭标签页失败:', error);
    // 不抛出错误，避免影响任务完成状态
  }
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
 * 使用 AI 从热榜列表中选择指定数量的话题
 * @param task 定时任务配置
 * @param articles 热榜文章列表
 * @param articleCount 需要选择的数量
 * @returns 选中的文章列表
 */
async function selectArticlesWithAI(
  task: ScheduledTask,
  articles: Array<{ title: string; url: string }>,
  articleCount: number
): Promise<Array<{ title: string; url: string }>> {
  try {
    // 获取设置，创建 AI 客户端
    const settings = await getSettings();
    
    // 构建 AI 客户端（复用 createOpenAIClient 的逻辑）
    let effectiveApiKey: string = '';
    let extraHeaders: Record<string, string> = {};

    if (settings.provider === 'memoraid') {
      if (settings.sync?.token) {
        effectiveApiKey = String(settings.sync.token);
      } else {
        const anonId = settings.anonymousId;
        if (!anonId) {
          throw new Error('无法获取匿名用户标识');
        }
        effectiveApiKey = 'anonymous';
        extraHeaders['X-Anonymous-ID'] = String(anonId);
      }
    } else {
      const rawKey = settings.apiKeys?.[settings.provider] || settings.apiKey;
      effectiveApiKey = rawKey ? String(rawKey) : '';
    }

    if (!effectiveApiKey) {
      throw new Error(`API Key for ${settings.provider} is missing`);
    }

    const baseURL = settings.baseUrl ? String(settings.baseUrl) : undefined;

    // 动态导入 OpenAI（避免在文件顶部导入导致循环依赖）
    const OpenAI = (await import('openai')).default;
    
    const client = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL,
      defaultHeaders: extraHeaders
    });

    // 构建热榜列表文本（只取前 50 条，避免 token 过多）
    // 格式：序号. 标题 | URL
    const articleList = articles.slice(0, 50).map((article, index) => 
      `${index + 1}. ${article.title} | ${article.url}`
    ).join('\n');

    // 构建 AI 提示词
    const systemPrompt = `你是一个专业的内容选题助手。用户会给你一个热榜列表和选题要求，你需要从中选择最合适的话题。

要求：
1. 严格按照用户的选题要求进行筛选
2. 优先选择热度高、有讨论价值的话题
3. 避免重复或相似的话题
4. 返回格式必须是 JSON 对象，包含选中话题的完整 URL 和选择理由

返回格式示例：
{
  "selections": [
    {"url": "https://example.com/article1", "reason": "该话题讨论度高，符合科技类要求"},
    {"url": "https://example.com/article2", "reason": "热点事件，具有时效性"}
  ]
}`;

    const userPrompt = `请从以下热榜中选择 ${articleCount} 个最合适的话题：

${articleList}

${task.customPrompt ? `\n选题要求：${task.customPrompt}\n` : '\n选题要求：选择热度高、有讨论价值的话题\n'}

请返回 JSON 格式的选择结果，包含每个话题的完整 URL 和选择理由。注意：必须返回列表中的原始 URL，不要修改。`;

    await taskLog(task.id, 'info', `🤖 AI 提示词已构建，共 ${articles.length} 个候选话题`);

    // 调用 AI API
    const response = await client.chat.completions.create({
      model: settings.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1000, // 增加 token 限制，因为需要返回理由
    });

    const aiResponse = response.choices[0]?.message?.content?.trim() || '';
    await taskLog(task.id, 'info', `🤖 AI 返回: ${aiResponse}`);

    // 解析 AI 返回的选择结果
    let selections: Array<{ url: string; reason: string }> = [];
    try {
      // 尝试提取 JSON（可能包含在 markdown 代码块中）
      let jsonText = aiResponse.trim();
      
      // 方法1：尝试匹配 ```json 或 ``` 代码块（使用贪婪匹配）
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        await taskLog(task.id, 'info', `🔍 从代码块中提取 JSON`);
      }
      
      await taskLog(task.id, 'info', `🔍 准备解析 JSON (长度: ${jsonText.length})`);
      
      const parsed = JSON.parse(jsonText);
      if (parsed.selections && Array.isArray(parsed.selections)) {
        selections = parsed.selections;
        await taskLog(task.id, 'info', `✅ 成功解析，获得 ${selections.length} 个选择`);
      } else if (Array.isArray(parsed)) {
        // 兼容直接返回数组的格式
        selections = parsed;
        await taskLog(task.id, 'info', `✅ 成功解析数组格式，获得 ${selections.length} 个选择`);
      } else {
        await taskLog(task.id, 'warn', `⚠️ JSON 格式不符合预期`);
      }
    } catch (e) {
      await taskLog(task.id, 'error', `❌ JSON 解析失败: ${e}`);
    }

    if (selections.length === 0) {
      throw new Error('AI 未返回有效的选择结果');
    }

    // 根据 URL 匹配文章
    await taskLog(task.id, 'info', `🔍 开始匹配 ${selections.length} 个 URL...`);
    
    const selectedArticles = selections
      .map((sel, idx) => {
        // 在原始列表中查找匹配的 URL
        const article = articles.find(a => a.url === sel.url);
        if (!article) {
          // 如果没有匹配到，记录日志方便调试
          taskLog(task.id, 'warn', `⚠️ [${idx + 1}] 无法匹配 URL: ${sel.url}`);
          // 打印前 3 个热榜 URL 作为参考
          if (idx === 0) {
            taskLog(task.id, 'info', `📋 热榜前 3 个 URL 示例:`);
            articles.slice(0, 3).forEach((a, i) => {
              taskLog(task.id, 'info', `  ${i + 1}. ${a.url}`);
            });
          }
        } else {
          taskLog(task.id, 'success', `✅ [${idx + 1}] 匹配成功: ${article.title}`);
        }
        return article ? { ...article, reason: sel.reason } : null;
      })
      .filter((article): article is { title: string; url: string; reason: string } => article !== null)
      .slice(0, articleCount); // 确保不超过请求数量

    if (selectedArticles.length === 0) {
      throw new Error('AI 返回的 URL 无法匹配到热榜文章');
    }

    await taskLog(task.id, 'success', `✅ 最终选择 ${selectedArticles.length} 个话题（AI 返回 ${selections.length} 个）`);
    
    // 打印 AI 返回的所有 URL（用于调试）
    await taskLog(task.id, 'info', `🔍 AI 返回的 URL 列表:`);
    selections.forEach((sel, i) => {
      taskLog(task.id, 'info', `  ${i + 1}. ${sel.url}`);
    });
    
    // 打印匹配成功的文章
    await taskLog(task.id, 'info', `✅ 匹配成功的文章:`);
    selectedArticles.forEach((article, i) => {
      taskLog(task.id, 'info', `  ${i + 1}. ${article.title}`);
      taskLog(task.id, 'info', `     💡 选择理由: ${article.reason}`);
      taskLog(task.id, 'info', `     🔗 URL: ${article.url}`);
    });

    // 返回时去掉 reason 字段（保持原有接口兼容）
    return selectedArticles.map(({ title, url }) => ({ title, url }));

  } catch (error: any) {
    await taskLog(task.id, 'error', `❌ AI 选择失败: ${error.message}`);
    // 如果 AI 选择失败，降级为随机选择
    await taskLog(task.id, 'warn', `⚠️ 降级为随机选择模式`);
    const shuffled = shuffleArray([...articles]);
    return shuffled.slice(0, articleCount);
  }
}

/**
 * 更新任务执行状态
 * 使用后端 API 更新，避免与用户配置修改冲突
 * @param taskId 任务 ID
 * @param status 执行状态
 * @param errorMessage 失败时的错误信息（可选）
 */
async function updateTaskStatus(taskId: string, status: 'success' | 'failed' | 'running', errorMessage?: string) {
  try {
    // 先从 settings 获取后端配置
    const settings = await getSettings();
    const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
    const anonymousId = settings.anonymousId;

    // 构建认证 headers：优先使用 token，否则使用 anonymousId
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (settings.sync?.token) {
      headers['Authorization'] = `Bearer ${settings.sync.token}`;
    } else if (anonymousId) {
      headers['X-Anonymous-ID'] = anonymousId;
    }

    // 调用后端 API 更新任务状态
    const response = await fetch(`${backendUrl}/api/scheduled-tasks/${taskId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        lastRunTime: Date.now(),
        lastRunStatus: status,
        lastRunError: status === 'failed' ? (errorMessage || '未知错误') : null,
      }),
    });

    if (!response.ok) {
      console.error('[Scheduler] 更新任务状态失败:', await response.text());
    }
  } catch (error) {
    console.error('[Scheduler] 更新任务状态异常:', error);
  }
}

/**
 * 手动立即执行指定任务（由 popup 的"立即执行"按钮触发）
 * @param taskId 要执行的任务 ID
 */
export async function runTaskById(taskId: string) {
  try {
    // 从后端 API 获取任务信息
    const settings = await getSettings();
    const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
    const anonymousId = settings.anonymousId;

    // 构建认证 headers
    const headers: Record<string, string> = {};
    if (settings.sync?.token) {
      headers['Authorization'] = `Bearer ${settings.sync.token}`;
    } else if (anonymousId) {
      headers['X-Anonymous-ID'] = anonymousId;
    }

    console.log(`[Scheduler] 从后端获取任务: ${taskId}`);
    const response = await fetch(`${backendUrl}/api/scheduled-tasks`, {
      headers,
    });

    if (!response.ok) {
      console.error(`[Scheduler] 获取任务列表失败: ${response.status}`);
      return;
    }

    const data = await response.json();
    const tasks = data.tasks || [];
    const task = tasks.find((t: ScheduledTask) => t.id === taskId);

    if (!task) {
      console.error(`[Scheduler] 未找到任务: ${taskId}`);
      return;
    }

    console.log(`[Scheduler] 手动触发任务: ${task.name}`);
    // 异步执行，不阻塞消息响应
    executeTask(task);
  } catch (error) {
    console.error(`[Scheduler] 获取任务失败:`, error);
  }
}
