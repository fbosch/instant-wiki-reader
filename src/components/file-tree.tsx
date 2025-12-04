'use client';

import React from 'react';
import { useTreeData } from 'react-stately';
import { useFocusRing } from '@react-aria/focus';
import { mergeProps } from '@react-aria/utils';
import { useSnapshot } from 'valtio';
import { useFileSystem } from '@/contexts/FileSystemContext';
import { uiStore, toggleExpandDir, setCurrentWiki } from '@/store/ui-store';
import { File, Folder, FolderOpen, ChevronRight } from 'lucide-react';
import { formatFileName } from '@/lib/utils';
import type { DirectoryNode } from '@/types';

interface FileTreeItemProps {
  item: DirectoryNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tree: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any;
  level?: number;
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
  searchQuery?: string;
}

/**
 * Splits text into segments that match or don't match the query words.
 * Returns an array of {text: string, isMatch: boolean} objects.
 * Supports space-separated words - highlights each word individually.
 */
function getHighlightSegments(text: string, query: string): Array<{ text: string; isMatch: boolean }> {
  if (!query.trim()) {
    return [{ text, isMatch: false }];
  }
  
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const lowerText = text.toLowerCase();
  
  // Find all match positions for all words
  const matches: Array<{ start: number; end: number }> = [];
  
  words.forEach(word => {
    let index = lowerText.indexOf(word);
    while (index !== -1) {
      matches.push({ start: index, end: index + word.length });
      index = lowerText.indexOf(word, index + 1);
    }
  });
  
  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);
  
  // Merge overlapping matches
  const merged: Array<{ start: number; end: number }> = [];
  matches.forEach(match => {
    if (merged.length === 0) {
      merged.push(match);
    } else {
      const last = merged[merged.length - 1];
      if (match.start <= last.end) {
        // Overlapping - extend the last match
        last.end = Math.max(last.end, match.end);
      } else {
        merged.push(match);
      }
    }
  });
  
  // Build segments
  const segments: Array<{ text: string; isMatch: boolean }> = [];
  let lastIndex = 0;
  
  merged.forEach(match => {
    // Add non-matching text before this match
    if (match.start > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, match.start),
        isMatch: false,
      });
    }
    
    // Add the matching text
    segments.push({
      text: text.substring(match.start, match.end),
      isMatch: true,
    });
    
    lastIndex = match.end;
  });
  
  // Add any remaining non-matching text
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      isMatch: false,
    });
  }
  
  return segments;
}

/**
 * Component that renders text with highlighted matches
 * Supports two highlight types:
 * - filename: Yellow highlight for filename search matches
 * - content: Blue highlight for content search matches
 */
