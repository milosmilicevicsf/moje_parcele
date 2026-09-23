import {
  RequestError,
  USER_AGENT,
  bbox,
  overpassQuery,
  packageFrom,
  parseCenter,
  upstreams,
} from "../../../lib/surroundings";

// Runs unchanged on Vercel (Node functions) and on Cloudflare Workers (via vinext):
// settings come from process.env and the Workers-only default cache is used when present.
export const maxDuration = 60;

const CACHE_SECONDS = 7 * 24 * 3600;
const TOTAL_BUDGET_MS = 50000;
// Public Overpass instances are randomly busy (the same query answers in 3 s or times out),
// so later upstreams are started while the earlier ones are still pending; the first good
// answer wins and the rest are aborted.
const HEDGE_DELAY_MS = 5000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// Overpass answers 429/504 while its slots are busy; that clears within seconds, so one retry is worth it.
const BUSY = new Set([429, 504]);
const RETRY_DELAY_MS = 3000;

async function attempt(upstream: string, delay: number, query: string, box: number[], signal: AbortSignal) {
  await sleep(delay, signal);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        // Own instance behind deploy/overpass/Caddyfile; public instances ignore the header.
        ...(process.env.OVERPASS_KEY ? { "X-Overpass-Key": process.env.OVERPASS_KEY } : {}),
      },
      body: new URLSearchParams({ data: query }),
      signal,
    });
    if (response.ok) return packageFrom(await response.json(), box);
    if (BUSY.has(response.status) && attempt === 0) { await sleep(RETRY_DELAY_MS, signal); continue; }
    throw new RequestError(
      BUSY.has(response.status)
        ? "Servis okoline je preopterećen. Sačekajte minut i pokušajte ponovo."
        : `Servis okoline nije dostupan (${response.status}).`,
      502
    );
  }
}

async function download(query: string, box: number[]) {
  const list = upstreams(process.env.OVERPASS_URL);
  const controllers = list.map(() => new AbortController());
  const deadline = setTimeout(() => {
    for (const c of controllers) c.abort(new DOMException("Upstream deadline", "TimeoutError"));
  }, TOTAL_BUDGET_MS);
  try {
    return await Promise.any(
      list.map((upstream, i) => attempt(upstream, i * HEDGE_DELAY_MS, query, box, controllers[i].signal))
    );
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [error];
    const known = errors.find((e) => e instanceof RequestError);
    if (known) throw known;
    const timedOut = errors.some((e) => e instanceof Error && e.name === "TimeoutError");
    throw new RequestError(
      timedOut ? "Servis okoline nije odgovorio na vreme. Pokušajte ponovo." : "Servis okoline trenutno nije dostupan.",
      504
    );
  } finally {
    clearTimeout(deadline);
    for (const c of controllers) c.abort();
  }
}

export async function GET(request: Request) {
  // Other websites must not use this deployment as their Overpass relay.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ error: "Servis je dostupan samo iz aplikacije." }, 403);
  }
  try {
    const url = new URL(request.url);
    const center = parseCenter(url.searchParams);
    const box = bbox(center);
    const cache = edgeCache();
    const key = new Request(
      new URL(`/api/surroundings?lat=${center[0]}&lon=${center[1]}`, url.origin)
    );
    const hit = await cache?.match(key);
    // Cached responses carry immutable headers, which the framework must still be able to touch.
    if (hit) return new Response(hit.body, hit);

    const response = json(await download(overpassQuery(center), box), 200, {
      // s-maxage lets the hosting CDN (Vercel) share one download between users.
      "Cache-Control": `public, max-age=86400, s-maxage=${CACHE_SECONDS}`,
    });
    await cache?.put(key, response.clone());
    return response;
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    return json({ error: "Servis okoline trenutno nije dostupan." }, 504);
  }
}
