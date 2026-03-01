import React, { useState, useEffect } from 'react';
import Home from '../components/Home';
import Settings from '../components/Settings';
import TaskLogViewer from '../components/TaskLogViewer';
import { ArrowLeft } from 'lucide-react';
import { getSettings, ScheduledTask } from '../utils/storage';
import { getTranslation } from '../utils/i18n';

const App: React.FC = () => {
  // 视图状态：home=首页, settings=设置, taskLog=任务日志
  const [view, setView] = useState<'home' | 'settings' | 'taskLog'>('home');
  const [lang, setLang] = useState('zh-CN');
  // 当前查看日志的任务（仅 taskLog 视图使用）
  const [logTask, setLogTask] = useState<ScheduledTask | null>(null);

  useEffect(() => {
    const loadLang = async () => {
      const settings = await getSettings();
      if (settings.language) {
        setLang(settings.language);
      }
    };

    loadLang();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.language) {
        loadLang();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  const t = getTranslation(lang);

  return (
    <div className="bg-white min-h-screen text-gray-900">
      {/* 任务日志视图 */}
      {view === 'taskLog' && logTask ? (
        <TaskLogViewer task={logTask} onBack={() => { setView('settings'); setLogTask(null); }} />
      ) : view === 'settings' ? (
        <div className="flex flex-col h-full">
          <div className="p-4 border-b flex items-center gap-2">
            <button 
              onClick={() => setView('home')}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="font-semibold">{t.backToHome}</span>
          </div>
          {/* 传递 onViewTaskLog 回调给 Settings，再传给 ScheduleSettings */}
          <Settings onViewTaskLog={(task) => { setLogTask(task); setView('taskLog'); }} />
        </div>
      ) : (
        <Home onOpenSettings={() => setView('settings')} />
      )}
    </div>
  );
};


export default App;
