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

describe('Map Config - Supabase Edge Function URLs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getTileUrl returns Supabase Edge Function tile URL', async () => {
    const { getTileUrl } = await import('../lib/map-config');
    const url = getTileUrl();
    expect(url).toBe(
      'https://oocciycvadlcculiqpsz.supabase.co/functions/v1/skyway-tile/{z}/{x}/{y}.mvt'
    );
    expect(url).toContain('/functions/v1/skyway-tile/');
    expect(url).toContain('{z}/{x}/{y}.mvt');
  });

  it('getFontGlyphsUrl returns Supabase Edge Function font URL', async () => {
    const { getFontGlyphsUrl } = await import('../lib/map-config');
    const url = getFontGlyphsUrl();
    expect(url).toBe(
      'https://oocciycvadlcculiqpsz.supabase.co/functions/v1/skyway-fonts/{fontstack}/{range}.pbf'
    );
    expect(url).toContain('/functions/v1/skyway-fonts/');
    expect(url).toContain('{fontstack}/{range}.pbf');
  });

  it('getMapHtmlUrl returns base URL without params', async () => {
    const { getMapHtmlUrl } = await import('../lib/map-config');
    const url = getMapHtmlUrl();
    expect(url).toBe(
      'https://oocciycvadlcculiqpsz.supabase.co/functions/v1/skyway-map'
    );
  });

  it('getMapHtmlUrl appends query params correctly', async () => {
    const { getMapHtmlUrl } = await import('../lib/map-config');
    const url = getMapHtmlUrl({ isDark: 'true', userLng: '-93.270', userLat: '44.976' });
    expect(url).toContain('/functions/v1/skyway-map?');
    expect(url).toContain('isDark=true');
    expect(url).toContain('userLng=-93.270');
    expect(url).toContain('userLat=44.976');
  });

  it('getMapHtmlUrl handles empty params object', async () => {
    const { getMapHtmlUrl } = await import('../lib/map-config');
    const url = getMapHtmlUrl({});
    expect(url).toBe(
      'https://oocciycvadlcculiqpsz.supabase.co/functions/v1/skyway-map'
    );
    expect(url).not.toContain('?');
  });

  it('all URLs use the same Supabase project', async () => {
    const { getTileUrl, getFontGlyphsUrl, getMapHtmlUrl } = await import('../lib/map-config');
    const projectUrl = 'https://oocciycvadlcculiqpsz.supabase.co';
    expect(getTileUrl().startsWith(projectUrl)).toBe(true);
    expect(getFontGlyphsUrl().startsWith(projectUrl)).toBe(true);
    expect(getMapHtmlUrl().startsWith(projectUrl)).toBe(true);
  });

  it('URLs do not reference Express server paths', async () => {
    const { getTileUrl, getFontGlyphsUrl, getMapHtmlUrl } = await import('../lib/map-config');
    const urls = [getTileUrl(), getFontGlyphsUrl(), getMapHtmlUrl()];
    for (const url of urls) {
      expect(url).not.toContain('/api/skyway/');
      expect(url).not.toContain('localhost');
      expect(url).not.toContain(':3000');
    }
  });
});

describe('Edge Function URLs - Format Validation', () => {
  it('tile URL has correct MVT extension pattern', async () => {
    const { getTileUrl } = await import('../lib/map-config');
    const url = getTileUrl();
    expect(url).toMatch(/\.mvt$/);
  });

  it('font URL has correct PBF extension pattern', async () => {
    const { getFontGlyphsUrl } = await import('../lib/map-config');
    const url = getFontGlyphsUrl();
    expect(url).toMatch(/\.pbf$/);
  });

  it('map URL uses HTTPS', async () => {
    const { getMapHtmlUrl } = await import('../lib/map-config');
    expect(getMapHtmlUrl()).toMatch(/^https:\/\//);
  });
});
