'use client';

import { useEffect } from 'react';
import { installGlobalErrorHandlers } from '@/lib/logging/client';

export function GlobalErrorHandlers() {
  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);
  return null;
}
