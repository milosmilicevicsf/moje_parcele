import { env } from "cloudflare:workers";
import {
  RequestError,
  USER_AGENT,
  bbox,
  overpassQuery,
  packageFrom,
  parseCenter,
  upstreams,
} from "../../../lib/surroundings";

const CACHE_SECONDS = 7 * 24 * 3600;
const UPSTREAM_TIMEOUT_MS = 25000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function download(query: string, box: number[]) {
  let failure: unknown = new RequestError("Servis okoline trenutno nije dostupan.", 504);
  for (const upstream of upstreams(env.OVERPASS_URL)) {
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
    // The DOM lib's CacheStorage type hides the Workers-only default cache.
    const cache = (caches as CacheStorage & { default: Cache }).default;
    const key = new Request(
      new URL(`/api/surroundings?lat=${center[0]}&lon=${center[1]}`, url.origin)
    );
    const hit = await cache.match(key);
    // Cached responses carry immutable headers, which the framework must still be able to touch.
    if (hit) return new Response(hit.body, hit);

    const response = json(await download(overpassQuery(box), box), 200, {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    });
    await cache.put(key, response.clone());
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
