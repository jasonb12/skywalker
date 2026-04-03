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
import { supabase } from './supabase';
import { initBleScanner, startScanning, stopScanning } from './ble-scanner';
import { PositionFusionEngine } from './position-fusion';
import type { UserPosition, Beacon } from './types';

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(navigationReducer, initialState);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const lastGpsTime = useRef<number>(0);
  const deadReckonPos = useRef<{ lat: number; lng: number } | null>(null);
  const fusionEngine = useRef(new PositionFusionEngine());
  const bleEnabled = useRef(true);

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

      // Load beacons from Supabase and initialize BLE scanner
      try {
        const { data: beacons } = await supabase.from('beacons').select('*');
        if (beacons && beacons.length > 0) {
          initBleScanner(beacons as Beacon[]);
          dispatch({ type: 'SET_BLE_STATUS', beaconCount: beacons.length, scanning: false });
        }
      } catch (e) {
        console.warn('Failed to load beacons:', e);
      }
    })();
  }, []);

  // Location tracking + BLE scanning + position fusion
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

                lastGpsTime.current = Date.now();

                const gpsPos: UserPosition = {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  accuracy: loc.coords.accuracy ?? 10,
                  heading: loc.coords.heading,
                  source: 'gps',
                };

                deadReckonPos.current = { lat: gpsPos.latitude, lng: gpsPos.longitude };

                // Feed GPS into fusion engine
                fusionEngine.current.updateGps(gpsPos);

                // Get fused position
                const fused = fusionEngine.current.getFusedPosition();
                if (fused) {
                  dispatch({ type: 'SET_POSITION', position: fused });
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
          const started = await startScanning((detectedBeacons) => {
            if (!mounted) return;

            // Feed BLE data into fusion engine
            fusionEngine.current.updateBle(detectedBeacons);

            // Get fused position
            const fused = fusionEngine.current.getFusedPosition();
            if (fused) {
              dispatch({ type: 'SET_POSITION', position: fused });
            }

            // Update BLE status
            const status = fusionEngine.current.getStatus();
            dispatch({
              type: 'SET_BLE_STATUS',
              beaconCount: detectedBeacons.length,
              scanning: true,
            });
          });

          if (started) {
            dispatch({ type: 'SET_BLE_STATUS', beaconCount: 0, scanning: true });
          }
        } catch (e) {
          console.warn('BLE scanning error:', e);
        }
      }
    })();

    // Dead reckoning fallback: if GPS and BLE haven't updated in 10s
    const drInterval = setInterval(() => {
      if (!mounted) return;
      const elapsed = Date.now() - lastGpsTime.current;
      const status = fusionEngine.current.getStatus();

      if (elapsed > 10000 && !status.bleAvailable && deadReckonPos.current) {
        const drPos: UserPosition = {
          latitude: deadReckonPos.current.lat,
          longitude: deadReckonPos.current.lng,
          accuracy: 50,
          heading: null,
          source: 'dead-reckoning',
        };

        fusionEngine.current.updateDeadReckoning(drPos);
        const fused = fusionEngine.current.getFusedPosition();
        if (fused) {
          dispatch({ type: 'SET_POSITION', position: fused });
        }
      }
    }, 5000);

    // Periodic fusion status update
    const statusInterval = setInterval(() => {
      if (!mounted) return;
      const status = fusionEngine.current.getStatus();
      dispatch({
        type: 'SET_BLE_STATUS',
        beaconCount: status.bleBeaconCount,
        scanning: status.bleAvailable,
      });
    }, 3000);

    return () => {
      mounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      stopScanning();
      clearInterval(drInterval);
      clearInterval(statusInterval);
    };
  }, []);

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  );
}