function HighlightedText({ 
  text, 
  query, 
  highlightType = 'filename' 
}: { 
  text: string; 
  query: string; 
  highlightType?: 'filename' | 'content';
}) {
  const segments = getHighlightSegments(text, query);
  
  const highlightClass = highlightType === 'filename'
    ? 'bg-yellow-200 dark:bg-yellow-600/40 text-slate-900 dark:text-slate-50'
    : 'bg-blue-200 dark:bg-blue-600/40 text-slate-900 dark:text-slate-50';
  
  return (
    <>
      {segments.map((segment, index) => 
        segment.isMatch ? (
          <mark 
            key={index} 
            className={`${highlightClass} px-0.5 rounded`}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

function FileTreeItem({ 
  item, 
  tree, 
  node, 
  level = 0,
  searchQuery = '',
}: {
  item: DirectoryNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tree: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any;
  level?: number;
  searchQuery?: string;
}) {
  const { openFile, currentFile } = useFileSystem();
  const { currentWiki, wikiStates } = useSnapshot(uiStore);
  const ref = React.useRef<HTMLDivElement>(null);
  const { focusProps } = useFocusRing();
  const hasScrolledToView = React.useRef(false);

  // Get expanded dirs for current wiki
  const expandedDirs = currentWiki && wikiStates.has(currentWiki) 
    ? wikiStates.get(currentWiki)!.expandedDirs 
    : new Set<string>();

  const isSelected = tree.selectedKeys?.has(node.key) ?? false;
  // When searching, auto-expand if item.isExpanded is true, but manual toggles override
  const isExpanded = expandedDirs.has(node.key) || (searchQuery && item.isExpanded === true);
  const hasChildren = node.children && node.children.length > 0;
  const isCurrentFile = currentFile?.path === item.path;

  const handleClick = () => {
    console.log('[FileTreeItem] Clicked:', item.name, 'Type:', item.type, 'Path:', item.path, 'Node key:', node.key);
    
    if (item.type === 'file') {
      openFile(item.path).catch((error) => {
        console.error('Failed to open file:', item.path, error);
      });
      tree.setSelectedKeys(new Set([node.key]));
    } else {
      // For directories, toggle expansion and open index file if it exists
      console.log('[FileTreeItem] Toggling directory:', node.key);
      toggleExpandDir(node.key);
      if (item.indexFile) {
        openFile(item.indexFile).catch((error) => {
          console.error('Failed to open index file:', item.indexFile, error);
        });
      }
    }
  };

  // Scroll the current file into view when it becomes active
  React.useEffect(() => {
    if (isCurrentFile && ref.current && !hasScrolledToView.current) {
      // Small delay to ensure the DOM is fully rendered and directories are expanded
      const timeoutId = setTimeout(() => {
        ref.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
        hasScrolledToView.current = true;
      }, 200);
      
      return () => clearTimeout(timeoutId);
    }
    
    // Reset the flag when the file changes
    if (!isCurrentFile) {
      hasScrolledToView.current = false;
    }
  }, [isCurrentFile]);

  return (
    <li>
      <div
        {...mergeProps(focusProps)}
        ref={ref}
        className={`flex items-center gap-2 px-2 py-1 cursor-pointer rounded transition-colors relative ${
          isCurrentFile
            ? 'bg-blue-600 text-white hover:bg-blue-700' 
            : isSelected 
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/40' 
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
        }`}
        style={{ paddingLeft: 8 + level * 16 }}
        onClick={handleClick}
      >
        {isCurrentFile && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600" />
        )}
        {hasChildren && (
          <ChevronRight 
            className={`w-4 h-4 flex-shrink-0 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            } ${isCurrentFile ? 'text-white' : 'text-slate-500'}`}
          />
        )}
        {!hasChildren && <div className="w-4 flex-shrink-0" />}
        {item.type === 'file' ? (
          <File className={`w-4 h-4 flex-shrink-0 ${isCurrentFile ? 'text-white' : 'text-slate-500'}`} />
        ) : isExpanded ? (
          <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isCurrentFile ? 'text-white' : 'text-blue-500'}`} />
        ) : (
          <Folder className={`w-4 h-4 flex-shrink-0 ${isCurrentFile ? 'text-white' : 'text-blue-500'}`} />
        )}
        <span className="text-sm truncate font-medium">
          <HighlightedText 
            text={item.type === 'file' ? formatFileName(item.name, true) : formatFileName(item.name)}
            query={searchQuery}
          />
        </span>
      </div>
      {hasChildren && isExpanded && (
        <ul>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {node.children.map((childNode: any) => (
            <FileTreeItem 
              key={childNode.key} 
              item={childNode.value} 
              tree={tree} 
              node={childNode} 
              level={level + 1}
              searchQuery={searchQuery}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ tree: treeOverride, searchQuery = '' }: { tree?: DirectoryNode | null; searchQuery?: string } = {}) {
  const { directoryTree, selectedNode } = useFileSystem();
  
  // Use override tree if provided, otherwise use context tree
  const activeTree = treeOverride !== undefined ? treeOverride : directoryTree;

  const tree = useTreeData({
    initialItems: activeTree?.children ? [...activeTree.children] : [],
    getKey: (item) => item.path,
    getChildren: (item) => item.children ? [...item.children] : [],
    initialSelectedKeys: selectedNode ? [selectedNode.path] : [],
  });

  if (!activeTree?.children) {
    return (
      <div className="p-4 text-slate-500 dark:text-slate-400 text-sm">
        No directory selected. Click &quot;Select Directory&quot; to get started.
      </div>
    );
  }

  return (
    <div className="h-full">
      <ul className="p-2">
        {tree.items.map((node) => (
          <FileTreeItem 
            key={node.key} 
            item={node.value as DirectoryNode} 
            tree={tree} 
            node={node}
            searchQuery={searchQuery}
          />
        ))}
      </ul>
    </div>
  );
}