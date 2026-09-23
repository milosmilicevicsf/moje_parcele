declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Comma-separated Overpass endpoints for /api/surroundings (read through process.env).
    OVERPASS_URL?: string;
  }
}
