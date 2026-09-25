import { createContext, useContext } from 'react';
import type { NavigationType } from 'react-router';

// "Is there an in-app page behind this one?" — answered from navigations the app actually made,
// so a Back button can use `navigate(-1)` without ever leaving the app.
//
// Each history entry (by `location.key`) gets a depth: the number of in-app entries before it.
//   - PUSH adds an entry: depth = previous depth + 1.
//   - REPLACE swaps the current entry (redirects, sign-in's return, the canonical post URL):
//     depth = previous depth — it never counts as history.
//   - POP (initial load, browser Back/Forward) keeps a depth we recorded for that key; a key we
//     never saw (the first entry, or anything from before a reload) gets 0.
// Unknown always means 0, so the worst case is falling back to a fixed in-app page, never a Back
// that leaves the app.
export interface NavigationDepthStore {
  record(key: string, type: `${NavigationType}`): void;
  depth(key: string): number;
  canGoBack(key: string): boolean;
}

export function createNavigationDepthStore(): NavigationDepthStore {
  const depths = new Map<string, number>();
  let currentKey: string | null = null;

  return {
    record(key, type) {
      // Same entry again (e.g. an effect re-run): nothing new happened.
      if (key === currentKey) return;
      const previous = currentKey === null ? 0 : (depths.get(currentKey) ?? 0);
      if (type === 'PUSH') depths.set(key, previous + 1);
      else if (type === 'REPLACE') depths.set(key, previous);
      else if (!depths.has(key)) depths.set(key, 0);
      currentKey = key;
    },
    // In-app entries behind `key` (0 when unknown).
    depth(key) {
      return depths.get(key) ?? 0;
    },
    canGoBack(key) {
      return this.depth(key) > 0;
    },
  };
}

export const NavigationDepthContext = createContext<NavigationDepthStore | null>(null);

// `canGoBack(location.key)` → whether `navigate(-1)` stays inside the app. Without a tracker above
// (e.g. a page rendered on its own in a test) it answers false, the safe default.
export function useCanGoBackInApp() {
  const store = useContext(NavigationDepthContext);
  return (key: string) => store?.canGoBack(key) ?? false;
}
