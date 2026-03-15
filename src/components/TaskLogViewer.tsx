import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Trash2, RefreshCw, Copy } from 'lucide-react';
import { ScheduledTask, CONTENT_CATEGORIES, PUBLISH_PLATFORMS } from '../utils/storage';

// ============================================
// 定时任务实时日志查看器
// 通过轮询 chrome.storage.local 读取 scheduler 写入的日志
// ============================================

// 日志条目类型（与 scheduler.ts 中的 TaskLogEntry 保持一致）
interface TaskLogEntry {
  time: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface TaskLogViewerProps {
  task: ScheduledTask;       // 当前查看的任务
  onBack: () => void;        // 返回按钮回调
}

// 日志存储 key 前缀（与 scheduler.ts 一致）
const LOG_STORAGE_PREFIX = 'task_log_';

const TaskLogViewer: React.FC<TaskLogViewerProps> = ({ task, onBack }) => {
  const [logs, setLogs] = useState<TaskLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true); // 是否自动滚动到底部
  const [copySuccess, setCopySuccess] = useState(false); // 复制成功提示
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 轮询读取日志
  useEffect(() => {
    const key = `${LOG_STORAGE_PREFIX}${task.id}`;

    // 立即读取一次
    const readLogs = async () => {
      try {
        const result = await chrome.storage.local.get(key);
        const entries: TaskLogEntry[] = result[key] || [];
        setLogs(entries);
      } catch (e) {
        console.error('读取任务日志失败:', e);
      }
    };

    readLogs();

    // 每 2 秒轮询一次（任务执行中时实时更新）
    const interval = setInterval(readLogs, 2000);
    return () => clearInterval(interval);
  }, [task.id]);

  // 自动滚动到底部（只在任务执行中时自动滚动）
  useEffect(() => {
    // 只有任务状态为 'running' 时才自动滚动
    const shouldAutoScroll = task.lastRunStatus === 'running' && autoScroll;
    if (shouldAutoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, task.lastRunStatus]);

  // 监听用户手动滚动，如果滚到上面就暂停自动滚动
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // 如果距离底部不到 50px，认为在底部，继续自动滚动
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  // 清空日志
  const clearLogs = async () => {
    const key = `${LOG_STORAGE_PREFIX}${task.id}`;
    await chrome.storage.local.set({ [key]: [] });
    setLogs([]);
  };

  // 复制所有日志到剪贴板
  const copyLogs = async () => {
    if (logs.length === 0) {
      return;
    }
    
    // 格式化日志内容
    const logText = logs.map(entry => {
      const time = formatTime(entry.time);
      const level = entry.level.toUpperCase().padEnd(7); // 对齐
      return `[${time}] [${level}] ${entry.message}`;
    }).join('\n');
    
    try {
      await navigator.clipboard.writeText(logText);
      setCopySuccess(true);
      // 2秒后隐藏提示
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (e) {
      console.error('复制日志失败:', e);
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  // 日志级别对应的样式
  const levelStyles: Record<string, string> = {
    info: 'text-gray-600',
    warn: 'text-yellow-600 bg-yellow-50',
    error: 'text-red-600 bg-red-50',
    success: 'text-green-600 bg-green-50',
  };

  // 任务状态标签
  const statusLabel = task.lastRunStatus === 'running'
    ? '⏳ 执行中...'
    : task.lastRunStatus === 'success'
      ? '✅ 已完成'
      : task.lastRunStatus === 'failed'
        ? '❌ 失败'
        : '⏸️ 未执行';

  return (
    <div className="flex flex-col h-full">
      {/* 顶部导航栏 */}
      <div className="p-3 border-b flex items-center gap-2 bg-gray-50 shrink-0">
        <button onClick={onBack} className="p-1 hover:bg-gray-200 rounded transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">📋 {task.name}</div>
          <div className="text-xs text-gray-500">
            {statusLabel} · {task.categories.map(c => CONTENT_CATEGORIES[c]).join('、')} → {task.platforms.map(p => PUBLISH_PLATFORMS[p]).join('、')}
          </div>
        </div>
        {/* 复制日志按钮 */}
        <button
          onClick={copyLogs}
          disabled={logs.length === 0}
          className={`p-1.5 rounded transition ${
            copySuccess 
              ? 'text-green-500 bg-green-50' 
              : logs.length === 0
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
          }`}
          title={copySuccess ? '已复制！' : '复制所有日志'}
        >
          <Copy className="w-4 h-4" />
        </button>
        {/* 清空日志按钮 */}
        <button
          onClick={clearLogs}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
          title="清空日志"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 日志内容区域 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-white"
        style={{ minHeight: 0 }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <RefreshCw className="w-8 h-8 animate-spin-slow" />
            <p>暂无日志，等待任务执行...</p>
            <p className="text-xs">点击 ⚡ 按钮立即执行任务</p>
          </div>
        ) : (
          logs.map((entry, idx) => (
            <div
              key={idx}
              className={`py-1 px-2 rounded mb-0.5 flex items-start gap-2 ${levelStyles[entry.level] || ''}`}
            >
              <span className="text-gray-400 shrink-0 select-none">{formatTime(entry.time)}</span>
              <span className="break-all">{entry.message}</span>
            </div>
          ))
        )}
        {/* 用于自动滚动的锚点 */}
        <div ref={logEndRef} />
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-2 border-t bg-gray-50 text-xs text-gray-500 flex justify-between shrink-0">
        <span>共 {logs.length} 条日志</span>
        <span>
          {task.lastRunStatus === 'running' 
            ? (autoScroll ? '📍 自动滚动' : '⏸️ 已暂停滚动（滑到底部恢复）')
            : '⏹️ 任务已结束'
          }
        </span>
      </div>
    </div>
  );
};

export default TaskLogViewer;
