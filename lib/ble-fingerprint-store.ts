/**
 * BLE Fingerprint Store
 *
 * Crowdsourced indoor positioning via BLE fingerprinting.
 *
 * Training phase (automatic):
 *   When GPS accuracy is good (< 15m), save a "fingerprint" = snapshot of
 *   all visible BLE devices + their RSSI at the current GPS position.
 *
 * Positioning phase:
 *   When GPS is poor or unavailable, compare the live BLE scan against
 *   stored fingerprints using Weighted K-Nearest Neighbors (WKNN) to
 *   estimate the user's position.
 *
 * The fingerprint database grows over time as the user walks around.
 * Stored in AsyncStorage for persistence across app launches.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RSSI_FLOOR } from './ble-scanner';

// ─── Types ───────────────────────────────────────────────────────────

export interface BleFingerprint {
  /** Unique fingerprint ID */
  id: string;
  /** GPS latitude where this fingerprint was captured */
  latitude: number;
  /** GPS longitude where this fingerprint was captured */
  longitude: number;
  /** GPS accuracy at capture time (meters) */
  gpsAccuracy: number;
  /** Map of deviceId → smoothedRssi at this location */
  devices: Record<string, number>;
  /** Number of devices in this fingerprint */
  deviceCount: number;
  /** Timestamp of capture */
  timestamp: number;
}

export interface FingerprintMatch {
  fingerprint: BleFingerprint;
  signalDistance: number;
  commonDevices: number;
  weight: number;
}

export interface FingerprintPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  matchCount: number;
  avgSignalDistance: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const STORAGE_KEY = '@skywalker/ble_fingerprints';
const MIN_GPS_ACCURACY_FOR_CAPTURE = 15;
const MIN_DEVICES_FOR_CAPTURE = 3;
const MIN_FINGERPRINT_SPACING = 5;
const MIN_COMMON_DEVICES = 2;
const WKNN_K = 5;
const MAX_FINGERPRINT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FINGERPRINTS = 2000;

// ─── Internal state ─────────────────────────────────────────────────

let fingerprints: BleFingerprint[] = [];
let loaded = false;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Persistence ─────────────────────────────────────────────────────

async function loadFingerprints(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BleFingerprint[];
      const cutoff = Date.now() - MAX_FINGERPRINT_AGE_MS;
      fingerprints = parsed.filter((fp) => fp.timestamp > cutoff);
      console.log(`[BLE-FP] Loaded ${fingerprints.length} fingerprints`);
    }
  } catch (e) {
    console.warn('[BLE-FP] Failed to load fingerprints:', e);
  }
  loaded = true;
}

function debouncedSave(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fingerprints));
    } catch (e) {
      console.warn('[BLE-FP] Failed to save fingerprints:', e);
    }
  }, 2000);
}

// ─── Haversine distance ──────────────────────────────────────────────

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

// ─── Signal distance calculation ─────────────────────────────────────

function signalDistance(
  liveScan: Map<string, number>,
  storedDevices: Record<string, number>
): { distance: number; commonCount: number } {
  const allIds = new Set<string>();
  for (const id of liveScan.keys()) allIds.add(id);
  for (const id of Object.keys(storedDevices)) allIds.add(id);

  let sumSq = 0;
  let commonCount = 0;

  for (const id of allIds) {
    const liveRssi = liveScan.get(id) ?? RSSI_FLOOR;
    const storedRssi = storedDevices[id] ?? RSSI_FLOOR;
    if (liveScan.has(id) && id in storedDevices) commonCount++;
    const diff = liveRssi - storedRssi;
    sumSq += diff * diff;
  }

  return { distance: Math.sqrt(sumSq), commonCount };
}

// ─── Public API ──────────────────────────────────────────────────────

export async function initFingerprintStore(): Promise<void> {
  await loadFingerprints();
}

/**
 * Try to capture a fingerprint at the current position.
 * Only captures if GPS is accurate enough and enough BLE devices are visible.
 */
export function captureFingerprint(
  latitude: number,
  longitude: number,
  gpsAccuracy: number,
  liveScan: Map<string, number>
): boolean {
  if (gpsAccuracy > MIN_GPS_ACCURACY_FOR_CAPTURE) return false;
  if (liveScan.size < MIN_DEVICES_FOR_CAPTURE) return false;

  const tooClose = fingerprints.some(
    (fp) => haversineMeters(latitude, longitude, fp.latitude, fp.longitude) < MIN_FINGERPRINT_SPACING
  );
  if (tooClose) return false;

  const devices: Record<string, number> = {};
  for (const [id, rssi] of liveScan) {
    devices[id] = rssi;
  }

  const fp: BleFingerprint = {
    id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    latitude,
    longitude,
    gpsAccuracy,
    devices,
    deviceCount: liveScan.size,
    timestamp: Date.now(),
  };

  fingerprints.push(fp);

  if (fingerprints.length > MAX_FINGERPRINTS) {
    fingerprints.sort((a, b) => b.timestamp - a.timestamp);
    fingerprints = fingerprints.slice(0, MAX_FINGERPRINTS);
  }

  debouncedSave();
  console.log(
    `[BLE-FP] Captured fingerprint with ${liveScan.size} devices at (${latitude.toFixed(5)}, ${longitude.toFixed(5)}). Total: ${fingerprints.length}`
  );
  return true;
}

/**
 * Estimate position from the current BLE scan using WKNN fingerprint matching.
 */
export function estimatePosition(
  liveScan: Map<string, number>
): FingerprintPosition | null {
  if (liveScan.size < MIN_COMMON_DEVICES) return null;
  if (fingerprints.length === 0) return null;

  const matches: FingerprintMatch[] = [];

  for (const fp of fingerprints) {
    const { distance, commonCount } = signalDistance(liveScan, fp.devices);
    if (commonCount < MIN_COMMON_DEVICES) continue;
    const weight = commonCount / (distance * distance + 1);
    matches.push({ fingerprint: fp, signalDistance: distance, commonDevices: commonCount, weight });
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.signalDistance - b.signalDistance);
  const topK = matches.slice(0, WKNN_K);

  let totalWeight = 0;
  let latSum = 0;
  let lngSum = 0;
  let distSum = 0;

  for (const m of topK) {
    latSum += m.fingerprint.latitude * m.weight;
    lngSum += m.fingerprint.longitude * m.weight;
    distSum += m.signalDistance;
    totalWeight += m.weight;
  }

  if (totalWeight === 0) return null;

  const avgSignalDist = distSum / topK.length;
  const accuracy = Math.max(5, Math.min(50, avgSignalDist / 2));

  return {
    latitude: latSum / totalWeight,
    longitude: lngSum / totalWeight,
    accuracy,
    matchCount: topK.length,
    avgSignalDistance: avgSignalDist,
  };
}

export function getFingerprintCount(): number {
  return fingerprints.length;
}

export function getAllFingerprints(): BleFingerprint[] {
  return [...fingerprints];
}

export async function clearFingerprints(): Promise<void> {
  fingerprints = [];
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[BLE-FP] Failed to clear fingerprints:', e);
  }
  console.log('[BLE-FP] All fingerprints cleared');
}
