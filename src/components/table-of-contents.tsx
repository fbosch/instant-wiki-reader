'use client';

import { memo, useMemo, useEffect } from 'react';
import { extractTableOfContents, type TocEntry } from '@/lib/utils';

interface TableOfContentsProps {
  content: string;
  className?: string;
}

interface TocItemProps {
  entry: TocEntry;
  level: number;
}

/**
 * Renders a single table of contents entry with its children
 */
function TocItem({ entry, level }: TocItemProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const element = document.getElementById(entry.id);
    if (element) {
      // Update URL hash without triggering a page reload
      window.history.pushState(null, '', `#${entry.id}`);
      
      // Scroll instantly without animation
      element.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  };

  return (
    <li className="my-1">
      <a
        href={`#${entry.id}`}
        onClick={handleClick}
        className="text-blue-500 hover:underline text-sm leading-relaxed"
      >
        {entry.text}
      </a>
      {entry.children.length > 0 && (
        <ul className="ml-4 mt-1 space-y-1">
          {entry.children.map((child, index) => (
            <TocItem key={`${child.id}-${index}`} entry={child} level={level + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Table of Contents component that extracts headings from markdown
 * and displays them as a hierarchical navigation menu.
 * 
 * @param content - Markdown content to extract headings from
 * @param className - Optional CSS classes
 */
export const TableOfContents = memo(function TableOfContents({
  content,
  className = '',
}: TableOfContentsProps) {
  const toc = useMemo(() => extractTableOfContents(content), [content]);

  // Scroll to hash on mount or when content changes
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      // Remove the # from the hash
      const id = hash.substring(1);
      const element = document.getElementById(id);
      if (element) {
        // Small delay to ensure the content is rendered
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'instant', block: 'start' });
        }, 100);
      }
    }
  }, [content]); // Re-run when content changes (new file opened)

  if (toc.length === 0) {
    return null;
  }

  return (
    <nav
      className={`p-4 border rounded-lg ${className}`}
      style={{
        borderColor: 'var(--theme-border)',
        backgroundColor: 'var(--theme-code)',
      }}
      aria-label="Table of contents"
    >
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--theme-text)' }}>
        Contents
      </h2>
      <ul className="space-y-1">
        {toc.map((entry, index) => (
          <TocItem key={`${entry.id}-${index}`} entry={entry} level={1} />
        ))}
      </ul>
    </nav>
  );
});
