import type { SessionInjectedRulesCache } from './types';

export function createSessionCacheStore(): {
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
  clearSessionCache: (sessionID: string) => void;
} {
  const sessionCaches = new Map<string, SessionInjectedRulesCache>();

  function getSessionCache(sessionID: string): SessionInjectedRulesCache {
    let cache = sessionCaches.get(sessionID);
    if (!cache) {
      cache = {
        contentHashes: new Set(),
        realPaths: new Set(),
      };
      sessionCaches.set(sessionID, cache);
    }
    return cache;
  }

  function clearSessionCache(sessionID: string): void {
    sessionCaches.delete(sessionID);
  }

  return { getSessionCache, clearSessionCache };
}
