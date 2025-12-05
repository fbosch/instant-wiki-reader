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

export interface AzureDevOpsContext {
  organization: string;
  project: string;
  wikiName: string;
  baseUrl: string;
}

export type SearchMode = 'filename' | 'fulltext';

export interface SearchResult {
  entry: SearchIndexEntry;
  score: number;
  matches: string[];
}

export interface ContentSearchResult {
  path: string;
  title: string;
  score: number;
  match: { [field: string]: string[] };
  terms: string[];
}

export interface FileSystemActions {
  selectDirectory: () => Promise<void>;
  loadNodeChildren: (node: DirectoryNode) => Promise<void>;
  openFile: (path: string) => void;
  loadFile: (path: string) => Promise<void>;
  search: (query: string, mode?: SearchMode) => Promise<SearchIndexEntry[]>;
  searchContent: (query: string) => Promise<ContentSearchResult[]>;
  refresh: () => Promise<void>;
  clearDirectory: () => void;
}
