'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkWikiLink from 'remark-wiki-link';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { cn, extractAzureDevOpsPath, findFileFlexible } from '@/lib/utils';
import { useFileSystem } from '@/contexts/FileSystemContext';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Resolves a relative image path to an absolute path within the wiki
 */
function resolveImagePath(imageSrc: string, currentFilePath: string): string {
  // If absolute URL, return as-is
  if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://') || imageSrc.startsWith('data:')) {
    return imageSrc;
  }

  const currentDir = currentFilePath.split('/').slice(0, -1).join('/');

  // Handle different relative path formats
  if (imageSrc.startsWith('./')) {
    return currentDir ? `${currentDir}/${imageSrc.slice(2)}` : imageSrc.slice(2);
  } else if (imageSrc.startsWith('../')) {
    const parts = currentDir.split('/');
    const srcParts = imageSrc.split('/');
    let upCount = 0;
    
    // Count how many levels to go up
    while (srcParts[upCount] === '..') {
      upCount++;
    }
    
    // Remove directories and join with remaining path
    const newParts = parts.slice(0, Math.max(0, parts.length - upCount));
    const remaining = srcParts.slice(upCount);
    return [...newParts, ...remaining].filter(Boolean).join('/');
  } else if (imageSrc.startsWith('/')) {
    // Absolute path from wiki root
    return imageSrc.slice(1);
  } else {
    // Relative to current directory
    return currentDir ? `${currentDir}/${imageSrc}` : imageSrc;
  }
}



// Cache for blob URLs to avoid recreating them
const blobCache = new Map<string, string>();

/**
 * Image component that loads images from the file system on-demand
 */
