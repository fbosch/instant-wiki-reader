# Development Guidelines for AI Agents

This document provides best practices and coding standards for AI agents working on this Next.js + TypeScript + React project.

## TypeScript Best Practices

### Type Safety
- **Always use explicit types** for function parameters and return values
- **Avoid `any` type** - use `unknown` if the type is truly unknown, then narrow it
- **Use type inference** for local variables when the type is obvious
- **Prefer interfaces over types** for object shapes that may be extended
- **Use discriminated unions** for state machines and variants

```typescript
// ✅ Good
interface User {
  id: string;
  name: string;
  email: string;
}

function getUser(id: string): Promise<User> {
  // implementation
}

// ❌ Bad
function getUser(id: any): any {
  // implementation
}
```

### Strict Null Checks
- **Always handle null/undefined cases** explicitly
- **Use optional chaining** (`?.`) and nullish coalescing (`??`)
- **Don't use non-null assertion** (`!`) unless absolutely necessary

```typescript
// ✅ Good
const userName = user?.name ?? 'Anonymous';

// ❌ Bad
const userName = user!.name;
```

### Enums and Constants
- **Use `const` objects or string literal unions** instead of enums
- **Use UPPER_SNAKE_CASE** for constants

```typescript
// ✅ Good
const FileType = {
  MARKDOWN: 'markdown',
  TEXT: 'text',
  JSON: 'json',
} as const;

type FileType = typeof FileType[keyof typeof FileType];

// ❌ Bad
enum FileType {
  Markdown,
  Text,
  Json,
}
```

### Generic Types
- **Use meaningful generic names** beyond single letters when context helps
- **Constrain generics** when possible

```typescript
// ✅ Good
function mapArray<TInput, TOutput>(
  items: TInput[],
  mapper: (item: TInput) => TOutput
): TOutput[] {
  return items.map(mapper);
}

// ❌ Bad
function mapArray<T, U>(items: T[], mapper: (item: T) => U): U[] {
  return items.map(mapper);
}
```

## React Best Practices

### Component Structure
- **Use functional components** exclusively (no class components)
- **Use TypeScript for prop types** (no PropTypes)
- **Export components as named exports** for better refactoring

```typescript
// ✅ Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}

// ❌ Bad
export default function Button(props: any) {
  return <button onClick={props.onClick}>{props.label}</button>;
}
```

### Hooks
- **Follow Rules of Hooks** (only at top level, only in React functions)
- **Use custom hooks** to extract reusable logic
- **Prefix custom hooks** with `use`
- **Memoize expensive computations** with `useMemo`
- **Memoize callbacks** with `useCallback` when passing to child components

```typescript
// ✅ Good
function useFileContent(path: string) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) return;
    
    setLoading(true);
    loadFile(path)
      .then(setContent)
      .finally(() => setLoading(false));
  }, [path]);

  return { content, loading };
}
```

### State Management
- **Use local state** for component-specific state
- **Use Context** for shared state across components
- **Use reducers** for complex state logic
- **Keep state minimal** and derive values when possible

```typescript
// ✅ Good - Derived state
function FileList({ files }: { files: File[] }) {
  const markdownFiles = useMemo(
    () => files.filter(f => f.name.endsWith('.md')),
    [files]
  );
  
  return <>{/* render */}</>;
}

// ❌ Bad - Redundant state
function FileList({ files }: { files: File[] }) {
  const [markdownFiles, setMarkdownFiles] = useState<File[]>([]);
  
  useEffect(() => {
    setMarkdownFiles(files.filter(f => f.name.endsWith('.md')));
  }, [files]);
  
  return <>{/* render */}</>;
}
```

### Event Handlers
- **Use arrow functions** for inline handlers only when necessary
- **Extract handlers** to named functions for complex logic
- **Use `useCallback`** for handlers passed to child components

```typescript
// ✅ Good
function SearchBar() {
  const handleSearch = useCallback((query: string) => {
    // complex search logic
  }, []);

  return <input onChange={(e) => handleSearch(e.target.value)} />;
}
```

### Conditional Rendering
- **Use ternary** for simple conditions
- **Use `&&`** for rendering when true
- **Extract to variable** for complex conditions

