declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Overpass-compatible endpoint used by /api/surroundings; defaults to the public instance.
    OVERPASS_URL?: string;
  }
}
