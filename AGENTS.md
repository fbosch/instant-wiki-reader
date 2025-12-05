# Development Guidelines for AI Agents

This document provides best practices and coding standards for AI agents working on this Next.js + TypeScript + React project.

## TypeScript Best Practices

### Type Safety (CRITICAL)
- **NEVER use `any` type** - This is strictly forbidden. Use proper types, `unknown` with type narrowing, or explicit type assertions
- **Always use explicit types** for function parameters and return values
- **Use type inference** for local variables when the type is obvious
- **Prefer interfaces over types** for object shapes that may be extended
- **Use discriminated unions** for state machines and variants

```typescript
// ✅ Good - Proper typing
function getFilePath(file: File | { path: string; name: string }): string {
  if ('path' in file && typeof file.path === 'string') {
    return file.path;
  }
  return (file as File).webkitRelativePath || file.name;
}

// ❌ Bad - Using any
function getFilePath(file: any): any {
  return file.path || file.webkitRelativePath || file.name;
}

// ✅ Good - Using unknown with type narrowing
function parseData(data: unknown): User {
  if (!isValidUserData(data)) {
    throw new Error('Invalid user data');
  }
  return data as User;
}
```

### Strict Null Checks
- **Always handle null/undefined cases** explicitly
- **Use optional chaining** (`?.`) and nullish coalescing (`??`)
- **Avoid non-null assertion** (`!`) unless absolutely necessary

### Constants and Enums
- **Use `const` objects or string literal unions** instead of enums
- **Use UPPER_SNAKE_CASE** for constants

### Generic Types
- **Use meaningful generic names** when context helps
- **Constrain generics** appropriately

## State Management - Valtio

### Core Principles
- **Use Valtio** for all global state (not Context + useReducer)
- **Create proxy stores** in `src/store/`
- **Use `useSnapshot`** for reactive reads
- **Mutate state directly** - Valtio tracks changes
- **Keep stores focused** - one per domain

### Best Practices
- **Don't store non-serializable values** in stores
- **Use `derive` for computed values** instead of useMemo
- **Keep actions colocated** with store definitions

## React Best Practices

### Components
- **Use functional components** exclusively
- **Use TypeScript for prop types** (no PropTypes)
- **Export as named exports** for better refactoring

### Hooks
- **Follow Rules of Hooks**
- **Prefix custom hooks** with `use`
- **Avoid useEffect** where possible - [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)

#### When NOT to use useEffect
- Transforming data for rendering → use variables or `useMemo`
- Handling user events → use event handlers
- Resetting state on prop change → use `key` prop
- Passing data to parent → lift state up

#### When TO use useEffect
Use `useEffect` **only** for external system sync:
- API calls (when not using Server Components)
- Subscriptions (WebSocket, event listeners)
- Direct DOM manipulation
- Analytics tracking
- Browser APIs (localStorage, matchMedia)

**Note**: For external stores, use `useSyncExternalStore` instead of `useEffect`.

### State Management
- **Use local state** for component-specific state
- **Keep state minimal** - derive values when possible

## Next.js Specific

### App Router
- **Use Server Components by default**
- **Mark Client Components** with `'use client'`
- **Keep Client Components small**

### File Structure
```
src/
  app/           # Next.js routes
  components/    # Shared components
  lib/           # Utilities
  hooks/         # Custom hooks
  types/         # TypeScript types
  store/         # Valtio stores
```

### Data Fetching
- **Use async Server Components** when possible
- **Use `fetch` with caching** in Server Components
- **Use SWR/React Query** for client-side data

## Code Style

### Naming Conventions
- **PascalCase**: Components, types, interfaces
- **camelCase**: Functions, variables, props
- **UPPER_SNAKE_CASE**: Constants
- **kebab-case**: File names (except components)

### File Organization
1. React/third-party imports
2. Local imports
3. Types/interfaces
4. Constants
5. Component/function

### Comments
- **Use JSDoc** for public APIs
- **Write "why" comments**, not "what"
- **Keep comments current**

## Error Handling

### Try-Catch
- **Always handle errors** in async functions
- **Provide user-friendly messages**
- **Log errors** for debugging

### Error Boundaries
- **Use Error Boundaries** for component errors
- **Provide fallback UI**

## Performance