```typescript
// ✅ Good
{isLoading ? <Spinner /> : <Content />}
{hasError && <ErrorMessage />}

// ✅ Good - Complex condition
const shouldShowWelcome = !isLoading && !hasError && !hasData;
{shouldShowWelcome && <Welcome />}
```

## Next.js Specific

### App Router
- **Use Server Components by default** unless you need interactivity
- **Mark Client Components** with `'use client'` directive
- **Keep Client Components small** and push them to the leaves of your tree

```typescript
// ✅ Good - Server Component (default)
export default async function Page() {
  const data = await fetchData();
  return <ClientComponent data={data} />;
}

// ✅ Good - Client Component
'use client';

export function InteractiveWidget({ data }: Props) {
  const [state, setState] = useState(data);
  return <>{/* interactive UI */}</>;
}
```

### File Structure
- **Use the `app/` directory** for routes
- **Use the `src/` directory** for shared code
- **Colocate components** with their routes when possible
- **Use barrel exports** (`index.ts`) sparingly

```
src/
  app/           # Next.js app router pages
    page.tsx
    layout.tsx
  components/    # Shared components
  lib/           # Utilities and helpers
  hooks/         # Custom hooks
  types/         # TypeScript types
  contexts/      # React contexts
```

### Data Fetching
- **Use async Server Components** for data fetching when possible
- **Use `fetch` with caching** in Server Components
- **Use client-side hooks** (SWR, React Query) for client-side data

```typescript
// ✅ Good - Server Component
export default async function Page() {
  const data = await fetch('https://api.example.com/data', {
    next: { revalidate: 60 }
  }).then(r => r.json());
  
  return <div>{data.title}</div>;
}

// ✅ Good - Client Component
'use client';

export function ClientData() {
  const { data, error } = useSWR('/api/data', fetcher);
  if (error) return <Error />;
  if (!data) return <Loading />;
  return <div>{data.title}</div>;
}
```

### Images and Assets
- **Use `next/image`** for images
- **Provide width and height** for images
- **Use `public/` folder** for static assets

```typescript
// ✅ Good
import Image from 'next/image';

<Image
  src="/logo.png"
  alt="Logo"
  width={200}
  height={100}
  priority
/>
```

### Environment Variables
- **Use `.env.local`** for local environment variables
- **Prefix client variables** with `NEXT_PUBLIC_`
- **Never commit** `.env.local` to version control

```typescript
// ✅ Good
const apiKey = process.env.NEXT_PUBLIC_API_KEY;
```

## Code Style

### Naming Conventions
- **PascalCase** for components, types, interfaces
- **camelCase** for functions, variables, props
- **UPPER_SNAKE_CASE** for constants
- **kebab-case** for file names (except components)

```typescript
// Components
export function FileExplorer() {}

// Types/Interfaces
interface UserProfile {}
type FileType = 'markdown' | 'text';

// Functions/Variables
const getUserName = () => {};
const isActive = true;

// Constants
const MAX_FILE_SIZE = 1024 * 1024;

// Files
file-explorer.tsx      # Component
use-file-content.ts    # Hook
file-utils.ts          # Utilities
```

### File Organization
- **Group imports** logically (React, third-party, local)
- **Order declarations** (types, constants, component)
- **One component per file** (except for small, related helpers)

```typescript
// ✅ Good import order
import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { useFileSystem } from '@/contexts/FileSystemContext';
import type { DirectoryNode } from '@/types';

// Types
interface Props {
  node: DirectoryNode;
}

// Constants
const MAX_DEPTH = 10;

// Component
export function TreeNode({ node }: Props) {
  // implementation
}
```

### Comments
- **Use JSDoc** for public APIs
- **Write comments for "why"**, not "what"
- **Keep comments up to date** with code changes

```typescript
/**
 * Recursively builds a directory tree from a flat list of files.
 * Uses webkitRelativePath to determine file hierarchy.
 * 
 * @param files - Array of File objects with webkitRelativePath property
 * @returns Root directory node with nested children
 */
export function buildDirectoryTree(files: File[]): DirectoryNode {
  // Implementation uses sorting for O(n log n) performance
  // instead of nested lookups which would be O(n²)
  const sortedFiles = [...files].sort((a, b) => 
    a.webkitRelativePath.localeCompare(b.webkitRelativePath)
  );
  
  // ...
}
```

