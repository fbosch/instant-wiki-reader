import type { Metadata } from 'next';
import { Inter, Lora, JetBrains_Mono } from 'next/font/google';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { FileSystemProvider } from '@/contexts/FileSystemContext';
import { Suspense } from 'react';
import './globals.css';

// Inter - Modern, highly readable sans-serif
// Designed specifically for UI and long-form content on screens
// Excellent letter spacing and distinguishable characters
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// Lora - Elegant serif for content
// Well-balanced contemporary serif with roots in calligraphy
// Excellent for long-form reading, slightly condensed, very clear
const lora = Lora({
  variable: '--font-lora',
  subsets: ['latin'],
  display: 'swap',
});

// JetBrains Mono - Excellent monospace for code
// Designed for developers with increased height for better readability
// Clear distinction between similar characters (0/O, 1/I/l)
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Instant Wiki Reader',
  description: 'A client-side markdown wiki reader using File System Access API',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${lora.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <NuqsAdapter>
          <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <FileSystemProvider>
              {children}
            </FileSystemProvider>
          </Suspense>
        </NuqsAdapter>
      </body>
    </html>
  );
}
