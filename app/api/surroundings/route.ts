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
const UPSTREAM_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 50000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

async function download(query: string, box: number[]) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let failure: unknown = new RequestError("Servis okoline trenutno nije dostupan.", 504);
  for (const upstream of upstreams(process.env.OVERPASS_URL)) {
    const remaining = deadline - Date.now();
    if (remaining < 3000) break;
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(Math.min(UPSTREAM_TIMEOUT_MS, remaining)),
      });
      if (!response.ok) throw new RequestError(`Servis okoline nije dostupan (${response.status}).`, 502);
      return packageFrom(await response.json(), box);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
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

    const response = json(await download(overpassQuery(box), box), 200, {
      // s-maxage lets the hosting CDN (Vercel) share one download between users.
      "Cache-Control": `public, max-age=86400, s-maxage=${CACHE_SECONDS}`,
    });
    await cache?.put(key, response.clone());
    return response;
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return json(
      {
        error: timeout
          ? "Servis okoline nije odgovorio na vreme. Pokušajte ponovo."
          : "Servis okoline trenutno nije dostupan.",
      },
      504
    );
  }
}
