import React, { useReducer, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  NavigationContext,
  initialState,
  navigationReducer,
} from './navigation-store';
import { fetchBuildings, fetchNodes, fetchEdges, fetchBusinesses } from './skyway-data';
import { loadSavedPaths, loadSettings } from './storage';
import {
  startScanning,
  stopScanning,
  getCurrentFingerprint,
  type DiscoveredDevice,
} from './ble-scanner';
import {
  initFingerprintStore,
  captureFingerprint,
  estimatePosition,
  getFingerprintCount,
} from './ble-fingerprint-store';
import type { UserPosition } from './types';

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(navigationReducer, initialState);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const lastGpsPosition = useRef<{ lat: number; lng: number; accuracy: number; time: number } | null>(null);
  const bleEnabled = useRef(true);
  const latestDevices = useRef<DiscoveredDevice[]>([]);

  // Load data on mount
  useEffect(() => {
    (async () => {
      try {
        const [buildings, nodes, edges, businesses] = await Promise.all([
          fetchBuildings(),
          fetchNodes(),
          fetchEdges(),
          fetchBusinesses(),
        ]);
        dispatch({ type: 'SET_DATA', buildings, nodes, edges, businesses });
      } catch (e) {
        console.warn('Failed to load skyway data:', e);
      }

      // Load saved paths
      const paths = await loadSavedPaths();
      dispatch({ type: 'SET_SAVED_PATHS', paths });

      // Load settings
      const settings = await loadSettings();
      if (!settings.hapticEnabled) dispatch({ type: 'TOGGLE_HAPTIC' });
      if (settings.distanceUnit !== 'feet') dispatch({ type: 'SET_DISTANCE_UNIT', unit: settings.distanceUnit });
      bleEnabled.current = settings.bleEnabled !== false;

      // Initialize fingerprint store
      await initFingerprintStore();
    })();
  }, []);

  // Location tracking + BLE scanning + fingerprint positioning
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;

    (async () => {
      // === GPS Location ===
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Location permission denied');
        } else {
          const hasServices = await Location.hasServicesEnabledAsync();
          if (hasServices) {
            locationSubscription.current = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 2000,
                distanceInterval: 2,
              },
              (loc) => {
                if (!mounted) return;

                const gpsPos: UserPosition = {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  accuracy: loc.coords.accuracy ?? 10,
                  heading: loc.coords.heading,
                  source: 'gps',
                };

                lastGpsPosition.current = {
                  lat: gpsPos.latitude,
                  lng: gpsPos.longitude,
                  accuracy: gpsPos.accuracy,
                  time: Date.now(),
                };

                // Auto-capture BLE fingerprint when GPS is good
                const fp = getCurrentFingerprint();
                if (fp.size >= 3 && gpsPos.accuracy < 15) {
                  captureFingerprint(
                    gpsPos.latitude,
                    gpsPos.longitude,
                    gpsPos.accuracy,
                    fp
                  );
                }

                // Use GPS position directly (or fuse with BLE if available)
                const bleEstimate = estimatePosition(fp);
                if (bleEstimate && gpsPos.accuracy > 20) {
                  // GPS is poor — prefer BLE fingerprint position
                  const fusedPos: UserPosition = {
                    latitude: bleEstimate.latitude,
                    longitude: bleEstimate.longitude,
                    accuracy: bleEstimate.accuracy,
                    heading: gpsPos.heading,
                    source: 'ble',
                    bleBeaconsInRange: latestDevices.current.length,
                  };
                  dispatch({ type: 'SET_POSITION', position: fusedPos });
                } else if (bleEstimate && gpsPos.accuracy > 10) {
                  // GPS is mediocre — fuse GPS + BLE
                  const gpsWeight = 10 / gpsPos.accuracy;
                  const bleWeight = bleEstimate.matchCount / (bleEstimate.avgSignalDistance + 1);
                  const totalWeight = gpsWeight + bleWeight;
                  const fusedPos: UserPosition = {
                    latitude: (gpsPos.latitude * gpsWeight + bleEstimate.latitude * bleWeight) / totalWeight,
                    longitude: (gpsPos.longitude * gpsWeight + bleEstimate.longitude * bleWeight) / totalWeight,
                    accuracy: Math.min(gpsPos.accuracy, bleEstimate.accuracy),
                    heading: gpsPos.heading,
                    source: 'fused',
                    bleBeaconsInRange: latestDevices.current.length,
                  };
                  dispatch({ type: 'SET_POSITION', position: fusedPos });
                } else {
                  // GPS is good — use it directly
                  dispatch({ type: 'SET_POSITION', position: gpsPos });
                }
              }
            );
          }
        }
      } catch (e) {
        console.warn('Location error:', e);
      }

      // === BLE Scanning ===
      if (bleEnabled.current) {
        try {
          const started = await startScanning((devices: DiscoveredDevice[]) => {
            if (!mounted) return;

            latestDevices.current = devices;

            // Update BLE status in state
            dispatch({
              type: 'SET_BLE_STATUS',
              deviceCount: devices.length,
              scanning: true,
              devices,
              fingerprintCount: getFingerprintCount(),
            });

            // If GPS hasn't updated in a while, try BLE-only positioning
            const gps = lastGpsPosition.current;
            const gpsStale = !gps || (Date.now() - gps.time > 10_000);

            if (gpsStale) {
              const fp = getCurrentFingerprint();
              const bleEstimate = estimatePosition(fp);
              if (bleEstimate) {
                const blePos: UserPosition = {
                  latitude: bleEstimate.latitude,
                  longitude: bleEstimate.longitude,
                  accuracy: bleEstimate.accuracy,
                  heading: null,
                  source: 'ble',
                  bleBeaconsInRange: devices.length,
                };
                dispatch({ type: 'SET_POSITION', position: blePos });
              }
            }
          });

          if (started) {
            dispatch({
              type: 'SET_BLE_STATUS',
              deviceCount: 0,
              scanning: true,
              devices: [],
              fingerprintCount: getFingerprintCount(),
            });
          }
        } catch (e) {
          console.warn('BLE scanning error:', e);
        }
      }
    })();

    return () => {
      mounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      stopScanning();
    };
  }, []);

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  );
}
