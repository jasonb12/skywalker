import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AsyncStorage
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: [], error: null }),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        count: vi.fn(),
      }),
    }),
  },
}));

describe('BLE Fingerprint Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export all required functions', async () => {
    const store = await import('@/lib/ble-fingerprint-store');
    expect(typeof store.initFingerprintStore).toBe('function');
    expect(typeof store.captureFingerprint).toBe('function');
    expect(typeof store.estimatePosition).toBe('function');
    expect(typeof store.getFingerprintCount).toBe('function');
    expect(typeof store.getRemoteCount).toBe('function');
    expect(typeof store.getAllFingerprints).toBe('function');
    expect(typeof store.getFingerprintLocations).toBe('function');
    expect(typeof store.forceSyncNow).toBe('function');
    expect(typeof store.stopSync).toBe('function');
    expect(typeof store.setSyncCallback).toBe('function');
    expect(typeof store.clearFingerprints).toBe('function');
  });

  it('should capture a calibration fingerprint with relaxed GPS accuracy', async () => {
    const store = await import('@/lib/ble-fingerprint-store');

    // Initialize store
    await store.initFingerprintStore();

    // Create a mock BLE scan with enough devices
    const liveScan = new Map<string, number>();
    liveScan.set('device1', -60);
    liveScan.set('device2', -70);
    liveScan.set('device3', -80);

    // Calibration mode should accept GPS accuracy up to 50m
    const result = store.captureFingerprint(
      44.976, -93.270, 30, liveScan, 'calibration'
    );
    expect(result).toBe(true);

    // Verify fingerprint was stored
    expect(store.getFingerprintCount()).toBeGreaterThan(0);
  });

  it('should reject auto fingerprint with poor GPS accuracy', async () => {
    const store = await import('@/lib/ble-fingerprint-store');
    await store.clearFingerprints();

    const liveScan = new Map<string, number>();
    liveScan.set('device1', -60);
    liveScan.set('device2', -70);
    liveScan.set('device3', -80);

    // Auto mode should reject GPS accuracy > 15m
    const result = store.captureFingerprint(
      44.976, -93.270, 20, liveScan, 'auto'
    );
    expect(result).toBe(false);
  });

  it('should return fingerprint locations for heatmap', async () => {
    const store = await import('@/lib/ble-fingerprint-store');
    await store.clearFingerprints();

    const liveScan = new Map<string, number>();
    liveScan.set('device1', -60);
    liveScan.set('device2', -70);
    liveScan.set('device3', -80);

    // Capture a calibration fingerprint
    store.captureFingerprint(44.976, -93.270, 5, liveScan, 'calibration');

    const locations = store.getFingerprintLocations();
    expect(locations.length).toBeGreaterThan(0);
    expect(locations[0]).toHaveProperty('latitude');
    expect(locations[0]).toHaveProperty('longitude');
    expect(locations[0]).toHaveProperty('deviceCount');
    expect(locations[0]).toHaveProperty('source');
    expect(locations[0].source).toBe('calibration');
  });
});

describe('Fingerprint Sync Service', () => {
  it('should export all required functions', async () => {
    const sync = await import('@/lib/fingerprint-sync');
    expect(typeof sync.uploadFingerprints).toBe('function');
    expect(typeof sync.downloadFingerprints).toBe('function');
    expect(typeof sync.getRemoteFingerprintCount).toBe('function');
    expect(typeof sync.getHeatmapData).toBe('function');
    expect(typeof sync.resetSyncState).toBe('function');
  });

  it('should handle empty upload gracefully', async () => {
    const sync = await import('@/lib/fingerprint-sync');
    const result = await sync.uploadFingerprints([]);
    expect(result).toBe(0);
  });

  it('should handle empty download gracefully', async () => {
    const sync = await import('@/lib/fingerprint-sync');
    const result = await sync.downloadFingerprints(new Set());
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Navigation Store - Heatmap Actions', () => {
  it('should toggle heatmap visibility', async () => {
    const { navigationReducer, initialState } = await import('@/lib/navigation-store');

    const state1 = navigationReducer(initialState, { type: 'TOGGLE_HEATMAP' });
    expect(state1.heatmapVisible).toBe(true);

    const state2 = navigationReducer(state1, { type: 'TOGGLE_HEATMAP' });
    expect(state2.heatmapVisible).toBe(false);
  });

  it('should set heatmap data', async () => {
    const { navigationReducer, initialState } = await import('@/lib/navigation-store');

    const data = [
      { latitude: 44.976, longitude: -93.270, deviceCount: 5, source: 'auto' },
      { latitude: 44.977, longitude: -93.271, deviceCount: 8, source: 'calibration' },
    ];

    const state = navigationReducer(initialState, { type: 'SET_HEATMAP_DATA', data });
    expect(state.heatmapData).toHaveLength(2);
    expect(state.heatmapData[0].latitude).toBe(44.976);
    expect(state.heatmapData[1].source).toBe('calibration');
  });
});
