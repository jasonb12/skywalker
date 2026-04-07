import { describe, it, expect } from 'vitest';
// Define __DEV__ global for Expo modules in vitest environment
(globalThis as any).__DEV__ = true;

import { trilateratePosition, lngToMeters, latToMeters, metersToLat, metersToLng } from '../lib/trilateration';
import { PositionFusionEngine } from '../lib/position-fusion';
import type { DetectedBeacon, UserPosition, Beacon } from '../lib/types';
import { navigationReducer, initialState } from '../lib/navigation-store';

// ============ Trilateration Tests ============

function makeBeacon(lat: number, lng: number, major: number, minor: number): Beacon {
  return {
    id: `b-${major}-${minor}`,
    building_id: null,
    hw_id: `UUID:${major}:${minor}`,
    label: `Beacon ${major}:${minor}`,
    beacon_uuid: 'E2C56DB5-DFFB-48D2-B060-D0F5A71096E0',
    major,
    minor,
    latitude: lat,
    longitude: lng,
    floor_level: 2,
    tx_power: -59,
    metadata: null,
  };
}

function makeDetected(beacon: Beacon, distance: number): DetectedBeacon {
  return {
    hw_id: beacon.hw_id,
    rssi: -60,
    distance,
    beacon,
  };
}

describe('trilateratePosition', () => {
  it('returns null with no beacons', () => {
    expect(trilateratePosition([])).toBeNull();
  });

  it('returns beacon position for single beacon', () => {
    const b = makeBeacon(44.975, -93.271, 1, 1);
    const result = trilateratePosition([makeDetected(b, 5)]);
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(44.975, 3);
    expect(result!.longitude).toBeCloseTo(-93.271, 3);
    expect(result!.accuracy).toBeGreaterThanOrEqual(5);
  });

  it('returns weighted midpoint for two beacons', () => {
    const b1 = makeBeacon(44.975, -93.271, 1, 1);
    const b2 = makeBeacon(44.976, -93.271, 1, 2);
    const result = trilateratePosition([
      makeDetected(b1, 2),
      makeDetected(b2, 8),
    ]);
    expect(result).not.toBeNull();
    // Closer to b1 since it has smaller distance
    expect(result!.latitude).toBeLessThan(44.9758);
    expect(result!.latitude).toBeGreaterThan(44.975);
  });

  it('estimates position from three beacons', () => {
    const b1 = makeBeacon(44.975, -93.271, 1, 1);
    const b2 = makeBeacon(44.976, -93.271, 1, 2);
    const b3 = makeBeacon(44.975, -93.272, 1, 3);
    const result = trilateratePosition([
      makeDetected(b1, 5),
      makeDetected(b2, 5),
      makeDetected(b3, 5),
    ]);
    expect(result).not.toBeNull();
    // Should be somewhere in the triangle
    expect(result!.latitude).toBeGreaterThan(44.974);
    expect(result!.latitude).toBeLessThan(44.977);
    expect(result!.longitude).toBeGreaterThan(-93.273);
    expect(result!.longitude).toBeLessThan(-93.270);
  });

  it('filters out beacons without positions', () => {
    const b1: DetectedBeacon = {
      hw_id: 'test',
      rssi: -60,
      distance: 5,
      beacon: undefined,
    };
    expect(trilateratePosition([b1])).toBeNull();
  });
});

describe('coordinate conversion', () => {
  it('converts latitude to meters and back', () => {
    const meters = latToMeters(0.001); // ~111.32 meters
    expect(meters).toBeCloseTo(111.32, 0);
    const lat = metersToLat(meters);
    expect(lat).toBeCloseTo(0.001, 5);
  });

  it('converts longitude to meters at Minneapolis latitude', () => {
    const meters = lngToMeters(0.001, 44.975);
    expect(meters).toBeGreaterThan(70);
    expect(meters).toBeLessThan(90);
    const lng = metersToLng(meters, 44.975);
    expect(lng).toBeCloseTo(0.001, 5);
  });
});

