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
  handleCache: Map<string, FileSystemFileHandle>;
  
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

// Initial state
const initialState: FileSystemStore = {
  rootHandle: null,
  directoryTree: null,
  selectedNode: null,
  currentFile: null,
  fileCache: new Map(),
  handleCache: new Map(),
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
  // Use ref() to prevent Valtio from wrapping File objects in Proxies
  // This is critical because File objects have getters that don't work through Proxies
  fileSystemStore.allFiles = ref(files) as File[];
}

export function setWikiName(name: string | null) {
  fileSystemStore.wikiName = name;
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
  fileSystemStore.handleCache = new Map();
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
