'use client';

import React, { useEffect } from 'react';
import { useTreeData } from 'react-stately';
import { useFocusRing } from '@react-aria/focus';
import { mergeProps } from '@react-aria/utils';
import { useFileSystem } from '@/contexts/FileSystemContext';
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
}

function FileTreeItem({ 
  item, 
  tree, 
  node, 
  level = 0,
  expandedKeys,
  onToggleExpand
}: FileTreeItemProps) {
  const { openFile, currentFile } = useFileSystem();
  const ref = React.useRef<HTMLDivElement>(null);
  const { focusProps } = useFocusRing();

  const isSelected = tree.selectedKeys?.has(node.key) ?? false;
  const isExpanded = expandedKeys.has(node.key);
  const hasChildren = node.children && node.children.length > 0;
  const isCurrentFile = currentFile?.path === item.path;

  const handleClick = () => {
    if (item.type === 'file') {
      openFile(item.path).catch((error) => {
        console.error('Failed to open file:', item.path, error);
      });
      tree.setSelectedKeys(new Set([node.key]));
    } else {
      // For directories, expand and open index file if it exists
      onToggleExpand(node.key);
      if (item.indexFile) {
        openFile(item.indexFile).catch((error) => {
          console.error('Failed to open index file:', item.indexFile, error);
        });
      }
    }
  };

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
          {item.type === 'file' ? formatFileName(item.name, true) : formatFileName(item.name)}
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
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree() {
  const { directoryTree, selectedNode, expandedDirs, setExpandedDirs } = useFileSystem();

  const tree = useTreeData({
    initialItems: directoryTree?.children || [],
    getKey: (item) => item.path,
    getChildren: (item) => item.children || [],
    initialSelectedKeys: selectedNode ? [selectedNode.path] : [],
  });

  useEffect(() => {
    if (selectedNode) {
      tree.setSelectedKeys(new Set([selectedNode.path]));
    }
  }, [selectedNode, tree]);

  const handleToggleExpand = (key: string) => {
    const next = new Set(expandedDirs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedDirs(next);
  };

  if (!directoryTree?.children) {
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
            item={node.value} 
            tree={tree} 
            node={node}
            expandedKeys={expandedDirs}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </ul>
    </div>
  );
}