"use client";

import {
  memo,
  useState,
  useEffect,
  useCallback,
  createElement,
  useMemo,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { match, P } from "ts-pattern";
import { cn, extractAzureDevOpsPath } from "@/lib/utils";
import { useFileSystem } from "@/contexts/FileSystemContext";
import { getFileByDisplayPath } from "@/lib/path-manager";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Resolves a relative image path to an absolute path within the wiki
 */
function resolveImagePath(imageSrc: string, currentFilePath: string): string {
  // If absolute URL, return as-is
  if (
    imageSrc.startsWith("http://") ||
    imageSrc.startsWith("https://") ||
    imageSrc.startsWith("data:")
  ) {
    return imageSrc;
  }

  const currentDir = currentFilePath.split("/").slice(0, -1).join("/");

  // Handle different relative path formats
  if (imageSrc.startsWith("./")) {
    return currentDir
      ? `${currentDir}/${imageSrc.slice(2)}`
      : imageSrc.slice(2);
  } else if (imageSrc.startsWith("../")) {
    const parts = currentDir.split("/");
    const srcParts = imageSrc.split("/");
    let upCount = 0;

    // Count how many levels to go up
    while (srcParts[upCount] === "..") {
      upCount++;
    }

    // Remove directories and join with remaining path
    const newParts = parts.slice(0, Math.max(0, parts.length - upCount));
    const remaining = srcParts.slice(upCount);
    return [...newParts, ...remaining].filter(Boolean).join("/");
  } else if (imageSrc.startsWith("/")) {
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
function MarkdownImage({
  src,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { currentFile, rootHandle, allFiles } = useFileSystem();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const srcString = typeof src === "string" ? src : "";

  // Check if this is an external URL or needs file system loading
  const isExternalUrl = useMemo(() => {
    return (
      srcString.startsWith("http://") ||
      srcString.startsWith("https://") ||
      srcString.startsWith("data:")
    );
  }, [srcString]);

  // Compute resolved path and check cache (outside effect to avoid sync setState)
  const { resolvedPath, cachedUrl } = useMemo(() => {
    if (!srcString || !currentFile || isExternalUrl) {
      return { resolvedPath: null, cachedUrl: null };
    }
    const path = resolveImagePath(srcString, currentFile.path);
    return {
      resolvedPath: path,
      cachedUrl: blobCache.get(path) || null,
    };
  }, [srcString, currentFile, isExternalUrl]);

  useEffect(() => {
    // Handle external URLs
    if (isExternalUrl) {
      setBlobUrl(srcString);
      return;
    }

    // Handle cached URLs
    if (cachedUrl) {
      setBlobUrl(cachedUrl);
      return;
    }

    // Need to load from file system
    if (!resolvedPath) {
      return;
    }

    let cancelled = false;

    async function loadImage() {
      if (!resolvedPath) return;

      try {
        let file: File | Blob | undefined;

        // Try File System Access API first if available
        if (rootHandle) {
          try {
            // Chrome/Edge: Use File System Access API
            const pathParts = resolvedPath.split("/");
            let currentHandle: FileSystemDirectoryHandle = rootHandle;

            // Navigate through directories (decode each part for file system access)
            for (let i = 0; i < pathParts.length - 1; i++) {
              const decodedPart = decodeURIComponent(pathParts[i]);
              currentHandle =
                await currentHandle.getDirectoryHandle(decodedPart);
            }

            // Get the file (decode the filename)
            const fileName = pathParts[pathParts.length - 1];
            const decodedFileName = decodeURIComponent(fileName);
            const fileHandle =
              await currentHandle.getFileHandle(decodedFileName);
            file = await fileHandle.getFile();
          } catch (fsError) {
            // File System Access API failed, fall back to allFiles
            console.warn(
              "[MarkdownImage] File System Access failed, trying allFiles fallback:",
              fsError,
            );
            file = getFileByDisplayPath(allFiles, resolvedPath);
          }
        } else {
          // Firefox/Safari or cached mode: Try allFiles first
          file = getFileByDisplayPath(allFiles, resolvedPath);
        }

        // If still not found, try IndexedDB cache (for Firefox cached mode or when allFiles is empty)
        if (!file) {
          console.log(
            "[MarkdownImage] Not found in allFiles, trying IndexedDB cache for:",
            resolvedPath,
          );
          const { getFileFromCache } = await import("@/lib/file-system");
          const cachedFile = await getFileFromCache(resolvedPath);

          if (cachedFile) {
            console.log(
              "[MarkdownImage] Loaded from IndexedDB cache:",
              resolvedPath,
            );
            file = cachedFile;
          }
        }

        if (!file) {
          throw new Error(`Image file not found: ${resolvedPath}`);
        }

        if (!cancelled) {
          const url = URL.createObjectURL(file);
          blobCache.set(resolvedPath, url);
          setBlobUrl(url);
        }
      } catch (err) {
        console.error(
          "Failed to load image:",
          srcString,
          "resolved to:",
          resolvedPath,
          err,
        );
        if (!cancelled) {
          setError(true);
        }
      }
    }

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [srcString, isExternalUrl, cachedUrl, resolvedPath, rootHandle, allFiles]);

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
      decoding="async"
      {...props}
    />
  );
}

/**
 * Link component that handles both external URLs and internal wiki links
 */
function MarkdownLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { currentFile, openFile, allFiles, wikiName } = useFileSystem();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href || !currentFile) return;

      console.log("[MarkdownLink] Clicked link:", href);

      // Use pattern matching to handle different link types
      const azureDevOpsInfo = extractAzureDevOpsPath(href);

      match({ href, azureDevOpsInfo, wikiName })
        // Pattern 1: Azure DevOps wiki link to same wiki with local file
        .with(
          {
            azureDevOpsInfo: P.not(P.nullish),
            wikiName: P.when((name) => name === azureDevOpsInfo?.wikiName),
          },
          ({ azureDevOpsInfo: info }) => {
            console.log(
              "[MarkdownLink] Azure DevOps wiki link - searching locally",
            );
            const localFile = getFileByDisplayPath(allFiles, info!.filePath);

            return match(localFile)
              .with(P.not(P.nullish), (file) => {
                e.preventDefault();
                // Handle both File and FileWrapper
                const localFilePath =
                  "path" in file && typeof file.path === "string"
                    ? file.path
                    : (file as any).webkitRelativePath || file.name;
                console.log("[MarkdownLink] Found local file:", localFilePath);
                openFile(localFilePath).catch((error) => {
                  console.error("Failed to open local file:", error);
                });
                return true; // Handled
              })
              .otherwise(() => {
                console.log(
                  "[MarkdownLink] File not found locally, opening external link",
                );
                return false; // Not handled, will open externally
              });
          },
        )
        // Pattern 2: External URLs (http, https, mailto)
        .with(
          { href: P.string.startsWith("http://") },
          { href: P.string.startsWith("https://") },
          { href: P.string.startsWith("mailto:") },
          () => {
            console.log("[MarkdownLink] External link - opening normally");
            return false; // Let browser handle it
          },
        )
        // Pattern 3: Anchor-only link (e.g., #heading)
        .when(
          () => {
            const [pathPart, hash] = href.split("#");
            return !pathPart && hash;
          },
          () => {
            e.preventDefault();
            const hash = href.split("#")[1];
            const element = document.getElementById(hash);
            element?.scrollIntoView({ behavior: "smooth" });
            console.log("[MarkdownLink] Anchor link - scrolling to:", hash);
            return true;
          },
        )
        // Pattern 4: Internal wiki link (relative path)
        .otherwise(() => {
          e.preventDefault();
          console.log("[MarkdownLink] Internal link - resolving path");

          const [pathPart] = href.split("#");
          let resolvedPath = resolveImagePath(pathPart, currentFile.path);

          if (!resolvedPath.endsWith(".md")) {
            resolvedPath = `${resolvedPath}.md`;
          }

          openFile(resolvedPath).catch((error) => {
            console.error("Failed to navigate to:", resolvedPath, error);
          });

          return true;
        });
    },
    [href, currentFile, openFile, allFiles, wikiName],
  );

  const isExternal =
    href?.startsWith("http://") || href?.startsWith("https://");

  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Preprocess markdown content before rendering.
 * - Fixes headers without spaces (e.g., ##Header -> ## Header)
 * - Converts Azure DevOps work item references (#12345) to clickable links
 *
 * @param content - Raw markdown content
 * @param azureDevOpsBaseUrl - Base URL for Azure DevOps (e.g., "https://org.visualstudio.com/Project")
 * @returns Preprocessed markdown content
 */
function preprocessMarkdown(
  content: string,
  azureDevOpsBaseUrl?: string,
): string {
  // Guard against non-string content
  if (typeof content !== 'string') {
    console.error('[preprocessMarkdown] Content is not a string:', typeof content, content);
    return '';
  }
  
  let processed = content;

  // Fix headers without space after # symbols
  // Matches: ##Header or ###Header etc. (but not URLs like http://)
  // Replaces with: ## Header or ### Header
  processed = processed.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");

  // Convert Azure DevOps work item references to links
  if (azureDevOpsBaseUrl) {
    // Protect code blocks and inline code from replacement
    const codeBlocks: string[] = [];
    const inlineCode: string[] = [];

    // Save code blocks
    processed = processed.replace(/```[\s\S]*?```/g, (match) => {
      const index = codeBlocks.length;
      codeBlocks.push(match);
      return `__CODE_BLOCK_${index}__`;
    });

    // Save inline code
    processed = processed.replace(/`[^`]+`/g, (match) => {
      const index = inlineCode.length;
      inlineCode.push(match);
      return `__INLINE_CODE_${index}__`;
    });

    // Save existing markdown links to avoid double-linking
    const existingLinks: string[] = [];
    processed = processed.replace(/\[[^\]]+\]\([^)]+\)/g, (match) => {
      const index = existingLinks.length;
      existingLinks.push(match);
      return `__EXISTING_LINK_${index}__`;
    });

    // Now convert work item references
    // Match: # followed by 4+ digits, but not at start of line after ## (headers)
    processed = processed.replace(
      /(\s|^)#(\d{4,})\b/gm,
      (match, prefix, id) => {
        // Check if this line starts with # (header)
        const beforeMatch = processed.substring(0, processed.indexOf(match));
        const lastNewline = beforeMatch.lastIndexOf("\n");
        const lineStart = processed.substring(lastNewline + 1);

        // Skip if line starts with # (it's a header)
        if (lineStart.trim().match(/^#{1,6}\d/)) {
          return match;
        }

        return `${prefix}[#${id}](${azureDevOpsBaseUrl}/_workitems/edit/${id})`;
      },
    );

    // Restore existing links
    existingLinks.forEach((link, index) => {
      processed = processed.replace(`__EXISTING_LINK_${index}__`, link);
    });

    // Restore inline code
    inlineCode.forEach((code, index) => {
      processed = processed.replace(`__INLINE_CODE_${index}__`, code);
    });

    // Restore code blocks
    codeBlocks.forEach((block, index) => {
      processed = processed.replace(`__CODE_BLOCK_${index}__`, block);
    });
  }

  return processed;
}

/**
 * Generates an ID from heading text for anchor linking.
 * Converts to lowercase, replaces special chars and spaces with hyphens.
 *
 * @param text - Heading text
 * @returns URL-safe ID
 */
function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Creates a heading component with automatic ID generation for table of contents.
 *
 * @param level - Heading level (1-6)
 * @param className - Tailwind CSS classes for styling
 * @returns Heading component
 */
function createHeadingComponent(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  className: string,
) {
  return function Heading({
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement>) {
    const text = String(children);
    const id = generateHeadingId(text);

    const Component = `h${level}` as const;

    return createElement(Component, { id, className, ...props }, children);
  };
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
  className,
}: MarkdownRendererProps) {
  const { azureDevOpsContext } = useFileSystem();

  // Guard against invalid content
  if (!content || typeof content !== 'string') {
    console.error('[MarkdownRenderer] Invalid content:', typeof content, content);
    return <div className="text-red-500">Error: Invalid content</div>;
  }

  // Build Azure DevOps base URL for work items
  const azureDevOpsBaseUrl = azureDevOpsContext
    ? `${azureDevOpsContext.baseUrl}/${encodeURIComponent(azureDevOpsContext.project)}`
    : undefined;

  console.log("[MarkdownRenderer] Azure DevOps context:", azureDevOpsContext);
  console.log(
    "[MarkdownRenderer] Base URL for work items:",
    azureDevOpsBaseUrl,
  );

  // Preprocess content to fix common markdown issues and add Azure DevOps links
  const processedContent = preprocessMarkdown(content, azureDevOpsBaseUrl);

  console.log(
    "[MarkdownRenderer] Content sample (first 200 chars):",
    content.substring(0, 200),
  );
  console.log(
    "[MarkdownRenderer] Processed sample (first 200 chars):",
    processedContent.substring(0, 200),
  );

  return (
    <div
      className={cn(
        "prose prose-slate dark:prose-invert max-w-none",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [
            remarkWikiLink,
            {
              // Configure wiki links to preserve spaces (don't convert to dashes)
              pageResolver: (name: string) => [name],
              hrefTemplate: (permalink: string) => permalink,
            },
          ],
        ]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          // Custom heading rendering with anchor IDs for table of contents
          h1: createHeadingComponent(1, "text-4xl font-bold mt-8 mb-4"),
          h2: createHeadingComponent(2, "text-3xl font-semibold mt-6 mb-3"),
          h3: createHeadingComponent(3, "text-2xl font-semibold mt-4 mb-2"),
          h4: createHeadingComponent(4, "text-xl font-semibold mt-3 mb-2"),
          h5: createHeadingComponent(5, "text-lg font-semibold mt-2 mb-1"),
          h6: createHeadingComponent(6, "text-base font-semibold mt-2 mb-1"),
          // Code blocks - inline code only (rehype-highlight handles block code)
          pre: ({ children, ...props }) => (
            <pre
              className="!bg-[#0d1117] !p-4 rounded-lg overflow-x-auto my-4"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            // Only style inline code - block code is handled by rehype-highlight
            const isInline = !className?.includes("language-");

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
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
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
              <table
                className="min-w-full border border-gray-300 dark:border-gray-600"
                {...props}
              >
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
            <td
              className="border border-gray-300 dark:border-gray-600 px-4 py-2"
              {...props}
            >
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

