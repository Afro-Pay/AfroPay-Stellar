import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import Header from '../components/Header';

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
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        <Header />
        {/* Ensure page content doesn't hide behind the sticky header */}
        <div className="pt-2">
          <AnyComponent {...pageProps} />
        </div>
      </div>
    </QueryClientProvider>
  );
}
