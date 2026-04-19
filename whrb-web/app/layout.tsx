import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { GlobalErrorHandlers } from '@/components/GlobalErrorHandlers';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from 'sonner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'WHRB Sales',
  description: 'WHRB 95.3 FM sales team prospect pipeline',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-[hsl(var(--background))] font-sans antialiased">
        <ThemeProvider>
          <GlobalErrorHandlers />
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
