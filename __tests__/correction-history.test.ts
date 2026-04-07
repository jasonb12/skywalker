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

// Must import AFTER mocks are set up
import {
  addCorrectionRecord,
  getCorrectionHistory,
  getCorrectionCount,
  clearCorrectionHistory,
  type CorrectionRecord,
} from '../lib/correction-history';

function makeRecord(overrides: Partial<Omit<CorrectionRecord, 'id'>> = {}): Omit<CorrectionRecord, 'id'> {
  return {
    timestamp: Date.now(),
    gpsLat: 44.9778,
    gpsLng: -93.2650,
    gpsAccuracy: 25,
    correctedLat: 44.9780,
    correctedLng: -93.2648,
    offsetDistanceMeters: 30,
    snappedToSkyway: true,
    snapDistanceMeters: 5,
    skywayColor: '#e31e24',
    bleDeviceCount: 8,
    fingerprintCaptured: true,
    ...overrides,
  };
}

describe('CorrectionHistory', () => {
  beforeEach(async () => {
    // Clear the mock store and the module's internal cache
    for (const key of Object.keys(store)) delete store[key];
    await clearCorrectionHistory();
  });

  it('should add a correction record and assign a unique id', async () => {
    const record = await addCorrectionRecord(makeRecord());

    expect(record.id).toBeTruthy();
    expect(record.id).toMatch(/^correction-/);
    expect(record.gpsLat).toBe(44.9778);
    expect(record.snappedToSkyway).toBe(true);
  });

  it('should return records in newest-first order', async () => {
    await addCorrectionRecord(makeRecord({ timestamp: 1000, offsetDistanceMeters: 10 }));
    await addCorrectionRecord(makeRecord({ timestamp: 2000, offsetDistanceMeters: 20 }));
    await addCorrectionRecord(makeRecord({ timestamp: 3000, offsetDistanceMeters: 30 }));

    const history = await getCorrectionHistory();
    expect(history.length).toBe(3);
    // Newest first (prepended)
    expect(history[0].offsetDistanceMeters).toBe(30);
    expect(history[1].offsetDistanceMeters).toBe(20);
    expect(history[2].offsetDistanceMeters).toBe(10);
  });

  it('should return the correct count', async () => {
    expect(await getCorrectionCount()).toBe(0);

    await addCorrectionRecord(makeRecord());
    expect(await getCorrectionCount()).toBe(1);

    await addCorrectionRecord(makeRecord());
    expect(await getCorrectionCount()).toBe(2);
  });

  it('should clear all records', async () => {
    await addCorrectionRecord(makeRecord());
    await addCorrectionRecord(makeRecord());
    expect(await getCorrectionCount()).toBe(2);

    await clearCorrectionHistory();
    expect(await getCorrectionCount()).toBe(0);

    const history = await getCorrectionHistory();
    expect(history).toEqual([]);
  });

  it('should persist records to AsyncStorage', async () => {
    await addCorrectionRecord(makeRecord({ offsetDistanceMeters: 42 }));

    // Check that AsyncStorage.setItem was called with the right key
    const raw = store['@skywalker/correction-history'];
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw) as CorrectionRecord[];
    expect(parsed.length).toBe(1);
    expect(parsed[0].offsetDistanceMeters).toBe(42);
  });

  it('should cap records at 100 (MAX_RECORDS)', async () => {
    // Add 105 records
    for (let i = 0; i < 105; i++) {
      await addCorrectionRecord(makeRecord({ timestamp: i, offsetDistanceMeters: i }));
    }

    const count = await getCorrectionCount();
    expect(count).toBe(100);

    // The newest records should be kept (highest timestamps)
    const history = await getCorrectionHistory();
    // The last added (timestamp=104) should be first
    expect(history[0].offsetDistanceMeters).toBe(104);
  });

  it('should preserve all CorrectionRecord fields', async () => {
    const input = makeRecord({
      timestamp: 1234567890,
      gpsLat: 44.123,
      gpsLng: -93.456,
      gpsAccuracy: 18,
      correctedLat: 44.124,
      correctedLng: -93.455,
      offsetDistanceMeters: 15.5,
      snappedToSkyway: false,
      snapDistanceMeters: 0,
      skywayColor: null,
      bleDeviceCount: 3,
      fingerprintCaptured: false,
    });

    const record = await addCorrectionRecord(input);

    expect(record.timestamp).toBe(1234567890);
    expect(record.gpsLat).toBe(44.123);
    expect(record.gpsLng).toBe(-93.456);
    expect(record.gpsAccuracy).toBe(18);
    expect(record.correctedLat).toBe(44.124);
    expect(record.correctedLng).toBe(-93.455);
    expect(record.offsetDistanceMeters).toBeCloseTo(15.5);
    expect(record.snappedToSkyway).toBe(false);
    expect(record.snapDistanceMeters).toBe(0);
    expect(record.skywayColor).toBeNull();
    expect(record.bleDeviceCount).toBe(3);
    expect(record.fingerprintCaptured).toBe(false);
  });

  it('should generate unique IDs for each record', async () => {
    const r1 = await addCorrectionRecord(makeRecord());
    const r2 = await addCorrectionRecord(makeRecord());
    const r3 = await addCorrectionRecord(makeRecord());

    const ids = new Set([r1.id, r2.id, r3.id]);
    expect(ids.size).toBe(3);
  });
});
