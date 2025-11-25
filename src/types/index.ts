// Core data models for the Instant Wiki Reader

export type NodeType = 'file' | 'dir';

export interface DirectoryNode {
  name: string;
  path: string;
  type: NodeType;
  children?: DirectoryNode[];
  isExpanded?: boolean;
  indexFile?: string; // Path to index file if directory has one (e.g., "docs.md" for "docs/" folder)
}

export interface FileMeta {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  extension: string;
}

export interface FileContent {
  path: string;
  content: string;
  parsedMarkdown?: unknown; // Will hold parsed AST from remark
}

export interface SearchIndexEntry {
  path: string;
  title: string;
  headings: string[];
  keywords: string[];
  content?: string; // Full text for search
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface FileSystemState {
  rootHandle: FileSystemDirectoryHandle | null;
  directoryTree: DirectoryNode | null;
  selectedNode: DirectoryNode | null;
  currentFile: FileContent | null;
  fileCache: Map<string, FileContent>;
  handleCache: Map<string, FileSystemHandle>;
  permissionState: PermissionState;
  isScanning: boolean;
  isInitializing: boolean;
  lastRefresh: number | null;
  searchIndex: SearchIndexEntry[];
  expandedDirs: Set<string>;
}

export interface FileSystemActions {
  selectDirectory: () => Promise<void>;
  loadNodeChildren: (node: DirectoryNode) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  search: (query: string, mode?: 'filename' | 'fulltext') => SearchIndexEntry[];
  refresh: () => Promise<void>;
  clearDirectory: () => void;
  setExpandedDirs: (dirs: Set<string>) => void;
  setUrlUpdateCallback: (callback: (file: string | null, expanded: Set<string>) => void) => void;
}

export type SearchMode = 'filename' | 'fulltext';

export interface SearchResult {
  entry: SearchIndexEntry;
  score: number;
  matches: string[];
}
