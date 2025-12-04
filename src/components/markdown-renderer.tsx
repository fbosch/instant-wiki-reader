"use client";

import {
  memo,
  useState,
  useEffect,
  useCallback,
  createElement,
  useMemo,
  useRef,
  useSyncExternalStore,
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
import mermaid from "mermaid";
import type { FontFamily, ColorTheme } from "@/store/theme-store";
import { colorThemes } from "@/store/theme-store";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  themeConfig?: {
    colorTheme: ColorTheme;
    fontFamily: FontFamily;
    fontSize: number;
    lineHeight: number;
  };
}

/**
 * Subscribe to hash changes
 */
function subscribeToHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/**
 * Get current hash
 */
function getHash(): string {
  return typeof window !== 'undefined' ? window.location.hash : '';
}

/**
 * Server snapshot (no hash on server)
 */
function getServerHash(): string {
  return '';
}

/**
 * Extract text fragment from hash
 */
function extractTextFragment(hash: string): string | null {
  const match = hash.match(/#:~:text=(.+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1].replace(/%2D/g, '-'));
    } catch {
      return match[1];
    }
  }
  return null;
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
    const resolved = currentDir
      ? `${currentDir}/${imageSrc.slice(2)}`
      : imageSrc.slice(2);
    console.log('[resolveImagePath] Relative path (./):', imageSrc, '→', resolved);
    return resolved;
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
    const resolved = [...newParts, ...remaining].filter(Boolean).join("/");
    console.log('[resolveImagePath] Parent path (../):', imageSrc, '→', resolved);
    return resolved;
  } else if (imageSrc.startsWith("/")) {
    // Absolute path from wiki root - strip leading slash
    // getFileByDisplayPath will add the common prefix if needed
    const resolved = imageSrc.slice(1);
    console.log('[resolveImagePath] Absolute path (/):', imageSrc, '→', resolved);
    return resolved;
  } else {
    // Relative to current directory
    const resolved = currentDir ? `${currentDir}/${imageSrc}` : imageSrc;
    console.log('[resolveImagePath] Relative path:', imageSrc, '→', resolved);
    return resolved;
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
          console.log('[MarkdownImage] Looking for file:', resolvedPath, 'in', allFiles.length, 'files');
          file = getFileByDisplayPath(allFiles, resolvedPath);
          if (!file) {
            console.warn('[MarkdownImage] File not found by getFileByDisplayPath:', resolvedPath);
          }
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
      <div className="my-4 p-4 border rounded text-sm" style={{ 
        borderColor: '#ef4444', 
        backgroundColor: 'rgba(239, 68, 68, 0.1)', 
        color: '#ef4444' 
      }}>
        Failed to load image: {srcString}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="my-4 h-32 rounded animate-pulse flex items-center justify-center" style={{ 
        backgroundColor: 'rgba(148, 163, 184, 0.1)', 
        color: '#94a3b8' 
      }}>
        Loading image...
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className="max-w-full h-auto my-4 rounded-lg shadow-md"
      {...props}
    />
  );
}

/**
 * Mermaid diagram component that renders diagrams from code blocks
 */
function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[MermaidDiagram] Rendering chart:', chart);
    
    // Initialize mermaid with configuration
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
    });

    // Generate unique ID for this diagram
    const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

    async function renderDiagram() {
      try {
        console.log('[MermaidDiagram] Calling mermaid.render with id:', id);
        const { svg } = await mermaid.render(id, chart);
        console.log('[MermaidDiagram] Render successful, SVG length:', svg.length);
        setSvg(svg);
        setError(null);
      } catch (err) {
        console.error('[MermaidDiagram] Rendering error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    }

    renderDiagram();
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 p-4 border rounded" style={{ 
        borderColor: '#ef4444', 
        backgroundColor: 'rgba(239, 68, 68, 0.1)', 
        color: '#ef4444' 
      }}>
        <div className="font-semibold mb-2">Mermaid Error:</div>
        <pre className="text-sm overflow-x-auto">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 h-32 rounded animate-pulse flex items-center justify-center" style={{ 
        backgroundColor: 'rgba(148, 163, 184, 0.1)', 
        color: '#94a3b8' 
      }}>
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Link component that handles both external URLs and internal wiki links
 */
