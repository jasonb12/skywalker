/**
 * Map configuration — Self-hosted skyway data on Supabase Storage.
 *
 * Skyway vector data is served as GeoJSON files from Supabase Storage.
 * Base map uses CARTO raster tiles (free, no API key).
 * Fonts use the MapLibre demo font CDN.
 * All data is extracted from OpenStreetMap (ODbL license).
 */

import Constants from 'expo-constants';

const SUPABASE_URL =
  Constants.expoConfig?.extra?.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  '';

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

/** Public URL for a skyway GeoJSON layer on Supabase Storage */
export function getGeojsonUrl(layer: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/map-tiles/skyway-${layer}.geojson`;
}

/** Base URL for GeoJSON endpoints (for the map HTML to fetch from) */
export function getGeojsonBaseUrl(): string {
  return `${SUPABASE_URL}/storage/v1/object/public/map-tiles`;
}

/** Public URL for the skyway PMTiles archive on Supabase Storage (legacy) */
export function getPmtilesUrl(): string {
  return `${SUPABASE_URL}/storage/v1/object/public/map-tiles/skyway.pmtiles`;
}

/**
 * Font glyphs URL pattern for MapLibre.
 * Uses the MapLibre demo font server which hosts Overpass and other open fonts.
 */
export function getFontGlyphsUrl(): string {
  return 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
}

/** URL for the skyway-map Edge Function that serves the full MapLibre HTML page */
export function getMapHtmlUrl(isDark: boolean): string {
  return `${SUPABASE_URL}/functions/v1/skyway-map${isDark ? '?dark=1' : ''}`;
}

// ---- Legacy exports (kept for backward compat during migration) ----

/** @deprecated Use getGeojsonUrl() instead */
export function getTileUrl(): string {
  return getPmtilesUrl();
}
