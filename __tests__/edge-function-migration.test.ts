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

describe('Map Config - S3 CDN GeoJSON', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getGeojsonUrl returns S3 CDN URL for a given layer', async () => {
    const { getGeojsonUrl } = await import('../lib/map-config');
    const url = getGeojsonUrl('footway-simple');
    expect(url).toContain('cloudfront.net');
    expect(url).toContain('skyway-footway-simple.geojson');
  });

  it('getGeojsonBaseUrl returns CDN base path', async () => {
    const { getGeojsonBaseUrl } = await import('../lib/map-config');
    const base = getGeojsonBaseUrl();
    expect(base).toContain('cloudfront.net');
    expect(base).toContain('map-tiles');
  });

  it('getFontGlyphsUrl returns Supabase-hosted font URL', async () => {
    const { getFontGlyphsUrl } = await import('../lib/map-config');
    const url = getFontGlyphsUrl();
    expect(url).toContain('supabase.co/storage/v1/object/public/map-tiles/fonts');
    expect(url).toContain('{fontstack}/{range}.pbf');
  });

  it('legacy getPmtilesUrl and getTileUrl return empty string', async () => {
    const { getPmtilesUrl, getTileUrl } = await import('../lib/map-config');
    expect(getPmtilesUrl()).toBe('');
    expect(getTileUrl()).toBe('');
  });

  it('GeoJSON URLs do not reference skyway.run', async () => {
    const { getGeojsonUrl, getFontGlyphsUrl } = await import('../lib/map-config');
    const urls = [getGeojsonUrl('footway-simple'), getFontGlyphsUrl()];
    for (const url of urls) {
      expect(url).not.toContain('skyway.run');
    }
  });

  it('GeoJSON URLs use HTTPS', async () => {
    const { getGeojsonUrl, getFontGlyphsUrl } = await import('../lib/map-config');
    expect(getGeojsonUrl('footway')).toMatch(/^https:\/\//);
    expect(getFontGlyphsUrl()).toMatch(/^https:\/\//);
  });

  it('SKYWAY_LAYERS includes expected layer names', async () => {
    const { SKYWAY_LAYERS } = await import('../lib/map-config');
    expect(SKYWAY_LAYERS).toContain('footway-simple');
    expect(SKYWAY_LAYERS).toContain('footway');
    expect(SKYWAY_LAYERS).toContain('building');
    expect(SKYWAY_LAYERS).toContain('poi');
  });
});
