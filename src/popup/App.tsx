import React, { useState } from 'react';
import Home from '../components/Home';
import Settings from '../components/Settings';
import { ArrowLeft } from 'lucide-react';

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'settings'>('home');

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
            <span className="font-semibold">Back to Home</span>
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
