import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for loading GeoJSON
const mockGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        // A simple east-west skyway segment along 7th St
        coordinates: [
          [-93.270, 44.977],
          [-93.268, 44.977],
        ],
      },
      properties: { color: '#de1215' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        // A north-south segment along Nicollet
        coordinates: [
          [-93.269, 44.976],
          [-93.269, 44.978],
        ],
      },
      properties: { color: '#008540' },
    },
  ],
};

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(mockGeoJson),
});

// Import after mock setup
import { snapToSkyway, clearFootwayCache } from '../lib/snap-to-skyway';

describe('snapToSkyway', () => {
  beforeEach(() => {
    clearFootwayCache();
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockGeoJson),
    });
  });

  it('snaps a point near the east-west segment to the segment', async () => {
    // Point slightly north of the east-west segment, far from the N-S segment
    const result = await snapToSkyway(44.9772, -93.2695);
    expect(result.snapped).toBe(true);
    // Should snap close to the segment
    expect(result.lat).toBeCloseTo(44.977, 3);
    expect(result.distanceMeters).toBeLessThan(50);
    // Color should be one of the two segments
    expect(['#de1215', '#008540']).toContain(result.segmentColor);
  });

  it('snaps a point near the north-south segment to the segment', async () => {
    // Point clearly east of the N-S segment, away from E-W segment
    const result = await snapToSkyway(44.9765, -93.2685);
    expect(result.snapped).toBe(true);
    // Should snap to the N-S segment (lng ~-93.269)
    expect(result.lng).toBeCloseTo(-93.269, 2);
    expect(result.segmentColor).toBe('#008540');
    expect(result.distanceMeters).toBeLessThan(80);
  });

  it('does not snap a point far from any skyway', async () => {
    // Point 1km away from any skyway
    const result = await snapToSkyway(44.990, -93.260);
    expect(result.snapped).toBe(false);
    // Returns original coordinates
    expect(result.lat).toBe(44.990);
    expect(result.lng).toBe(-93.260);
  });

  it('snaps to the closest segment when near an intersection', async () => {
    // Point at the intersection of the two segments
    const result = await snapToSkyway(44.977, -93.269);
    expect(result.snapped).toBe(true);
    // Should be very close to the intersection point
    expect(result.distanceMeters).toBeLessThan(5);
  });

  it('handles fetch failure gracefully', async () => {
    clearFootwayCache();
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    const result = await snapToSkyway(44.977, -93.269);
    expect(result.snapped).toBe(false);
    expect(result.lat).toBe(44.977);
    expect(result.lng).toBe(-93.269);
  });

  it('snaps to segment endpoint when closest point is at the end', async () => {
    // Point beyond the east end of the east-west segment
    const result = await snapToSkyway(44.977, -93.2675);
    expect(result.snapped).toBe(true);
    // Should snap to the east endpoint
    expect(result.lng).toBeCloseTo(-93.268, 3);
    expect(result.lat).toBeCloseTo(44.977, 3);
  });
});
