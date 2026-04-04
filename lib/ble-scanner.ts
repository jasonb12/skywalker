/**
 * BLE Scanner Service — Passive Discovery Mode
 *
 * Scans for ALL nearby BLE devices (not just iBeacons).
 * Tracks every device's identifier, name, RSSI with exponential smoothing,
 * and last-seen timestamp. Provides a live snapshot of the BLE environment
 * that can be used for fingerprint-based indoor positioning.
 *
 * On web, this module is a no-op since BLE is not available.
 */

import { Platform } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────

export interface DiscoveredDevice {
  /** Unique device identifier (platform-assigned UUID on iOS, MAC on Android) */
  id: string;
  /** Advertised local name, if any */
  name: string | null;
  /** Raw RSSI of the most recent reading */
  rawRssi: number;
  /** Exponentially smoothed RSSI */
  smoothedRssi: number;
  /** Estimated distance in meters (from path-loss model) */
  estimatedDistance: number;
  /** Timestamp of the most recent sighting (ms since epoch) */
  lastSeen: number;
  /** Number of times this device has been seen */
  sightings: number;
  /** Whether this looks like an iBeacon */
  isBeacon: boolean;
  /** Service UUIDs advertised, if any */
  serviceUUIDs: string[];
}

export type ScanCallback = (devices: DiscoveredDevice[]) => void;

// ─── Constants ───────────────────────────────────────────────────────

/** RSSI smoothing factor (0–1, lower = smoother) */
const RSSI_ALPHA = 0.3;

/** Path-loss exponent for indoor BLE (free space = 2.0, indoor = 2.5–4.0) */
const PATH_LOSS_N = 2.7;

/** Reference RSSI at 1 meter */
const REF_RSSI_1M = -59;

/** Maximum distance to keep a device in the list (meters) */
const MAX_DISTANCE = 80;

/** Stale device timeout — remove devices not seen for this long (ms) */
const STALE_TIMEOUT_MS = 30_000;

/** How often to emit the device list to the callback (ms) */
const EMIT_INTERVAL_MS = 1_000;

/** Floor RSSI value for devices not seen (used in fingerprint comparison) */
export const RSSI_FLOOR = -100;

// ─── Internal state ─────────────────────────────────────────────────

let isScanning = false;
let scanCallback: ScanCallback | null = null;
let bleManager: any = null;
let emitTimer: ReturnType<typeof setInterval> | null = null;

/** Live device map: deviceId → DiscoveredDevice */
const deviceMap = new Map<string, DiscoveredDevice>();

// ─── Helpers ─────────────────────────────────────────────────────────

function rssiToDistance(rssi: number): number {
  if (rssi >= 0) return MAX_DISTANCE;
  const ratio = (REF_RSSI_1M - rssi) / (10 * PATH_LOSS_N);
  return Math.min(Math.pow(10, ratio), MAX_DISTANCE);
}

function smoothRssi(newRssi: number, prevSmoothed: number | null): number {
  if (prevSmoothed === null) return newRssi;
  return RSSI_ALPHA * newRssi + (1 - RSSI_ALPHA) * prevSmoothed;
}

function pruneStaleDevices(): void {
  const cutoff = Date.now() - STALE_TIMEOUT_MS;
  for (const [id, dev] of deviceMap) {
    if (dev.lastSeen < cutoff) {
      deviceMap.delete(id);
    }
  }
}

