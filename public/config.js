// Deployment settings. Edit here or rewrite this file in your CI.
// Route on this deployment that packages OpenStreetMap surroundings.
export const SURROUNDINGS_URL='/api/surroundings';
// Public GeoSrbija search endpoint; the browser calls it directly (cross-origin works because
// the service replies with permissive CORS). Point it at your own proxy if RGZ ever changes that.
// Satellite basemap (XYZ, Web Mercator) through ArcGIS Location Platform. The key is public by
// design (every browser sees it); its referrer restriction in the ArcGIS portal is what protects it.
// It expires at most a year after creation: regenerate it in the portal and replace it here.
// The service answers 404 where a zoom has no imagery, so the map falls back to a lower zoom.
export const SATELLITE_KEY='AAPTa9NkgDhNbXzhW_VbgjdrPmw..JyrD0nNbz4OUz2TAcjTcG4_pMwXiewwiPox7EdRenB4i5KgbCqyh5ey_bj19C-77cmdyeVfL5qG0PHBz4URmGobiJRoZ8VvlZJBvbr7a00GBrThZPnCJWURMzssWlEsxpamVcv56KnVMWVdtbqWkqGEoxQ91lDCp5a1QaMeo7gUbA1QNtXXYXaIgq0mAdNZn4tgM3Ed-qrIz04z_SVn1u_5J9V2_fFSbh5vhGjjPeX6-xehO5v-OPz8cAT1_7QR8quM5';
export const SATELLITE_TILES='https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token='+SATELLITE_KEY;
export const SATELLITE_ATTRIBUTION='Esri, Maxar, Earthstar Geographics';
export const GEOSRBIJA_URL='https://a3.geosrbija.rs/WebServices/search/SearchProxy.asmx/Search';
