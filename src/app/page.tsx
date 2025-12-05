'use client';

// Force dynamic rendering to prevent prerendering issues with useSearchParams
export const dynamic = 'force-dynamic';

import { useFileSystem } from '@/contexts/FileSystemContext';
import { addExpandedDirs } from '@/store/ui-store';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { TableOfContents } from '@/components/table-of-contents';
import { FileTree } from '@/components/file-tree';
import { CommandPalette } from '@/components/command-palette';
import { FileNameSearch } from '@/components/file-name-search';
import { DevTools } from '@/components/dev-tools';
import { ThemeSettings } from '@/components/theme-settings';
import { FolderOpen, FileText, Type } from 'lucide-react';
import { useUrlState } from '@/hooks/use-url-state';
import { getParentDirs, formatFileName } from '@/lib/utils';
import { useEffect, Suspense, useState, useCallback, useSyncExternalStore } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { DirectoryNode } from '@/types';
import { useSnapshot } from 'valtio';
import { themeStore, colorThemes, contentWidthValues } from '@/store/theme-store';

// Subscribe to hash changes for text fragment highlighting
function subscribeToHashChanges(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHash() {
  return window.location.hash;
}

function getServerHash() {
  return '';
}

/**
 * Main content component that uses URL state.
 * Separated to allow Suspense boundary wrapping.
 */
function HomeContent() {
  const ctx = useFileSystem();
  const { updateUrl, getFileFromUrl, getHighlightFromUrl } = useUrlState();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [filteredTree, setFilteredTree] = useState<DirectoryNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasScrolledToHash, setHasScrolledToHash] = useState(false);
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);
  
  // Subscribe to hash changes for reactive text fragment highlighting
  const currentHash = useSyncExternalStore(subscribeToHashChanges, getHash, getServerHash);
  
  // Get text fragment from URL hash for passing to MarkdownRenderer
  const textFragment = getHighlightFromUrl();
  console.log('[HomeContent] textFragment from URL:', textFragment, 'currentHash:', currentHash);
  
  // Get theme settings
  const { fontFamily, fontSize, lineHeight, colorTheme, contentWidth, centerContent } = useSnapshot(themeStore);

  // Load file from URL when URL changes
  useEffect(() => {
    // Wait for tree to be ready
    if (!ctx.directoryTree) {
      console.log('[HomeContent] Waiting for directoryTree...');
      return;
    }

    const filePath = getFileFromUrl();

    console.log('[HomeContent] URL state:', { filePath });

    // Auto-expand parent directories when loading a file from URL
    if (filePath) {
      const parentDirs = getParentDirs(filePath);
      
      if (parentDirs.length > 0) {
        // Add parent dirs to existing expanded dirs (don't replace)
        addExpandedDirs(parentDirs);
      }
    }

    // Load file content if path changed
    if (filePath && ctx.currentFile?.path !== filePath) {
      console.log('[HomeContent] Loading file from URL:', filePath);
      setIsLoadingFromUrl(true);
      
      ctx.loadFile(filePath)
        .then(() => setIsLoadingFromUrl(false))
        .catch((error) => {
          console.error('Failed to load file from URL:', error);
          setIsLoadingFromUrl(false);
        });
    }
  }, [ctx.directoryTree, ctx.loadFile, getFileFromUrl]); // React to URL changes
  // Reset scroll position when file changes (unless hash is present)
  useEffect(() => {
    if (!ctx.currentFile) return;

    // Only reset if there's no hash (hash scrolling is handled separately)
    const hash = window.location.hash;
    if (!hash) {
      // Reset scroll to top when navigating to a new file
      const mainElement = document.querySelector('main');
      if (mainElement) {
        mainElement.scrollTop = 0;
        console.log('[HomeContent] Reset scroll to top for new file:', ctx.currentFile.path);
      }
    }
  }, [ctx.currentFile?.path]); // Only trigger on path change

  // Handle hash scrolling and text fragment highlighting
  useEffect(() => {
    if (!ctx.currentFile) return;

    const hash = window.location.hash;
    if (!hash) {
      setHasScrolledToHash(false);
      return;
    }

    // Give the markdown renderer time to render the content
    const timeoutId = setTimeout(() => {
      // Check if this is a text fragment (#:~:text=...)
      const textFragmentMatch = hash.match(/#:~:text=(.+)/);
      
      if (textFragmentMatch) {
        // Handle text fragment
        try {
          const searchText = decodeURIComponent(textFragmentMatch[1].replace(/%2D/g, '-'));
          console.log('[HomeContent] Searching for text fragment:', searchText);
          
          // Find text in the document
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
          );
          
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            const index = text.toLowerCase().indexOf(searchText.toLowerCase());
            
            if (index !== -1 && node.parentElement) {
              console.log('[HomeContent] Found text fragment, scrolling and highlighting');
              
              // Scroll to the element
              node.parentElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
              });
              
              // Highlight the text temporarily
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + searchText.length);
              
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              
              // Clear selection after 2 seconds
              setTimeout(() => {
                selection?.removeAllRanges();
              }, 2000);
              
              setHasScrolledToHash(true);
              break;
            }
          }
        } catch (err) {
          console.error('[HomeContent] Error handling text fragment:', err);
        }
      } else {
        // Handle regular hash (element ID)
        const elementId = hash.slice(1); // Remove the # prefix
        const element = document.getElementById(elementId);
        
        if (element) {
          const isInitialScroll = !hasScrolledToHash;
          console.log('[HomeContent] Scrolling to hash:', hash, isInitialScroll ? '(instant)' : '(smooth)');
          
          // Use instant scroll on initial load, smooth scroll on subsequent navigations
          element.scrollIntoView({ 
            behavior: isInitialScroll ? 'auto' : 'smooth', 
            block: 'start' 
          });
          
          setHasScrolledToHash(true);
        } else {
          console.warn('[HomeContent] Hash element not found:', hash);
        }
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [ctx.currentFile, ctx.currentFile?.path, currentHash]); // Run when file or hash changes

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900 p-8">
        <div className="max-w-2xl w-full">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50 mb-3">
              Wiki Reader
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400">
              Browse and search markdown wikis locally in your browser.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-slate-50 mb-4">
              Getting Started
            </h2>
            
            <div className="space-y-4 mb-6">
              <div className="flex gap-3">
                <span className="text-slate-400 dark:text-slate-500 font-mono text-sm flex-shrink-0">1.</span>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-50 mb-1">
                    Clone your Azure DevOps wiki repository
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                    In Azure DevOps, navigate to your wiki and clone it to your local machine using Git.
                  </p>
                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    git clone https://dev.azure.com/your-org/your-project/_git/your-wiki.wiki
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="text-slate-400 dark:text-slate-500 font-mono text-sm flex-shrink-0">2.</span>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-50 mb-1">
                    Select the wiki directory
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Click the button below and choose the root folder of your cloned wiki repository.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="text-slate-400 dark:text-slate-500 font-mono text-sm flex-shrink-0">3.</span>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-50 mb-1">
                    Start reading
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Browse files, search content instantly, and navigate with ease—all locally in your browser.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleSelectDirectory}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Directory
            </button>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p>All files are processed locally. Nothing is uploaded to any server.</p>
            <p>Works with Azure DevOps wikis, GitHub wikis, or any markdown directory.</p>
          </div>
        </div>
      </div>
    );
  }

  // Apply theme styles
  const theme = colorThemes[colorTheme];
  const contentStyle = {
    fontFamily: fontFamily === 'serif' 
      ? 'var(--font-lora), Georgia, serif' 
      : 'var(--font-inter), system-ui, sans-serif',
    fontSize: `${fontSize}rem`,
    lineHeight: lineHeight,
    backgroundColor: theme.bg,
    color: theme.text,
  };

  // Main application view - directory loaded
  return (
    <div 
      className="flex h-screen bg-slate-50 dark:bg-slate-900"
      style={{
        // CSS variables for theme colors - accessible to all child components
        '--theme-bg': theme.bg,
        '--theme-text': theme.text,
        '--theme-secondary': theme.secondary,
        '--theme-border': theme.border,
        '--theme-code': theme.code,
      } as React.CSSProperties}
    >
      {/* Dev Tools (only in development) */}
      <DevTools />
      
      {/* Command Palette */}
      <CommandPalette 
        isOpen={isCommandPaletteOpen} 
        onClose={() => setIsCommandPaletteOpen(false)} 
      />

      {/* Sidebar - File tree */}
      <aside 
        className="w-80 border-r flex flex-col h-full"
        style={{ 
          backgroundColor: theme.bg, 
          borderColor: theme.border,
          color: theme.text 
        }}
      >
        <div className="p-4 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold truncate pr-2" style={{ color: theme.text }}>
              {ctx.wikiName || 'Directory'}
            </h2>
            <div className="flex items-center gap-2">
              <ThemeSettings />
              <button
                onClick={handleSelectDirectory}
                className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors flex-shrink-0"
              >
                Change
              </button>
            </div>
          </div>
          
          {/* Filename search bar */}
          <FileNameSearch tree={ctx.directoryTree as DirectoryNode | null} onFilter={handleFilterTree} />
          
          {/* Hint for content search */}
          <div className="mt-2 text-xs text-center" style={{ color: theme.secondary }}>
            Press <kbd className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ backgroundColor: theme.code, border: `1px solid ${theme.border}` }}>⌘⇧F</kbd> for content search
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
      <main className="flex-1 overflow-y-auto h-full" style={{ backgroundColor: theme.bg }}>
        {ctx.currentFile ? (
          <div 
            className="flex gap-8 w-full p-8 pr-4"
            style={{
              marginLeft: centerContent ? 'auto' : '0',
              marginRight: centerContent ? 'auto' : '0',
              maxWidth: contentWidth === 'full' ? '100%' : `calc(${contentWidthValues[contentWidth]} + 18rem + 2rem)`, // content + TOC + gap
            }}
          >
            {/* Main content - uses available space */}
            <div 
              className="flex-1 min-w-0" 
              style={{
                ...contentStyle,
                maxWidth: contentWidth === 'full' ? '100%' : contentWidthValues[contentWidth],
              }}
            >
              <div className="mb-6">
                <h1 
                  className="text-3xl font-bold mb-2" 
                  style={{ 
                    color: theme.text, 
                    fontSize: `${fontSize * 2.25}rem`,
                    fontFamily: contentStyle.fontFamily,
                  }}
                >
                  {formatFileName(ctx.currentFile.path.split('/').pop() || '', true)}
                </h1>
                <p className="text-sm" style={{ color: theme.secondary }}>
                  {ctx.currentFile.path}
                </p>
              </div>
              <MarkdownRenderer 
                content={ctx.currentFile.content} 
                textFragment={textFragment}
                themeConfig={{
                  colorTheme,
                  fontFamily,
                  fontSize,
                  lineHeight,
                }}
              />
            </div>
            
            {/* Table of Contents - sticky sidebar */}
            <aside className="hidden xl:block w-72 flex-shrink-0">
              <div className="sticky top-8" style={{ maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}>
                <TableOfContents content={ctx.currentFile.content} />
              </div>
            </aside>
          </div>
        ) : isLoadingFromUrl ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-600 dark:text-slate-400">
                Loading file...
              </p>
            </div>
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
