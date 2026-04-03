/**
 * Trilateration Algorithm for BLE Indoor Positioning
 *
 * Uses weighted least-squares trilateration to estimate position
 * from 3+ BLE beacon distance measurements. Falls back to weighted
 * centroid when fewer beacons are available.
 */

import type { DetectedBeacon } from './types';

interface Position {
  latitude: number;
  longitude: number;
  accuracy: number; // estimated accuracy in meters
}

/**
 * Estimate position from detected BLE beacons using trilateration.
 *
 * With 3+ beacons: uses weighted least-squares trilateration
 * With 2 beacons: uses weighted midpoint
 * With 1 beacon: returns beacon position with large accuracy radius
 *
 * Returns null if no beacons with known positions are available.
 */
export function trilateratePosition(detectedBeacons: DetectedBeacon[]): Position | null {
  // Filter to beacons that have known positions
  const positioned = detectedBeacons.filter(
    (b) => b.beacon && b.beacon.latitude !== 0 && b.beacon.longitude !== 0
  );

  if (positioned.length === 0) return null;

  if (positioned.length === 1) {
    return singleBeaconEstimate(positioned[0]);
  }

  if (positioned.length === 2) {
    return twoBeaconEstimate(positioned[0], positioned[1]);
  }

  // 3+ beacons: weighted least-squares trilateration
  return weightedTrilateration(positioned);
}

/**
 * Single beacon: return beacon position with accuracy = distance estimate.
 */
function singleBeaconEstimate(beacon: DetectedBeacon): Position {
  return {
    latitude: beacon.beacon!.latitude,
    longitude: beacon.beacon!.longitude,
    accuracy: Math.max(beacon.distance, 5), // at least 5m accuracy
  };
}

/**
 * Two beacons: weighted midpoint between the two.
 */
function twoBeaconEstimate(b1: DetectedBeacon, b2: DetectedBeacon): Position {
  // Weight inversely proportional to distance (closer beacon has more influence)
  const w1 = 1 / Math.max(b1.distance, 0.1);
  const w2 = 1 / Math.max(b2.distance, 0.1);
  const totalWeight = w1 + w2;

  const lat = (b1.beacon!.latitude * w1 + b2.beacon!.latitude * w2) / totalWeight;
  const lng = (b1.beacon!.longitude * w1 + b2.beacon!.longitude * w2) / totalWeight;

  // Accuracy is the average of the two distances
  const accuracy = (b1.distance + b2.distance) / 2;

  return { latitude: lat, longitude: lng, accuracy: Math.max(accuracy, 3) };
}

/**
 * Weighted least-squares trilateration for 3+ beacons.
 *
 * Converts lat/lng to local meters, performs trilateration in Cartesian space,
 * then converts back to lat/lng.
 *
 * Uses the method of linearizing the circle intersection equations:
 *   (x - xi)^2 + (y - yi)^2 = ri^2
 * by subtracting the last equation from all others.
 */
function weightedTrilateration(beacons: DetectedBeacon[]): Position {
  // Use the first beacon as the reference origin
  const refLat = beacons[0].beacon!.latitude;
  const refLng = beacons[0].beacon!.longitude;

  // Convert to local Cartesian coordinates (meters from reference)
  const points = beacons.map((b) => ({
    x: lngToMeters(b.beacon!.longitude - refLng, refLat),
    y: latToMeters(b.beacon!.latitude - refLat),
    r: b.distance,
    weight: 1 / Math.max(b.distance * b.distance, 0.01), // inverse square weight
  }));

  const n = points.length;
  const last = points[n - 1];

  // Build the linear system: A * [x, y]^T = b
  // From (xi - xn)x + (yi - yn)y = 0.5 * (ri^2 - rn^2 - xi^2 + xn^2 - yi^2 + yn^2)
  const A: number[][] = [];
  const b: number[] = [];
  const weights: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const p = points[i];
    A.push([2 * (last.x - p.x), 2 * (last.y - p.y)]);
    b.push(
      p.r * p.r -
        last.r * last.r -
        p.x * p.x +
        last.x * last.x -
        p.y * p.y +
        last.y * last.y
    );
    weights.push((p.weight + last.weight) / 2);
  }

  // Weighted least squares: (A^T W A)^-1 A^T W b
  const result = weightedLeastSquares(A, b, weights);

  if (!result) {
    // Fallback to weighted centroid
    return weightedCentroid(beacons);
  }

  const [estX, estY] = result;

  // Convert back to lat/lng
  const estLat = refLat + metersToLat(estY);
  const estLng = refLng + metersToLng(estX, refLat);

  // Estimate accuracy from residuals
  let residualSum = 0;
  for (const p of points) {
    const dx = estX - p.x;
    const dy = estY - p.y;
    const actualDist = Math.sqrt(dx * dx + dy * dy);
    residualSum += Math.abs(actualDist - p.r);
  }
  const accuracy = Math.max(residualSum / n, 2);

  return { latitude: estLat, longitude: estLng, accuracy };
}

/**
 * Weighted centroid fallback when trilateration fails.
 */
function weightedCentroid(beacons: DetectedBeacon[]): Position {
  let totalWeight = 0;
  let latSum = 0;
  let lngSum = 0;

  for (const b of beacons) {
    const weight = 1 / Math.max(b.distance * b.distance, 0.01);
    latSum += b.beacon!.latitude * weight;
    lngSum += b.beacon!.longitude * weight;
    totalWeight += weight;
  }

  const avgDist =
    beacons.reduce((sum, b) => sum + b.distance, 0) / beacons.length;

  return {
    latitude: latSum / totalWeight,
    longitude: lngSum / totalWeight,
    accuracy: Math.max(avgDist, 2),
  };
}

/**
 * Solve weighted least squares: minimize sum(wi * (Ai*x - bi)^2)
 * For a 2-variable system.
 */
function weightedLeastSquares(
  A: number[][],
  b: number[],
  w: number[]
): [number, number] | null {
  const n = A.length;
  if (n < 1) return null;

  // A^T W A (2x2 matrix)
  let a00 = 0, a01 = 0, a10 = 0, a11 = 0;
  let b0 = 0, b1 = 0;

  for (let i = 0; i < n; i++) {
    const wi = w[i];
    a00 += wi * A[i][0] * A[i][0];
    a01 += wi * A[i][0] * A[i][1];
    a10 += wi * A[i][1] * A[i][0];
    a11 += wi * A[i][1] * A[i][1];
    b0 += wi * A[i][0] * b[i];
    b1 += wi * A[i][1] * b[i];
  }

  // Solve 2x2 system using Cramer's rule
  const det = a00 * a11 - a01 * a10;
  if (Math.abs(det) < 1e-10) return null;

  const x = (b0 * a11 - b1 * a01) / det;
  const y = (a00 * b1 - a10 * b0) / det;

  return [x, y];
}

// ============================================================
// Coordinate conversion helpers
// ============================================================

const METERS_PER_DEGREE_LAT = 111320; // approximately constant

/**
 * Convert longitude difference to meters at a given latitude.
 */
export function lngToMeters(dLng: number, lat: number): number {
  return dLng * METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * Convert latitude difference to meters.
 */
export function latToMeters(dLat: number): number {
  return dLat * METERS_PER_DEGREE_LAT;
}

/**
 * Convert meters to latitude difference.
 */
export function metersToLat(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

/**
 * Convert meters to longitude difference at a given latitude.
 */
export function metersToLng(meters: number, lat: number): number {
  return meters / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
}
