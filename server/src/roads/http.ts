// Fetch JSON from a road-closure feed, with a timeout and a plain user agent.

const USER_AGENT = 'gsoc-monitor/1.0 (road-closures layer)';

export async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/geo+json;q=0.9, */*;q=0.5' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}
