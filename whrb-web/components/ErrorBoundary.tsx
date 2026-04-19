'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import Link from 'next/link';
import { logClient } from '@/lib/logging/client';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void logClient({
      level: 'error',
      category: 'ui_exception',
      message: error.message,
      context: { stack: error.stack, componentStack: info.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl p-6 text-sm">
          <h2 className="mb-2 text-lg font-semibold">Something broke rendering this page.</h2>
          <p className="text-[hsl(var(--muted-foreground))]">
            The error has been logged. Try reloading, or head{' '}
            <Link href="/" className="underline">
              home
            </Link>
            .
          </p>
          {this.state.message ? (
            <pre className="mt-4 overflow-auto rounded border bg-[hsl(var(--muted))] p-3 text-xs">
              {this.state.message}
            </pre>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
