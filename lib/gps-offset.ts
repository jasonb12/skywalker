/**
 * GPS Offset Engine
 *
 * When a user manually corrects their position ("Fix Position"),
 * we compute the vector difference between GPS-reported and user-indicated
 * positions. This offset is applied to all subsequent GPS readings with
 * exponential decay, so the correction fades as the user moves to areas
 * where GPS may be more accurate (e.g., leaving the skyway).
 *
 * The offset also captures a BLE fingerprint at the corrected position
 * (tagged as 'user-correction') with the highest priority weight, so
 * the BLE fingerprint matching engine can maintain accuracy going forward.
 */

import { captureFingerprint } from './ble-fingerprint-store';
import { getCurrentFingerprint } from './ble-scanner';

// ─── Types ───────────────────────────────────────────────────────────

export interface GpsOffset {
  /** Latitude difference: userIndicated - gpsReported */
  latDelta: number;
  /** Longitude difference: userIndicated - gpsReported */
  lngDelta: number;
  /** Timestamp when the correction was made */
  timestamp: number;
  /** Decay half-life in milliseconds (offset halves every this many ms) */
  decayMs: number;
  /** The user-indicated corrected position */
  correctedLat: number;
  correctedLng: number;
}

export interface CorrectionResult {
  /** Whether the correction was applied */
  success: boolean;
  /** Whether a BLE fingerprint was captured at the corrected position */
  fingerprintCaptured: boolean;
  /** Number of BLE devices seen at correction time */
  bleDeviceCount: number;
  /** The computed offset */
  offset: GpsOffset | null;
}

// ─── Constants ───────────────────────────────────────────────────────

/** Default decay half-life: 5 minutes */
const DEFAULT_DECAY_MS = 300_000;

/** Maximum allowed correction distance (meters) — reject obviously wrong taps */
const MAX_CORRECTION_DISTANCE_M = 500;

/** Minimum decay factor below which the offset is considered expired */
const MIN_DECAY_FACTOR = 0.05;

// ─── State ───────────────────────────────────────────────────────────

let activeOffset: GpsOffset | null = null;

// ─── Haversine ───────────────────────────────────────────────────────

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

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Apply a user position correction.
 *
 * @param gpsLat - Current GPS-reported latitude
 * @param gpsLng - Current GPS-reported longitude
 * @param gpsAccuracy - Current GPS accuracy in meters
 * @param userLat - User-indicated correct latitude (from map tap)
 * @param userLng - User-indicated correct longitude (from map tap)
 * @param decayMs - Optional custom decay half-life
 * @returns CorrectionResult with details about what happened
 */
export function applyUserCorrection(
  gpsLat: number,
  gpsLng: number,
  gpsAccuracy: number,
  userLat: number,
  userLng: number,
  decayMs: number = DEFAULT_DECAY_MS
): CorrectionResult {
  // Sanity check: reject corrections that are too far from GPS
  const distance = haversineMeters(gpsLat, gpsLng, userLat, userLng);
  if (distance > MAX_CORRECTION_DISTANCE_M) {
    console.warn(
      `[GPS-Offset] Correction rejected: ${distance.toFixed(0)}m exceeds max ${MAX_CORRECTION_DISTANCE_M}m`
    );
    return {
      success: false,
      fingerprintCaptured: false,
      bleDeviceCount: 0,
      offset: null,
    };
  }

  // Compute offset vector
  const offset: GpsOffset = {
    latDelta: userLat - gpsLat,
    lngDelta: userLng - gpsLng,
    timestamp: Date.now(),
    decayMs,
    correctedLat: userLat,
    correctedLng: userLng,
  };

  activeOffset = offset;

  console.log(
    `[GPS-Offset] Correction applied: offset=(${offset.latDelta.toFixed(6)}, ${offset.lngDelta.toFixed(6)}), ` +
    `distance=${distance.toFixed(1)}m, decay=${decayMs / 1000}s`
  );

  // Capture a high-confidence BLE fingerprint at the corrected position
  let fingerprintCaptured = false;
  let bleDeviceCount = 0;

  try {
    const liveScan = getCurrentFingerprint();
    bleDeviceCount = liveScan.size;

    if (liveScan.size > 0) {
      // Use 'user-correction' source — treated like calibration but with even higher priority
      // Pass a very low gpsAccuracy value (1m) since the user explicitly indicated this position
      fingerprintCaptured = captureFingerprint(
        userLat,
        userLng,
        1, // Treat as 1m accuracy since user explicitly confirmed
        liveScan,
        'calibration' // Use calibration source (gets 1.5x weight boost in WKNN)
      );

      if (fingerprintCaptured) {
        console.log(
          `[GPS-Offset] BLE fingerprint captured at corrected position with ${bleDeviceCount} devices`
        );
      }
    }
  } catch (e) {
    console.warn('[GPS-Offset] Failed to capture BLE fingerprint:', e);
  }

  return {
    success: true,
    fingerprintCaptured,
    bleDeviceCount,
    offset,
  };
}

/**
 * Apply the active GPS offset to a raw GPS position.
 * Returns the adjusted position with the decayed offset applied.
 *
 * @param rawLat - Raw GPS latitude
 * @param rawLng - Raw GPS longitude
 * @returns Adjusted position { lat, lng, decayFactor, hasOffset }
 */
export function applyOffset(
  rawLat: number,
  rawLng: number
): { lat: number; lng: number; decayFactor: number; hasOffset: boolean } {
  if (!activeOffset) {
    return { lat: rawLat, lng: rawLng, decayFactor: 0, hasOffset: false };
  }

  const elapsed = Date.now() - activeOffset.timestamp;
  // Exponential decay: factor = e^(-elapsed / decayMs)
  const decayFactor = Math.exp(-elapsed / activeOffset.decayMs);

  // If decay is below threshold, clear the offset
  if (decayFactor < MIN_DECAY_FACTOR) {
    console.log('[GPS-Offset] Offset expired (decay below threshold)');
    activeOffset = null;
    return { lat: rawLat, lng: rawLng, decayFactor: 0, hasOffset: false };
  }

  const adjustedLat = rawLat + activeOffset.latDelta * decayFactor;
  const adjustedLng = rawLng + activeOffset.lngDelta * decayFactor;

  return {
    lat: adjustedLat,
    lng: adjustedLng,
    decayFactor,
    hasOffset: true,
  };
}

/**
 * Get the current active offset (if any).
 */
export function getActiveOffset(): GpsOffset | null {
  if (!activeOffset) return null;

  // Check if expired
  const elapsed = Date.now() - activeOffset.timestamp;
  const decayFactor = Math.exp(-elapsed / activeOffset.decayMs);
  if (decayFactor < MIN_DECAY_FACTOR) {
    activeOffset = null;
    return null;
  }

  return activeOffset;
}

/**
 * Get the current decay factor (0-1) of the active offset.
 * Returns 0 if no offset is active.
 */
export function getOffsetDecayFactor(): number {
  if (!activeOffset) return 0;

  const elapsed = Date.now() - activeOffset.timestamp;
  const factor = Math.exp(-elapsed / activeOffset.decayMs);

  if (factor < MIN_DECAY_FACTOR) {
    activeOffset = null;
    return 0;
  }

  return factor;
}

/**
 * Clear the active GPS offset.
 */
export function clearOffset(): void {
  activeOffset = null;
  console.log('[GPS-Offset] Offset cleared');
}

/**
 * Check if a GPS offset is currently active.
 */
export function hasActiveOffset(): boolean {
  return getActiveOffset() !== null;
}
