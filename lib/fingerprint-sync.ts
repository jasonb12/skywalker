/**
 * Fingerprint Sync Service
 *
 * Syncs BLE fingerprints between local AsyncStorage and Supabase.
 * - Uploads locally captured fingerprints to Supabase for community sharing
 * - Downloads community fingerprints from Supabase to improve local positioning
 * - Deduplicates by fingerprint ID to avoid conflicts
 * - Runs periodically in the background
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { BleFingerprint } from './ble-fingerprint-store';

// ─── Constants ───────────────────────────────────────────────────────

const SYNC_STATE_KEY = '@skywalker/fp_sync_state';
const UPLOAD_BATCH_SIZE = 50;
const DOWNLOAD_BATCH_SIZE = 200;

interface SyncState {
  /** Timestamp of last successful upload */
  lastUploadAt: number;
  /** Timestamp of last successful download */
  lastDownloadAt: number;
  /** IDs of fingerprints already uploaded */
  uploadedIds: string[];
}

let syncState: SyncState = {
  lastUploadAt: 0,
  lastDownloadAt: 0,
  uploadedIds: [],
};

let syncStateLoaded = false;

// ─── Persistence ─────────────────────────────────────────────────────

async function loadSyncState(): Promise<void> {
  if (syncStateLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(SYNC_STATE_KEY);
    if (raw) {
      syncState = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[FP-Sync] Failed to load sync state:', e);
  }
  syncStateLoaded = true;
}

async function saveSyncState(): Promise<void> {
  try {
    await AsyncStorage.setItem(SYNC_STATE_KEY, JSON.stringify(syncState));
  } catch (e) {
    console.warn('[FP-Sync] Failed to save sync state:', e);
  }
}

// ─── Upload ──────────────────────────────────────────────────────────

/**
 * Upload local fingerprints to Supabase that haven't been uploaded yet.
 * Returns the number of fingerprints uploaded.
 */
export async function uploadFingerprints(
  localFingerprints: BleFingerprint[],
  deviceId?: string
): Promise<number> {
  await loadSyncState();

  const uploadedSet = new Set(syncState.uploadedIds);
  const toUpload = localFingerprints.filter((fp) => !uploadedSet.has(fp.id));

  if (toUpload.length === 0) {
    console.log('[FP-Sync] No new fingerprints to upload');
    return 0;
  }

  let totalUploaded = 0;

  // Upload in batches
  for (let i = 0; i < toUpload.length; i += UPLOAD_BATCH_SIZE) {
    const batch = toUpload.slice(i, i + UPLOAD_BATCH_SIZE);
    const rows = batch.map((fp) => ({
      id: fp.id,
      latitude: fp.latitude,
      longitude: fp.longitude,
      gps_accuracy: fp.gpsAccuracy,
      devices: fp.devices,
      device_count: fp.deviceCount,
      source: (fp as any).source ?? 'auto',
      device_id: deviceId ?? null,
      created_at: new Date(fp.timestamp).toISOString(),
    }));

    try {
      const { error } = await supabase
        .from('ble_fingerprints')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

      if (error) {
        console.warn('[FP-Sync] Upload batch error:', error.message);
        continue;
      }

      // Track uploaded IDs
      for (const fp of batch) {
        syncState.uploadedIds.push(fp.id);
      }
      totalUploaded += batch.length;
    } catch (e) {
      console.warn('[FP-Sync] Upload exception:', e);
    }
  }

  if (totalUploaded > 0) {
    syncState.lastUploadAt = Date.now();
    // Keep uploadedIds list manageable (max 5000)
    if (syncState.uploadedIds.length > 5000) {
      syncState.uploadedIds = syncState.uploadedIds.slice(-3000);
    }
    await saveSyncState();
    console.log(`[FP-Sync] Uploaded ${totalUploaded} fingerprints to Supabase`);
  }

  return totalUploaded;
}

// ─── Download ────────────────────────────────────────────────────────

/**
 * Download community fingerprints from Supabase.
 * Returns fingerprints that are newer than the last download.
 */
export async function downloadFingerprints(
  existingIds: Set<string>
): Promise<BleFingerprint[]> {
  await loadSyncState();

  const downloaded: BleFingerprint[] = [];
  let offset = 0;
  let hasMore = true;

  // Only fetch fingerprints created after our last download
  const since = syncState.lastDownloadAt > 0
    ? new Date(syncState.lastDownloadAt - 60_000).toISOString() // 1 min overlap for safety
    : new Date(0).toISOString();

  while (hasMore) {
    try {
      const { data, error } = await supabase
        .from('ble_fingerprints')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(offset, offset + DOWNLOAD_BATCH_SIZE - 1);

      if (error) {
        console.warn('[FP-Sync] Download error:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        // Skip fingerprints we already have locally
        if (existingIds.has(row.id)) continue;

        downloaded.push({
          id: row.id,
          latitude: row.latitude,
          longitude: row.longitude,
          gpsAccuracy: row.gps_accuracy,
          devices: row.devices as Record<string, number>,
          deviceCount: row.device_count,
          timestamp: new Date(row.created_at).getTime(),
        });
      }

      offset += data.length;
      if (data.length < DOWNLOAD_BATCH_SIZE) {
        hasMore = false;
      }
    } catch (e) {
      console.warn('[FP-Sync] Download exception:', e);
      break;
    }
  }

  if (downloaded.length > 0) {
    syncState.lastDownloadAt = Date.now();
    await saveSyncState();
    console.log(`[FP-Sync] Downloaded ${downloaded.length} community fingerprints from Supabase`);
  }

  return downloaded;
}

/**
 * Get the total count of fingerprints in Supabase.
 */
export async function getRemoteFingerprintCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('ble_fingerprints')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.warn('[FP-Sync] Count error:', error.message);
      return 0;
    }

    return count ?? 0;
  } catch (e) {
    console.warn('[FP-Sync] Count exception:', e);
    return 0;
  }
}

/**
 * Get all fingerprint locations from Supabase (for heatmap).
 * Returns lightweight objects with just lat/lng/deviceCount.
 */
export async function getHeatmapData(): Promise<
  Array<{ latitude: number; longitude: number; deviceCount: number; source: string }>
> {
  try {
    const { data, error } = await supabase
      .from('ble_fingerprints')
      .select('latitude, longitude, device_count, source')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      console.warn('[FP-Sync] Heatmap data error:', error.message);
      return [];
    }

    return (data ?? []).map((row) => ({
      latitude: row.latitude,
      longitude: row.longitude,
      deviceCount: row.device_count,
      source: row.source,
    }));
  } catch (e) {
    console.warn('[FP-Sync] Heatmap data exception:', e);
    return [];
  }
}

/**
 * Reset sync state (useful for debugging).
 */
export async function resetSyncState(): Promise<void> {
  syncState = { lastUploadAt: 0, lastDownloadAt: 0, uploadedIds: [] };
  syncStateLoaded = true;
  await saveSyncState();
  console.log('[FP-Sync] Sync state reset');
}
