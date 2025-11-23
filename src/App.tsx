/// <reference types="chrome" />
import { useState, useEffect, useRef } from 'react';
import { initTranslator, isModelReady, forceDownloadModel } from './lib/ml/pipeline';

import { Languages, Zap, Download, Terminal } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

function App() {
  const [modelReady, setModelReady] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, loading, translating, done, error
  const [progress, setProgress] = useState(0);
  const [sourceLang, setSourceLang] = useState('jp');
  const [targetLang, setTargetLang] = useState('en');
  const [showConsole, setShowConsole] = useState(true); // Enabled by default
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const addLog = (level: LogEntry['level'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, level, message }]);
  };

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    // Check if model is already cached
    isModelReady()
      .then((ready) => {
        setModelReady(ready);
        addLog('info', ready ? 'Translation model is ready (cached).' : 'Translation model not found, will need download.');
      })
      .catch(() => {
        setModelReady(false);
        addLog('info', 'Error checking model status.');
      });
  }, []);



  const handleTranslate = async () => {
    // Existing translation logic unchanged
    setStatus('loading');
    setProgress(0);
    addLog('info', `Starting translation: ${sourceLang} → ${targetLang}`);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      addLog('info', `Active tab: ${tab.title}`);

      if (!tab.id) {
        addLog('error', 'No active tab ID found');
        setStatus('error');
        return;
      }

      let retryCount = 0;
      const maxRetries = 3;

      const sendMessage = async () => {
        if (retryCount >= maxRetries) {
          addLog('error', `Failed after ${maxRetries} attempts. Please refresh the page and try again.`);
          setStatus('error');
          return;
        }

        addLog('info', `Sending message to content script... (attempt ${retryCount + 1}/${maxRetries})`);
        chrome.tabs.sendMessage(tab.id!, {
          action: 'TRANSLATE_PAGE',
          source: sourceLang,
          target: targetLang
        }, async (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;

            // If content script not loaded, inject it
            if (errorMsg?.includes('Receiving end does not exist')) {
              if (retryCount === 0) {
                addLog('info', 'Content script not loaded, injecting...');
                retryCount++;

                try {
                  // Get the content script file from manifest
                  const manifest = chrome.runtime.getManifest();
                  const contentScripts = manifest.content_scripts?.[0]?.js || [];

                  if (contentScripts.length === 0) {
                    addLog('error', 'No content script found in manifest');
                    setStatus('error');
                    return;
                  }

                  await chrome.scripting.executeScript({
                    target: { tabId: tab.id! },
                    files: contentScripts
                  });

                  addLog('success', 'Content script injected successfully');
                  // Wait longer for script to initialize
                  setTimeout(() => sendMessage(), 500);
                } catch (err: unknown) {
                  addLog('error', `Injection failed: ${(err as Error).message}`);
                  addLog('error', 'This page may not allow content scripts (e.g., chrome:// pages)');
                  setStatus('error');
                }
              } else {
                // Already injected once, something else is wrong
                addLog('error', 'Content script was injected but still not responding');
                addLog('error', 'Try: 1) Refresh the page, 2) Reload extension');
                setStatus('error');
              }
            } else {
              addLog('error', `Chrome error: ${errorMsg}`);
              setStatus('error');
            }
          } else {
            addLog('success', `Content script responded: ${JSON.stringify(response)}`);
            setStatus('translating');

            let p = 0;
            const interval = setInterval(() => {
              p += 10;
              setProgress(p);
              if (p >= 100) {
                clearInterval(interval);
                setStatus('done');
                addLog('success', 'Translation completed!');
              }
            }, 500);
          }
        });
      };

      sendMessage();
    } catch (e) {
      addLog('error', `Exception: ${e instanceof Error ? e.message : String(e)}`);
      setStatus('error');
    }
  };

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'success': return 'text-green-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="w-[400px] min-h-[500px] bg-gray-900 text-white p-4 font-sans relative overflow-hidden flex flex-col">
      {/* Background Gradients */}
      <div className="absolute top-[-50px] left-[-50px] w-40 h-40 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
      <div className="absolute top-[-50px] right-[-50px] w-40 h-40 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

      {/* Header */}
      <header className="flex justify-between items-center mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <Languages className="w-6 h-6 text-purple-400" />
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
            MangaTL
          </h1>
        </div>
        <button
          onClick={() => setShowConsole(!showConsole)}
          className={`p-2 rounded-full transition-colors ${showConsole ? 'bg-purple-600/30 text-purple-400' : 'hover:bg-white/10 text-gray-400'}`}
          title="Toggle Debug Console"
        >
          <Terminal className="w-5 h-5" />
        </button>
      </header>

      {/* Main Card */}
      <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-4 mb-3 relative z-10 shadow-xl">
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
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-3 mb-3 relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 flex items-center gap-2">
            <Download className="w-4 h-4 text-green-400" />
            {modelReady ? 'Model Ready' : 'Model Not Downloaded'}
          </span>
          <button
            onClick={async () => {
              addLog('info', modelReady ? 'Re‑downloading model...' : 'Downloading model...');
              try {
                if (modelReady) {
                  await forceDownloadModel();
                } else {
                  await initTranslator();
                }
                setModelReady(true);
                addLog('success', 'Model ready for translation');
              } catch (e) {
                console.error(e);
                addLog('error', 'Model download failed');
                setModelReady(false);
              }
            }}
            className="ml-2 px-2 py-1 bg-purple-600 hover:bg-purple-500 text-xs rounded"
          >
            {modelReady ? 'Re‑download' : 'Download'}
          </button>
          <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)] ${status === 'error' ? 'bg-red-500' : 'bg-green-500'}`}></div>
        </div>
        <div className="w-full bg-black/30 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-500 to-blue-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Debug Console */}
      {showConsole && (
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl p-3 relative z-10 flex-1 flex flex-col min-h-[200px]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Debug Console</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 max-h-[200px]">
            {logs.length === 0 ? (
              <div className="text-gray-500 italic">No logs yet...</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-gray-600">[{log.timestamp}]</span>
                  <span className={getLevelColor(log.level)}>{log.message}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}

      <div className="mt-3 text-center">
        <p className="text-xs text-gray-500">Offline Mode • WebGPU Enabled</p>
      </div>
    </div>
  );
}

export default App;
