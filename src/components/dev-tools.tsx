'use client';

import { useState } from 'react';
import { useFileSystem } from '@/contexts/FileSystemContext';
import { Trash2, Bug, X } from 'lucide-react';

/**
 * Floating developer tools panel
 * Only visible in development mode
 */
export function DevTools() {
  const [isOpen, setIsOpen] = useState(false);
  const { clearDirectory, isCaching } = useFileSystem();

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const handleClearCaches = async () => {
    if (!confirm('Clear all caches? This will remove cached files and you\'ll need to reselect your directory.')) {
      return;
    }
    
    try {
      clearDirectory();
      alert('Caches cleared successfully! Please reload the page.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear caches:', error);
      alert('Failed to clear caches. Check console for details.');
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-all hover:scale-110"
        title="Developer Tools"
      >
        <Bug className="w-5 h-5" />
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 z-50 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                Dev Tools
              </h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
            >
              <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Cache status */}
            <div className="text-sm">
              <div className="text-slate-600 dark:text-slate-400 mb-1">
                Cache Status:
              </div>
              <div className={`font-medium ${isCaching ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                {isCaching ? 'Caching in progress...' : 'Idle'}
              </div>
            </div>

            {/* Clear caches button */}
            <button
              onClick={handleClearCaches}
              disabled={isCaching}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Caches
            </button>

            <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
              This will clear IndexedDB and reload the page
            </div>
          </div>
        </div>
      )}
    </>
  );
}
