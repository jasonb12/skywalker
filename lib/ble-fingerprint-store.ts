/**
 * BLE Fingerprint Store
 *
 * Crowdsourced indoor positioning via BLE fingerprinting.
 *
 * Training phase (automatic + manual calibration):
 *   When GPS accuracy is good (< 15m), save a "fingerprint" = snapshot of
 *   all visible BLE devices + their RSSI at the current GPS position.
 *   Manual calibration mode allows users to explicitly record high-confidence
 *   fingerprints at known locations.
 *
 * Positioning phase:
 *   When GPS is poor or unavailable, compare the live BLE scan against
 *   stored fingerprints using Weighted K-Nearest Neighbors (WKNN) to
 *   estimate the user's position.
 *
 * Sync:
 *   Fingerprints are synced to/from Supabase so all users benefit from
 *   community-collected data. Local fingerprints are uploaded periodically,
 *   and community fingerprints are downloaded to improve positioning.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RSSI_FLOOR } from './ble-scanner';
import {
  uploadFingerprints,
  downloadFingerprints,
  getRemoteFingerprintCount,
} from './fingerprint-sync';

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
  /** Source: 'auto' for GPS-triggered, 'calibration' for manual */
  source?: 'auto' | 'calibration';
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
const MAX_FINGERPRINTS = 5000; // Increased to accommodate community fingerprints
const SYNC_INTERVAL_MS = 60_000; // Sync every 60 seconds

// ─── Internal state ─────────────────────────────────────────────────

let fingerprints: BleFingerprint[] = [];
let loaded = false;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let remoteFingerprintCount = 0;
let isSyncing = false;
let deviceIdentifier: string | undefined;

// ─── Callbacks ──────────────────────────────────────────────────────

type SyncCallback = (stats: {
  localCount: number;
  remoteCount: number;
  uploaded: number;
  downloaded: number;
}) => void;

let onSyncComplete: SyncCallback | null = null;

export function setSyncCallback(cb: SyncCallback | null): void {
  onSyncComplete = cb;
}

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

// ─── Sync ────────────────────────────────────────────────────────────

async function performSync(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Upload local fingerprints
    const uploaded = await uploadFingerprints(fingerprints, deviceIdentifier);

    // Download community fingerprints
    const existingIds = new Set(fingerprints.map((fp) => fp.id));
    const downloaded = await downloadFingerprints(existingIds);

    // Merge downloaded fingerprints into local store
    if (downloaded.length > 0) {
      fingerprints.push(...downloaded);

      // Enforce max limit
      if (fingerprints.length > MAX_FINGERPRINTS) {
        // Keep calibration fingerprints and most recent
        fingerprints.sort((a, b) => {
          // Calibration fingerprints get priority
          if (a.source === 'calibration' && b.source !== 'calibration') return -1;
          if (b.source === 'calibration' && a.source !== 'calibration') return 1;
          return b.timestamp - a.timestamp;
        });
        fingerprints = fingerprints.slice(0, MAX_FINGERPRINTS);
      }

      debouncedSave();
    }

    // Update remote count
    remoteFingerprintCount = await getRemoteFingerprintCount();

    // Notify callback
    if (onSyncComplete) {
      onSyncComplete({
        localCount: fingerprints.length,
        remoteCount: remoteFingerprintCount,
        uploaded,
        downloaded: downloaded.length,
      });
    }
  } catch (e) {
    console.warn('[BLE-FP] Sync error:', e);
  } finally {
    isSyncing = false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function initFingerprintStore(devId?: string): Promise<void> {
  deviceIdentifier = devId;
  await loadFingerprints();

  // Start periodic sync
  if (!syncTimer) {
    // Initial sync after 5 seconds
    setTimeout(() => performSync(), 5000);

    // Then sync periodically
    syncTimer = setInterval(() => performSync(), SYNC_INTERVAL_MS);
  }
}

/**
 * Try to capture a fingerprint at the current position.
 * Only captures if GPS is accurate enough and enough BLE devices are visible.
 */
export function captureFingerprint(
  latitude: number,
  longitude: number,
  gpsAccuracy: number,
  liveScan: Map<string, number>,
  source: 'auto' | 'calibration' = 'auto'
): boolean {
  // For calibration mode, relax the GPS accuracy requirement
  const maxAccuracy = source === 'calibration' ? 50 : MIN_GPS_ACCURACY_FOR_CAPTURE;
  if (gpsAccuracy > maxAccuracy) return false;
  if (liveScan.size < MIN_DEVICES_FOR_CAPTURE) return false;

  // For auto mode, check spacing; for calibration, allow closer spacing
  const minSpacing = source === 'calibration' ? 2 : MIN_FINGERPRINT_SPACING;
  const tooClose = fingerprints.some(
    (fp) => haversineMeters(latitude, longitude, fp.latitude, fp.longitude) < minSpacing
  );
  if (tooClose && source === 'auto') return false;

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
    source,
  };

  fingerprints.push(fp);

  if (fingerprints.length > MAX_FINGERPRINTS) {
    fingerprints.sort((a, b) => {
      if (a.source === 'calibration' && b.source !== 'calibration') return -1;
      if (b.source === 'calibration' && a.source !== 'calibration') return 1;
      return b.timestamp - a.timestamp;
    });
    fingerprints = fingerprints.slice(0, MAX_FINGERPRINTS);
  }

  debouncedSave();
  console.log(
    `[BLE-FP] Captured ${source} fingerprint with ${liveScan.size} devices at (${latitude.toFixed(5)}, ${longitude.toFixed(5)}). Total: ${fingerprints.length}`
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

    // Give calibration fingerprints higher weight
    const sourceBonus = fp.source === 'calibration' ? 1.5 : 1.0;
    const weight = (commonCount / (distance * distance + 1)) * sourceBonus;
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

export function getRemoteCount(): number {
  return remoteFingerprintCount;
}

export function getAllFingerprints(): BleFingerprint[] {
  return [...fingerprints];
}

/**
 * Get fingerprint locations for heatmap rendering.
 * Returns lightweight coordinate + metadata objects.
 */
export function getFingerprintLocations(): Array<{
  latitude: number;
  longitude: number;
  deviceCount: number;
  source: string;
}> {
  return fingerprints.map((fp) => ({
    latitude: fp.latitude,
    longitude: fp.longitude,
    deviceCount: fp.deviceCount,
    source: fp.source ?? 'auto',
  }));
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

/**
 * Force an immediate sync with Supabase.
 */
export async function forceSyncNow(): Promise<void> {
  await performSync();
}

/**
 * Stop the periodic sync timer.
 */
export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
