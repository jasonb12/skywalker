import React, { useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import type { DiscoveredDevice } from '@/lib/ble-scanner';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const PANEL_HEIGHT = SCREEN_HEIGHT * 0.55;

interface BleDetailsPanelProps {
  visible: boolean;
  onClose: () => void;
}

function SignalBars({ rssi }: { rssi: number }) {
  const colors = useColors();
  // Map RSSI to 0-4 bars: -30 = 4 bars, -100 = 0 bars
  const strength = Math.max(0, Math.min(4, Math.round((rssi + 100) / 17.5)));

  return (
    <View style={styles.signalBars}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.signalBar,
            {
              height: 6 + i * 4,
              backgroundColor:
                i < strength
                  ? strength >= 3
                    ? '#22C55E'
                    : strength >= 2
                      ? '#F59E0B'
                      : '#EF4444'
                  : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

function DeviceRow({ device }: { device: DiscoveredDevice }) {
  const colors = useColors();
  const lastSeenAgo = Math.round((Date.now() - device.lastSeen) / 1000);
  const isStale = lastSeenAgo > 10;

  return (
    <View
      style={[
        styles.deviceRow,
        { borderBottomColor: colors.border, opacity: isStale ? 0.5 : 1 },
      ]}
    >
      <View style={styles.deviceInfo}>
        <Text
          style={[styles.deviceName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {device.name || 'Unknown Device'}
        </Text>
        <Text style={[styles.deviceId, { color: colors.muted }]} numberOfLines={1}>
          {device.id.length > 20 ? `${device.id.slice(0, 8)}...${device.id.slice(-8)}` : device.id}
        </Text>
      </View>
      <View style={styles.deviceMeta}>
        <SignalBars rssi={device.smoothedRssi} />
        <Text style={[styles.rssiText, { color: colors.muted }]}>
          {Math.round(device.smoothedRssi)} dBm
        </Text>
      </View>
    </View>
  );
}

export function BleDetailsPanel({ visible, onClose }: BleDetailsPanelProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state } = useNavigation();
  const translateY = useSharedValue(PANEL_HEIGHT);

  React.useEffect(() => {
    translateY.value = withTiming(visible ? 0 : PANEL_HEIGHT, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const sortedDevices = useMemo(() => {
    return [...state.bleDevices].sort((a, b) => b.smoothedRssi - a.smoothedRssi);
  }, [state.bleDevices]);

  const stats = useMemo(() => {
    const total = sortedDevices.length;
    const named = sortedDevices.filter((d) => d.name).length;
    const strong = sortedDevices.filter((d) => d.smoothedRssi > -70).length;
    return { total, named, strong };
  }, [sortedDevices]);

  if (!visible && translateY.value === PANEL_HEIGHT) return null;

  return (
    <>
      {/* Backdrop */}
      {visible && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
      )}

      {/* Panel */}
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
              BLE Devices
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
              {stats.total} found · {stats.named} named · {stats.strong} strong signal
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.tint }]}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {state.bleFingerprintCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Fingerprints</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {state.bleScanning ? 'Active' : 'Off'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Scanner</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {state.userPosition?.source ?? '—'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Position Src</Text>
          </View>
        </View>

        {/* Device list */}
        {sortedDevices.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {state.bleScanning
                ? 'Scanning for BLE devices...'
                : 'BLE scanning is disabled. Enable it in Settings.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sortedDevices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <DeviceRow device={item} />}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
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
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
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
    fontSize: 16,
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
  listContent: {
    paddingHorizontal: 16,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  deviceInfo: {
    flex: 1,
    marginRight: 12,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '500',
  },
  deviceId: {
    fontSize: 11,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  deviceMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 4,
    borderRadius: 1,
  },
  rssiText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
