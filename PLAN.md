# Instant Wiki Reader Implementation Plan

## Goal
- Ship a Next.js 14 + TypeScript app deployable on Vercel.
- Enable browsing and searching of a user-selected local wiki directory via the File System Access API.
- Render Markdown with smooth navigation, caching, and quick search ergonomics.

## Data Model
- `DirectoryNode`: `{ name, path, type: 'file' | 'dir', children?: DirectoryNode[] }`
  - Represents tree nodes; lazily attach `children` when expanded.
- `FileMeta`: `{ path, name, size, lastModified, extension }`
  - Captures lightweight metadata for list + refresh diffing.
- `FileContent`: `{ path, content, parsedMarkdown }`
  - Stores raw text + pre-parsed AST for renderer + cache.
- `SearchIndexEntry`: `{ path, title, headings[], keywords[] }`
  - Backing structure for mini-search/flexsearch indices.
- Client cache: `Map<path, FileContent>` shared via context to avoid re-reading handles.

## Integration Plan

### 1. Next.js Setup
- Scaffold Next 14 app router w/ TypeScript + shadcn/ui shell.
- Add config/environment toggle for `local` (FS API) vs `remote` (future server) modes.
- Establish shared UI primitives (pane layout, search bar, markdown surface).

### 2. File System Access Flow
- Use `window.showDirectoryPicker()` to select wiki root; ask to persist handle.
- Persist `FileSystemDirectoryHandle` in IndexedDB (via idb-keyval) when user consents.
- Build recursive walker utilities returning `DirectoryNode` objects with lazy `children` loading.
- Maintain `Map<path, FileSystemHandle>` to resolve subsequent file operations quickly.

### 3. State & Context
- Implement `FileSystemContext` provider exposing: directory tree, selected nodes, cache, search index state.
- Actions: `selectDirectory`, `loadNodeChildren`, `openFile(path)`, `search(query)`, `refresh()`.
- Derive UI-friendly selectors (breadcrumbs, recently opened files, status info).

### 4. Search Strategy
- On first scan, iterate Markdown files, parse with `remark` to capture headings + text snippets.
- Feed parsed data into `mini-search`/`flexsearch`, storing serialized index in memory + IndexedDB snapshot.
- Offer filters (filename-only vs full-text) and highlight matched terms in results & Markdown view.
- Surface Cmd+K command palette backed by same search source.

### 5. UI Structure
- **Left Pane**: collapsible/virtualized tree showing directories + files, with lazy expansion indicators.
- **Top Search Bar**: global search with mode toggles and keyboard shortcut hints.
- **Main Content**: Markdown renderer using `remark/rehype` pipeline + anchor TOC + breadcrumb.
- **Status Footer**: show selected directory name, permission state, refresh timestamp, offline indicator.

### 6. Persistence & Sync
- On load, check IndexedDB for stored handle; re-request permission via `queryPermission`/`requestPermission` flows.
- `Refresh` action rescans tree, comparing `FileMeta` snapshots (path + `lastModified`) for incremental diffs.
- Handle permission denials gracefully with inline messaging + CTA to reauthorize.

### 7. Deployment & HTTPS
- Configure Vercel deployment; ensure FS API usage is gated behind `window.isSecureContext` checks.
- Detect unsupported browsers and show fallback instructions with demo data link.
- Document how to run locally over HTTPS (e.g., `next dev --experimental-https`).

### 8. Testing & Tooling
- Write unit tests for walkers, metadata extraction, and search index builders using mock handles.
- Provide Storybook (or mock provider) with fixture directory data to develop UI components offline.
- Document setup: granting directory access, clearing IndexedDB to reset, and reauthorization steps.

---
Let me know if you want me to start scaffolding the Next.js components, build the file walker, or prototype the search index next.
