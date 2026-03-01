import React, { useState } from 'react';
import { Plus, Trash2, Clock, Play, Pause, ChevronDown, ChevronUp, Zap, Loader2, FileText } from 'lucide-react';
import {
  ScheduledTask, ContentCategory, PublishPlatform, ScheduleType,
  CONTENT_CATEGORIES, PUBLISH_PLATFORMS, AppSettings
} from '../utils/storage';

// ============================================
// 定时任务设置组件
// 支持配置定时抓取新闻 → AI 生成文章 → 自动发布到各平台
// ============================================

interface ScheduleSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onViewTaskLog?: (task: ScheduledTask) => void; // 点击查看任务日志的回调
}

// 周几的中文映射
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 生成唯一 ID
const generateId = () => `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

// 创建默认任务
const createDefaultTask = (): ScheduledTask => ({
  id: generateId(),
  enabled: false,
  name: '新任务',
  scheduleType: 'daily',
  hour: 9,
  minute: 0,
  weekdays: [1, 2, 3, 4, 5], // 默认工作日
  intervalMinutes: 60,
  newsSourceUrl: 'https://cryptonews.dpdns.org/c/hottest',
  categories: ['tech'],
  platforms: ['weixin'],
  createdAt: Date.now(),
});

const ScheduleSettings: React.FC<ScheduleSettingsProps> = ({ settings, onSettingsChange, onViewTaskLog }) => {
  // 当前展开编辑的任务 ID
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // 正在执行的任务 ID（用于显示 loading 状态）
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const tasks = settings.scheduledTasks || [];

  // 更新任务列表并触发保存
  const updateTasks = (newTasks: ScheduledTask[]) => {
    onSettingsChange({
      ...settings,
      scheduledTasks: newTasks,
    });
  };

  // 添加新任务
  const addTask = () => {
    const newTask = createDefaultTask();
    updateTasks([...tasks, newTask]);
    setExpandedTaskId(newTask.id); // 自动展开新任务
  };

  // 删除任务
  const deleteTask = (taskId: string) => {
    updateTasks(tasks.filter(t => t.id !== taskId));
    if (expandedTaskId === taskId) setExpandedTaskId(null);
  };

  // 更新单个任务
  const updateTask = (taskId: string, updates: Partial<ScheduledTask>) => {
    updateTasks(tasks.map(t => t.id === taskId ? { ...t, ...updates } : t));
  };

  // 切换任务启用/禁用
  const toggleTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      updateTask(taskId, { enabled: !task.enabled });
    }
  };

  // 立即执行任务（发送消息给 background script）
  const runTaskNow = async (taskId: string) => {
    if (runningTaskId) return; // 防止重复点击
    setRunningTaskId(taskId);
    try {
      await chrome.runtime.sendMessage({
        type: 'SCHEDULE_RUN_NOW',
        payload: { taskId }
      });
    } catch (e) {
      console.error('发送执行任务消息失败:', e);
    }
    // 定时轮询 storage 获取最新任务状态（后台异步执行，需要主动刷新）
    let pollCount = 0;
    const maxPolls = 20; // 最多轮询 20 次（约 60 秒）
    const pollInterval = setInterval(async () => {
      pollCount++;
      try {
        const result = await chrome.storage.sync.get('scheduledTasks');
        const latestTasks: ScheduledTask[] = result.scheduledTasks || [];
        const updatedTask = latestTasks.find(t => t.id === taskId);
        // 如果任务状态不再是 running，说明执行完毕，停止轮询并刷新 UI
        if (updatedTask && updatedTask.lastRunStatus !== 'running') {
          clearInterval(pollInterval);
          setRunningTaskId(null);
          // 用最新的任务列表更新 UI
          onSettingsChange({ ...settings, scheduledTasks: latestTasks });
        }
      } catch (e) {
        console.error('轮询任务状态失败:', e);
      }
      // 超过最大轮询次数，停止轮询
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        setRunningTaskId(null);
      }
    }, 3000); // 每 3 秒检查一次
  };

  // 切换内容分类
  const toggleCategory = (taskId: string, category: ContentCategory) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const cats = task.categories.includes(category)
      ? task.categories.filter(c => c !== category)
      : [...task.categories, category];
    // 至少保留一个分类
    if (cats.length > 0) updateTask(taskId, { categories: cats });
  };

  // 切换发布平台
  const togglePlatform = (taskId: string, platform: PublishPlatform) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const plats = task.platforms.includes(platform)
      ? task.platforms.filter(p => p !== platform)
      : [...task.platforms, platform];
    if (plats.length > 0) updateTask(taskId, { platforms: plats });
  };

  // 切换周几
  const toggleWeekday = (taskId: string, day: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const days = task.weekdays || [];
    const newDays = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day].sort();
    if (newDays.length > 0) updateTask(taskId, { weekdays: newDays });
  };

  // 格式化调度描述
  const formatScheduleDesc = (task: ScheduledTask): string => {
    const timeStr = `${String(task.hour).padStart(2, '0')}:${String(task.minute).padStart(2, '0')}`;
    if (task.scheduleType === 'daily') return `每天 ${timeStr}`;
    if (task.scheduleType === 'weekly') {
      const days = (task.weekdays || []).map(d => WEEKDAY_NAMES[d]).join('、');
      return `每${days} ${timeStr}`;
    }
    return `每 ${task.intervalMinutes || 60} 分钟`;
  };

  // 格式化上次执行状态
  const formatLastRun = (task: ScheduledTask): string => {
    if (!task.lastRunTime) return '从未执行';
    const date = new Date(task.lastRunTime);
    const timeStr = date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const statusMap = { success: '✅ 成功', failed: '❌ 失败', running: '⏳ 执行中' };
    return `${timeStr} ${statusMap[task.lastRunStatus || 'success']}`;
  };

  return (
    <div className="border-t pt-4">
      <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        ⏰ 定时任务
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        定时抓取热点新闻，AI 生成文章并自动发布到各平台（需保持浏览器开启）
      </p>

      {/* 任务列表 */}
      <div className="space-y-2">
        {tasks.map(task => (
          <div key={task.id} className={`border rounded-lg overflow-hidden transition-all ${task.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
            {/* 任务摘要行 */}
            <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}>
              {/* 启用/禁用开关 */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
                className={`p-1 rounded transition ${task.enabled ? 'text-green-600 hover:bg-green-100' : 'text-gray-400 hover:bg-gray-100'}`}
                title={task.enabled ? '点击暂停' : '点击启用'}
              >
                {task.enabled ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>

              {/* 任务名称和描述 */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{task.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {formatScheduleDesc(task)} · {task.platforms.map(p => PUBLISH_PLATFORMS[p]).join('、')} · {/* 状态文字可点击查看日志 */}
                  <span
                    onClick={(e) => { e.stopPropagation(); onViewTaskLog?.(task); }}
                    className="cursor-pointer hover:underline inline-flex items-center gap-0.5"
                    title="点击查看执行日志"
                  >
                    {formatLastRun(task)} <FileText className="w-3 h-3 inline" />
                  </span>
                </div>
              </div>

              {/* 展开/收起 */}
              {expandedTaskId === task.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}

              {/* 立即执行按钮 */}
              <button
                onClick={(e) => { e.stopPropagation(); runTaskNow(task.id); }}
                disabled={runningTaskId === task.id}
                className={`p-1 rounded transition ${runningTaskId === task.id ? 'text-orange-400' : 'text-blue-500 hover:text-blue-700 hover:bg-blue-50'}`}
                title="立即执行"
              >
                {runningTaskId === task.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              </button>

              {/* 删除按钮 */}
              <button
                onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                title="删除任务"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* 失败时显示错误信息 */}
            {task.lastRunStatus === 'failed' && task.lastRunError && (
              <div className="px-3 pb-2 -mt-1">
                <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2 break-words">
                  ⚠️ 错误详情：{task.lastRunError}
                </div>
              </div>
            )}

            {/* 展开的编辑区域 */}
            {expandedTaskId === task.id && (
              <div className="border-t p-3 space-y-3 bg-white">
                {/* 任务名称 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">任务名称</label>
                  <input
                    type="text"
                    value={task.name}
                    onChange={(e) => updateTask(task.id, { name: e.target.value })}
                    className="w-full p-2 border rounded text-sm"
                    placeholder="给任务起个名字"
                  />
                </div>

                {/* 调度类型 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">执行频率</label>
                  <div className="flex gap-2">
                    {(['daily', 'weekly', 'interval'] as ScheduleType[]).map(type => (
                      <button
                        key={type}
                        onClick={() => updateTask(task.id, { scheduleType: type })}
                        className={`px-3 py-1.5 text-xs rounded-full border transition ${task.scheduleType === type ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'}`}
                      >
                        {type === 'daily' ? '每天' : type === 'weekly' ? '每周' : '间隔'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 时间设置 */}
                {task.scheduleType !== 'interval' ? (
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">执行时间</label>
                    <div className="flex gap-2 items-center">
                      <select
                        value={task.hour}
                        onChange={(e) => updateTask(task.id, { hour: parseInt(e.target.value) })}
                        className="p-2 border rounded text-sm"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')} 时</option>
                        ))}
                      </select>
                      <span className="text-gray-500">:</span>
                      <select
                        value={task.minute}
                        onChange={(e) => updateTask(task.id, { minute: parseInt(e.target.value) })}
                        className="p-2 border rounded text-sm"
                      >
                        {[0, 10, 15, 20, 30, 40, 45, 50].map(m => (
                          <option key={m} value={m}>{String(m).padStart(2, '0')} 分</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">执行间隔</label>
                    <select
                      value={task.intervalMinutes || 60}
                      onChange={(e) => updateTask(task.id, { intervalMinutes: parseInt(e.target.value) })}
                      className="p-2 border rounded text-sm"
                    >
                      {[30, 60, 120, 180, 360, 720, 1440].map(m => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} 分钟` : m < 1440 ? `${m / 60} 小时` : '24 小时'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 周几选择（仅 weekly 模式） */}
                {task.scheduleType === 'weekly' && (
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">执行日期</label>
                    <div className="flex gap-1 flex-wrap">
                      {WEEKDAY_NAMES.map((name, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleWeekday(task.id, idx)}
                          className={`px-2.5 py-1 text-xs rounded border transition ${(task.weekdays || []).includes(idx) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'}`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 新闻源 URL */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">新闻源地址</label>
                  <input
                    type="url"
                    value={task.newsSourceUrl}
                    onChange={(e) => updateTask(task.id, { newsSourceUrl: e.target.value })}
                    className="w-full p-2 border rounded text-sm"
                    placeholder="https://cryptonews.dpdns.org/c/hottest"
                  />
                  <p className="text-xs text-gray-400 mt-1">插件会打开此页面抓取热点新闻列表</p>
                </div>

                {/* 内容偏好 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">内容偏好（可多选）</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {(Object.entries(CONTENT_CATEGORIES) as [ContentCategory, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => toggleCategory(task.id, key)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition ${task.categories.includes(key) ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 发布平台 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">发布平台（可多选）</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {(Object.entries(PUBLISH_PLATFORMS) as [PublishPlatform, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => togglePlatform(task.id, key)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition ${task.platforms.includes(key) ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-300 hover:border-green-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 添加任务按钮 */}
      <button
        onClick={addTask}
        className="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition flex items-center justify-center gap-1"
      >
        <Plus className="w-4 h-4" />
        添加定时任务
      </button>
    </div>
  );
};

export default ScheduleSettings;
