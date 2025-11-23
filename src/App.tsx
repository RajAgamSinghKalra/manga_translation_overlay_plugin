/// <reference types="chrome" />
import { useState } from 'react';
import { Languages, Zap, Download, Settings } from 'lucide-react';

function App() {
  const [status, setStatus] = useState('idle'); // idle, loading, translating, done, error
  const [progress, setProgress] = useState(0);
  const [sourceLang, setSourceLang] = useState('jp');
  const [targetLang, setTargetLang] = useState('en');

  const handleTranslate = async () => {
    setStatus('loading');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'TRANSLATE_PAGE',
          source: sourceLang,
          target: targetLang
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            setStatus('error');
          } else {
            console.log(response);
            setStatus('translating');
            // Simulate progress for demo
            let p = 0;
            const interval = setInterval(() => {
              p += 10;
              setProgress(p);
              if (p >= 100) {
                clearInterval(interval);
                setStatus('done');
              }
            }, 500);
          }
        });
      }
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  return (
    <div className="w-[350px] min-h-[400px] bg-gray-900 text-white p-4 font-sans relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-[-50px] left-[-50px] w-40 h-40 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
      <div className="absolute top-[-50px] right-[-50px] w-40 h-40 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

      {/* Header */}
      <header className="flex justify-between items-center mb-6 relative z-10">
        <div className="flex items-center gap-2">
          <Languages className="w-6 h-6 text-purple-400" />
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
            MangaTL
          </h1>
        </div>
        <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <Settings className="w-5 h-5 text-gray-400" />
        </button>
      </header>

      {/* Main Card */}
      <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-4 mb-4 relative z-10 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <div className="flex-1">
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">From</label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-purple-500 transition-colors"
            >
              <option value="jp">Japanese</option>
              <option value="kr">Korean</option>
              <option value="cn">Chinese</option>
            </select>
          </div>
          <div className="px-2 pt-4">
            <Zap className="w-4 h-4 text-gray-500" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">To</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-purple-500 transition-colors"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleTranslate}
          disabled={status === 'loading' || status === 'translating'}
          className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transform transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'loading' ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
          ) : (
            <Zap className="w-5 h-5" />
          )}
          {status === 'translating' ? 'Translating...' : 'Translate Page'}
        </button>
      </div>

      {/* Status / Models */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-3 relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 flex items-center gap-2">
            <Download className="w-4 h-4 text-green-400" />
            {status === 'idle' ? 'Ready' : status === 'done' ? 'Completed' : 'Processing...'}
          </span>
          <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)] ${status === 'error' ? 'bg-red-500' : 'bg-green-500'}`}></div>
        </div>
        <div className="w-full bg-black/30 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-500 to-blue-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      <div className="mt-4 text-center">
        <p className="text-xs text-gray-500">Offline Mode • WebGPU Enabled</p>
      </div>
    </div>
  );
}

export default App;
