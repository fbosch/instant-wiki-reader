'use client';

// Force dynamic rendering to prevent prerendering issues with useSearchParams
export const dynamic = 'force-dynamic';

import { useFileSystem } from '@/contexts/FileSystemContext';
import { addExpandedDirs, toggleExpandDir, uiStore } from '@/store/ui-store';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { TableOfContents } from '@/components/table-of-contents';
import { FileTree } from '@/components/file-tree';
import { CommandPalette } from '@/components/command-palette';
import { FileNameSearch } from '@/components/file-name-search';
import { DevTools } from '@/components/dev-tools';
import { ThemeSettings } from '@/components/theme-settings';
import { FolderOpen, FileText } from 'lucide-react';
import { useUrlState } from '@/hooks/use-url-state';
import { getParentDirs, formatFileName } from '@/lib/utils';
import { useEffect, Suspense, useState, useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { DirectoryNode } from '@/types';
import { useSnapshot } from 'valtio';
import { themeStore, colorThemes, contentWidthValues } from '@/store/theme-store';

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
  const [keyboardSelectedPath, setKeyboardSelectedPath] = useState<string>('');
  const [flatFileList, setFlatFileList] = useState<string[]>([]);
  
  // Get text fragment (highlight) from URL query params
  const textFragment = getHighlightFromUrl();
  console.log('[HomeContent] textFragment from URL:', textFragment);
  
  // Get theme settings
  const { fontFamily, fontSize, lineHeight, colorTheme, contentWidth, centerContent } = useSnapshot(themeStore);
  
  // Get UI state reactively
  const uiState = useSnapshot(uiStore);

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

  // Handle scrolling to highlighted text or hash anchors
  useEffect(() => {
    if (!ctx.currentFile) return;

    // Give the markdown renderer time to render the content
    const timeoutId = setTimeout(() => {
      // Priority 1: Scroll to highlighted text fragment if present
      if (textFragment) {
        console.log('[HomeContent] Looking for highlighted text fragment:', textFragment);
        
        // Find the first <mark class="text-fragment-highlight"> element
        const firstMark = document.querySelector('mark.text-fragment-highlight');
        
        if (firstMark) {
          console.log('[HomeContent] Found first highlighted element, scrolling to it');
          firstMark.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
          setHasScrolledToHash(true);
        } else {
          console.warn('[HomeContent] Text fragment specified but no highlighted elements found');
        }
      } 
      // Priority 2: Handle regular hash (element ID) if no text fragment
      else {
        const hash = window.location.hash;
        if (hash) {
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
        } else {
          // No highlight or hash - reset scroll flag
          setHasScrolledToHash(false);
        }
      }
    }, 150); // Slightly longer delay to ensure marks are rendered

    return () => clearTimeout(timeoutId);
  }, [ctx.currentFile, ctx.currentFile?.path, textFragment, hasScrolledToHash]); // Run when file or highlight text changes

  // Keyboard shortcut for command palette (Cmd+Shift+F / Ctrl+Shift+F)
  useHotkeys('mod+shift+f', (e) => {
    e.preventDefault();
    setIsCommandPaletteOpen(true);
  }, { enableOnFormTags: true });

  // Helper function to flatten directory tree into a list of paths (files + dirs)
  // Respects expanded/collapsed state to only show visible items
  const flattenTree = useCallback((node: DirectoryNode | null, expandedDirs?: Set<string>): string[] => {
    if (!node) return [];
    
    const paths: string[] = [];
    
    const traverse = (n: DirectoryNode) => {
      // Add both files and directories to the list
      paths.push(n.path);
      
      // Only traverse children if directory is expanded
      if (n.type === 'dir' && n.children) {
        const isExpanded = expandedDirs?.has(n.path) || (searchQuery && n.isExpanded === true);
        if (isExpanded) {
          n.children.forEach(child => traverse(child));
        }
      }
    };
    
    // Start with the root's children
    if (node.children) {
      node.children.forEach(child => traverse(child));
    }
    
    return paths;
  }, [searchQuery]);

  // Update flat file list when filtered tree or directory tree changes
  useEffect(() => {
    const treeToFlatten = filteredTree || ctx.directoryTree;
    
    // Get expanded dirs from ui-store for current wiki (reactive)
    const { currentWiki, wikiStates } = uiState;
    const expandedDirs = currentWiki && wikiStates.has(currentWiki)
      ? wikiStates.get(currentWiki)!.expandedDirs
      : new Set<string>();
    
    const paths = flattenTree(treeToFlatten as DirectoryNode | null, expandedDirs);
    setFlatFileList(paths);
    
    // Reset keyboard selection when tree changes
    if (paths.length > 0 && !paths.includes(keyboardSelectedPath)) {
      setKeyboardSelectedPath(paths[0]);
    }
  }, [filteredTree, ctx.directoryTree, flattenTree, keyboardSelectedPath, uiState.currentWiki, uiState.wikiStates]);

  // Handle keyboard navigation
  const handleNavigate = useCallback((direction: 'up' | 'down') => {
    if (flatFileList.length === 0) return;
    
    const currentIndex = flatFileList.indexOf(keyboardSelectedPath);
    let nextIndex: number;
    
    if (direction === 'down') {
      nextIndex = currentIndex < flatFileList.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : flatFileList.length - 1;
    }
    
    setKeyboardSelectedPath(flatFileList[nextIndex]);
  }, [flatFileList, keyboardSelectedPath]);

  // Handle Enter key to open selected file or toggle directory
  const handleSelectCurrent = useCallback(() => {
    if (!keyboardSelectedPath) return;
    
    // Find the node to determine if it's a file or directory
    const findNode = (node: DirectoryNode | null, path: string): DirectoryNode | null => {
      if (!node) return null;
      
      const search = (n: DirectoryNode): DirectoryNode | null => {
        if (n.path === path) return n;
        
        if (n.type === 'dir' && n.children) {
          for (const child of n.children) {
            const found = search(child);
            if (found) return found;
          }
        }
        
        return null;
      };
      
      if (node.children) {
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
      }
      
      return null;
    };
    
    const treeToSearch = filteredTree || ctx.directoryTree;
    const selectedNode = findNode(treeToSearch as DirectoryNode | null, keyboardSelectedPath);
    
    if (selectedNode) {
      if (selectedNode.type === 'file') {
        ctx.openFile(keyboardSelectedPath);
      } else if (selectedNode.type === 'dir') {
        // Toggle directory expansion
        toggleExpandDir(keyboardSelectedPath);
        
        // If directory has an index file, open it
        if (selectedNode.indexFile) {
          ctx.openFile(selectedNode.indexFile);
        }
      }
    }
  }, [keyboardSelectedPath, ctx, filteredTree]);

  // Handle left/right arrows for expand/collapse
  const handleExpandCollapse = useCallback((action: 'expand' | 'collapse') => {
    if (!keyboardSelectedPath) return;
    
    // Find the node to determine if it's a directory
    const findNode = (node: DirectoryNode | null, path: string): DirectoryNode | null => {
      if (!node) return null;
      
      const search = (n: DirectoryNode): DirectoryNode | null => {
        if (n.path === path) return n;
        
        if (n.type === 'dir' && n.children) {
          for (const child of n.children) {
            const found = search(child);
            if (found) return found;
          }
        }
        
        return null;
      };
      
      if (node.children) {
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
      }
      
      return null;
    };
    
    const treeToSearch = filteredTree || ctx.directoryTree;
    const selectedNode = findNode(treeToSearch as DirectoryNode | null, keyboardSelectedPath);
    
    if (selectedNode && selectedNode.type === 'dir') {
      const { currentWiki, wikiStates } = uiStore;
      const expandedDirs = currentWiki && wikiStates.has(currentWiki)
        ? wikiStates.get(currentWiki)!.expandedDirs
        : new Set<string>();
      
      const isExpanded = expandedDirs.has(keyboardSelectedPath);
      
      if (action === 'expand' && !isExpanded) {
        toggleExpandDir(keyboardSelectedPath);
      } else if (action === 'collapse' && isExpanded) {
        toggleExpandDir(keyboardSelectedPath);
      }
    }
  }, [keyboardSelectedPath, filteredTree]);

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
          <FileNameSearch 
            tree={ctx.directoryTree as DirectoryNode | null} 
            onFilter={handleFilterTree}
            onNavigate={handleNavigate}
            onSelectCurrent={handleSelectCurrent}
            onExpandCollapse={handleExpandCollapse}
          />
          
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
            keyboardSelectedPath={keyboardSelectedPath}
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
