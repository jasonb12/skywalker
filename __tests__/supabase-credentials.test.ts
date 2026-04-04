import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('Supabase credentials', () => {
  it('should connect and query ble_fingerprints table', async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    expect(url).toBeTruthy();
    expect(key).toBeTruthy();

    const supabase = createClient(url!, key!);

    // Try a simple query on the ble_fingerprints table
    const { data, error } = await supabase
      .from('ble_fingerprints')
      .select('id')
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
  });
});
