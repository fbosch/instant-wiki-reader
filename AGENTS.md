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

## When in Doubt

1. **Favor explicitness over cleverness**
2. **Make it work, make it right, make it fast** (in that order)
3. **Follow existing patterns**
4. **Ask for clarification** if unclear
5. **Write code for humans first**
6. **Test across multiple browsers** for File System APIs

---

**Remember**: These are guidelines, not absolute rules. Use judgment and consider context.
