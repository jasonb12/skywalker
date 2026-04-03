import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView } from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { saveSettings, clearPaths } from '@/lib/storage';
import { clearCache } from '@/lib/skyway-data';

export default function SettingsScreen() {
  const colors = useColors();
  const { state, dispatch } = useNavigation();

  const handleToggleHaptic = () => {
    haptic.selection();
    dispatch({ type: 'TOGGLE_HAPTIC' });
    saveSettings({
      hapticEnabled: !state.hapticEnabled,
      distanceUnit: state.distanceUnit,
    });
  };

  const handleDistanceUnit = (unit: 'feet' | 'meters') => {
    haptic.selection();
    dispatch({ type: 'SET_DISTANCE_UNIT', unit });
    saveSettings({
      hapticEnabled: state.hapticEnabled,
      distanceUnit: unit,
    });
  };

  const handleClearHistory = () => {
    haptic.medium();
    clearPaths();
    dispatch({ type: 'SET_SAVED_PATHS', paths: [] });
  };

  const handleRefreshData = () => {
    haptic.medium();
    clearCache();
  };

  return (
    <ScreenContainer className="flex-1">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

        {/* Navigation section */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>NAVIGATION</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Haptic Feedback</Text>
            <Switch
              value={state.hapticEnabled}
              onValueChange={handleToggleHaptic}
              trackColor={{ false: colors.border, true: '#0066CC' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Distance Unit</Text>
            <View style={styles.segmentControl}>
              <TouchableOpacity
                onPress={() => handleDistanceUnit('feet')}
                style={[
                  styles.segment,
                  state.distanceUnit === 'feet' && { backgroundColor: '#0066CC' },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: state.distanceUnit === 'feet' ? '#FFFFFF' : colors.foreground },
                  ]}
                >
                  Feet
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDistanceUnit('meters')}
                style={[
                  styles.segment,
                  state.distanceUnit === 'meters' && { backgroundColor: '#0066CC' },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: state.distanceUnit === 'meters' ? '#FFFFFF' : colors.foreground },
                  ]}
                >
                  Meters
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Data section */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>DATA</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleClearHistory}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.rowLabel, { color: '#EF4444' }]}>Clear Navigation History</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefreshData} style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.tint }]}>Refresh Skyway Data</Text>
          </TouchableOpacity>
        </View>

        {/* About section */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>ABOUT</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Version</Text>
            <Text style={[styles.rowValue, { color: colors.muted }]}>1.0.0</Text>
          </View>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Buildings</Text>
            <Text style={[styles.rowValue, { color: colors.muted }]}>{state.buildings.length}</Text>
          </View>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Businesses</Text>
            <Text style={[styles.rowValue, { color: colors.muted }]}>{state.businesses.length}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Skyway Segments</Text>
            <Text style={[styles.rowValue, { color: colors.muted }]}>{state.edges.length}</Text>
          </View>
        </View>

        <Text style={[styles.footer, { color: colors.muted }]}>
          Skywalker — Minneapolis Skyway Navigator
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 20 },
  sectionHeader: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginLeft: 4, letterSpacing: 0.5 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16 },
  segmentControl: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#0066CC' },
  segment: { paddingHorizontal: 16, paddingVertical: 6 },
  segmentText: { fontSize: 14, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 13, marginTop: 8 },
});
