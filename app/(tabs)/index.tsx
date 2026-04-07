import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
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
import { buildMapHtml } from '@/lib/map-html-builder';
import { BleDetailsPanel } from '@/components/ble-details-panel';
import { CalibrationPanel } from '@/components/calibration-panel';
import { applyUserCorrection, getOffsetDecayFactor, hasActiveOffset } from '@/lib/gps-offset';
import { snapToSkyway, preloadFootwayData } from '@/lib/snap-to-skyway';
import { addCorrectionRecord } from '@/lib/correction-history';
import { haptic } from '@/lib/haptics';

/**
 * Web map using MapLibre GL JS with self-hosted data.
 * The map HTML is served from the Express server (dev) or Supabase Edge Function (prod)
 * so the iframe has a proper origin context for MapLibre web workers.
 *
 * No ScreenContainer here — the map should fill edge-to-edge like a native map.
 */
function WebMapView({
  onCrosshairCoords,
}: {
  onCrosshairCoords?: (lat: number, lng: number) => void;
}) {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { state, dispatch } = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const mapHtml = useMemo(() => buildMapHtml({
    isDark: colorScheme === 'dark',
    userLng: state.userPosition?.longitude,
    userLat: state.userPosition?.latitude,
  }), [colorScheme]);

  const sendMessage = useCallback((msg: any) => {
    if (iframeRef.current) {
      const iframe = iframeRef.current as any;
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
      }
    }
  }, []);

  // Update location when it changes
  useEffect(() => {
    if (state.userPosition && !state.isFixingPosition) {
      sendMessage({
        type: 'updateLocation',
        lng: state.userPosition.longitude,
        lat: state.userPosition.latitude,
      });
    }
  }, [state.userPosition, state.isFixingPosition, sendMessage]);

  // Enter/exit fix position mode on the map
  useEffect(() => {
    if (state.isFixingPosition) {
      sendMessage({
        type: 'enterFixMode',
        lng: state.userPosition?.longitude,
        lat: state.userPosition?.latitude,
      });
    } else {
      sendMessage({
        type: 'exitFixMode',
        correctedLng: state.fixPositionCrosshairCoords?.lng,
        correctedLat: state.fixPositionCrosshairCoords?.lat,
      });
    }
  }, [state.isFixingPosition]);

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

  // Listen for messages from iframe
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg.type === 'crosshairCoords' && onCrosshairCoords) {
          onCrosshairCoords(msg.lat, msg.lng);
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onCrosshairCoords]);

  return (
    <View style={styles.fullScreen}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef as any}
          srcDoc={mapHtml}
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
          sandbox="allow-scripts allow-same-origin"
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

function FixPositionButton({ onPress, offsetActive }: { onPress: () => void; offsetActive: boolean }) {
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.fixPositionButton,
        {
          backgroundColor: offsetActive ? '#FF3B30' : colors.background,
          borderColor: offsetActive ? '#FF3B30' : colors.border,
          shadowColor: '#000',
        },
      ]}
    >
      <View style={styles.fixPositionIconContainer}>
        <View style={[styles.fixPositionCrosshair, { borderColor: offsetActive ? '#fff' : '#FF3B30' }]} />
        <View style={[styles.fixPositionDot, { backgroundColor: offsetActive ? '#fff' : '#FF3B30' }]} />
      </View>
      <Text style={[styles.fixPositionText, { color: offsetActive ? '#FFFFFF' : colors.foreground }]}>
        {offsetActive ? 'Corrected' : 'Fix Position'}
      </Text>
    </TouchableOpacity>
  );
}

