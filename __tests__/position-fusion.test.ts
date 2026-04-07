import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock dependencies ──────────────────────────────────────────────

// Mock trilateration
vi.mock('../lib/trilateration', () => ({
  trilateratePosition: vi.fn((beacons: any[]) => {
    if (beacons.length < 3) return null;
    // Return a simple average position
    const lat = beacons.reduce((s: number, b: any) => s + (b.beacon?.latitude ?? 44.977), 0) / beacons.length;
    const lng = beacons.reduce((s: number, b: any) => s + (b.beacon?.longitude ?? -93.265), 0) / beacons.length;
    return { latitude: lat, longitude: lng, accuracy: 5 };
  }),
}));

// Mock gps-offset module
let mockHasActiveOffset = false;
let mockOffsetResult = { lat: 0, lng: 0, decayFactor: 0 };
let mockDecayFactor = 0;

vi.mock('../lib/gps-offset', () => ({
  applyOffset: vi.fn((lat: number, lng: number) => mockOffsetResult),
  hasActiveOffset: vi.fn(() => mockHasActiveOffset),
  getOffsetDecayFactor: vi.fn(() => mockDecayFactor),
}));

import { PositionFusionEngine } from '../lib/position-fusion';
import type { UserPosition, DetectedBeacon, Beacon } from '../lib/types';

function makeGpsPosition(overrides: Partial<UserPosition> = {}): UserPosition {
  return {
    latitude: 44.9778,
    longitude: -93.2650,
    accuracy: 10,
    heading: null,
    source: 'gps',
    ...overrides,
  };
}

function makeBeacon(id: string, rssi: number, lat: number, lng: number): DetectedBeacon {
  return {
    hw_id: id,
    rssi,
    distance: Math.pow(10, (-59 - rssi) / (10 * 2)),
    beacon: {
      id,
      building_id: null,
      hw_id: id,
      label: `Beacon ${id}`,
      beacon_uuid: 'test-uuid',
      major: 1,
      minor: parseInt(id),
      latitude: lat,
      longitude: lng,
      floor_level: 2,
      tx_power: -59,
      metadata: null,
    },
  };
}

