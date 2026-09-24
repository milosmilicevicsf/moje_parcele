// Deployment settings. Edit here or rewrite this file in your CI.
// Route on this deployment that packages OpenStreetMap surroundings.
export const SURROUNDINGS_URL='/api/surroundings';
// Public GeoSrbija search endpoint; the browser calls it directly (cross-origin works because
// the service replies with permissive CORS). Point it at your own proxy if RGZ ever changes that.
// Satellite basemap (XYZ, Web Mercator). blankTile=false makes Esri answer 404 instead of a grey
// "Map data not yet available" tile, so the map can fall back to a lower zoom. For production use
// under Esri terms, add an ArcGIS Location Platform key (token=...) or point this at another provider.
export const SATELLITE_TILES='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false';
export const SATELLITE_ATTRIBUTION='Esri, Maxar, Earthstar Geographics';
export const GEOSRBIJA_URL='https://a3.geosrbija.rs/WebServices/search/SearchProxy.asmx/Search';
