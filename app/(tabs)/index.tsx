import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import NativeMapComponent from '@/components/native-map';

function WebMapFallback() {
  const colors = useColors();
  const { state } = useNavigation();
  return (
    <ScreenContainer className="flex-1 p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={[styles.webMapTitle, { color: colors.foreground }]}>Minneapolis Skyway Map</Text>
        <Text style={[styles.webMapSubtitle, { color: colors.muted }]}>
          Open on your iPhone to see the interactive map with live navigation.
        </Text>
        <View style={[styles.webStats, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.webStatRow}>
            <Text style={[styles.webStatLabel, { color: colors.muted }]}>Buildings</Text>
            <Text style={[styles.webStatValue, { color: colors.foreground }]}>{state.buildings.length}</Text>
          </View>
          <View style={styles.webStatRow}>
            <Text style={[styles.webStatLabel, { color: colors.muted }]}>Businesses</Text>
            <Text style={[styles.webStatValue, { color: colors.foreground }]}>{state.businesses.length}</Text>
          </View>
          <View style={styles.webStatRow}>
            <Text style={[styles.webStatLabel, { color: colors.muted }]}>Skyway Segments</Text>
            <Text style={[styles.webStatValue, { color: colors.foreground }]}>{state.edges.length}</Text>
          </View>
        </View>
        <Text style={[styles.webNote, { color: colors.muted }]}>
          The map uses Apple Maps on iOS with skyway route overlays, building markers, and live GPS positioning.
        </Text>
      </ScrollView>
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
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading skyway data...</Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return <WebMapFallback />;
  }

  return <NativeMapComponent />;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16 },
  webMapTitle: { fontSize: 28, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  webMapSubtitle: { fontSize: 16, textAlign: 'center', marginBottom: 24, maxWidth: 300 },
  webStats: { borderRadius: 16, padding: 20, borderWidth: 1, width: '100%', maxWidth: 320, marginBottom: 24 },
  webStatRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  webStatLabel: { fontSize: 14 },
  webStatValue: { fontSize: 20, fontWeight: '700' },
  webNote: { fontSize: 13, textAlign: 'center', maxWidth: 300 },
});