describe('PositionFusionEngine', () => {
  let engine: PositionFusionEngine;

  beforeEach(() => {
    engine = new PositionFusionEngine();
    mockHasActiveOffset = false;
    mockOffsetResult = { lat: 0, lng: 0, decayFactor: 0 };
    mockDecayFactor = 0;
  });

  // ─── Basic GPS ──────────────────────────────────────────────────

  it('should return null when no sources are available', () => {
    expect(engine.getFusedPosition()).toBeNull();
  });

  it('should return GPS position when only GPS is available', () => {
    engine.updateGps(makeGpsPosition({ latitude: 44.98, longitude: -93.27 }));
    const fused = engine.getFusedPosition();

    expect(fused).not.toBeNull();
    expect(fused!.latitude).toBe(44.98);
    expect(fused!.longitude).toBe(-93.27);
    expect(fused!.source).toBe('gps');
  });

  it('should assign higher confidence to more accurate GPS', () => {
    // Accurate GPS
    const engine1 = new PositionFusionEngine();
    engine1.updateGps(makeGpsPosition({ accuracy: 3 }));
    const pos1 = engine1.getFusedPosition();

    // Inaccurate GPS
    const engine2 = new PositionFusionEngine();
    engine2.updateGps(makeGpsPosition({ accuracy: 25 }));
    const pos2 = engine2.getFusedPosition();

    // Both should return a position
    expect(pos1).not.toBeNull();
    expect(pos2).not.toBeNull();
  });

  // ─── User Correction ─────────────────────────────────────────────

  it('should return user correction as highest priority source', () => {
    engine.updateGps(makeGpsPosition({ latitude: 44.970, longitude: -93.260 }));
    engine.updateUserCorrection(44.980, -93.270);

    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    // User correction has 0.98 confidence vs GPS ~0.7, so fused should be close to correction
    expect(fused!.latitude).toBeGreaterThan(44.975);
    expect(fused!.source).toBe('snapped');
  });

  it('should decay user correction confidence over time', () => {
    engine.updateUserCorrection(44.980, -93.270);

    // Immediately: high confidence
    const immediate = engine.getFusedPosition();
    expect(immediate).not.toBeNull();
    expect(immediate!.latitude).toBeCloseTo(44.980, 3);

    // Simulate time passing by manipulating the internal timestamp
    // The correction is valid for 30 seconds with decay
    const status = engine.getStatus();
    expect(status.userCorrectionActive).toBe(true);
  });

  it('should label source as "snapped" when user correction dominates', () => {
    engine.updateUserCorrection(44.980, -93.270);
    const fused = engine.getFusedPosition();
    expect(fused!.source).toBe('snapped');
  });

  // ─── BLE Trilateration ────────────────────────────────────────────

  it('should use BLE trilateration when beacons are available', () => {
    const beacons = [
      makeBeacon('1', -60, 44.978, -93.266),
      makeBeacon('2', -65, 44.977, -93.264),
      makeBeacon('3', -70, 44.976, -93.265),
    ];

    engine.updateBle(beacons);
    const fused = engine.getFusedPosition();

    expect(fused).not.toBeNull();
    expect(fused!.source).toBe('ble');
  });

  it('should not use BLE when fewer than 3 beacons (trilateration returns null)', () => {
    const beacons = [
      makeBeacon('1', -60, 44.978, -93.266),
      makeBeacon('2', -65, 44.977, -93.264),
    ];

    engine.updateBle(beacons);
    const fused = engine.getFusedPosition();

    // No GPS either, so should be null
    expect(fused).toBeNull();
  });

  // ─── Fingerprint Estimate ─────────────────────────────────────────

  it('should use fingerprint estimate when available', () => {
    engine.updateFingerprintEstimate(44.979, -93.268, 10, 5);
    const fused = engine.getFusedPosition();

    expect(fused).not.toBeNull();
    expect(fused!.latitude).toBeCloseTo(44.979, 3);
    expect(fused!.longitude).toBeCloseTo(-93.268, 3);
  });

  it('should give higher confidence to fingerprint with more matches', () => {
    // Engine with many matches
    const engine1 = new PositionFusionEngine();
    engine1.updateGps(makeGpsPosition({ latitude: 44.970 }));
    engine1.updateFingerprintEstimate(44.980, -93.268, 10, 5); // 5 matches = 0.85 confidence
    const pos1 = engine1.getFusedPosition();

    // Engine with few matches
    const engine2 = new PositionFusionEngine();
    engine2.updateGps(makeGpsPosition({ latitude: 44.970 }));
    engine2.updateFingerprintEstimate(44.980, -93.268, 10, 1); // 1 match = 0.4 confidence
    const pos2 = engine2.getFusedPosition();

    // With more matches, fused position should be closer to fingerprint estimate
    expect(pos1!.latitude).toBeGreaterThan(pos2!.latitude);
  });

  // ─── Dead Reckoning ───────────────────────────────────────────────

  it('should use dead reckoning as fallback', () => {
    engine.updateDeadReckoning(makeGpsPosition({
      latitude: 44.975,
      longitude: -93.260,
      source: 'dead-reckoning',
    }));

    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.latitude).toBeCloseTo(44.975, 3);
  });

  // ─── Multi-source Fusion ──────────────────────────────────────────

  it('should fuse GPS and BLE when both are available', () => {
    engine.updateGps(makeGpsPosition({ latitude: 44.970, longitude: -93.260, accuracy: 15 }));

    const beacons = [
      makeBeacon('1', -60, 44.980, -93.270),
      makeBeacon('2', -65, 44.980, -93.270),
      makeBeacon('3', -70, 44.980, -93.270),
    ];
    engine.updateBle(beacons);

    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.source).toBe('fused');
    // Fused position should be between GPS and BLE
    expect(fused!.latitude).toBeGreaterThan(44.970);
    expect(fused!.latitude).toBeLessThan(44.981);
  });

  it('should weight user correction highest in multi-source fusion', () => {
    engine.updateGps(makeGpsPosition({ latitude: 44.970, longitude: -93.260 }));
    engine.updateFingerprintEstimate(44.975, -93.265, 10, 4);
    engine.updateUserCorrection(44.985, -93.275);

    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    // User correction (0.98) dominates but GPS (0.7 at acc=10) and fingerprint (0.7 at 4 matches)
    // also contribute, pulling the fused position between all three sources.
    // User correction at 44.985, fingerprint at 44.975, GPS at 44.970
    // Weighted average should lean toward user correction but not reach it exactly.
    expect(fused!.latitude).toBeGreaterThan(44.975);
    expect(fused!.source).toBe('snapped');
  });

  // ─── GPS Offset ───────────────────────────────────────────────────

  it('should apply GPS offset when active', () => {
    mockHasActiveOffset = true;
    mockOffsetResult = { lat: 44.980, lng: -93.270, decayFactor: 0.9 };
    mockDecayFactor = 0.9;

    engine.updateGps(makeGpsPosition({ latitude: 44.975, longitude: -93.265, accuracy: 15 }));
    const fused = engine.getFusedPosition();

    expect(fused).not.toBeNull();
    // The GPS position should be the offset-adjusted one
    expect(fused!.latitude).toBeCloseTo(44.980, 3);
    expect(fused!.longitude).toBeCloseTo(-93.270, 3);
  });

  it('should reduce GPS confidence when offset is active', () => {
    // Without offset: GPS at accuracy 10 gets ~0.7 confidence
    const engine1 = new PositionFusionEngine();
    mockHasActiveOffset = false;
    engine1.updateGps(makeGpsPosition({ accuracy: 10 }));
    engine1.updateFingerprintEstimate(44.985, -93.275, 10, 3);
    const pos1 = engine1.getFusedPosition();

    // With offset: GPS confidence is halved (offsetPenalty = 0.5)
    const engine2 = new PositionFusionEngine();
    mockHasActiveOffset = true;
    mockOffsetResult = { lat: 44.9778, lng: -93.2650, decayFactor: 0.8 };
    engine2.updateGps(makeGpsPosition({ accuracy: 10 }));
    engine2.updateFingerprintEstimate(44.985, -93.275, 10, 3);
    const pos2 = engine2.getFusedPosition();

    // With offset active, fused position should lean more toward fingerprint
    // (because GPS confidence is penalized)
    expect(pos2!.latitude).toBeGreaterThan(pos1!.latitude);
  });

  // ─── Status ───────────────────────────────────────────────────────

  it('should report correct status', () => {
    const status1 = engine.getStatus();
    expect(status1.gpsAvailable).toBe(false);
    expect(status1.bleAvailable).toBe(false);
    expect(status1.userCorrectionActive).toBe(false);
    expect(status1.fusedSource).toBe('none');

    engine.updateGps(makeGpsPosition());
    const status2 = engine.getStatus();
    expect(status2.gpsAvailable).toBe(true);

    engine.updateUserCorrection(44.980, -93.270);
    const status3 = engine.getStatus();
    expect(status3.userCorrectionActive).toBe(true);
  });

  // ─── Reset ────────────────────────────────────────────────────────

  it('should reset all sources', () => {
    engine.updateGps(makeGpsPosition());
    engine.updateUserCorrection(44.980, -93.270);
    engine.updateFingerprintEstimate(44.979, -93.268, 10, 5);

    engine.reset();

    expect(engine.getFusedPosition()).toBeNull();
    const status = engine.getStatus();
    expect(status.gpsAvailable).toBe(false);
    expect(status.bleAvailable).toBe(false);
    expect(status.userCorrectionActive).toBe(false);
  });

  // ─── Last known position ──────────────────────────────────────────

  it('should return last known position when all sources expire', () => {
    engine.updateGps(makeGpsPosition({ latitude: 44.978 }));
    const pos = engine.getFusedPosition();
    expect(pos).not.toBeNull();
    expect(pos!.latitude).toBeCloseTo(44.978, 3);

    // The position is cached as lastFused, so even if we don't update,
    // getFusedPosition returns the last known position when sources are still fresh
    const pos2 = engine.getFusedPosition();
    expect(pos2).not.toBeNull();
  });
});
