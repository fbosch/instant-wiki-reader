'use client';

import { useFileSystem } from '@/contexts/FileSystemContext';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { FileTree } from '@/components/file-tree';
import { FolderOpen, FileText } from 'lucide-react';
import { useUrlState } from '@/hooks/use-url-state';
import { useEffect } from 'react';

/**
 * Main application page for the Instant Wiki Reader.
 * Provides directory selection and markdown file viewing.
 */
export default function Home() {
  const ctx = useFileSystem();
  const { updateUrl, getFileFromUrl, getExpandedFromUrl } = useUrlState();

  // Set up URL update callback
  useEffect(() => {
    ctx.setUrlUpdateCallback((file, expanded) => {
      updateUrl({ file, expanded });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Restore state from URL on mount
  useEffect(() => {
    if (!ctx.directoryTree) return;

    const filePath = getFileFromUrl();
    const expandedDirs = getExpandedFromUrl();

    // Restore expanded directories
    if (expandedDirs.size > 0) {
      ctx.setExpandedDirs(expandedDirs);
    }

    // Restore opened file
    if (filePath && ctx.currentFile?.path !== filePath) {
      ctx.openFile(filePath).catch((error) => {
        console.error('Failed to open file from URL:', error);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.directoryTree]); // Only run when tree is loaded

  const handleSelectDirectory = async () => {
    try {
      await ctx.selectDirectory();
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  // Show loading spinner during initialization or scanning
  if (ctx.isInitializing || ctx.isScanning) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600 dark:text-slate-400">
            {ctx.isInitializing ? 'Initializing...' : 'Loading directory...'}
          </p>
        </div>
      </div>
    );
  }

  // No directory selected - show welcome screen
  if (!ctx.rootHandle) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md text-center">
          <FolderOpen className="w-24 h-24 text-slate-400 dark:text-slate-500" />
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50">
              Instant Wiki Reader
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              Browse and read your local markdown wiki files directly in your browser.
            </p>
          </div>
          <button
            onClick={handleSelectDirectory}
            className="flex items-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg hover:shadow-xl"
          >
            <FolderOpen className="w-5 h-5" />
            Open Wiki Directory
          </button>
          <div className="flex flex-col gap-2 text-sm text-slate-500 dark:text-slate-400">
            <p>Your files stay on your computer.</p>
            <p>No upload, no server, completely private.</p>
          </div>
        </div>
      </div>
    );
  }

  // Main application view - directory loaded
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Sidebar - File tree */}
      <aside className="w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Directory
            </h2>
            <button
              onClick={handleSelectDirectory}
              className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            >
              Change
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-hidden">
          <FileTree />
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto">
        {ctx.currentFile ? (
          <div className="max-w-4xl mx-auto p-8">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-2">
                {ctx.currentFile.path.split('/').pop()}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {ctx.currentFile.path}
              </p>
            </div>
            <MarkdownRenderer content={ctx.currentFile.content} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4 text-center">
              <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600" />
              <p className="text-lg text-slate-500 dark:text-slate-400">
                Select a file to view
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
