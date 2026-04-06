/**
 * Snap-to-Skyway
 *
 * When the user confirms a "Fix Position" correction, we snap their
 * indicated position to the nearest point on the skyway network.
 * This ensures the corrected position is always on a valid skyway path,
 * not on a building roof or in the middle of a street.
 *
 * The module fetches the footway-simple GeoJSON (cached after first load),
 * then finds the closest point on any LineString segment to the user's
 * indicated position using perpendicular projection.
 */

import { getGeojsonUrl } from './map-config';

// ─── Types ───────────────────────────────────────────────────────────

interface SnapResult {
  /** Snapped latitude (on the skyway path) */
  lat: number;
  /** Snapped longitude (on the skyway path) */
  lng: number;
  /** Distance in meters from the original point to the snapped point */
  distanceMeters: number;
  /** Whether snapping was successful */
  snapped: boolean;
  /** Color of the nearest skyway segment (for display) */
  segmentColor: string | null;
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[][] | number[][][] | number[];
  };
  properties: Record<string, unknown>;
}

interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum snap distance in meters — don't snap if too far from any skyway */
const MAX_SNAP_DISTANCE_M = 100;

/** Cache the loaded GeoJSON to avoid re-fetching */
let cachedFootways: GeoJsonCollection | null = null;
let cachePromise: Promise<GeoJsonCollection | null> | null = null;

// ─── Geometry helpers ────────────────────────────────────────────────

/** Haversine distance in meters */
function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the closest point on a line segment (A→B) to point P.
 * Works in lat/lng space (good enough for short distances).
 * Returns the projected point and the parameter t (0-1).
 */
function closestPointOnSegment(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): { lat: number; lng: number; t: number } {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (A == B)
    return { lat: aLat, lng: aLng, t: 0 };
  }

  // Project P onto the line A→B, clamped to [0, 1]
  let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    lat: aLat + t * dy,
    lng: aLng + t * dx,
    t,
  };
}

// ─── Data loading ────────────────────────────────────────────────────

async function loadFootways(): Promise<GeoJsonCollection | null> {
  if (cachedFootways) return cachedFootways;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    try {
      const url = getGeojsonUrl('footway-simple');
      console.log('[Snap] Loading footway data from:', url);
      const response = await fetch(url);
      if (!response.ok) {
        console.warn('[Snap] Failed to load footway data:', response.status);
        return null;
      }
      const data = await response.json() as GeoJsonCollection;
      cachedFootways = data;
      console.log(`[Snap] Loaded ${data.features.length} footway features`);
      return data;
    } catch (e) {
      console.warn('[Snap] Error loading footway data:', e);
      return null;
    } finally {
      cachePromise = null;
    }
  })();

  return cachePromise;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Snap a position to the nearest point on the skyway network.
 *
 * @param lat - User-indicated latitude
 * @param lng - User-indicated longitude
 * @returns SnapResult with the snapped position and distance
 */
export async function snapToSkyway(lat: number, lng: number): Promise<SnapResult> {
  const footways = await loadFootways();

  if (!footways || footways.features.length === 0) {
    console.warn('[Snap] No footway data available, returning original position');
    return { lat, lng, distanceMeters: 0, snapped: false, segmentColor: null };
  }

  let bestLat = lat;
  let bestLng = lng;
  let bestDist = Infinity;
  let bestColor: string | null = null;

  for (const feature of footways.features) {
    const geom = feature.geometry;
    const color = (feature.properties?.color as string) || null;

    // Extract coordinate arrays from LineString or MultiLineString
    let lineStrings: number[][][] = [];
    if (geom.type === 'LineString') {
      lineStrings = [geom.coordinates as number[][]];
    } else if (geom.type === 'MultiLineString') {
      lineStrings = geom.coordinates as number[][][];
    } else {
      continue; // Skip non-line features
    }

    for (const coords of lineStrings) {
      for (let i = 0; i < coords.length - 1; i++) {
        const [aLng, aLat] = coords[i];
        const [bLng, bLat] = coords[i + 1];

        const proj = closestPointOnSegment(lat, lng, aLat, aLng, bLat, bLng);
        const dist = haversineMeters(lat, lng, proj.lat, proj.lng);

        if (dist < bestDist) {
          bestDist = dist;
          bestLat = proj.lat;
          bestLng = proj.lng;
          bestColor = color;
        }
      }
    }
  }

  // Only snap if within the maximum distance
  if (bestDist > MAX_SNAP_DISTANCE_M) {
    console.log(`[Snap] Nearest skyway is ${bestDist.toFixed(0)}m away (max ${MAX_SNAP_DISTANCE_M}m), not snapping`);
    return { lat, lng, distanceMeters: bestDist, snapped: false, segmentColor: null };
  }

  console.log(
    `[Snap] Snapped to skyway: ${bestDist.toFixed(1)}m offset, color=${bestColor}`
  );

  return {
    lat: bestLat,
    lng: bestLng,
    distanceMeters: bestDist,
    snapped: true,
    segmentColor: bestColor,
  };
}

/**
 * Pre-load the footway data so snapping is instant when the user needs it.
 * Call this when the map screen mounts.
 */
export function preloadFootwayData(): void {
  loadFootways().catch(() => {});
}

/**
 * Clear the cached footway data (for testing or memory management).
 */
export function clearFootwayCache(): void {
  cachedFootways = null;
  cachePromise = null;
}
