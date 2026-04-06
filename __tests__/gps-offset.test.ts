import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the BLE modules so they don't fail in test
vi.mock('../lib/ble-fingerprint-store', () => ({
  captureFingerprint: vi.fn(() => true),
}));

vi.mock('../lib/ble-scanner', () => ({
  getCurrentFingerprint: vi.fn(() => new Map([
    ['AA:BB:CC:DD:EE:FF', -65],
    ['11:22:33:44:55:66', -72],
  ])),
}));

import {
  applyUserCorrection,
  applyOffset,
  getActiveOffset,
  getOffsetDecayFactor,
  clearOffset,
  hasActiveOffset,
} from '../lib/gps-offset';

describe('GPS Offset Engine', () => {
  beforeEach(() => {
    clearOffset();
  });

  describe('applyUserCorrection', () => {
    it('should apply a valid correction and return success', () => {
      const result = applyUserCorrection(
        44.9778, -93.2650, 50,  // GPS position (accuracy 50m)
        44.9780, -93.2655,      // User-indicated position
      );

      expect(result.success).toBe(true);
      expect(result.offset).not.toBeNull();
      expect(result.offset!.latDelta).toBeCloseTo(0.0002, 4);
      expect(result.offset!.lngDelta).toBeCloseTo(-0.0005, 4);
      expect(result.offset!.correctedLat).toBe(44.9780);
      expect(result.offset!.correctedLng).toBe(-93.2655);
    });

    it('should capture a BLE fingerprint at the corrected position', () => {
      const result = applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
      );

      expect(result.success).toBe(true);
      expect(result.fingerprintCaptured).toBe(true);
      expect(result.bleDeviceCount).toBe(2);
    });

    it('should reject corrections that are too far (>500m)', () => {
      const result = applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9900, -93.2650,  // ~1.3km away
      );

      expect(result.success).toBe(false);
      expect(result.offset).toBeNull();
    });

    it('should set the active offset after correction', () => {
      expect(hasActiveOffset()).toBe(false);

      applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
      );

      expect(hasActiveOffset()).toBe(true);
      const offset = getActiveOffset();
      expect(offset).not.toBeNull();
      expect(offset!.correctedLat).toBe(44.9780);
    });
  });

  describe('applyOffset', () => {
    it('should return raw position when no offset is active', () => {
      const result = applyOffset(44.9778, -93.2650);

      expect(result.lat).toBe(44.9778);
      expect(result.lng).toBe(-93.2650);
      expect(result.hasOffset).toBe(false);
      expect(result.decayFactor).toBe(0);
    });

    it('should apply full offset immediately after correction', () => {
      applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
      );

      // Apply offset to the same GPS position — should get close to user-indicated
      const result = applyOffset(44.9778, -93.2650);

      expect(result.hasOffset).toBe(true);
      expect(result.decayFactor).toBeGreaterThan(0.99); // Nearly 1.0 immediately
      expect(result.lat).toBeCloseTo(44.9780, 4);
      expect(result.lng).toBeCloseTo(-93.2655, 4);
    });

    it('should decay the offset over time', () => {
      applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
        1000, // 1 second decay for testing
      );

      // Immediately: full offset
      const immediate = applyOffset(44.9778, -93.2650);
      expect(immediate.decayFactor).toBeGreaterThan(0.9);

      // Simulate time passing by manipulating the offset timestamp
      const offset = getActiveOffset()!;
      // Hack: modify timestamp to simulate 2 seconds ago
      (offset as any).timestamp = Date.now() - 2000;

      const later = applyOffset(44.9778, -93.2650);
      expect(later.decayFactor).toBeLessThan(0.2); // e^(-2) ≈ 0.135
      // Offset should be partially applied
      expect(later.lat).toBeGreaterThan(44.9778);
      expect(later.lat).toBeLessThan(44.9780);
    });
  });

  describe('getOffsetDecayFactor', () => {
    it('should return 0 when no offset is active', () => {
      expect(getOffsetDecayFactor()).toBe(0);
    });

    it('should return close to 1.0 immediately after correction', () => {
      applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
      );

      expect(getOffsetDecayFactor()).toBeGreaterThan(0.99);
    });
  });

  describe('clearOffset', () => {
    it('should clear the active offset', () => {
      applyUserCorrection(
        44.9778, -93.2650, 50,
        44.9780, -93.2655,
      );

      expect(hasActiveOffset()).toBe(true);
      clearOffset();
      expect(hasActiveOffset()).toBe(false);
      expect(getActiveOffset()).toBeNull();
    });
  });
});
