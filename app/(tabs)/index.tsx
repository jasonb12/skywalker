import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNavigation } from '@/lib/navigation-store';
import { getApiBaseUrl } from '@/constants/oauth';
import { BleDetailsPanel } from '@/components/ble-details-panel';

/**
 * Web map using MapLibre GL JS with skyway.run's vector tile data.
 * The map HTML is served from the Express server (/api/skyway/map)
 * so the iframe has a proper origin and MapLibre workers can fetch tiles.
 *
 * No ScreenContainer here — the map should fill edge-to-edge like a native map.
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
    <View style={styles.fullScreen}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef as any}
          src={mapUrl}
          style={{
            position: 'absolute' as any,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="Skyway Map"
          allow="geolocation"
        />
      ) : null}
    </View>
  );
}

function BleStatusPill({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  const { state } = useNavigation();

  const deviceCount = state.bleDevicesInRange;
  const isScanning = state.bleScanning;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.blePill,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          shadowColor: '#000',
        },
      ]}
    >
      <View
        style={[
          styles.bleDot,
          { backgroundColor: isScanning ? '#22C55E' : colors.muted },
        ]}
      />
      <Text style={[styles.blePillText, { color: colors.foreground }]}>
        {isScanning ? `${deviceCount} BLE` : 'BLE Off'}
      </Text>
      <Text style={[styles.blePillChevron, { color: colors.muted }]}>{'>'}</Text>
    </TouchableOpacity>
  );
}

export default function MapScreen() {
  const colors = useColors();
  const { state } = useNavigation();
  const [bleDetailsVisible, setBleDetailsVisible] = useState(false);

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

  const mapContent = Platform.OS === 'web'
    ? <WebMapView />
    : (() => {
        const NativeMapComponent = require('@/components/native-map').default;
        return <NativeMapComponent />;
      })();

  return (
    <View style={styles.fullScreen}>
      {mapContent}

      {/* BLE Status Pill - floating button */}
      <BleStatusPill onPress={() => setBleDetailsVisible(true)} />

      {/* BLE Details Panel */}
      <BleDetailsPanel
        visible={bleDetailsVisible}
        onClose={() => setBleDetailsVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16 },
  fullScreen: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  blePill: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  bleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  blePillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  blePillChevron: {
    fontSize: 12,
    fontWeight: '700',
  },
});