function FixPositionConfirmBar({
  onConfirm,
  onCancel,
  isSnapping,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isSnapping: boolean;
}) {
  const colors = useColors();

  return (
    <View style={[styles.fixConfirmBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
      <View style={styles.fixConfirmContent}>
        <View style={styles.fixConfirmTextGroup}>
          <Text style={[styles.fixConfirmTitle, { color: colors.foreground }]}>
            Fix Your Position
          </Text>
          <Text style={[styles.fixConfirmSubtitle, { color: colors.muted }]}>
            Drag the map so the crosshair is on your actual location.{'\n'}
            Your position will snap to the nearest skyway path.
          </Text>
        </View>
        <View style={styles.fixConfirmButtons}>
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.7}
            style={[styles.fixCancelBtn, { borderColor: colors.border }]}
            disabled={isSnapping}
          >
            <Text style={[styles.fixCancelText, { color: colors.muted }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            activeOpacity={0.7}
            style={[styles.fixConfirmBtn, isSnapping && { opacity: 0.6 }]}
            disabled={isSnapping}
          >
            {isSnapping ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.fixConfirmBtnText}>Confirm</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function GpsOffsetIndicator() {
  const colors = useColors();
  const [decayPercent, setDecayPercent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const factor = getOffsetDecayFactor();
      setDecayPercent(Math.round(factor * 100));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (decayPercent <= 0) return null;

  return (
    <View style={[styles.offsetIndicator, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.offsetBarTrack}>
        <View
          style={[
            styles.offsetBarFill,
            { width: `${decayPercent}%`, backgroundColor: '#FF3B30' },
          ]}
        />
      </View>
      <Text style={[styles.offsetText, { color: colors.muted }]}>
        GPS correction {decayPercent}%
      </Text>
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
  const { state, dispatch } = useNavigation();
  const [bleDetailsVisible, setBleDetailsVisible] = useState(false);
  const [calibrationVisible, setCalibrationVisible] = useState(false);
  const [heatmapActive, setHeatmapActive] = useState(false);
  const [crosshairCoords, setCrosshairCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSnapping, setIsSnapping] = useState(false);

  // Track GPS offset status for the button indicator
  const [offsetActive, setOffsetActive] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setOffsetActive(hasActiveOffset());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Pre-load footway data for snap-to-skyway
  useEffect(() => {
    preloadFootwayData();
  }, []);

  const handleStartFixPosition = useCallback(() => {
    dispatch({ type: 'START_FIX_POSITION' });
  }, [dispatch]);

  const handleCancelFixPosition = useCallback(() => {
    dispatch({ type: 'CANCEL_FIX_POSITION' });
    setCrosshairCoords(null);
  }, [dispatch]);

  const handleConfirmFixPosition = useCallback(async () => {
    if (!crosshairCoords) {
      dispatch({ type: 'CANCEL_FIX_POSITION' });
      return;
    }

    setIsSnapping(true);

    try {
      // Step 1: Snap to nearest skyway path
      const snapResult = await snapToSkyway(crosshairCoords.lat, crosshairCoords.lng);
      const finalLat = snapResult.snapped ? snapResult.lat : crosshairCoords.lat;
      const finalLng = snapResult.snapped ? snapResult.lng : crosshairCoords.lng;

      // Step 2: Apply the GPS offset correction
      const gpsLat = state.userPosition?.latitude ?? finalLat;
      const gpsLng = state.userPosition?.longitude ?? finalLng;
      const gpsAccuracy = state.userPosition?.accuracy ?? 50;

      const result = applyUserCorrection(
        gpsLat,
        gpsLng,
        gpsAccuracy,
        finalLat,
        finalLng
      );

      if (result.success) {
        // Step 3: Haptic feedback — success pulse
        haptic.success();

        console.log(
          `[FixPosition] Correction applied. ` +
          `Snapped: ${snapResult.snapped} (${snapResult.distanceMeters.toFixed(1)}m). ` +
          `BLE fingerprint: ${result.fingerprintCaptured ? 'yes' : 'no'} (${result.bleDeviceCount} devices)`
        );

        // Step 4: Save to correction history
        const offsetDistance = haversineMeters(gpsLat, gpsLng, finalLat, finalLng);
        await addCorrectionRecord({
          timestamp: Date.now(),
          gpsLat,
          gpsLng,
          gpsAccuracy,
          correctedLat: finalLat,
          correctedLng: finalLng,
          offsetDistanceMeters: offsetDistance,
          snappedToSkyway: snapResult.snapped,
          snapDistanceMeters: snapResult.distanceMeters,
          skywayColor: snapResult.segmentColor,
          bleDeviceCount: result.bleDeviceCount,
          fingerprintCaptured: result.fingerprintCaptured,
        });

        // Step 5: Update state
        dispatch({ type: 'SET_CROSSHAIR_COORDS', lat: finalLat, lng: finalLng });
        dispatch({ type: 'CONFIRM_FIX_POSITION' });

        // Update the displayed position to the corrected one
        if (state.userPosition) {
          dispatch({
            type: 'SET_POSITION',
            position: {
              ...state.userPosition,
              latitude: finalLat,
              longitude: finalLng,
              accuracy: 3,
              source: 'snapped',
            },
          });
        }
      } else {
        // Correction rejected (too far)
        haptic.error();
        console.warn('[FixPosition] Correction rejected (too far from GPS)');
        dispatch({ type: 'CANCEL_FIX_POSITION' });
      }
    } catch (e) {
      console.error('[FixPosition] Error during correction:', e);
      haptic.error();
      dispatch({ type: 'CANCEL_FIX_POSITION' });
    } finally {
      setIsSnapping(false);
      setCrosshairCoords(null);
    }
  }, [crosshairCoords, state.userPosition, dispatch]);

  const handleCrosshairCoords = useCallback((lat: number, lng: number) => {
    setCrosshairCoords({ lat, lng });
    dispatch({ type: 'SET_CROSSHAIR_COORDS', lat, lng });
  }, [dispatch]);

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
    ? <WebMapView onCrosshairCoords={handleCrosshairCoords} />
    : (() => {
        const NativeMapComponent = require('@/components/native-map').default;
        return <NativeMapComponent />;
      })();

  return (
    <View style={styles.fullScreen}>
      {mapContent}

      {/* Only show floating buttons when NOT in fix-position mode */}
      {!state.isFixingPosition && (
        <>
          <BleStatusPill onPress={() => setBleDetailsVisible(true)} />
          <CalibrationButton onPress={() => setCalibrationVisible(true)} />
          <FixPositionButton
            onPress={handleStartFixPosition}
            offsetActive={offsetActive}
          />
          <HeatmapButton
            active={heatmapActive}
            onPress={() => {
              setHeatmapActive(!heatmapActive);
              dispatch({ type: 'TOGGLE_HEATMAP' });
              if (Platform.OS === 'web') {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach((iframe) => {
                  iframe.contentWindow?.postMessage(JSON.stringify({ type: 'toggleHeatmap' }), '*');
                });
              }
            }}
          />
          <GpsOffsetIndicator />
        </>
      )}

      {/* Fix Position confirm/cancel bar */}
      {state.isFixingPosition && (
        <FixPositionConfirmBar
          onConfirm={handleConfirmFixPosition}
          onCancel={handleCancelFixPosition}
          isSnapping={isSnapping}
        />
      )}

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

// ─── Haversine helper (local to this file) ───────────────────────────

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  fixPositionButton: {
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
  fixPositionIconContainer: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixPositionCrosshair: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  fixPositionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  fixPositionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heatmapButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 180 : 160,
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
  // Fix Position confirm bar
  fixConfirmBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  fixConfirmContent: {
    gap: 12,
  },
  fixConfirmTextGroup: {
    gap: 4,
  },
  fixConfirmTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  fixConfirmSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  fixConfirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  fixCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  fixCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  fixConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixConfirmBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // GPS Offset indicator
  offsetIndicator: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 100 : 80,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  offsetBarTrack: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    overflow: 'hidden',
  },
  offsetBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  offsetText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
