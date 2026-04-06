/**
 * Map configuration — Self-hosted skyway data on S3/CDN storage.
 *
 * Skyway vector data is served as GeoJSON files from S3 CDN.
 * Base map uses CARTO raster tiles (free, no API key).
 * Fonts use the MapLibre demo font CDN.
 * All data is extracted from OpenStreetMap (ODbL license) via skyway.run.
 */

/** CDN base URL for GeoJSON files */
const GEOJSON_CDN_BASE =
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663073371114/ni6f2tiWMMwdiAqNoUpTSw/map-tiles';

/** Skyway source layer names */
export const SKYWAY_LAYERS = [
  'footway-simple',
  'footway',
  'building',
  'building-names',
  'building-simple',
  'roadway',
  'poi',
] as const;

/** Public URL for a skyway GeoJSON layer on S3 CDN */
export function getGeojsonUrl(layer: string): string {
  return `${GEOJSON_CDN_BASE}/skyway-${layer}.geojson`;
}

/** Base URL for GeoJSON endpoints (for the map HTML to fetch from) */
export function getGeojsonBaseUrl(): string {
  return GEOJSON_CDN_BASE;
}

/**
 * Font glyphs URL pattern for MapLibre.
 * Uses the MapLibre demo font server which hosts Overpass and other open fonts.
 */
export function getFontGlyphsUrl(): string {
  return 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
}

/**
 * Bounding box of the Minneapolis skyway network.
 * Used for auto-zoom to fit on first load.
 */
export const SKYWAY_BOUNDS = {
  sw: [-93.279135, 44.969565] as [number, number],
  ne: [-93.257473, 44.983473] as [number, number],
  center: [-93.268304, 44.976519] as [number, number],
};

/**
 * Route color definitions from skyway.run data.
 * Colors represent geographic zones of the skyway network.
 */
export const SKYWAY_ROUTE_COLORS = [
  { color: '#de1215', name: 'Red', zone: 'Northwest' },
  { color: '#c1105a', name: 'Pink', zone: 'West Central' },
  { color: '#74133f', name: 'Maroon', zone: 'Southwest' },
  { color: '#894406', name: 'Brown', zone: 'Central East' },
  { color: '#008540', name: 'Green', zone: 'Nicollet Mall' },
  { color: '#177eab', name: 'Teal', zone: 'Central West' },
  { color: '#2e3092', name: 'Blue', zone: 'Central South' },
  { color: '#7f3f98', name: 'Purple', zone: 'East' },
  { color: '#666666', name: 'Gray', zone: 'South' },
  { color: '#333333', name: 'Dark Gray', zone: 'Connectors' },
] as const;

// ---- Legacy exports (kept for backward compat during migration) ----

/** @deprecated Use getGeojsonUrl() instead */
export function getPmtilesUrl(): string {
  return '';
}

/** @deprecated Use getGeojsonUrl() instead */
export function getTileUrl(): string {
  return '';
}
