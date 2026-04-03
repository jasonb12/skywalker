import React, { useReducer, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  NavigationContext,
  initialState,
  navigationReducer,
} from './navigation-store';
import { fetchBuildings, fetchNodes, fetchEdges, fetchBusinesses, findNearestNode, haversine } from './skyway-data';
import { loadSavedPaths, loadSettings } from './storage';
import type { UserPosition } from './types';

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(navigationReducer, initialState);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const lastGpsTime = useRef<number>(0);
  const deadReckonPos = useRef<{ lat: number; lng: number } | null>(null);

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
    })();
  }, []);

  // Location tracking
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Location permission denied');
          return;
        }

        const hasServices = await Location.hasServicesEnabledAsync();
        if (!hasServices) {
          console.warn('Location services disabled');
          return;
        }

        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 2,
          },
          (loc) => {
            if (!mounted) return;

            const now = Date.now();
            lastGpsTime.current = now;

            const pos: UserPosition = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? 10,
              heading: loc.coords.heading,
              source: 'gps',
            };

            // Snap to nearest skyway node if within 30m
            deadReckonPos.current = { lat: pos.latitude, lng: pos.longitude };

            dispatch({ type: 'SET_POSITION', position: pos });
          }
        );
      } catch (e) {
        console.warn('Location error:', e);
      }
    })();

    // Dead reckoning fallback: if GPS hasn't updated in 10s, use last known position
    const drInterval = setInterval(() => {
      if (!mounted) return;
      const elapsed = Date.now() - lastGpsTime.current;
      if (elapsed > 10000 && deadReckonPos.current) {
        // Keep showing last known position with degraded accuracy
        dispatch({
          type: 'SET_POSITION',
          position: {
            latitude: deadReckonPos.current.lat,
            longitude: deadReckonPos.current.lng,
            accuracy: 50,
            heading: null,
            source: 'dead-reckoning',
          },
        });
      }
    }, 5000);

    return () => {
      mounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      clearInterval(drInterval);
    };
  }, []);

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  );
}
