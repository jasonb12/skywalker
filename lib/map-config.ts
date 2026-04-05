/**
 * Map configuration — Supabase Edge Function URLs for tiles, fonts, and map HTML.
 *
 * These Edge Functions proxy data from skyway.run and serve the MapLibre HTML page,
 * so the app works without the local Express dev server running.
 */

import Constants from 'expo-constants';

const SUPABASE_URL =
  Constants.expoConfig?.extra?.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  '';

/** Base URL for the skyway tile proxy Edge Function */
export function getTileUrl(): string {
  return `${SUPABASE_URL}/functions/v1/skyway-tile/{z}/{x}/{y}.mvt`;
}

/** Base URL for the skyway font proxy Edge Function */
export function getFontGlyphsUrl(): string {
  return `${SUPABASE_URL}/functions/v1/skyway-fonts/{fontstack}/{range}.pbf`;
}

/** Full URL for the skyway map HTML Edge Function (with query params) */
export function getMapHtmlUrl(params?: Record<string, string>): string {
  const base = `${SUPABASE_URL}/functions/v1/skyway-map`;
  if (!params || Object.keys(params).length === 0) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}