// ============ Position Fusion Tests ============

describe('PositionFusionEngine', () => {
  it('returns null when no sources available', () => {
    const engine = new PositionFusionEngine();
    expect(engine.getFusedPosition()).toBeNull();
  });

  it('returns GPS position when only GPS available', () => {
    const engine = new PositionFusionEngine();
    const gps: UserPosition = {
      latitude: 44.975,
      longitude: -93.271,
      accuracy: 5,
      heading: 90,
      source: 'gps',
    };
    engine.updateGps(gps);
    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.latitude).toBeCloseTo(44.975, 3);
    expect(fused!.source).toBe('gps');
  });

  it('returns BLE position when only BLE available', () => {
    const engine = new PositionFusionEngine();
    const b1 = makeBeacon(44.975, -93.271, 1, 1);
    const b2 = makeBeacon(44.976, -93.271, 1, 2);
    const b3 = makeBeacon(44.975, -93.272, 1, 3);
    engine.updateBle([
      makeDetected(b1, 3),
      makeDetected(b2, 3),
      makeDetected(b3, 3),
    ]);
    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.source).toBe('ble');
  });

  it('returns fused position when both GPS and BLE available', () => {
    const engine = new PositionFusionEngine();
    const gps: UserPosition = {
      latitude: 44.975,
      longitude: -93.271,
      accuracy: 10,
      heading: 90,
      source: 'gps',
    };
    engine.updateGps(gps);

    const b1 = makeBeacon(44.9752, -93.2712, 1, 1);
    const b2 = makeBeacon(44.9753, -93.2711, 1, 2);
    const b3 = makeBeacon(44.9751, -93.2713, 1, 3);
    engine.updateBle([
      makeDetected(b1, 2),
      makeDetected(b2, 2),
      makeDetected(b3, 2),
    ]);

    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.source).toBe('fused');
  });

  it('reports correct status', () => {
    const engine = new PositionFusionEngine();
    let status = engine.getStatus();
    expect(status.gpsAvailable).toBe(false);
    expect(status.bleAvailable).toBe(false);

    engine.updateGps({
      latitude: 44.975,
      longitude: -93.271,
      accuracy: 5,
      heading: null,
      source: 'gps',
    });
    status = engine.getStatus();
    expect(status.gpsAvailable).toBe(true);
  });

  it('handles dead reckoning fallback', () => {
    const engine = new PositionFusionEngine();
    const dr: UserPosition = {
      latitude: 44.975,
      longitude: -93.271,
      accuracy: 50,
      heading: null,
      source: 'dead-reckoning',
    };
    engine.updateDeadReckoning(dr);
    const fused = engine.getFusedPosition();
    expect(fused).not.toBeNull();
    expect(fused!.source).toBe('dead-reckoning');
  });

  it('resets all sources', () => {
    const engine = new PositionFusionEngine();
    engine.updateGps({
      latitude: 44.975,
      longitude: -93.271,
      accuracy: 5,
      heading: null,
      source: 'gps',
    });
    engine.reset();
    expect(engine.getFusedPosition()).toBeNull();
    const status = engine.getStatus();
    expect(status.gpsAvailable).toBe(false);
  });
});

// ============ Reducer BLE Tests ============

describe('navigationReducer BLE actions', () => {
  it('handles TOGGLE_BLE', () => {
    const state = navigationReducer(initialState, { type: 'TOGGLE_BLE' });
    expect(state.bleEnabled).toBe(false);
    const state2 = navigationReducer(state, { type: 'TOGGLE_BLE' });
    expect(state2.bleEnabled).toBe(true);
  });

  it('handles SET_BLE_STATUS', () => {
    const state = navigationReducer(initialState, {
      type: 'SET_BLE_STATUS',
      deviceCount: 5,
      scanning: true,
      devices: [],
      fingerprintCount: 10,
    });
    expect(state.bleScanning).toBe(true);
    expect(state.bleDevicesInRange).toBe(5);
    expect(state.bleFingerprintCount).toBe(10);
  });
});
