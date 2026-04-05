import React, { useRef, useCallback, useEffect, useState } from 'react';
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
import { CalibrationPanel } from '@/components/calibration-panel';

/**
 * Web map using MapLibre GL JS with self-hosted PMTiles data.
 * The map HTML is served from the Express server (dev) or Supabase Edge Function (prod)
 * so the iframe has a proper origin context for MapLibre web workers.
 *
 * No ScreenContainer here — the map should fill edge-to-edge like a native map.
 */
function WebMapView() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { state, dispatch } = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Use Express server map HTML endpoint — serves proper text/html with PMTiles
  const mapUrl = `${getApiBaseUrl()}/api/skyway/map?theme=${colorScheme === 'dark' ? 'dark' : 'light'}`;

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

  // Send heatmap data to iframe when it changes
  useEffect(() => {
    if (state.heatmapData.length > 0) {
      const features = state.heatmapData.map((fp) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [fp.longitude, fp.latitude],
        },
        properties: {
          deviceCount: fp.deviceCount,
          source: fp.source,
        },
      }));
      sendMessage({ type: 'updateHeatmap', features });
    }
  }, [state.heatmapData, sendMessage]);

  // Listen for heatmap state changes from iframe
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg.type === 'heatmapState') {
          // Keep local state in sync with map
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <View style={styles.fullScreen}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef as any}
          src={mapUrl}
          onLoad={() => setIframeLoaded(true)}
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

function HeatmapButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.heatmapButton,
        {
          backgroundColor: active ? '#0066CC' : colors.background,
          borderColor: active ? '#0066CC' : colors.border,
          shadowColor: '#000',
        },
      ]}
    >
      <View style={[styles.heatmapIcon, { backgroundColor: active ? '#FFFFFF' : '#FF8800' }]} />
      <Text style={[styles.heatmapText, { color: active ? '#FFFFFF' : colors.foreground }]}>
        Heatmap
      </Text>
    </TouchableOpacity>
  );
}

function CalibrationButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.calibrationButton,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          shadowColor: '#000',
        },
      ]}
    >
      <View style={[styles.calibrationIcon, { backgroundColor: '#0066CC' }]} />
      <Text style={[styles.calibrationText, { color: colors.foreground }]}>
        Calibrate
      </Text>
    </TouchableOpacity>
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
  const { state, dispatch } = useNavigation();
  const [bleDetailsVisible, setBleDetailsVisible] = useState(false);
  const [calibrationVisible, setCalibrationVisible] = useState(false);
  const [heatmapActive, setHeatmapActive] = useState(false);

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

      {/* Calibration button - below BLE pill */}
      <CalibrationButton onPress={() => setCalibrationVisible(true)} />

      {/* Heatmap toggle button */}
      <HeatmapButton
        active={heatmapActive}
        onPress={() => {
          setHeatmapActive(!heatmapActive);
          dispatch({ type: 'TOGGLE_HEATMAP' });
          // Send toggle message to iframe on web
          if (Platform.OS === 'web') {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach((iframe) => {
              iframe.contentWindow?.postMessage(JSON.stringify({ type: 'toggleHeatmap' }), '*');
            });
          }
        }}
      />

      {/* BLE Details Panel */}
      <BleDetailsPanel
        visible={bleDetailsVisible}
        onClose={() => setBleDetailsVisible(false)}
      />

      {/* Calibration Panel */}
      <CalibrationPanel
        visible={calibrationVisible}
        onClose={() => setCalibrationVisible(false)}
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
  calibrationButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 80,
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
  calibrationIcon: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calibrationText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heatmapButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 140 : 120,
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
  heatmapIcon: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heatmapText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
