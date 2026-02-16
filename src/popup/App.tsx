import React, { useState, useEffect } from 'react';
import Home from '../components/Home';
import Settings from '../components/Settings';
import { ArrowLeft } from 'lucide-react';
import { getSettings } from '../utils/storage';
import { getTranslation } from '../utils/i18n';

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [lang, setLang] = useState('zh-CN');

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
      {view === 'settings' ? (
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
          <Settings />
        </div>
      ) : (
        <Home onOpenSettings={() => setView('settings')} />
      )}
    </div>
  );
};


export default App;