function getDeviceList(): DiscoveredDevice[] {
  pruneStaleDevices();
  return Array.from(deviceMap.values())
    .filter((d) => d.estimatedDistance <= MAX_DISTANCE)
    .sort((a, b) => b.smoothedRssi - a.smoothedRssi); // strongest first
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Start continuous BLE scanning for ALL devices.
 * Returns true if scanning started successfully.
 */
export async function startScanning(callback: ScanCallback): Promise<boolean> {
  if (Platform.OS === 'web') {
    console.log('[BLE] BLE scanning not available on web');
    return false;
  }

  if (isScanning) {
    console.log('[BLE] Already scanning');
    scanCallback = callback;
    return true;
  }

  try {
    const { BleManager } = require('react-native-ble-plx');

    if (!bleManager) {
      bleManager = new BleManager();
    }

    // Wait for BLE to power on (up to 5 seconds)
    let state = await bleManager.state();
    if (state !== 'PoweredOn') {
      console.log('[BLE] Waiting for Bluetooth to power on... current:', state);
      await new Promise<void>((resolve) => {
        const sub = bleManager.onStateChange((newState: string) => {
          if (newState === 'PoweredOn') {
            sub.remove();
            resolve();
          }
        }, true);
        // Timeout after 5 seconds
        setTimeout(() => {
          sub.remove();
          resolve();
        }, 5000);
      });
      state = await bleManager.state();
    }

    if (state !== 'PoweredOn') {
      console.warn('[BLE] Bluetooth is not powered on:', state);
      return false;
    }

    scanCallback = callback;
    isScanning = true;
    deviceMap.clear();

    // Start scanning for ALL devices (null = no service UUID filter)
    bleManager.startDeviceScan(
      null,
      { allowDuplicates: true, scanMode: 2 /* LowLatency on Android */ },
      (error: any, device: any) => {
        if (error) {
          console.warn('[BLE] Scan error:', error.message);
          return;
        }
        if (!device) return;

        const deviceId: string = device.id;
        const rssi: number = device.rssi ?? -100;
        const name: string | null = device.localName || device.name || null;
        const serviceUUIDs: string[] = device.serviceUUIDs ?? [];

        // Check if this looks like an iBeacon (has manufacturer data with Apple prefix)
        const isBeacon = !!device.manufacturerData;

        const existing = deviceMap.get(deviceId);
        const smoothed = smoothRssi(rssi, existing?.smoothedRssi ?? null);
        const distance = rssiToDistance(smoothed);

        deviceMap.set(deviceId, {
          id: deviceId,
          name: name || existing?.name || null,
          rawRssi: rssi,
          smoothedRssi: smoothed,
          estimatedDistance: distance,
          lastSeen: Date.now(),
          sightings: (existing?.sightings ?? 0) + 1,
          isBeacon,
          serviceUUIDs: serviceUUIDs.length > 0 ? serviceUUIDs : (existing?.serviceUUIDs ?? []),
        });
      }
    );

    // Periodically emit the device list
    emitTimer = setInterval(() => {
      if (!isScanning || !scanCallback) return;
      const devices = getDeviceList();
      scanCallback(devices);
    }, EMIT_INTERVAL_MS);

    console.log('[BLE] Passive scanning started — discovering all devices');
    return true;
  } catch (err) {
    console.warn('[BLE] Failed to start scanning:', err);
    isScanning = false;
    return false;
  }
}

/**
 * Stop BLE scanning.
 */
export function stopScanning(): void {
  if (!isScanning) return;

  isScanning = false;
  scanCallback = null;

  if (emitTimer) {
    clearInterval(emitTimer);
    emitTimer = null;
  }

  if (bleManager && Platform.OS !== 'web') {
    try {
      bleManager.stopDeviceScan();
    } catch (err) {
      console.warn('[BLE] Error stopping scan:', err);
    }
  }

  console.log('[BLE] Scanning stopped');
}

/**
 * Check if BLE scanning is active.
 */
export function isBleScanning(): boolean {
  return isScanning;
}

/**
 * Get the current snapshot of all discovered devices.
 */
export function getDiscoveredDevices(): DiscoveredDevice[] {
  return getDeviceList();
}

/**
 * Get the current BLE "fingerprint" — a map of deviceId → smoothedRssi
 * for all currently visible devices. This is used for fingerprint matching.
 */
export function getCurrentFingerprint(): Map<string, number> {
  pruneStaleDevices();
  const fp = new Map<string, number>();
  for (const [id, dev] of deviceMap) {
    // Only include devices seen in the last 10 seconds for a fresh fingerprint
    if (Date.now() - dev.lastSeen < 10_000) {
      fp.set(id, dev.smoothedRssi);
    }
  }
  return fp;
}

/**
 * Get the count of currently visible devices.
 */
export function getDeviceCount(): number {
  pruneStaleDevices();
  return deviceMap.size;
}