### Optimization
- **Use `React.memo`** for expensive pure components
- **Use `useMemo`** for expensive computations
- **Use `useCallback`** for callbacks to memoized children
- **Use lazy loading** for code splitting
- **Avoid inline object/array literals** in props

## Cross-Browser Compatibility

### File System APIs
- **Support all modern browsers** (Chrome, Firefox, Safari, Edge)
- **Use path utilities** from `src/lib/path-manager.ts`
- **Use `browser-fs-access` library** for cross-browser file access (don't create custom wrappers)
- **Gracefully degrade** when File System Access API unavailable

```typescript
// ✅ Good - Use existing utilities
import { getFilePath } from '@/lib/path-manager';
const path = getFilePath(file);

// ❌ Bad - Direct webkit API
const path = file.webkitRelativePath;
```

## Security & Best Practices

### Input Validation
- **Validate user input** on client and server
- **Sanitize data** before rendering

### Dependencies
- **Keep dependencies updated**
- **Use lock files**

## Git Practices

### Commits
- **Use conventional commits format**
- **Keep commits atomic**
- **Never commit sensitive data**

```bash
# ✅ Good
feat: add markdown search functionality
fix: resolve file permission error

# ❌ Bad  
update
wip
```

## Critical Code Editing Rules

### ALWAYS Complete Your Edits (CRITICAL)
- **NEVER make partial edits** - Always include the complete code block you're replacing
- **Read the full context** before editing - Don't assume what comes after
- **Verify your replacement** includes ALL necessary code, not just the part you're changing
- **Check for orphaned code** after your edits - Make sure nothing is left dangling

```typescript
// ❌ BAD - Incomplete edit that breaks code
// Only edited the first few lines, left the rest incomplete
if (condition) {
  doSomething();
  // ... rest of code is missing!

// ✅ GOOD - Complete edit with full context
if (condition) {
  doSomething();
  doSomethingElse();
  return result;
}
```

**Common mistakes to avoid:**
- Editing only the start of a function and forgetting the rest
- Not including the closing braces/brackets
- Leaving old code after adding new code (dead code)
- Not reading far enough to see what needs to be preserved

**Best practice:**
1. Read MORE lines than you think you need
2. Include the COMPLETE block you're replacing
3. Double-check your edit includes everything
4. Verify the build succeeds after your edit

## Path Handling (CRITICAL)

### NO Path Transformations for Data Management
- **NEVER strip, add, or modify path prefixes** when storing/managing paths
- **Store paths exactly as they appear** in the File objects
- **Use paths as-is** in URLs, cache keys, and lookups
- **No "with prefix" or "without prefix" variations** in storage

```typescript
// ✅ GOOD - Use path exactly as-is for data management
const path = getFilePath(file);
cache.set(path, content);           // Store with exact path
openFile(path);                      // Look up with exact path
router.push(`?file=${path}`);        // URL with exact path

// ❌ BAD - Transforming paths for storage
const displayPath = path.replace(prefix + '/', '');  // NO!
const fullPath = prefix + '/' + path;                // NO!
cache.set(displayPath, content);                     // NO!
```

**The rule:** If `getFilePath(file)` returns `"dir/file.md"`, then:
- Store in cache as: `"dir/file.md"`
- Store in URL as: `"dir/file.md"`
- Look up as: `"dir/file.md"`

### Path Transformations ARE Allowed for Content Rendering
When **rendering user content** (markdown, images), you may need to normalize paths from external sources:

```typescript
// ✅ GOOD - Normalizing search queries to match stored paths
// Markdown references: /.attachments/image.png
// Actual file path: WikiName/.attachments/image.png
function findImage(files: File[], markdownPath: string): File | undefined {
  const commonPrefix = detectCommonPrefix(files);
  const normalizedPath = commonPrefix 
    ? `${commonPrefix}/${markdownPath}` 
    : markdownPath;
  return files.find(f => getFilePath(f) === normalizedPath);
}

// ✅ GOOD - Resolving relative paths in markdown
const resolvedPath = resolveImagePath('../../img.png', currentFile.path);
```

**Why the distinction:**
- **Data management**: Paths must be consistent across storage, cache, URLs, and lookups
- **Content rendering**: External references (markdown links/images) may not match our storage format and need normalization

**Key principle:** Transform paths only when **converting external references to internal lookups**, never when managing our own data.

## URL State Management (CRITICAL)

### URL as Single Source of Truth
- **URL is the ONLY source of truth** for navigation state (file path, search terms, highlights)
- **NEVER duplicate URL state in useState/useReducer** - This causes sync issues and bugs
- **Components should OBSERVE the URL** and react to changes, not manage state separately
- **All navigation updates the URL** - Components read from URL, not from React state
- **Expanded directories are NOT in URL** - They persist in sessionStorage via Valtio for better UX

```typescript
// ✅ GOOD - URL as single source of truth
function Page() {
  const { getFileFromUrl, updateUrl } = useUrlState();
  const filePath = getFileFromUrl(); // Read from URL
  
  useEffect(() => {
    if (filePath) {
      loadFile(filePath); // React to URL changes
    }
  }, [filePath]);
  
  return <FileTree onSelect={(path) => updateUrl({ file: path })} />;
}

// ❌ BAD - Duplicating state in React
function Page() {
  const [currentFile, setCurrentFile] = useState(''); // NO! Duplicate state
  const { updateUrl } = useUrlState();
  
  const handleSelect = (path: string) => {
    setCurrentFile(path);  // Updates React state
    updateUrl({ file: path }); // Updates URL
    // Now have TWO sources of truth - will get out of sync!
  };
}
```

**Why this matters:**
- **Prevents sync bugs** - No more "URL says X but component shows Y"
- **Enables deep linking** - Users can bookmark/share any app state
- **Simplifies code** - One source of truth, no sync logic needed
- **Browser navigation works** - Back/forward buttons just work

**Architecture pattern:**
1. User action → `updateUrl({ file: 'new.md' })`
2. URL updates via router.replace()
3. `useUrlState` hook observes URL change
4. Component re-renders with new URL state
5. useEffect reacts to URL state change
6. Component loads/displays new content

### Always Store State in URL Query Parameters
- **NEVER rely on URL hash fragments** (`#...`) for application state
- **URL hashes are NOT preserved** across page refreshes or browser sessions
- **Always use query parameters** (`?key=value`) for persistent state

```typescript
// ✅ GOOD - State in query parameters (persists across refresh)
const url = '?file=doc.md&highlight=search-term';

// ❌ BAD - State in hash (lost on refresh)
const url = '?file=doc.md#:~:text=search-term';
```

**Why this matters:**
- **Hashes are ephemeral** - Browser doesn't send them to server, clears them on refresh
- **Query params are persistent** - Preserved in URL bar, shareable, bookmarkable
- **Text fragments** (`#:~:text=`) are intentionally not preserved for privacy reasons

**When to use each:**
- **Query params**: File paths, search terms, filters, highlights (persistent state)
- **Hash**: Only for in-page anchors (heading links) - never for application state
- **SessionStorage**: UI preferences like expanded directories (not shareable, but persists in session)

```typescript
// ✅ GOOD - Persistent highlight with query param
updateUrl({ file: 'doc.md', highlight: 'search term' });
// Result: ?file=doc.md&highlight=search%20term

// ❌ BAD - Lost on refresh
window.location.hash = '#:~:text=search%20term';
```

### Using nuqs for URL State
- **Use `useQueryStates`** for all URL state management
- **Define parsers** for each parameter type
- **Use `parseAsString`, `parseAsArrayOf`** for typed parsing
- **Wrap page in Suspense** - Required by Next.js for useSearchParams

```typescript
// In your custom hook
const [state, setState] = useQueryStates({
  file: parseAsString.withDefault(''),
  highlight: parseAsString.withDefault(''),
  // Note: expanded dirs are NOT in URL - they persist in sessionStorage
});

// In your page component
export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PageContent />
    </Suspense>
  );
}
```

## When in Doubt

1. **Favor explicitness over cleverness**
2. **Make it work, make it right, make it fast** (in that order)
3. **Follow existing patterns**
4. **Ask for clarification** if unclear
5. **Write code for humans first**
6. **Test across multiple browsers** for File System APIs
7. **COMPLETE YOUR EDITS** - Never leave code half-finished
8. **NO PATH TRANSFORMATIONS** - Use paths exactly as-is
9. **URL IS SINGLE SOURCE OF TRUTH** - Never duplicate URL state in React state

---

**Remember**: These are guidelines, not absolute rules. Use judgment and consider context.
