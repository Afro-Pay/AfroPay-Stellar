import { useEffect } from 'react';
import { useRouter } from 'next/router';

export function withAuth<P extends Record<string, any>>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  const ProtectedComponent = (props: P) => {
    const router = useRouter();

    useEffect(() => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) {
        router.push('/login');
      }

      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'token' && !e.newValue) {
          router.push('/login');
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
      }
    }, [router]);

    return <Component {...props} />;
  };

  ProtectedComponent.displayName = `withAuth(${Component.displayName || Component.name})`;
  return ProtectedComponent;
}
