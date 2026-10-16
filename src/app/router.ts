// Hash routing so deep links work on static hosting (GitHub Pages).
import { useSyncExternalStore } from 'react';

function current(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function parseRoute(hash: string): Route {
  const [path, q = ''] = hash.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const h = useSyncExternalStore(subscribe, current, () => '/');
  return parseRoute(h);
}

export function navigate(to: string, replace = false): void {
  const url = `#${to}`;
  if (replace) window.location.replace(url);
  else window.location.hash = to;
}
