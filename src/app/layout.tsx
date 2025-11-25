import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { FileSystemProvider } from '@/contexts/FileSystemContext';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <FileSystemProvider>
          {children}
        </FileSystemProvider>
      </body>
    </html>
  );
}
