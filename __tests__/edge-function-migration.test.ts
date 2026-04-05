import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock expo-constants
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://oocciycvadlcculiqpsz.supabase.co',
      },
    },
  },
}));

describe('Map Config - Self-hosted PMTiles', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getPmtilesUrl returns Supabase Storage URL for PMTiles archive', async () => {
    const { getPmtilesUrl } = await import('../lib/map-config');
    const url = getPmtilesUrl();
    expect(url).toBe(
      'https://oocciycvadlcculiqpsz.supabase.co/storage/v1/object/public/map-tiles/skyway.pmtiles'
    );
    expect(url).toContain('/storage/v1/object/public/map-tiles/');
    expect(url).toContain('.pmtiles');
  });

  it('getFontGlyphsUrl returns MapLibre demo font CDN URL', async () => {
    const { getFontGlyphsUrl } = await import('../lib/map-config');
    const url = getFontGlyphsUrl();
    expect(url).toBe(
      'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    );
    expect(url).toContain('{fontstack}/{range}.pbf');
  });

  it('getTileUrl (legacy) returns same as getPmtilesUrl', async () => {
    const { getTileUrl, getPmtilesUrl } = await import('../lib/map-config');
    expect(getTileUrl()).toBe(getPmtilesUrl());
  });

  it('URLs do not reference skyway.run', async () => {
    const { getPmtilesUrl, getFontGlyphsUrl } = await import('../lib/map-config');
    const urls = [getPmtilesUrl(), getFontGlyphsUrl()];
    for (const url of urls) {
      expect(url).not.toContain('skyway.run');
    }
  });

  it('URLs do not reference Express server paths', async () => {
    const { getPmtilesUrl, getFontGlyphsUrl } = await import('../lib/map-config');
    const urls = [getPmtilesUrl(), getFontGlyphsUrl()];
    for (const url of urls) {
      expect(url).not.toContain('/api/skyway/');
      expect(url).not.toContain('localhost');
      expect(url).not.toContain(':3000');
    }
  });

  it('PMTiles URL uses HTTPS', async () => {
    const { getPmtilesUrl } = await import('../lib/map-config');
    expect(getPmtilesUrl()).toMatch(/^https:\/\//);
  });

  it('font URL uses HTTPS', async () => {
    const { getFontGlyphsUrl } = await import('../lib/map-config');
    expect(getFontGlyphsUrl()).toMatch(/^https:\/\//);
  });
});
