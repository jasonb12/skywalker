import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { getCurrentFingerprint } from '@/lib/ble-scanner';
import {
  captureFingerprint,
  getFingerprintCount,
  forceSyncNow,
  getRemoteCount,
} from '@/lib/ble-fingerprint-store';
import { haptic } from '@/lib/haptics';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const PANEL_HEIGHT = SCREEN_HEIGHT * 0.45;

interface CalibrationPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function CalibrationPanel({ visible, onClose }: CalibrationPanelProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state } = useNavigation();
  const translateY = useSharedValue(PANEL_HEIGHT);
  const [isRecording, setIsRecording] = useState(false);
  const [lastResult, setLastResult] = useState<'success' | 'fail' | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const pulseScale = useSharedValue(1);
  const resultTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    translateY.value = withTiming(visible ? 0 : PANEL_HEIGHT, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const handleRecord = useCallback(() => {
    if (!state.userPosition) {
      setLastResult('fail');
      haptic.error();
      if (resultTimeout.current) clearTimeout(resultTimeout.current);
      resultTimeout.current = setTimeout(() => setLastResult(null), 2000);
      return;
    }

    setIsRecording(true);
    const fp = getCurrentFingerprint();

    const success = captureFingerprint(
      state.userPosition.latitude,
      state.userPosition.longitude,
      state.userPosition.accuracy,
      fp,
      'calibration'
    );

    if (success) {
      haptic.success();
      setLastResult('success');
      setCapturedCount((c) => c + 1);
      pulseScale.value = withSequence(
        withSpring(1.15, { damping: 8 }),
        withSpring(1, { damping: 12 })
      );
    } else {
      haptic.error();
      setLastResult('fail');
    }

    setIsRecording(false);
    if (resultTimeout.current) clearTimeout(resultTimeout.current);
    resultTimeout.current = setTimeout(() => setLastResult(null), 2000);
  }, [state.userPosition, pulseScale]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    haptic.light();
    try {
      await forceSyncNow();
    } catch (e) {
      console.warn('Sync error:', e);
    }
    setIsSyncing(false);
    haptic.success();
  }, []);

  const pos = state.userPosition;
  const hasBle = state.bleDevicesInRange > 0;
  const hasGps = pos !== null;
  const canRecord = hasGps && hasBle;

  const localCount = getFingerprintCount();
  const remoteCount = getRemoteCount();

  if (!visible && translateY.value === PANEL_HEIGHT) return null;

  return (
    <>
      {visible && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
      )}

      <Animated.View
        style={[
          styles.panel,
          animatedStyle,
          {
            backgroundColor: colors.background,
            height: PANEL_HEIGHT,
            paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 60,
          },
        ]}
      >
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
        </View>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Calibration Mode
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
              Record your position to improve indoor navigation
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.tint }]}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Status indicators */}
        <View style={[styles.statusRow, { borderBottomColor: colors.border }]}>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: hasGps ? '#22C55E' : '#EF4444' }]} />
            <Text style={[styles.statusLabel, { color: colors.foreground }]}>
              GPS {hasGps ? `(${pos?.accuracy.toFixed(0)}m)` : 'Off'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: hasBle ? '#22C55E' : '#EF4444' }]} />
            <Text style={[styles.statusLabel, { color: colors.foreground }]}>
              BLE ({state.bleDevicesInRange} devices)
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {capturedCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>This Session</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {localCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Local</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {remoteCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Community</Text>
          </View>
        </View>

        {/* Record button */}
        <View style={styles.buttonRow}>
          <Animated.View style={[styles.recordButtonWrap, pulseStyle]}>
            <TouchableOpacity
              onPress={handleRecord}
              disabled={!canRecord || isRecording}
              activeOpacity={0.7}
              style={[
                styles.recordButton,
                {
                  backgroundColor: canRecord
                    ? lastResult === 'success'
                      ? '#22C55E'
                      : lastResult === 'fail'
                        ? '#EF4444'
                        : '#0066CC'
                    : colors.border,
                },
              ]}
            >
              {isRecording ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.recordButtonText}>
                  {lastResult === 'success'
                    ? 'Recorded!'
                    : lastResult === 'fail'
                      ? !hasGps
                        ? 'No GPS Signal'
                        : 'Too Close to Existing'
                      : 'Record Location'}
                </Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity
            onPress={handleSync}
            disabled={isSyncing}
            activeOpacity={0.7}
            style={[
              styles.syncButton,
              { borderColor: colors.border },
            ]}
          >
            {isSyncing ? (
              <ActivityIndicator color={colors.tint} size="small" />
            ) : (
              <Text style={[styles.syncButtonText, { color: colors.tint }]}>
                Sync Now
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={[styles.instructionText, { color: colors.muted }]}>
            Stand at a known location in the skyway, then tap "Record Location" to save the BLE fingerprint. Walk to different spots and record again. More recordings = better indoor positioning for everyone.
          </Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 99,
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
    maxWidth: 240,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    gap: 24,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    alignSelf: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  recordButtonWrap: {
    flex: 1,
  },
  recordButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  syncButton: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  instructions: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  instructionText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
