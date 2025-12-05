import { proxy, ref } from 'valtio';
import type {
  DirectoryNode,
  FileContent,
  SearchIndexEntry,
  AzureDevOpsContext,
} from '@/types';

/**
 * Valtio store for file system state.
 * Replaces the Context+useReducer pattern with simpler, more performant state management.
 */

export interface FileSystemStore {
  // Core state
  rootHandle: FileSystemDirectoryHandle | null;
  directoryTree: DirectoryNode | null;
  selectedNode: DirectoryNode | null;
  currentFile: FileContent | null;
  
  // Caches
  fileCache: Map<string, FileContent>;
  
  // Permission & loading states
  permissionState: 'unknown' | 'granted' | 'denied' | 'prompt';
  isScanning: boolean;
  isInitializing: boolean;
  isCaching: boolean;
  
  // Metadata
  lastRefresh: number | null;
  searchIndex: SearchIndexEntry[];
  allFiles: File[];
  wikiName: string | null;
  azureDevOpsContext: AzureDevOpsContext | null;
}

// Store file path metadata map OUTSIDE Valtio to avoid proxy issues with Maps
// Maps file paths for quick existence checks and metadata lookups
let globalFilePathMetadata = new Map<string, { path: string; name: string }>();

// WeakMap to store decoded paths for File objects
// This avoids the issue of File.webkitRelativePath containing URL-encoded characters
let globalFileToDecodedPath = new WeakMap<File, string>();

export function getFilePathMetadata(): Map<string, { path: string; name: string }> {
  return globalFilePathMetadata;
}

export function hasFilePath(path: string): boolean {
  return globalFilePathMetadata.has(path);
}

export function getDecodedPathForFile(file: File): string | undefined {
  return globalFileToDecodedPath.get(file);
}

export function setFilePathMetadataFromCache(metadata: Array<{ path: string; name: string }>) {
  console.log('[setFilePathMetadataFromCache] Building map from', metadata.length, 'entries');
  globalFilePathMetadata = new Map();
  for (const item of metadata) {
    // Decode the path to handle legacy cached data with URL-encoded paths
    let decodedPath = item.path;
    try {
      decodedPath = decodeURIComponent(item.path);
    } catch (e) {
      // If decoding fails, keep the original path
      console.warn('[setFilePathMetadataFromCache] Failed to decode path:', item.path);
    }
    globalFilePathMetadata.set(decodedPath, { path: decodedPath, name: item.name });
  }
  console.log('[setFilePathMetadataFromCache] Done -', globalFilePathMetadata.size, 'entries');
}

// Initial state
const initialState: FileSystemStore = {
  rootHandle: null,
  directoryTree: null,
  selectedNode: null,
  currentFile: null,
  fileCache: new Map(),
  permissionState: 'unknown',
  isScanning: false,
  isInitializing: true,
  isCaching: false,
  lastRefresh: null,
  searchIndex: [],
  allFiles: ref([]) as File[], // Use ref to prevent proxying File objects
  wikiName: null,
  azureDevOpsContext: null,
};

// Create the proxy store
export const fileSystemStore = proxy<FileSystemStore>(initialState);

// Actions - Direct mutations (Valtio tracks changes automatically)

export function setRootHandle(handle: FileSystemDirectoryHandle | null) {
  fileSystemStore.rootHandle = handle;
}

export function setDirectoryTree(tree: DirectoryNode | null) {
  fileSystemStore.directoryTree = tree;
}

export function setSelectedNode(node: DirectoryNode | null) {
  fileSystemStore.selectedNode = node;
}

export function setCurrentFile(file: FileContent | null) {
  fileSystemStore.currentFile = file;
}

export function updateFileCache(path: string, content: FileContent) {
  fileSystemStore.fileCache.set(path, content);
}

export function setPermissionState(state: FileSystemStore['permissionState']) {
  fileSystemStore.permissionState = state;
}

export function setIsScanning(isScanning: boolean) {
  fileSystemStore.isScanning = isScanning;
}

export function setIsInitializing(isInitializing: boolean) {
  fileSystemStore.isInitializing = isInitializing;
}

export function setIsCaching(isCaching: boolean) {
  fileSystemStore.isCaching = isCaching;
}

export function setLastRefresh(timestamp: number) {
  fileSystemStore.lastRefresh = timestamp;
}

export function setSearchIndex(index: SearchIndexEntry[]) {
  fileSystemStore.searchIndex = index;
}

export function setAllFiles(files: File[]) {
  try {
    console.log('[setAllFiles] START - Building file path metadata for', files.length, 'files');
    const startTime = performance.now();
    
    // Use ref() to prevent Valtio from wrapping File objects in Proxies
    // This is critical because File objects have getters that don't work through Proxies
    fileSystemStore.allFiles = ref(files) as File[];
    console.log('[setAllFiles] Set allFiles');
    
    // Build metadata map for path lookups (not storing full File objects)
    // Store it in module-level variable (not in Valtio) to avoid proxy issues with Maps
    globalFilePathMetadata = new Map();
    globalFileToDecodedPath = new WeakMap();
    console.log('[setAllFiles] Created metadata map and WeakMap');
    
    // Import getFilePath
    const { getFilePath } = require('@/lib/path-manager');
    console.log('[setAllFiles] Imported getFilePath');
    
    for (const file of files) {
      const rawPath = getFilePath(file);
      // Decode the path to handle URL-encoded characters (e.g., %2D -> -)
      // This ensures consistent path storage regardless of how File objects encode their paths
      let decodedPath = rawPath;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch (e) {
        // If decoding fails, use the raw path
        console.warn('[setAllFiles] Failed to decode path:', rawPath, e);
      }
      globalFilePathMetadata.set(decodedPath, { path: decodedPath, name: file.name });
      globalFileToDecodedPath.set(file, decodedPath);
    }
    
    console.log('[setAllFiles] Built metadata map with', globalFilePathMetadata.size, 'entries (took', (performance.now() - startTime).toFixed(2), 'ms)');
    console.log('[setAllFiles] First 5 keys:', Array.from(globalFilePathMetadata.keys()).slice(0, 5));
    console.log('[setAllFiles] DONE - globalFilePathMetadata.size:', globalFilePathMetadata.size);
  } catch (error) {
    console.error('[setAllFiles] ERROR:', error);
    throw error;
  }
}

export function setWikiName(name: string | null) {
  fileSystemStore.wikiName = name;
  
  // Also set current wiki in UI store to avoid needing a useEffect
  // This keeps a single source of truth for the wiki name
  if (name) {
    const { setCurrentWiki } = require('@/store/ui-store');
    setCurrentWiki(name);
  }
}

export function setAzureDevOpsContext(context: AzureDevOpsContext | null) {
  fileSystemStore.azureDevOpsContext = context;
}

export function clearAllFileSystem() {
  // Reset to initial state
  fileSystemStore.rootHandle = null;
  fileSystemStore.directoryTree = null;
  fileSystemStore.selectedNode = null;
  fileSystemStore.currentFile = null;
  fileSystemStore.fileCache = new Map();
  fileSystemStore.permissionState = 'unknown';
  fileSystemStore.isScanning = false;
  fileSystemStore.isInitializing = true;
  fileSystemStore.isCaching = false;
  fileSystemStore.lastRefresh = null;
  fileSystemStore.searchIndex = [];
  fileSystemStore.allFiles = ref([]) as File[]; // Use ref to prevent proxying
  fileSystemStore.wikiName = null;
  fileSystemStore.azureDevOpsContext = null;
}
