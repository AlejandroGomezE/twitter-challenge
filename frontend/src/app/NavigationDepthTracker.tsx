import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { NavigationDepthContext, createNavigationDepthStore } from '@/lib/navigation-history';

// Records every navigation of the router it's rendered in (see lib/navigation-history.ts) and
// provides the store to the tree. Mounted once, at the top of AppRouter, so it also sees the
// auth pages' redirects. Readers only consult it from event handlers (e.g. a Back click), by which
// time this effect has recorded the current entry.
interface NavigationDepthTrackerProps {
  children: ReactNode;
}

export function NavigationDepthTracker({ children }: NavigationDepthTrackerProps) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [store] = useState(createNavigationDepthStore);

  useEffect(() => {
    store.record(location.key, navigationType);
  }, [store, location.key, navigationType]);

  return <NavigationDepthContext.Provider value={store}>{children}</NavigationDepthContext.Provider>;
}
