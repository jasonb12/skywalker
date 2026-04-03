/**
 * BLE Beacon Scanner Service
 *
 * Scans for iBeacon-compatible BLE beacons in the Minneapolis Skyway.
 * Converts RSSI to distance estimates and matches detected beacons
 * against the known beacon database from Supabase.
 *
 * On web, this module is a no-op since BLE is not available.
 */

import { Platform } from 'react-native';
import type { Beacon, DetectedBeacon } from './types';

// The skyway beacon UUID (all beacons share this)
export const SKYWAY_BEACON_UUID = 'E2C56DB5-DFFB-48D2-B060-D0F5A71096E0';

// Path loss exponent for indoor environments (2.0 = free space, 2.5-4.0 = indoor)
const PATH_LOSS_EXPONENT = 2.7;

// Reference RSSI at 1 meter (calibrated per beacon, default -59)
const DEFAULT_TX_POWER = -59;

// RSSI smoothing factor (exponential moving average, 0-1)
const RSSI_SMOOTHING = 0.3;

// Minimum number of beacons needed for trilateration
export const MIN_BEACONS_FOR_TRILATERATION = 3;

// Maximum distance to consider a beacon relevant (meters)
const MAX_BEACON_DISTANCE = 50;

// Scan interval in milliseconds
const SCAN_INTERVAL_MS = 1000;

/**
 * Convert RSSI to estimated distance in meters using the log-distance path loss model.
 *
 * Formula: distance = 10 ^ ((txPower - rssi) / (10 * n))
 * where n is the path loss exponent
 */
export function rssiToDistance(rssi: number, txPower: number = DEFAULT_TX_POWER): number {
  if (rssi >= 0) return MAX_BEACON_DISTANCE; // invalid RSSI

  const ratio = (txPower - rssi) / (10 * PATH_LOSS_EXPONENT);
  const distance = Math.pow(10, ratio);

  return Math.min(distance, MAX_BEACON_DISTANCE);
}

/**
 * Apply exponential moving average smoothing to RSSI values.
 */
export function smoothRssi(currentRssi: number, previousSmoothed: number | null): number {
  if (previousSmoothed === null) return currentRssi;
  return RSSI_SMOOTHING * currentRssi + (1 - RSSI_SMOOTHING) * previousSmoothed;
}

// Internal state for the scanner
type ScanCallback = (beacons: DetectedBeacon[]) => void;

let isScanning = false;
let scanCallback: ScanCallback | null = null;
let knownBeacons: Beacon[] = [];
let rssiHistory: Map<string, number> = new Map(); // hw_id -> smoothed RSSI
let bleManager: any = null;

/**
 * Initialize the BLE scanner with known beacon data from Supabase.
 */
export function initBleScanner(beacons: Beacon[]): void {
  knownBeacons = beacons;
  rssiHistory.clear();
}

/**
 * Start scanning for BLE beacons.
 * Calls the callback with detected beacons on each scan cycle.
 */
