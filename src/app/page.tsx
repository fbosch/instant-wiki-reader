'use client';

import { useFileSystem } from '@/contexts/FileSystemContext';
import { setCurrentWiki, setExpandedDirs as setExpandedDirsValtio } from '@/store/ui-store';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { TableOfContents } from '@/components/table-of-contents';
import { FileTree } from '@/components/file-tree';
import { CommandPalette } from '@/components/command-palette';
import { FileNameSearch } from '@/components/file-name-search';
import { FolderOpen, FileText } from 'lucide-react';
import { useUrlState } from '@/hooks/use-url-state';
import { getParentDirs, formatFileName, formatFilePath } from '@/lib/utils';
import { useEffect, Suspense, useState, useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { DirectoryNode } from '@/types';

/**
 * Main content component that uses URL state.
 * Separated to allow Suspense boundary wrapping.
 */
function HomeContent() {
  const ctx = useFileSystem();
  const { updateUrl, getFileFromUrl, getExpandedFromUrl } = useUrlState();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [filteredTree, setFilteredTree] = useState<DirectoryNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Set up URL update callback
  useEffect(() => {
    ctx.setUrlUpdateCallback((file, expanded) => {
      updateUrl({ file, expanded });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Set current wiki in Valtio store when directory changes
  useEffect(() => {
    if (ctx.wikiName) {
      setCurrentWiki(ctx.wikiName);
    }
  }, [ctx.wikiName]);

  // Restore state from URL on mount
  useEffect(() => {
    if (!ctx.directoryTree) return;

    const filePath = getFileFromUrl();
    const expandedDirs = getExpandedFromUrl();

    // If there's a file path in URL, auto-expand parent directories
    if (filePath) {
      const parentDirs = getParentDirs(filePath);
      const dirsToExpand = new Set([...expandedDirs, ...parentDirs]);
      
      if (dirsToExpand.size > 0) {
        setExpandedDirsValtio(dirsToExpand);
      }

      // Open the file
      if (ctx.currentFile?.path !== filePath) {
        ctx.openFile(filePath).catch((error) => {
          console.error('Failed to open file from URL:', error);
        });
      }
    } else if (expandedDirs.size > 0) {
      // Only restore expanded directories if no file path
      setExpandedDirsValtio(expandedDirs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.directoryTree]); // Only run when tree is loaded

  // Keyboard shortcut for command palette (Cmd+Shift+F / Ctrl+Shift+F)
  useHotkeys('mod+shift+f', (e) => {
    e.preventDefault();
    setIsCommandPaletteOpen(true);
  }, { enableOnFormTags: true });

  const handleFilterTree = useCallback((tree: DirectoryNode | null, query: string) => {
    setFilteredTree(tree);
    setSearchQuery(query);
  }, []);

  const handleSelectDirectory = async () => {
    try {
      await ctx.selectDirectory();
    } catch (error) {
      console.error('Failed to select directory:', error);
      // Show user-friendly error message
      if (error instanceof Error) {
        alert(`Failed to open directory: ${error.message}\n\nPlease try again.`);
      }
    }
  };

  const handleClearCaches = async () => {
    if (!confirm('Clear all caches? This will remove cached files and you\'ll need to reselect your directory.')) {
      return;
    }
    
    try {
      await ctx.clearDirectory();
      alert('Caches cleared successfully! Please reload the page.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear caches:', error);
      alert('Failed to clear caches. Check console for details.');
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
  // Check for either no directory tree (Firefox/fallback) or no root handle (native API)
  if (!ctx.directoryTree) {
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
          <div className="flex flex-col gap-3">
            <button
              onClick={handleSelectDirectory}
              className="flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg hover:shadow-xl"
            >
              <FolderOpen className="w-5 h-5" />
              Open Wiki Directory
            </button>
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={handleClearCaches}
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-red-100 hover:bg-red-200 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg transition-colors"
              >
                Clear All Caches (Dev)
              </button>
            )}
          </div>
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
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      {/* Command Palette */}
      <CommandPalette 
        isOpen={isCommandPaletteOpen} 
        onClose={() => setIsCommandPaletteOpen(false)} 
      />

      {/* Sidebar - File tree */}
      <aside className="w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate pr-2">
              {ctx.wikiName || 'Directory'}
            </h2>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={handleSelectDirectory}
                className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                Change
              </button>
              {process.env.NODE_ENV === 'development' && (
                <button
                  onClick={handleClearCaches}
                  className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Clear all caches (dev only)"
                >
                  Clear Cache
                </button>
              )}
            </div>
          </div>
          
          {/* Filename search bar */}
          <FileNameSearch tree={ctx.directoryTree as DirectoryNode | null} onFilter={handleFilterTree} />
          
          {/* Hint for content search */}
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-xs font-mono">⌘⇧F</kbd> for content search
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <FileTree 
            key={searchQuery || 'no-search'} 
            tree={(filteredTree || ctx.directoryTree) as DirectoryNode | null} 
            searchQuery={searchQuery} 
          />
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto h-full">
        {ctx.currentFile ? (
          <div className="flex gap-8 w-full mx-auto p-8 pr-4">
            {/* Main content - uses available space */}
            <div className="flex-1 min-w-0 max-w-5xl">
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-2">
                  {formatFileName(ctx.currentFile.path.split('/').pop() || '', true)}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {formatFilePath(ctx.currentFile.path)}
                </p>
              </div>
              <MarkdownRenderer content={ctx.currentFile.content} />
            </div>
            
            {/* Table of Contents - sticky sidebar */}
            <aside className="hidden xl:block w-72 flex-shrink-0">
              <div className="sticky top-8">
                <TableOfContents content={ctx.currentFile.content} />
              </div>
            </aside>
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

/**
 * Main application page for the Instant Wiki Reader.
 * Provides directory selection and markdown file viewing.
 */
export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
