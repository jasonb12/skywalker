import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedPath } from './types';

const PATHS_KEY = '@skywalker_paths';
const SETTINGS_KEY = '@skywalker_settings';

export async function loadSavedPaths(): Promise<SavedPath[]> {
  try {
    const json = await AsyncStorage.getItem(PATHS_KEY);
    if (json) return JSON.parse(json);
  } catch (e) {
    console.warn('Failed to load saved paths:', e);
  }
  return [];
}

export async function savePath(path: SavedPath): Promise<void> {
  try {
    const existing = await loadSavedPaths();
    const updated = [path, ...existing].slice(0, 100); // Keep last 100
    await AsyncStorage.setItem(PATHS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save path:', e);
  }
}

export async function clearPaths(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PATHS_KEY);
  } catch (e) {
    console.warn('Failed to clear paths:', e);
  }
}

export interface AppSettings {
  hapticEnabled: boolean;
  bleEnabled: boolean;
  distanceUnit: 'feet' | 'meters';
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await AsyncStorage.getItem(SETTINGS_KEY);
    if (json) return JSON.parse(json);
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return { hapticEnabled: true, bleEnabled: true, distanceUnit: 'feet' };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}
