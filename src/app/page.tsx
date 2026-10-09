// The main concierge view is an interactive client-side app.
// We wrap it in an ErrorBoundary so any uncaught render error shows
// a recovery screen instead of a blank page.
import { ConciergeApp } from '@/components/ConciergeApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UserAuthGate } from '@/components/auth/UserAuthGate';

export default function Home() {
  return (
    <ErrorBoundary>
      <UserAuthGate>
        <ConciergeApp />
      </UserAuthGate>
    </ErrorBoundary>
  );
}

