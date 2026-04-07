import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock AsyncStorage ──────────────────────────────────────────────
const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete store[key];
    }),
  },
}));

// Mock ble-scanner for RSSI_FLOOR
vi.mock('../lib/ble-scanner', () => ({
  RSSI_FLOOR: -100,
}));

// Mock fingerprint-sync (no actual network calls)
vi.mock('../lib/fingerprint-sync', () => ({
  uploadFingerprints: vi.fn(async () => 0),
  downloadFingerprints: vi.fn(async () => []),
  getRemoteFingerprintCount: vi.fn(async () => 0),
}));

import {
  captureFingerprint,
  estimatePosition,
  getFingerprintCount,
  getAllFingerprints,
  clearFingerprints,
  getFingerprintLocations,
} from '../lib/ble-fingerprint-store';

function makeScan(devices: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(devices));
}

describe('BLE Fingerprint Store', () => {
  beforeEach(async () => {
    for (const key of Object.keys(store)) delete store[key];
    await clearFingerprints();
  });

  // ─── Capture ──────────────────────────────────────────────────────

  describe('captureFingerprint', () => {
    it('should capture a fingerprint when GPS is accurate and enough devices are visible', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      const result = captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      expect(result).toBe(true);
      expect(getFingerprintCount()).toBe(1);
    });

    it('should reject capture when GPS accuracy is too poor (auto mode)', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      // GPS accuracy 20m > threshold of 15m for auto
      const result = captureFingerprint(44.9778, -93.2650, 20, scan, 'auto');

      expect(result).toBe(false);
      expect(getFingerprintCount()).toBe(0);
    });

    it('should allow poor GPS accuracy in calibration mode (up to 50m)', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      // GPS accuracy 30m > 15m auto threshold, but < 50m calibration threshold
      const result = captureFingerprint(44.9778, -93.2650, 30, scan, 'calibration');

      expect(result).toBe(true);
      expect(getFingerprintCount()).toBe(1);
    });

    it('should reject capture when too few BLE devices are visible', () => {
      const scan = makeScan({ dev1: -55, dev2: -60 }); // Only 2, need 3
      const result = captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      expect(result).toBe(false);
    });

    it('should enforce minimum spacing for auto captures', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });

      // First capture succeeds
      const r1 = captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');
      expect(r1).toBe(true);

      // Second capture at nearly the same location should fail (< 5m spacing)
      const r2 = captureFingerprint(44.97781, -93.26501, 10, scan, 'auto');
      expect(r2).toBe(false);
      expect(getFingerprintCount()).toBe(1);
    });

    it('should allow closer spacing for calibration captures', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });

      // First capture
      captureFingerprint(44.9778, -93.2650, 10, scan, 'calibration');

      // Second capture very close (within 5m but > 2m)
      // ~3m away (approx 0.00003 degrees lat)
      const r2 = captureFingerprint(44.97783, -93.2650, 10, scan, 'calibration');
      expect(r2).toBe(true);
      expect(getFingerprintCount()).toBe(2);
    });

    it('should store the correct device RSSI values', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70, dev4: -80 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      const fps = getAllFingerprints();
      expect(fps.length).toBe(1);
      expect(fps[0].devices['dev1']).toBe(-55);
      expect(fps[0].devices['dev2']).toBe(-60);
      expect(fps[0].devices['dev3']).toBe(-70);
      expect(fps[0].devices['dev4']).toBe(-80);
      expect(fps[0].deviceCount).toBe(4);
    });

    it('should tag fingerprints with the correct source', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });

      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');
      captureFingerprint(44.9800, -93.2700, 10, scan, 'calibration');

      const fps = getAllFingerprints();
      expect(fps[0].source).toBe('auto');
      expect(fps[1].source).toBe('calibration');
    });
  });

  // ─── Position Estimation (WKNN) ──────────────────────────────────

  describe('estimatePosition', () => {
    it('should return null when no fingerprints exist', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      const result = estimatePosition(scan);
      expect(result).toBeNull();
    });

    it('should return null when live scan has too few devices', () => {
      // Add a fingerprint first
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      // Try to estimate with only 1 device
      const liveScan = makeScan({ dev1: -55 });
      const result = estimatePosition(liveScan);
      expect(result).toBeNull();
    });

    it('should estimate position from a single matching fingerprint', () => {
      // Capture a fingerprint at a known location
      const captureScan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, captureScan, 'auto');

      // Estimate with similar signal strengths
      const liveScan = makeScan({ dev1: -56, dev2: -61, dev3: -71 });
      const result = estimatePosition(liveScan);

      expect(result).not.toBeNull();
      expect(result!.latitude).toBeCloseTo(44.9778, 3);
      expect(result!.longitude).toBeCloseTo(-93.2650, 3);
      expect(result!.matchCount).toBe(1);
    });

    it('should weight closer signal matches more heavily', () => {
      const scan1 = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      const scan2 = makeScan({ dev1: -75, dev2: -80, dev3: -90 });

      // Fingerprint A: close signals at location A
      captureFingerprint(44.9770, -93.2640, 10, scan1, 'auto');
      // Fingerprint B: far signals at location B (far enough away)
      captureFingerprint(44.9800, -93.2700, 10, scan2, 'auto');

      // Live scan is close to fingerprint A's signals
      const liveScan = makeScan({ dev1: -56, dev2: -61, dev3: -71 });
      const result = estimatePosition(liveScan);

      expect(result).not.toBeNull();
      // Should be closer to location A (44.977) than location B (44.980)
      expect(result!.latitude).toBeLessThan(44.979);
    });

    it('should give calibration fingerprints higher weight (1.5x bonus)', () => {
      // Auto fingerprint at location A
      const scanA = makeScan({ dev1: -60, dev2: -65, dev3: -70 });
      captureFingerprint(44.9770, -93.2640, 10, scanA, 'auto');

      // Calibration fingerprint at location B with same signal profile
      const scanB = makeScan({ dev1: -60, dev2: -65, dev3: -70 });
      captureFingerprint(44.9800, -93.2700, 5, scanB, 'calibration');

      // Live scan matches both equally in signal distance
      const liveScan = makeScan({ dev1: -60, dev2: -65, dev3: -70 });
      const result = estimatePosition(liveScan);

      expect(result).not.toBeNull();
      // Should lean toward calibration fingerprint (location B) due to 1.5x weight
      expect(result!.latitude).toBeGreaterThan(44.978);
    });

    it('should require at least 2 common devices for a match', () => {
      // Fingerprint with devices A, B, C
      const captureScan = makeScan({ devA: -55, devB: -60, devC: -70 });
      captureFingerprint(44.9778, -93.2650, 10, captureScan, 'auto');

      // Live scan with only 1 overlapping device (devA) and 2 different ones
      const liveScan = makeScan({ devA: -56, devX: -60, devY: -70 });
      const result = estimatePosition(liveScan);

      // Only 1 common device (devA), below MIN_COMMON_DEVICES=2
      expect(result).toBeNull();
    });

    it('should return accuracy and matchCount in the result', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      const liveScan = makeScan({ dev1: -56, dev2: -61, dev3: -71 });
      const result = estimatePosition(liveScan);

      expect(result).not.toBeNull();
      expect(result!.accuracy).toBeGreaterThan(0);
      expect(result!.accuracy).toBeLessThanOrEqual(50);
      expect(result!.matchCount).toBeGreaterThanOrEqual(1);
      expect(result!.avgSignalDistance).toBeGreaterThan(0);
    });
  });

  // ─── Utility Functions ────────────────────────────────────────────

  describe('utility functions', () => {
    it('getFingerprintCount should return the correct count', () => {
      expect(getFingerprintCount()).toBe(0);

      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');
      expect(getFingerprintCount()).toBe(1);

      captureFingerprint(44.9800, -93.2700, 10, scan, 'calibration');
      expect(getFingerprintCount()).toBe(2);
    });

    it('getAllFingerprints should return a copy of the array', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');

      const fps = getAllFingerprints();
      expect(fps.length).toBe(1);

      // Modifying the returned array should not affect the store
      fps.pop();
      expect(getAllFingerprints().length).toBe(1);
    });

    it('getFingerprintLocations should return lightweight location objects', () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'calibration');

      const locations = getFingerprintLocations();
      expect(locations.length).toBe(1);
      expect(locations[0].latitude).toBe(44.9778);
      expect(locations[0].longitude).toBe(-93.2650);
      expect(locations[0].deviceCount).toBe(3);
      expect(locations[0].source).toBe('calibration');
    });

    it('clearFingerprints should remove all fingerprints', async () => {
      const scan = makeScan({ dev1: -55, dev2: -60, dev3: -70 });
      captureFingerprint(44.9778, -93.2650, 10, scan, 'auto');
      captureFingerprint(44.9800, -93.2700, 10, scan, 'calibration');
      expect(getFingerprintCount()).toBe(2);

      await clearFingerprints();
      expect(getFingerprintCount()).toBe(0);
      expect(getAllFingerprints()).toEqual([]);
    });
  });
});