function MarkdownImage({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { currentFile, rootHandle } = useFileSystem();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const srcString = typeof src === 'string' ? src : '';

  useEffect(() => {
    if (!srcString || !currentFile || !rootHandle) {
      return;
    }

    // If external URL, no need to process
    if (srcString.startsWith('http://') || srcString.startsWith('https://') || srcString.startsWith('data:')) {
      setBlobUrl(srcString);
      return;
    }

    const resolvedPath = resolveImagePath(srcString, currentFile.path);
    
    // Check cache first
    if (blobCache.has(resolvedPath)) {
      setBlobUrl(blobCache.get(resolvedPath)!);
      return;
    }

    // Load image from file system
    let cancelled = false;

    async function loadImage() {
      if (!rootHandle) return;
      
      try {
        const pathParts = resolvedPath.split('/');
        let currentHandle: FileSystemDirectoryHandle = rootHandle;

        // Navigate through directories (decode each part for file system access)
        for (let i = 0; i < pathParts.length - 1; i++) {
          const decodedPart = decodeURIComponent(pathParts[i]);
          currentHandle = await currentHandle.getDirectoryHandle(decodedPart);
        }

        // Get the file (decode the filename)
        const fileName = pathParts[pathParts.length - 1];
        const decodedFileName = decodeURIComponent(fileName);
        const fileHandle = await currentHandle.getFileHandle(decodedFileName);
        const file = await fileHandle.getFile();

        if (!cancelled) {
          const url = URL.createObjectURL(file);
          blobCache.set(resolvedPath, url);
          setBlobUrl(url);
        }
      } catch (err) {
        console.error('Failed to load image:', srcString, 'resolved to:', resolvedPath, err);
        if (!cancelled) {
          setError(true);
        }
      }
    }

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [srcString, currentFile, rootHandle]);

  if (error) {
    return (
      <div className="my-4 p-4 border border-red-300 dark:border-red-700 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
        Failed to load image: {srcString}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="my-4 h-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse flex items-center justify-center text-slate-400">
        Loading image...
      </div>
    );
  }

  return (
    <img 
      src={blobUrl} 
      alt={alt} 
      className="max-w-full h-auto rounded-lg shadow-sm my-4"
      {...props}
    />
  );
}

/**
 * Link component that handles both external URLs and internal wiki links
 */
function MarkdownLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { currentFile, openFile, allFiles, wikiName } = useFileSystem();

  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href || !currentFile) return;

    console.log('[MarkdownLink] Clicked link:', href);
    console.log('[MarkdownLink] Current wiki name:', wikiName);

    // First, check if this is an Azure DevOps wiki link that maps to a local file
    const azureDevOpsInfo = extractAzureDevOpsPath(href);
    console.log('[MarkdownLink] Azure DevOps info:', azureDevOpsInfo);
    
    if (azureDevOpsInfo) {
      // Check if this link is to the same wiki we have open
      console.log('[MarkdownLink] Comparing wiki names:', azureDevOpsInfo.wikiName, '===', wikiName);
      
      if (azureDevOpsInfo.wikiName === wikiName) {
        console.log('[MarkdownLink] Wiki name matches! Looking for file:', azureDevOpsInfo.filePath);
        
        // Use flexible matching to handle Azure DevOps wiki naming variations
        const localFile = findFileFlexible(allFiles, azureDevOpsInfo.filePath);

        if (localFile) {
          // We have this file locally - navigate internally
          e.preventDefault();
          const localFilePath = localFile.webkitRelativePath || localFile.name;
          console.log('[MarkdownLink] Matched file:', localFilePath);
          console.log('[MarkdownLink] Navigating to local file');
          openFile(localFilePath).catch((error) => {
            console.error('Failed to navigate to Azure DevOps linked file:', localFilePath, error);
          });
          return;
        } else {
          console.log('[MarkdownLink] File not found locally after trying all matching strategies');
          console.log('[MarkdownLink] Searched for variations of:', azureDevOpsInfo.filePath);
          console.log('[MarkdownLink] Will open external link');
        }
      } else {
        console.log('[MarkdownLink] Wiki name mismatch, will open external link');
      }
      // If different wiki or file not found locally, let it open as external link (fall through)
    }

    // External links - open normally
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      return; // Let the browser handle it
    }

    // Internal links - intercept and navigate within the app
    e.preventDefault();

    // Remove hash/anchor from link
    const [pathPart, hash] = href.split('#');
    if (!pathPart) {
      // Just an anchor link, scroll to it
      if (hash) {
        const element = document.getElementById(hash);
        element?.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    // Resolve the path
    let resolvedPath = resolveImagePath(pathPart, currentFile.path);
    
    // If doesn't end with .md, try adding it
    if (!resolvedPath.endsWith('.md')) {
      resolvedPath = `${resolvedPath}.md`;
    }

    // Try to open the file
    openFile(resolvedPath).catch((error) => {
      console.error('Failed to navigate to:', resolvedPath, error);
    });
  }, [href, currentFile, openFile, allFiles, wikiName]);

  const isExternal = href?.startsWith('http://') || href?.startsWith('https://');

  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Preprocesses markdown content to fix common formatting issues.
 * Fixes headers without spaces (e.g., ##Header -> ## Header)
 * 
 * @param content - Raw markdown content
 * @returns Preprocessed markdown content
 */
function preprocessMarkdown(content: string): string {
  // Fix headers without space after # symbols
  // Matches: ##Header or ###Header etc. (but not URLs like http://)
  // Replaces with: ## Header or ### Header
  return content.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
}

/**
 * Renders markdown content with proper styling.
 * Uses react-markdown for parsing and rendering.
 * 
 * @param content - Markdown content to render
 * @param className - Optional additional CSS classes
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className 
}: MarkdownRendererProps) {
  // Preprocess content to fix common markdown issues
  const processedContent = preprocessMarkdown(content);
  
  return (
    <div className={cn('prose prose-slate dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [remarkWikiLink, {
            // Configure wiki links to preserve spaces (don't convert to dashes)
            pageResolver: (name: string) => [name],
            hrefTemplate: (permalink: string) => permalink,
          }],
        ]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          // Custom heading rendering with anchor links
          h1: ({ children, ...props }) => (
            <h1 className="text-4xl font-bold mt-8 mb-4" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-3xl font-semibold mt-6 mb-3" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-2xl font-semibold mt-4 mb-2" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-xl font-semibold mt-3 mb-2" {...props}>
              {children}
            </h4>
          ),
          // Code blocks - inline code only (rehype-highlight handles block code)
          pre: ({ children, ...props }) => (
            <pre className="!bg-[#0d1117] !p-4 rounded-lg overflow-x-auto my-4" {...props}>
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            // Only style inline code - block code is handled by rehype-highlight
            const isInline = !className?.includes('language-');
            
            if (isInline) {
              return (
                <code
                  className="bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            
            // Let rehype-highlight handle block code styling
            return <code className={className} {...props}>{children}</code>;
          },
          // Links - use custom component for internal navigation
          a: MarkdownLink,
          // Blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-4"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Lists
          ul: ({ children, ...props }) => (
            <ul className="list-disc list-inside my-4 space-y-2" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal list-inside my-4 space-y-2" {...props}>
              {children}
            </ol>
          ),
          // Tables
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border border-gray-300 dark:border-gray-600" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-left font-semibold"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2" {...props}>
              {children}
            </td>
          ),
          // Images - load from file system on-demand
          img: MarkdownImage,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});