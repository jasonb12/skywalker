import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNavigation } from '@/lib/navigation-store';
import { getApiBaseUrl } from '@/constants/oauth';

/**
 * Web map using MapLibre GL JS with skyway.run's vector tile data.
 * The map HTML is served from the Express server (/api/skyway/map)
 * so the iframe has a proper origin and MapLibre workers can fetch tiles.
 */
function WebMapView() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { state } = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build the map URL with query params
  const mapUrl = useMemo(() => {
    const apiBase = getApiBaseUrl();
    const params = new URLSearchParams();

    // Dark mode
    if (colorScheme === 'dark') {
      params.set('isDark', 'true');
    }

    // User position
    if (state.userPosition) {
      params.set('userLng', String(state.userPosition.longitude));
      params.set('userLat', String(state.userPosition.latitude));
    }

    // Active route
    if (state.activeRoute) {
      const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
      const coords = state.activeRoute.nodeIds
        .map(id => {
          const n = nodeMap.get(id);
          return n ? [n.longitude, n.latitude] : null;
        })
        .filter(Boolean);
      if (coords.length > 0) {
        params.set('routeCoords', JSON.stringify(coords));
      }
    }

    // Navigation info
    if (state.isNavigating && state.activeRoute) {
      const step = state.activeRoute.steps[state.currentStepIndex];
      if (step) {
        params.set('navStep', step.instruction);
        params.set('navDist', String(Math.round(state.activeRoute.totalDistance)));
        params.set('navTime', String(Math.round(state.activeRoute.estimatedTime / 60)));
      }
    }

    return `${apiBase}/api/skyway/map?${params.toString()}`;
  }, [colorScheme, state.userPosition, state.activeRoute, state.isNavigating, state.currentStepIndex, state.nodes]);

  // Send location updates to the iframe via postMessage
  const sendMessage = useCallback((msg: any) => {
    if (iframeRef.current) {
      const iframe = iframeRef.current as any;
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
      }
    }
  }, []);

  // Update location when it changes (without full reload)
  useEffect(() => {
    if (state.userPosition) {
      sendMessage({
        type: 'updateLocation',
        lng: state.userPosition.longitude,
        lat: state.userPosition.latitude,
      });
    }
  }, [state.userPosition, sendMessage]);

  return (
    <ScreenContainer edges={['top', 'left', 'right']} className="flex-1">
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            ref={iframeRef as any}
            src={mapUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: 0,
            }}
            title="Skyway Map"
            allow="geolocation"
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export default function MapScreen() {
  const colors = useColors();
  const { state } = useNavigation();

  if (!state.dataLoaded) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>
          Loading skyway data...
        </Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return <WebMapView />;
  }

  // Native: use NativeMapComponent
  const NativeMapComponent = require('@/components/native-map').default;
  return <NativeMapComponent />;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16 },
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
  },
});
