import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Clock, Play, Pause, ChevronDown, ChevronUp, Zap, Loader2, FileText, Save, RefreshCw } from 'lucide-react';
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
  newsSourceType: 'newsnow', // 默认使用 NewsNow
  newsSourceUrl: 'https://cryptonews.dpdns.org/c/hottest',
  categories: ['tech'],
  platforms: ['weixin'],
  createdAt: Date.now(),
});

const ScheduleSettings: React.FC<ScheduleSettingsProps> = ({ settings, onSettingsChange, onViewTaskLog }) => {
  // 保留 onSettingsChange 用于兼容性（虽然现在直接使用后端 API）
  void onSettingsChange; // 消除未使用警告
  
  // 当前展开编辑的任务 ID
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // 正在执行的任务 ID
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  // 从后端加载的任务列表
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(false);
  // 未保存的任务 ID 集合
  const [unsavedTaskIds, setUnsavedTaskIds] = useState<Set<string>>(new Set());
  // 正在保存的任务 ID 集合
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());

  const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
  const anonymousId = settings.anonymousId;

  // 构建认证 headers：优先使用 token，否则使用 anonymousId
  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (settings.sync?.token) {
      // 已登录用户：使用 Authorization Bearer token
      headers['Authorization'] = `Bearer ${settings.sync.token}`;
    } else if (anonymousId) {
      // 匿名用户：使用 X-Anonymous-ID
      headers['X-Anonymous-ID'] = anonymousId;
    }
    return headers;
  };

  // 从后端加载任务列表
  const loadTasksFromBackend = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/scheduled-tasks`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      } else {
        console.error('加载任务失败:', await response.text());
      }
    } catch (error) {
      console.error('加载任务异常:', error);
    } finally {
      setLoading(false);
    }
  };

  // 组件挂载时加载任务，并每10秒自动刷新
  useEffect(() => {
    loadTasksFromBackend();
    const interval = setInterval(loadTasksFromBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  // 标记任务为未保存
  const markTaskUnsaved = (taskId: string) => {
    setUnsavedTaskIds(prev => new Set(prev).add(taskId));
  };

  // 保存任务到后端
  const saveTaskToBackend = async (task: ScheduledTask) => {
    setSavingTaskIds(prev => new Set(prev).add(task.id));
    try {
      // 判断是否是新任务：先尝试 PUT，如果失败则改用 POST
      let response: Response;
      let url = `${backendUrl}/api/scheduled-tasks/${task.id}`;

      // 先尝试 PUT（更新已存在的任务）
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(task),
      });

      // 如果返回 404（任务不存在），则改用 POST 创建新任务
      if (response.status === 404) {
        url = `${backendUrl}/api/scheduled-tasks`;
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify(task),
        });
      }

      if (response.ok) {
        // 保存成功，从未保存列表中移除
        setUnsavedTaskIds(prev => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        // 重新加载任务列表
        await loadTasksFromBackend();
      } else {
        const error = await response.text();
        alert(`保存失败: ${error}`);
      }
    } catch (error) {
      alert(`保存失败: ${error}`);
    } finally {
      setSavingTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  // 删除任务
  const deleteTask = async (taskId: string) => {
    if (!confirm('确定要删除这个任务吗？')) return;
    try {
      const response = await fetch(`${backendUrl}/api/scheduled-tasks/${taskId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(), // 使用统一的认证 headers
      });
      if (response.ok) {
        await loadTasksFromBackend();
        if (expandedTaskId === taskId) setExpandedTaskId(null);
      } else {
        alert(`删除失败: ${await response.text()}`);
      }
    } catch (error) {
      alert(`删除失败: ${error}`);
    }
  };

  // 更新本地任务（标记为未保存）
  const updateTaskLocal = (taskId: string, updates: Partial<ScheduledTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    markTaskUnsaved(taskId);
  };

  // 添加新任务
  const addTask = () => {
    const newTask = createDefaultTask();
    setTasks(prev => [...prev, newTask]);
    setExpandedTaskId(newTask.id);
    markTaskUnsaved(newTask.id);
  };

  // 切换任务启用/禁用
  const toggleTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      updateTaskLocal(taskId, { enabled: !task.enabled });
    }
  };

  // 立即执行任务
  const runTaskNow = async (taskId: string) => {
    if (runningTaskId) return;
    setRunningTaskId(taskId);
    try {
      await chrome.runtime.sendMessage({
        type: 'SCHEDULE_RUN_NOW',
        payload: { taskId }
      });
    } catch (e) {
      console.error('发送执行任务消息失败:', e);
    }
    // 轮询后端获取最新任务状态
    let pollCount = 0;
    const maxPolls = 20;
    const pollInterval = setInterval(async () => {
      pollCount++;
      await loadTasksFromBackend();
      const updatedTask = tasks.find(t => t.id === taskId);
      if (updatedTask && updatedTask.lastRunStatus !== 'running') {
        clearInterval(pollInterval);
        setRunningTaskId(null);
      }
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        setRunningTaskId(null);
      }
    }, 3000);
  };

  // 切换内容分类
  const toggleCategory = (taskId: string, category: ContentCategory) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const cats = task.categories.includes(category)
      ? task.categories.filter(c => c !== category)
      : [...task.categories, category];
    if (cats.length > 0) updateTaskLocal(taskId, { categories: cats });
  };

  // 切换发布平台
  const togglePlatform = (taskId: string, platform: PublishPlatform) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const plats = task.platforms.includes(platform)
      ? task.platforms.filter(p => p !== platform)
      : [...task.platforms, platform];
    if (plats.length > 0) updateTaskLocal(taskId, { platforms: plats });
  };

  // 切换周几
  const toggleWeekday = (taskId: string, day: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const days = task.weekdays || [];
    const newDays = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day].sort();
    if (newDays.length > 0) updateTaskLocal(taskId, { weekdays: newDays });
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
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-md font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" />
          ⏰ 定时任务
        </h3>
        <button
          onClick={loadTasksFromBackend}
          disabled={loading}
          className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded transition disabled:opacity-50 flex items-center gap-1"
          title="刷新任务列表"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-xs">刷新</span>
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        定时抓取热点新闻，AI 生成文章并自动发布到各平台（需保持浏览器开启）
      </p>

      {loading && tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          <p className="text-sm">加载任务列表...</p>
        </div>
      ) : (
        <>
          {/* 任务列表 */}
          <div className="space-y-2">
            {tasks.map(task => {
              const isUnsaved = unsavedTaskIds.has(task.id);
              const isSaving = savingTaskIds.has(task.id);

              return (
                <div key={task.id} className={`border rounded-lg overflow-hidden transition-all ${task.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'} ${isUnsaved ? 'ring-2 ring-orange-300' : ''}`}>
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
                      <div className="text-sm font-medium truncate flex items-center gap-1">
                        {task.name}
                        {isUnsaved && <span className="text-xs text-orange-500 font-normal">(未保存)</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {formatScheduleDesc(task)} · {task.platforms.map(p => PUBLISH_PLATFORMS[p]).join('、')} ·
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

                    {/* 保存按钮 */}
                    {isUnsaved && (
                      <button
                        onClick={(e) => { e.stopPropagation(); saveTaskToBackend(task); }}
                        disabled={isSaving}
                        className="p-1 rounded transition text-orange-500 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                        title="保存修改"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </button>
                    )}

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
                          onChange={(e) => updateTaskLocal(task.id, { name: e.target.value })}
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
                              onClick={() => updateTaskLocal(task.id, { scheduleType: type })}
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
                              onChange={(e) => updateTaskLocal(task.id, { hour: parseInt(e.target.value) })}
                              className="p-2 border rounded text-sm"
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>{String(i).padStart(2, '0')} 时</option>
                              ))}
                            </select>
                            <span className="text-gray-500">:</span>
                            <select
                              value={task.minute}
                              onChange={(e) => updateTaskLocal(task.id, { minute: parseInt(e.target.value) })}
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
                            onChange={(e) => updateTaskLocal(task.id, { intervalMinutes: parseInt(e.target.value) })}
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

                      {/* 新闻源类型选择 */}
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">新闻源类型</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateTaskLocal(task.id, { newsSourceType: 'newsnow', tophubNodeId: undefined })}
                            className={`flex-1 px-3 py-2 text-sm rounded border transition ${task.newsSourceType === 'newsnow' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-300'}`}
                          >
                            NewsNow API
                          </button>
                          <button
                            onClick={() => updateTaskLocal(task.id, { newsSourceType: 'tophub', categories: [] })}
                            className={`flex-1 px-3 py-2 text-sm rounded border transition ${task.newsSourceType === 'tophub' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-300'}`}
                          >
                            今日热榜
                          </button>
                        </div>
                      </div>

                      {/* NewsNow 配置 */}
                      {task.newsSourceType === 'newsnow' && (
                        <>
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">NewsNow 地址</label>
                            <input
                              type="url"
                              value={task.newsSourceUrl}
                              onChange={(e) => updateTaskLocal(task.id, { newsSourceUrl: e.target.value })}
                              className="w-full p-2 border rounded text-sm"
                              placeholder="https://cryptonews.dpdns.org/c/hottest"
                            />
                            <p className="text-xs text-gray-400 mt-1">NewsNow 新闻站的任意页面地址</p>
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
                            <p className="text-xs text-gray-400 mt-1">根据偏好自动选择对应的新闻源</p>
                          </div>
                        </>
                      )}

                      {/* 今日热榜配置 */}
                      {task.newsSourceType === 'tophub' && (
                        <div>
                          <label className="text-xs font-medium text-gray-600 block mb-1">今日热榜 Node ID</label>
                          <input
                            type="text"
                            value={task.tophubNodeId || ''}
                            onChange={(e) => updateTaskLocal(task.id, { tophubNodeId: e.target.value })}
                            className="w-full p-2 border rounded text-sm font-mono"
                            placeholder="3QeLwJEd7k"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            从今日热榜页面 URL 中获取，如 tophub.today/n/<span className="font-semibold">3QeLwJEd7k</span> 中的 <span className="font-semibold">3QeLwJEd7k</span>
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            常用：知乎热榜 <code className="bg-gray-100 px-1 rounded">3QeLwJEd7k</code>、
                            微博热搜 <code className="bg-gray-100 px-1 rounded">KqndgxeLl9</code>、
                            百度热搜 <code className="bg-gray-100 px-1 rounded">Jb0vmloB1G</code>
                          </p>
                        </div>
                      )}

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

                      {/* 保存按钮（展开区域底部） */}
                      {isUnsaved && (
                        <div className="pt-2 border-t">
                          <button
                            onClick={() => saveTaskToBackend(task)}
                            disabled={isSaving}
                            className="w-full py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                保存中...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4" />
                                保存修改
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 添加任务按钮 */}
          <button
            onClick={addTask}
            className="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" />
            添加定时任务
          </button>
        </>
      )}
    </div>
  );
}

export default ScheduleSettings;
