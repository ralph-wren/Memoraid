import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, Clock, Play, Pause, ChevronDown, ChevronUp, Zap, Loader2, FileText, Save, RefreshCw, Copy, X } from 'lucide-react';
import {
  ScheduledTask, PublishPlatform, ScheduleType,
  PUBLISH_PLATFORMS, AppSettings
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
  executionTimes: [{ hour: 9, minute: 0 }], // 默认一个执行时间
  weekdays: [1, 2, 3, 4, 5], // 默认工作日
  intervalMinutes: 60,
  newsSourceType: 'tophub', // 默认使用今日热榜
  newsSourceUrl: '',
  tophubNodeId: '3QeLwJEd7k', // 默认知乎热榜
  categories: [],
  platforms: ['xiaohongshu'], // 默认小红书
  articleCount: 1, // 默认生成 1 篇文章
  customPrompt: '', // 默认无自定义提示词
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
  // 使用 ref 保存最新的 unsavedTaskIds，避免闭包问题
  const unsavedTaskIdsRef = useRef<Set<string>>(new Set());
  // 正在保存的任务 ID 集合
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  // 临时时间输入状态（用于添加新时间）
  const [tempHour, setTempHour] = useState<number>(9);
  const [tempMinute, setTempMinute] = useState<number>(0);

  const backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
  const anonymousId = settings.anonymousId;

  // 同步 unsavedTaskIds 到 ref
  useEffect(() => {
    unsavedTaskIdsRef.current = unsavedTaskIds;
  }, [unsavedTaskIds]);

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

  // 从后端加载任务列表（如果有未保存的修改，跳过刷新避免覆盖）
  // 使用 useCallback 避免不必要的重新创建，依赖 backendUrl 和 getAuthHeaders
  const loadTasksFromBackend = useCallback(async (force: boolean = false) => {
    // 如果有未保存的修改且不是强制刷新，跳过（使用 ref 避免闭包问题）
    if (!force && unsavedTaskIdsRef.current.size > 0) {
      console.log('[ScheduleSettings] 跳过自动刷新：有未保存的修改', Array.from(unsavedTaskIdsRef.current));
      return;
    }
    
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (settings.sync?.token) {
        headers['Authorization'] = `Bearer ${settings.sync.token}`;
      } else if (anonymousId) {
        headers['X-Anonymous-ID'] = anonymousId;
      }
      
      const response = await fetch(`${backendUrl}/api/scheduled-tasks`, {
        headers,
      });
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
        
        // 【新增2026-03-28】检查是否有正在执行的任务，更新runningTaskId状态
        const runningTask = (data.tasks || []).find((t: ScheduledTask) => t.lastRunStatus === 'running');
        if (runningTask) {
          setRunningTaskId(runningTask.id);
        } else {
          setRunningTaskId(null);
        }
      } else {
        console.error('加载任务失败:', await response.text());
      }
    } catch (error) {
      console.error('加载任务异常:', error);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, settings.sync?.token, anonymousId]); // 依赖这些值，当它们变化时重新创建函数

  // 组件挂载时加载任务，并每10秒自动刷新（有未保存修改时跳过）
  // 当 token 或 anonymousId 变化时也重新加载（用户登录/登出）
  useEffect(() => {
    loadTasksFromBackend(true); // 初始加载强制执行
    const interval = setInterval(() => loadTasksFromBackend(false), 10000); // 自动刷新时检查未保存状态
    return () => clearInterval(interval);
  }, [loadTasksFromBackend]); // 依赖 loadTasksFromBackend，当它变化时重新设置定时器

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
        // 重新加载任务列表（强制刷新）
        await loadTasksFromBackend(true);
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

  // 删除任务（直接删除，不需要确认）
  const deleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`${backendUrl}/api/scheduled-tasks/${taskId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(), // 使用统一的认证 headers
      });
      if (response.ok) {
        await loadTasksFromBackend(true); // 强制刷新
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

  // 复制任务
  const duplicateTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const newTask: ScheduledTask = {
      ...task,
      id: generateId(),
      name: `${task.name} (副本)`,
      enabled: false, // 复制的任务默认禁用
      createdAt: Date.now(),
      lastRunTime: undefined,
      lastRunStatus: undefined,
      lastRunError: undefined,
    };
    
    setTasks(prev => [...prev, newTask]);
    setExpandedTaskId(newTask.id);
    markTaskUnsaved(newTask.id);
  };

  // 切换展开/收起
  const toggleExpand = (taskId: string) => {
    setExpandedTaskId(prev => prev === taskId ? null : taskId);
  };

  // 切换任务启用/禁用
  const toggleTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      updateTaskLocal(taskId, { enabled: !task.enabled });
    }
  };

  // 添加执行时间（不自动保存，只标记为未保存）
  const addExecutionTime = (taskId: string, hour: number, minute: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const times = task.executionTimes || [];
    // 检查是否已存在相同时间（静默处理，不弹窗）
    const exists = times.some(t => t.hour === hour && t.minute === minute);
    if (exists) {
      // 不弹窗，静默返回
      return;
    }
    
    // 添加新时间并排序
    const newTimes = [...times, { hour, minute }].sort((a, b) => {
      if (a.hour !== b.hour) return a.hour - b.hour;
      return a.minute - b.minute;
    });
    
    // 只更新本地状态，不自动保存
    updateTaskLocal(taskId, { executionTimes: newTimes });
  };

  // 删除执行时间（不自动保存，只标记为未保存）
  const removeExecutionTime = (taskId: string, index: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const times = task.executionTimes || [];
    // 至少保留一个时间点（静默处理，不弹窗）
    if (times.length <= 1) {
      // 不弹窗，静默返回
      return;
    }
    
    const newTimes = times.filter((_, i) => i !== index);
    // 只更新本地状态，不自动保存
    updateTaskLocal(taskId, { executionTimes: newTimes });
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
    // 轮询后端获取最新任务状态（只更新正在执行的任务，不影响其他任务）
    let pollCount = 0;
    const maxPolls = 20;
    const pollInterval = setInterval(async () => {
      pollCount++;
      
      // 只获取正在执行的任务的最新状态，不刷新整个列表
      try {
        const response = await fetch(`${backendUrl}/api/scheduled-tasks`, {
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          const updatedTask = (data.tasks || []).find((t: ScheduledTask) => t.id === taskId);
          
          if (updatedTask) {
            // 只更新正在执行的任务的状态字段，不覆盖整个任务
            setTasks(prev => prev.map(t => {
              if (t.id === taskId) {
                return {
                  ...t,
                  lastRunTime: updatedTask.lastRunTime,
                  lastRunStatus: updatedTask.lastRunStatus,
                  lastRunError: updatedTask.lastRunError,
                };
              }
              return t;
            }));
            
            // 如果任务已完成，停止轮询
            if (updatedTask.lastRunStatus !== 'running') {
              clearInterval(pollInterval);
              setRunningTaskId(null);
            }
          }
        }
      } catch (error) {
        console.error('轮询任务状态失败:', error);
      }
      
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        setRunningTaskId(null);
      }
    }, 3000);
  };

  // 【新增2026-03-28】暂停正在执行的任务
  const stopTaskNow = async (taskId: string) => {
    if (runningTaskId !== taskId) return;
    
    try {
      // 发送暂停任务消息到后台
      await chrome.runtime.sendMessage({
        type: 'SCHEDULE_STOP_NOW',
        payload: { taskId }
      });
      
      // 立即清除运行状态
      setRunningTaskId(null);
      
      // 刷新任务状态
      await loadTasksFromBackend(true);
    } catch (e) {
      console.error('发送暂停任务消息失败:', e);
    }
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

  // 格式化调度描述（支持多个执行时间）
  const formatScheduleDesc = (task: ScheduledTask): string => {
    // 获取执行时间列表（优先使用 executionTimes，否则使用 hour/minute）
    const executionTimes = task.executionTimes && task.executionTimes.length > 0
      ? task.executionTimes
      : [{ hour: task.hour, minute: task.minute }];
    
    // 格式化时间列表
    const timeStrs = executionTimes.map(t => 
      `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
    );
    
    if (task.scheduleType === 'daily') {
      // 每天模式：显示所有时间点
      return `每天 ${timeStrs.join('、')}`;
    }
    
    if (task.scheduleType === 'weekly') {
      // 每周模式：显示周几和所有时间点
      const days = (task.weekdays || []).map(d => WEEKDAY_NAMES[d]).join('、');
      return `每${days} ${timeStrs.join('、')}`;
    }
    
    // 间隔模式：不使用时间点
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
          onClick={loadTasksFromBackend.bind(null, true)}
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
                    {/* 任务名称和描述 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-1">
                        {task.name}
                        {isUnsaved && <span className="text-xs text-orange-500 font-normal">(未保存)</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {formatScheduleDesc(task)} · {task.platforms.map(p => PUBLISH_PLATFORMS[p]).join('、')} · {formatLastRun(task)}
                      </div>
                      {/* 任务状态提示（在任务名称下方） */}
                      {task.lastRunStatus === 'running' && (
                        <div className="text-xs text-blue-500 mt-1">
                          ⏳ 正在执行中...
                        </div>
                      )}
                      {task.lastRunStatus === 'success' && task.lastRunTime && Date.now() - task.lastRunTime < 60000 && (
                        <div className="text-xs text-green-500 mt-1">
                          ✅ 执行成功
                        </div>
                      )}
                      {task.lastRunStatus === 'failed' && task.lastRunTime && Date.now() - task.lastRunTime < 60000 && (
                        <div className="text-xs text-red-500 mt-1">
                          ❌ 执行失败
                        </div>
                      )}
                    </div>

                    {/* 展开/收起按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition"
                      title={expandedTaskId === task.id ? '收起' : '展开'}
                    >
                      {expandedTaskId === task.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {/* 启用/禁用开关 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
                      className={`p-1 rounded transition ${task.enabled ? 'text-green-600 hover:bg-green-100' : 'text-gray-400 hover:bg-gray-100'}`}
                      title={task.enabled ? '点击暂停' : '点击启用'}
                    >
                      {task.enabled ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>

                    {/* 立即执行/取消按钮 */}
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (runningTaskId === task.id) {
                          // 执行中，点击取消
                          stopTaskNow(task.id);
                        } else {
                          // 未执行，点击执行
                          runTaskNow(task.id);
                        }
                      }}
                      className={`p-1 rounded transition ${runningTaskId === task.id ? 'text-red-500 hover:text-red-700 hover:bg-red-50' : 'text-blue-500 hover:text-blue-700 hover:bg-blue-50'}`}
                      title={runningTaskId === task.id ? '点击取消执行' : '立即执行'}
                    >
                      {runningTaskId === task.id ? <X className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                    </button>

                    {/* 查看日志按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewTaskLog?.(task); }}
                      className="p-1 text-gray-400 hover:text-purple-500 hover:bg-purple-50 rounded transition"
                      title="查看执行日志"
                    >
                      <FileText className="w-4 h-4" />
                    </button>

                    {/* 复制按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); duplicateTask(task.id); }}
                      className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition"
                      title="复制任务"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    {/* 保存按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); saveTaskToBackend(task); }}
                      disabled={isSaving}
                      className={`p-1 rounded transition ${isUnsaved ? 'text-orange-500 hover:text-orange-700 hover:bg-orange-50' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'} disabled:opacity-50`}
                      title={isUnsaved ? '有未保存的修改，点击保存' : '保存任务配置'}
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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

                      {/* 时间设置 + 文章数量 */}
                      {task.scheduleType !== 'interval' ? (
                        <div className="grid grid-cols-2 gap-3">
                          {/* 执行时间（多时间点） */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">执行时间</label>
                            
                            {/* 添加时间输入框 */}
                            <div className="flex gap-2 items-center mb-2">
                              <select
                                value={tempHour}
                                onChange={(e) => setTempHour(parseInt(e.target.value))}
                                className="p-1.5 border rounded text-sm flex-1"
                              >
                                {Array.from({ length: 24 }, (_, i) => (
                                  <option key={i} value={i}>{String(i).padStart(2, '0')} 时</option>
                                ))}
                              </select>
                              <span className="text-gray-500 text-sm">:</span>
                              <select
                                value={tempMinute}
                                onChange={(e) => setTempMinute(parseInt(e.target.value))}
                                className="p-1.5 border rounded text-sm flex-1"
                              >
                                {Array.from({ length: 60 }, (_, i) => (
                                  <option key={i} value={i}>{String(i).padStart(2, '0')} 分</option>
                                ))}
                              </select>
                              <button
                                onClick={() => addExecutionTime(task.id, tempHour, tempMinute)}
                                className="p-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
                                title="添加时间"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {/* 已添加的时间列表 */}
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {(task.executionTimes || [{ hour: task.hour, minute: task.minute }]).map((time, index) => (
                                <div key={index} className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded text-sm">
                                  <span className="font-mono">
                                    {String(time.hour).padStart(2, '0')}:{String(time.minute).padStart(2, '0')}
                                  </span>
                                  <button
                                    onClick={() => removeExecutionTime(task.id, index)}
                                    className="p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                    title="删除"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* 文章数量 */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">生成文章数量</label>
                            <select
                              value={task.articleCount || 1}
                              onChange={(e) => updateTaskLocal(task.id, { articleCount: parseInt(e.target.value) })}
                              className="w-full p-2 border rounded text-sm"
                            >
                              {[1, 2, 3, 4, 5].map(n => (
                                <option key={n} value={n}>{n} 篇</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {/* 执行间隔 */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">执行间隔</label>
                            <select
                              value={task.intervalMinutes || 60}
                              onChange={(e) => updateTaskLocal(task.id, { intervalMinutes: parseInt(e.target.value) })}
                              className="w-full p-2 border rounded text-sm"
                            >
                              {[30, 60, 120, 180, 360, 720, 1440].map(m => (
                                <option key={m} value={m}>
                                  {m < 60 ? `${m} 分钟` : m < 1440 ? `${m / 60} 小时` : '24 小时'}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* 文章数量 */}
                          <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">生成文章数量</label>
                            <select
                              value={task.articleCount || 1}
                              onChange={(e) => updateTaskLocal(task.id, { articleCount: parseInt(e.target.value) })}
                              className="w-full p-2 border rounded text-sm"
                            >
                              {[1, 2, 3, 4, 5].map(n => (
                                <option key={n} value={n}>{n} 篇</option>
                              ))}
                            </select>
                          </div>
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

                      {/* 今日热榜 Node ID */}
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">今日热榜 Node ID</label>
                        <p className="text-xs text-gray-500 mb-2">
                          访问 <a href="https://tophub.today" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">tophub.today</a>，
                          选择热榜后从 URL 中获取 Node ID。例如：tophub.today/n/<span className="font-semibold text-gray-700">3QeLwJEd7k</span> 中的 <span className="font-semibold text-gray-700">3QeLwJEd7k</span>
                        </p>
                        <input
                          type="text"
                          value={task.tophubNodeId || ''}
                          onChange={(e) => updateTaskLocal(task.id, { tophubNodeId: e.target.value })}
                          className="w-full p-2 border rounded text-sm font-mono"
                          placeholder="3QeLwJEd7k"
                        />
                      </div>

                      {/* 通知邮箱 */}
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">通知邮箱（可选）</label>
                        <p className="text-xs text-gray-500 mb-2">
                          任务完成后将发送邮件通知，包含执行状态、文章详情等信息
                        </p>
                        <input
                          type="email"
                          value={task.notificationEmail || ''}
                          onChange={(e) => updateTaskLocal(task.id, { notificationEmail: e.target.value })}
                          className="w-full p-2 border rounded text-sm"
                          placeholder="your-email@example.com"
                        />
                      </div>

                      {/* 自定义提示词（直接保存，不需要独立按钮） */}
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">自定义提示词（可选）</label>
                        <textarea
                          value={task.customPrompt || ''}
                          onChange={(e) => updateTaskLocal(task.id, { customPrompt: e.target.value })}
                          className="w-full p-2 border rounded text-sm"
                          placeholder="例如：优先选择科技类话题，避免娱乐八卦"
                          rows={3}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          AI 会根据你的要求从热榜中选择合适的话题
                          {isUnsaved && (
                            <span className="text-orange-500 ml-1">· 修改内容后记得点击右上角的保存按钮</span>
                          )}
                        </p>
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
