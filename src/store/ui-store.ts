import { proxy, subscribe } from 'valtio';

interface WikiUIState {
  expandedDirs: Set<string>;
}

interface UIStore {
  currentWiki: string | null;
  // Map of wiki name -> UI state
  wikiStates: Map<string, WikiUIState>;
}

const STORAGE_KEY_PREFIX = 'instant-wiki';

// Load UI state for a specific wiki from sessionStorage
function loadWikiState(wikiName: string): WikiUIState {
  if (typeof window === 'undefined') {
    return { expandedDirs: new Set() };
  }
  
  try {
    const key = `${STORAGE_KEY_PREFIX}:${wikiName}:ui`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const data = JSON.parse(stored);
      return {
        expandedDirs: new Set(data.expandedDirs || []),
      };
    }
  } catch (error) {
    console.error(`Failed to load UI state for wiki "${wikiName}":`, error);
  }
  
  return { expandedDirs: new Set() };
}

// Save UI state for a specific wiki to sessionStorage
function saveWikiState(wikiName: string, state: WikiUIState) {
  if (typeof window === 'undefined') return;
  
  try {
    const key = `${STORAGE_KEY_PREFIX}:${wikiName}:ui`;
    const data = {
      expandedDirs: Array.from(state.expandedDirs),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`Failed to save UI state for wiki "${wikiName}":`, error);
  }
}

// Create the store
export const uiStore = proxy<UIStore>({
  currentWiki: null,
  wikiStates: new Map(),
});

// Get current wiki's expanded dirs (reactive)
export function getCurrentExpandedDirs(): Set<string> {
  const { currentWiki, wikiStates } = uiStore;
  if (!currentWiki) return new Set();
  
  if (!wikiStates.has(currentWiki)) {
    wikiStates.set(currentWiki, loadWikiState(currentWiki));
  }
  
  return wikiStates.get(currentWiki)!.expandedDirs;
}

// Actions
export function setCurrentWiki(wikiName: string | null) {
  uiStore.currentWiki = wikiName;
  
  // Load state for this wiki if not already loaded
  if (wikiName && !uiStore.wikiStates.has(wikiName)) {
    uiStore.wikiStates.set(wikiName, loadWikiState(wikiName));
  }
}

export function toggleExpandDir(path: string) {
  const { currentWiki, wikiStates } = uiStore;
  
  console.log('[toggleExpandDir] path:', path);
  console.log('[toggleExpandDir] currentWiki:', currentWiki);
  console.log('[toggleExpandDir] wikiStates.has:', wikiStates.has(currentWiki || ''));
  
  if (!currentWiki) {
    console.error('[toggleExpandDir] No current wiki set!');
    return;
  }
  
  if (!wikiStates.has(currentWiki)) {
    console.log('[toggleExpandDir] Loading wiki state for:', currentWiki);
    wikiStates.set(currentWiki, loadWikiState(currentWiki));
  }
  
  const state = wikiStates.get(currentWiki)!;
  const wasPreviouslyExpanded = state.expandedDirs.has(path);
  
  // Create a new Set to trigger Valtio reactivity (Sets are not deeply tracked)
  const newExpandedDirs = new Set(state.expandedDirs);
  
  if (wasPreviouslyExpanded) {
    newExpandedDirs.delete(path);
    console.log('[toggleExpandDir] Collapsed:', path);
  } else {
    newExpandedDirs.add(path);
    console.log('[toggleExpandDir] Expanded:', path);
  }
  
  // Replace the Set to trigger re-render
  state.expandedDirs = newExpandedDirs;
  
  console.log('[toggleExpandDir] New expandedDirs:', Array.from(state.expandedDirs));
}

export function setExpandedDirs(dirs: Set<string>) {
  const { currentWiki, wikiStates } = uiStore;
  if (!currentWiki) return;
  
  if (!wikiStates.has(currentWiki)) {
    wikiStates.set(currentWiki, loadWikiState(currentWiki));
  }
  
  wikiStates.get(currentWiki)!.expandedDirs = new Set(dirs);
}

export function addExpandedDirs(dirs: Set<string> | string[]) {
  const { currentWiki, wikiStates } = uiStore;
  if (!currentWiki) return;
  
  if (!wikiStates.has(currentWiki)) {
    wikiStates.set(currentWiki, loadWikiState(currentWiki));
  }
  
  const state = wikiStates.get(currentWiki)!;
  const dirsArray = Array.isArray(dirs) ? dirs : Array.from(dirs);
  
  // Merge with existing expanded dirs
  const newExpandedDirs = new Set([...state.expandedDirs, ...dirsArray]);
  state.expandedDirs = newExpandedDirs;
  
  console.log('[addExpandedDirs] Added dirs:', dirsArray, 'Total expanded:', Array.from(newExpandedDirs));
}

export function clearExpandedDirs() {
  const { currentWiki, wikiStates } = uiStore;
  if (!currentWiki) return;
  
  if (!wikiStates.has(currentWiki)) {
    wikiStates.set(currentWiki, loadWikiState(currentWiki));
  }
  
  // Create new empty Set to trigger Valtio reactivity
  wikiStates.get(currentWiki)!.expandedDirs = new Set();
}

// Subscribe to changes and sync to sessionStorage
if (typeof window !== 'undefined') {
  subscribe(uiStore, () => {
    const { currentWiki, wikiStates } = uiStore;
    if (currentWiki && wikiStates.has(currentWiki)) {
      saveWikiState(currentWiki, wikiStates.get(currentWiki)!);
    }
  });
}

