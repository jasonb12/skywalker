const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
console.log('URL available:', !!url, url.substring(0, 40));
console.log('Key available:', !!key, key.substring(0, 20));