export async function startScanning(callback: ScanCallback): Promise<boolean> {
  if (Platform.OS === 'web') {
    console.log('[BLE] BLE scanning not available on web');
    return false;
  }

  if (isScanning) {
    console.log('[BLE] Already scanning');
    return true;
  }

  try {
    // Dynamic import to avoid web bundling issues
    const { BleManager } = require('react-native-ble-plx');

    if (!bleManager) {
      bleManager = new BleManager();
    }

    // Check BLE state
    const state = await bleManager.state();
    if (state !== 'PoweredOn') {
      console.warn('[BLE] Bluetooth is not powered on:', state);
      return false;
    }

    scanCallback = callback;
    isScanning = true;

    const detectedBeacons: Map<string, DetectedBeacon> = new Map();

    // Start BLE scan
    bleManager.startDeviceScan(
      null, // scan all service UUIDs
      { allowDuplicates: true },
      (error: any, device: any) => {
        if (error) {
          console.warn('[BLE] Scan error:', error.message);
          return;
        }

        if (!device || !device.manufacturerData) return;

        // Parse iBeacon advertisement data
        const ibeacon = parseIBeaconData(device.manufacturerData);
        if (!ibeacon) return;

        // Check if this is a skyway beacon
        if (ibeacon.uuid.toUpperCase() !== SKYWAY_BEACON_UUID) return;

        const hwId = `${ibeacon.uuid}:${ibeacon.major}:${ibeacon.minor}`;
        const rssi = device.rssi ?? -100;

        // Smooth the RSSI
        const previousSmoothed = rssiHistory.get(hwId) ?? null;
        const smoothedRssi = smoothRssi(rssi, previousSmoothed);
        rssiHistory.set(hwId, smoothedRssi);

        // Find matching beacon in database
        const matchedBeacon = knownBeacons.find(
          (b) => b.major === ibeacon.major && b.minor === ibeacon.minor
        );

        const txPower = matchedBeacon?.tx_power ?? DEFAULT_TX_POWER;
        const distance = rssiToDistance(smoothedRssi, txPower);

        if (distance <= MAX_BEACON_DISTANCE) {
          detectedBeacons.set(hwId, {
            hw_id: hwId,
            rssi: smoothedRssi,
            distance,
            beacon: matchedBeacon,
          });
        }
      }
    );

    // Periodically emit the detected beacons
    const emitInterval = setInterval(() => {
      if (!isScanning) {
        clearInterval(emitInterval);
        return;
      }

      const beaconList = Array.from(detectedBeacons.values())
        .filter((b) => b.distance <= MAX_BEACON_DISTANCE)
        .sort((a, b) => a.distance - b.distance);

      if (scanCallback) {
        scanCallback(beaconList);
      }

      // Remove stale beacons (not seen in last 5 seconds)
      // For simplicity, we keep all detected beacons until scan restarts
    }, SCAN_INTERVAL_MS);

    console.log('[BLE] Scanning started');
    return true;
  } catch (err) {
    console.warn('[BLE] Failed to start scanning:', err);
    isScanning = false;
    return false;
  }
}

/**
 * Stop scanning for BLE beacons.
 */
export function stopScanning(): void {
  if (!isScanning) return;

  isScanning = false;
  scanCallback = null;

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
 * Check if BLE scanning is currently active.
 */
export function isBleScanning(): boolean {
  return isScanning;
}

/**
 * Parse iBeacon data from manufacturer-specific data.
 * iBeacon format: Company ID (2 bytes) + Type (1 byte) + Length (1 byte) +
 *                 UUID (16 bytes) + Major (2 bytes) + Minor (2 bytes) + TX Power (1 byte)
 */
function parseIBeaconData(
  manufacturerData: string
): { uuid: string; major: number; minor: number; txPower: number } | null {
  try {
    // Decode base64 manufacturer data
    const bytes = base64ToBytes(manufacturerData);
    if (!bytes || bytes.length < 25) return null;

    // Check for iBeacon prefix (Apple company ID 0x004C, type 0x02, length 0x15)
    const companyId = (bytes[1] << 8) | bytes[0];
    if (companyId !== 0x004c) return null;
    if (bytes[2] !== 0x02 || bytes[3] !== 0x15) return null;

    // Extract UUID (bytes 4-19)
    const uuidParts = [];
    for (let i = 4; i < 20; i++) {
      uuidParts.push(bytes[i].toString(16).padStart(2, '0'));
    }
    const uuid = [
      uuidParts.slice(0, 4).join(''),
      uuidParts.slice(4, 6).join(''),
      uuidParts.slice(6, 8).join(''),
      uuidParts.slice(8, 10).join(''),
      uuidParts.slice(10, 16).join(''),
    ]
      .join('-')
      .toUpperCase();

    // Extract Major (bytes 20-21, big-endian)
    const major = (bytes[20] << 8) | bytes[21];

    // Extract Minor (bytes 22-23, big-endian)
    const minor = (bytes[22] << 8) | bytes[23];

    // Extract TX Power (byte 24, signed)
    const txPower = bytes[24] > 127 ? bytes[24] - 256 : bytes[24];

    return { uuid, major, minor, txPower };
  } catch {
    return null;
  }
}

/**
 * Decode base64 string to byte array.
 */
function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Get the number of known beacons loaded.
 */
export function getKnownBeaconCount(): number {
  return knownBeacons.length;
}