## Error Handling

### Try-Catch Blocks
- **Always handle errors** in async functions
- **Provide user-friendly messages** for errors
- **Log errors** for debugging

```typescript
// ✅ Good
async function loadFile(path: string): Promise<FileContent> {
  try {
    const file = await fetchFile(path);
    return parseFile(file);
  } catch (error) {
    console.error('Failed to load file:', path, error);
    throw new Error(`Unable to load file: ${path}`);
  }
}
```

### Error Boundaries
- **Use Error Boundaries** for component errors
- **Provide fallback UI** for errors

```typescript
// ✅ Good
'use client';

export function ErrorBoundary({ 
  error, 
  reset 
}: { 
  error: Error; 
  reset: () => void; 
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

## Performance

### Optimization
- **Use `React.memo`** for expensive pure components
- **Use `useMemo`** for expensive computations
- **Use `useCallback`** for callbacks passed to memoized children
- **Use lazy loading** for code splitting
- **Avoid inline object/array literals** in props

```typescript
// ✅ Good
const MemoizedList = memo(function FileList({ files }: Props) {
  return <>{/* render */}</>;
});

function Parent() {
  const files = useMemo(() => sortFiles(rawFiles), [rawFiles]);
  const handleClick = useCallback(() => {
    // handler logic
  }, []);
  
  return <MemoizedList files={files} onClick={handleClick} />;
}

// ❌ Bad - Creates new object on every render
function Parent() {
  return <MemoizedList files={sortFiles(rawFiles)} onClick={() => {}} />;
}
```

### Code Splitting
- **Use dynamic imports** for large components
- **Use `next/dynamic`** for client components

```typescript
// ✅ Good
import dynamic from 'next/dynamic';

const MarkdownEditor = dynamic(() => import('./MarkdownEditor'), {
  loading: () => <Spinner />,
  ssr: false,
});
```

## Testing Considerations

### Write Testable Code
- **Keep functions pure** when possible
- **Extract business logic** from components
- **Use dependency injection** for external dependencies

```typescript
// ✅ Good - Testable
export function calculateFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Component uses the pure function
function FileInfo({ file }: Props) {
  const size = calculateFileSize(file.size);
  return <span>{size}</span>;
}
```

## Accessibility

### Semantic HTML
- **Use semantic HTML** elements
- **Provide ARIA labels** when needed
- **Support keyboard navigation**

```typescript
// ✅ Good
<button 
  onClick={handleClick}
  aria-label="Close dialog"
  type="button"
>
  <CloseIcon />
</button>

// ❌ Bad
<div onClick={handleClick}>
  <CloseIcon />
</div>
```

## Security

### Input Validation
- **Validate user input** on both client and server
- **Sanitize data** before rendering
- **Use prepared statements** for database queries

### Dependencies
- **Keep dependencies updated** regularly
- **Audit dependencies** for vulnerabilities
- **Use lock files** (package-lock.json, pnpm-lock.yaml)

## Git Practices

### Commits
- **Write clear commit messages** (conventional commits format)
- **Keep commits atomic** (one logical change per commit)
- **Don't commit sensitive data** or build artifacts

```bash
# ✅ Good commit messages
feat: add markdown file search functionality
fix: resolve permission error on directory re-open
refactor: extract file system utilities to separate module
docs: update API documentation for FileSystemContext

# ❌ Bad commit messages
update
fix bug
changes
wip
```

### Branches
- **Use feature branches** for new work
- **Keep branches short-lived**
- **Rebase before merging** to keep history clean

## When in Doubt

1. **Favor explicitness over cleverness**
2. **Make it work, then make it right, then make it fast**
3. **Follow existing patterns** in the codebase
4. **Ask for clarification** if requirements are unclear
5. **Write code for humans first**, computers second

---

**Remember**: These are guidelines, not absolute rules. Use judgment and consider the specific context of each situation.