function MarkdownLink({
  href,
  children,
  themeColors,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { themeColors?: { text: string; secondary: string } }) {
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
      className="hover:underline cursor-pointer"
      style={{ color: '#3b82f6' }}
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

  // Convert Azure DevOps wiki Mermaid syntax (:::mermaid) to standard code fences
  // Matches: :::mermaid ... ::: or ::: mermaid ... :::
  const mermaidMatches = content.match(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi);
  if (mermaidMatches) {
    console.log('[preprocessMarkdown] Found', mermaidMatches.length, 'Mermaid blocks');
  }
  
  processed = processed.replace(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi, (match, code) => {
    const converted = '```mermaid\n' + code.trim() + '\n```';
    console.log('[preprocessMarkdown] Converting Mermaid block:', match.substring(0, 50) + '...');
    console.log('[preprocessMarkdown] Converted to:', converted.substring(0, 50) + '...');
    return converted;
  });

  // Fix headers without space after # symbols
  // Matches: ##Header or ###Header etc. (but not URLs like http://)
  // EXCLUDES: #12345 (work item references - single # followed by digits)
  // Replaces with: ## Header or ### Header
  processed = processed.replace(/^(#{1,6})([^\s#\d])/gm, "$1 $2");
  
  // Also handle the case where there are multiple # followed by non-digit
  // This catches ##Header but not #12345
  processed = processed.replace(/^(#)(\d)/gm, (match, hash, digit) => {
    // If it's a single # followed by 4+ digits at start of line, it's a work item reference
    // Don't add a space - keep it as-is so it gets converted to a link
    const restOfLine = processed.substring(processed.indexOf(match) + match.length);
    if (/^\d{3,}\b/.test(digit + restOfLine)) {
      return match; // Keep as-is (work item reference)
    }
    return `${hash} ${digit}`; // Add space (heading)
  });

  // Convert Azure DevOps work item references to links
  console.log('[preprocessMarkdown] azureDevOpsBaseUrl:', azureDevOpsBaseUrl);
  if (azureDevOpsBaseUrl) {
    console.log('[preprocessMarkdown] Converting work items with base URL:', azureDevOpsBaseUrl);
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
    // Match: # followed by 4+ digits
    // Handles both inline (#12345) and start-of-line cases
    const startOfLineMatches = processed.match(/^#(\d{4,})\b/gm);
    console.log('[preprocessMarkdown] Start-of-line work items found:', startOfLineMatches);
    
    processed = processed.replace(
      /^#(\d{4,})\b/gm,
      (match, id) => {
        // Line starts with #12345 - convert to link
        const link = `[#${id}](${azureDevOpsBaseUrl}/_workitems/edit/${id})`;
        console.log('[preprocessMarkdown] Converting', match, 'to', link);
        return link;
      },
    );
    
    // Also match work items that appear mid-line or after whitespace
    processed = processed.replace(
      /(\s)#(\d{4,})\b/g,
      (match, prefix, id) => {
        const link = `${prefix}[#${id}](${azureDevOpsBaseUrl}/_workitems/edit/${id})`;
        console.log('[preprocessMarkdown] Converting inline', match, 'to', link);
        return link;
      },
    );

    // Convert person mentions with GUIDs to links
    // Match: @ or @<GUID>
    // Example: @<32CD5341-9BDE-6624-931E-2A3B28F1F90C>
    processed = processed.replace(
      /@<([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})>/gi,
      (match, guid) => {
        // Try common Azure DevOps user profile URL patterns:
        // Option 1: Modern dev.azure.com format
        const userProfileUrl = `${azureDevOpsBaseUrl}/_usersSettings/about?userId=${guid}`;
        
        // Option 2: Classic format (uncomment to try)
        // const userProfileUrl = `${azureDevOpsBaseUrl}/_settings/users?userId=${guid}`;
        
        // Option 3: Subject descriptor format (uncomment to try)
        // const userProfileUrl = `${azureDevOpsBaseUrl}/_settings/users?subjectDescriptor=${guid}`;
        
        const link = `[@<${guid}>](${userProfileUrl})`;
        console.log('[preprocessMarkdown] Converting person mention', match, 'to', link);
        return link;
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
 * Highlight text fragment in markdown content
 * Wraps matching text with <mark> tags for visual highlighting
 * 
 * @param content - Markdown content to search
 * @param textFragment - Text to highlight (from URL hash #:~:text=...)
 * @returns Content with <mark> tags around matched text
 */
function highlightTextFragment(content: string, textFragment: string | null | undefined): string {
  if (!textFragment || !content) {
    return content;
  }

  try {
    // Escape special regex characters in the search text
    const escapedFragment = textFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create regex to match the text (case-insensitive, global)
    const regex = new RegExp(`(${escapedFragment})`, 'gi');
    
    // Protect existing code blocks and inline code from highlighting
    const codeBlocks: string[] = [];
    const inlineCode: string[] = [];
    
    let protectedContent = content;
    
    // Protect code blocks
    protectedContent = protectedContent.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    
    // Protect inline code
    protectedContent = protectedContent.replace(/`[^`]+`/g, (match) => {
      inlineCode.push(match);
      return `__INLINE_CODE_${inlineCode.length - 1}__`;
    });
    
    // Apply highlighting with <mark class="text-fragment-highlight">
    // Using a class so we can style it consistently
    const highlighted = protectedContent.replace(regex, '<mark class="text-fragment-highlight">$1</mark>');
    
    // Restore code blocks
    let restored = highlighted;
    codeBlocks.forEach((block, index) => {
      restored = restored.replace(`__CODE_BLOCK_${index}__`, block);
    });
    
    // Restore inline code
    inlineCode.forEach((code, index) => {
      restored = restored.replace(`__INLINE_CODE_${index}__`, code);
    });
    
    return restored;
  } catch (error) {
    console.error('[highlightTextFragment] Error highlighting text:', error);
    return content;
  }
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
 * @param style - Inline styles (fontSize, color, etc.)
 * @returns Heading component
 */
function createHeadingComponent(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  className: string,
  style?: React.CSSProperties,
) {
  return function Heading({
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement>) {
    const text = String(children);
    const id = generateHeadingId(text);

    const Component = `h${level}` as const;

    return createElement(Component, { id, className, style, ...props }, children);
  };
}

/**
 * Renders markdown content with proper styling.
 * Uses react-markdown for parsing and rendering.
 *
 * @param content - Markdown content to render
 * @param className - Optional additional CSS classes
 * @param themeConfig - Theme configuration (font, colors, etc.)
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  themeConfig,
}: MarkdownRendererProps) {
  const { azureDevOpsContext } = useFileSystem();
  
  // Subscribe to hash changes to get text fragment
  const currentHash = useSyncExternalStore(subscribeToHash, getHash, getServerHash);
  const textFragment = extractTextFragment(currentHash);
  
  // Extract theme colors
  const colors = themeConfig 
    ? colorThemes[themeConfig.colorTheme]
    : colorThemes.dark;

  // Guard against invalid content (but empty string is valid)
  if (typeof content !== 'string') {
    console.error('[MarkdownRenderer] Invalid content:', typeof content, content);
    return <div className="text-red-500">Error: Invalid content</div>;
  }

  // Handle empty content
  if (content === '') {
    return <div className="text-slate-500 dark:text-slate-400 italic">This file is empty</div>;
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
  let processedContent = preprocessMarkdown(content, azureDevOpsBaseUrl);
  
  // Apply text fragment highlighting if present
  if (textFragment) {
    console.log("[MarkdownRenderer] Applying text fragment highlight:", textFragment);
    processedContent = highlightTextFragment(processedContent, textFragment);
  }

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
          // Using em units so headings scale with base font size
          h1: createHeadingComponent(1, "font-bold mt-8 mb-4", { fontSize: '2.25em', color: colors.text }),
          h2: createHeadingComponent(2, "font-semibold mt-6 mb-3", { fontSize: '1.875em', color: colors.text }),
          h3: createHeadingComponent(3, "font-semibold mt-4 mb-2", { fontSize: '1.5em', color: colors.text }),
          h4: createHeadingComponent(4, "font-semibold mt-3 mb-2", { fontSize: '1.25em', color: colors.text }),
          h5: createHeadingComponent(5, "font-semibold mt-2 mb-1", { fontSize: '1.125em', color: colors.text }),
          h6: createHeadingComponent(6, "font-semibold mt-2 mb-1", { fontSize: '1em', color: colors.text }),
          // Code blocks - inline code only (rehype-highlight handles block code)
          pre: ({ children, ...props }) => (
            <pre
              className="!p-4 rounded-lg overflow-x-auto my-4"
              style={{ backgroundColor: colors.code }}
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
                  className="rounded px-1.5 py-0.5 text-sm font-mono"
                  style={{ 
                    backgroundColor: colors.code,
                    color: colors.text,
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // Check for Mermaid diagrams
            // className can be "language-mermaid" or "hljs language-mermaid" (with rehype-highlight)
            const isMermaid = className?.includes("language-mermaid");
            console.log('[CodeBlock] className:', className, 'isMermaid:', isMermaid);
            if (isMermaid) {
              const code = String(children).replace(/\n$/, '');
              console.log('[CodeBlock] Rendering Mermaid diagram, code length:', code.length);
              return <MermaidDiagram chart={code} />;
            }

            // Let rehype-highlight handle block code styling
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // Links - use custom component for internal navigation
          a: (props) => <MarkdownLink {...props} themeColors={{ text: colors.text, secondary: colors.secondary }} />,
          // Blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 pl-4 italic my-4"
              style={{ 
                borderColor: colors.border,
                color: colors.secondary,
              }}
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
                className="min-w-full border"
                style={{ borderColor: colors.border }}
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border px-4 py-2 text-left font-semibold"
              style={{ 
                borderColor: colors.border,
                backgroundColor: colors.code,
                color: colors.text,
              }}
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              className="border px-4 py-2"
              style={{ 
                borderColor: colors.border,
                color: colors.text,
              }}
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

