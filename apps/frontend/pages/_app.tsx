import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';
import Header from '../components/Header';
import OfflineBanner from '../components/layout/OfflineBanner';
import { startSyncEngine } from '../lib/syncEngine';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App({ Component, pageProps }: AppProps) {
  const AnyComponent = Component as any;
  const [swRegistered, setSwRegistered] = useState(false);

  useEffect(() => {
    // Register service worker for PWA support.
    if ('serviceWorker' in navigator && !swRegistered) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => setSwRegistered(true))
        .catch(() => {
          // SW registration may fail in CI / dev; ignore silently.
        });
    }
  }, [swRegistered]);

  useEffect(() => {
    // Start the sync engine (runs once on mount, listens to online/offline events).
    const stop = startSyncEngine();
    return stop;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <meta name="application-name" content="RemitX" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RemitX" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </Head>
      <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        <OfflineBanner />
        <Header />
        <div className="pt-2">
          <AnyComponent {...pageProps} />
        </div>
      </div>
    </QueryClientProvider>
  );
}