/**
 * Correction History
 *
 * Stores past GPS position corrections made by the user via "Fix Position".
 * Each correction records the GPS-reported position, the user-indicated (snapped)
 * position, the offset distance, BLE device count, and whether snapping occurred.
 *
 * History is persisted in AsyncStorage and displayed in the History tab.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────

export interface CorrectionRecord {
  /** Unique ID */
  id: string;
  /** Timestamp of the correction */
  timestamp: number;
  /** GPS-reported position */
  gpsLat: number;
  gpsLng: number;
  gpsAccuracy: number;
  /** User-indicated position (after snap if applicable) */
  correctedLat: number;
  correctedLng: number;
  /** Distance between GPS and corrected position (meters) */
  offsetDistanceMeters: number;
  /** Whether the position was snapped to a skyway path */
  snappedToSkyway: boolean;
  /** Distance from user tap to the snapped skyway point (meters) */
  snapDistanceMeters: number;
  /** Color of the nearest skyway segment (if snapped) */
  skywayColor: string | null;
  /** Number of BLE devices detected at correction time */
  bleDeviceCount: number;
  /** Whether a BLE fingerprint was captured */
  fingerprintCaptured: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

const STORAGE_KEY = '@skywalker/correction-history';
const MAX_RECORDS = 100;

// ─── In-memory cache ─────────────────────────────────────────────────

let records: CorrectionRecord[] = [];
let loaded = false;

// ─── Storage ─────────────────────────────────────────────────────────

async function loadRecords(): Promise<CorrectionRecord[]> {
  if (loaded) return records;

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      records = JSON.parse(raw) as CorrectionRecord[];
    }
  } catch (e) {
    console.warn('[CorrectionHistory] Failed to load:', e);
    records = [];
  }

  loaded = true;
  return records;
}

async function saveRecords(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[CorrectionHistory] Failed to save:', e);
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Add a new correction record.
 */
export async function addCorrectionRecord(record: Omit<CorrectionRecord, 'id'>): Promise<CorrectionRecord> {
  await loadRecords();

  const newRecord: CorrectionRecord = {
    ...record,
    id: `correction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  // Prepend (newest first) and cap at MAX_RECORDS
  records = [newRecord, ...records].slice(0, MAX_RECORDS);
  await saveRecords();

  console.log(
    `[CorrectionHistory] Saved correction: offset=${record.offsetDistanceMeters.toFixed(1)}m, ` +
    `snapped=${record.snappedToSkyway}, ble=${record.bleDeviceCount}`
  );

  return newRecord;
}

/**
 * Get all correction records (newest first).
 */
export async function getCorrectionHistory(): Promise<CorrectionRecord[]> {
  return loadRecords();
}

/**
 * Get the count of correction records.
 */
export async function getCorrectionCount(): Promise<number> {
  await loadRecords();
  return records.length;
}

/**
 * Clear all correction history.
 */
export async function clearCorrectionHistory(): Promise<void> {
  records = [];
  loaded = true;
  await saveRecords();
  console.log('[CorrectionHistory] History cleared');
}
