import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { formatDistance, formatTime, formatTimestamp } from '@/lib/format';
import { buildRoute } from '@/lib/pathfinding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { SavedPath } from '@/lib/types';
import { useRouter } from 'expo-router';
import {
  getCorrectionHistory,
  clearCorrectionHistory,
  type CorrectionRecord,
} from '@/lib/correction-history';

// ─── Section types ───────────────────────────────────────────────────

type SectionItem =
  | { kind: 'path'; data: SavedPath }
  | { kind: 'correction'; data: CorrectionRecord };

interface Section {
  title: string;
  data: SectionItem[];
}

// ─── Main Screen ─────────────────────────────────────────────────────

export default function HistoryScreen() {
  const colors = useColors();
  const { state, dispatch } = useNavigation();
  const router = useRouter();
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);

  // Load correction history on mount and when returning to this tab
  useEffect(() => {
    let mounted = true;
    getCorrectionHistory().then((records) => {
      if (mounted) setCorrections(records);
    });
    return () => { mounted = false; };
  }, [state.lastCorrectionTime]); // Re-load when a new correction is made

  const handleReplay = useCallback(
    (path: SavedPath) => {
      haptic.medium();
      if (path.nodeIds.length < 2) return;
      const route = buildRoute(path.nodeIds, state.nodes, state.edges);
      const destNode = state.nodes.find((n) => n.id === path.endNodeId);
      if (!destNode) return;
      dispatch({ type: 'START_NAVIGATION', route, business: null, destNode });
      router.push('/(tabs)');
    },
    [state.nodes, state.edges, dispatch, router]
  );

  const handleClearCorrections = useCallback(async () => {
    haptic.light();
    await clearCorrectionHistory();
    setCorrections([]);
  }, []);

  // Build sections
  const sections: Section[] = [];

  if (corrections.length > 0) {
    sections.push({
      title: 'Position Corrections',
      data: corrections.map((c) => ({ kind: 'correction' as const, data: c })),
    });
  }

  if (state.savedPaths.length > 0) {
    sections.push({
      title: 'Navigation Routes',
      data: state.savedPaths.map((p) => ({ kind: 'path' as const, data: p })),
    });
  }

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      if (item.kind === 'path') {
        return <PathCard path={item.data} onReplay={handleReplay} distanceUnit={state.distanceUnit} />;
      }
      return <CorrectionCard correction={item.data} distanceUnit={state.distanceUnit} />;
    },
    [handleReplay, state.distanceUnit]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {section.title}
        </Text>
        {section.title === 'Position Corrections' && corrections.length > 0 && (
          <TouchableOpacity onPress={handleClearCorrections} activeOpacity={0.7}>
            <Text style={[styles.clearText, { color: colors.error }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
    ),
    [colors, corrections.length, handleClearCorrections]
  );

  const isEmpty = sections.length === 0;

  return (
    <ScreenContainer className="flex-1">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>History</Text>
      </View>
      {isEmpty ? (
        <View style={styles.emptyState}>
          <IconSymbol name="clock.fill" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            Your navigation routes and position corrections will appear here
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.kind === 'path' ? item.data.id : item.data.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </ScreenContainer>
  );
}

// ─── Path Card (existing) ────────────────────────────────────────────

function PathCard({
  path,
  onReplay,
  distanceUnit,
}: {
  path: SavedPath;
  onReplay: (p: SavedPath) => void;
  distanceUnit: 'feet' | 'meters';
}) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.pathCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => onReplay(path)}
      activeOpacity={0.7}
    >
      <View style={styles.pathHeader}>
        <View style={styles.pathRoute}>
          <View style={[styles.dot, { backgroundColor: '#0066CC' }]} />
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
        </View>
        <View style={styles.pathNames}>
          <Text style={[styles.pathStart, { color: colors.foreground }]} numberOfLines={1}>
            {path.startName}
          </Text>
          <Text style={[styles.pathEnd, { color: colors.foreground }]} numberOfLines={1}>
            {path.endName}
          </Text>
        </View>
        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
      </View>
      <View style={[styles.pathMeta, { borderTopColor: colors.border }]}>
        <Text style={[styles.pathMetaText, { color: colors.muted }]}>
          {formatTimestamp(path.timestamp)}
        </Text>
        <Text style={[styles.pathMetaText, { color: colors.muted }]}>
          {formatDistance(path.distance, distanceUnit)} · {formatTime(path.duration)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Correction Card (new) ───────────────────────────────────────────

function CorrectionCard({
  correction,
  distanceUnit,
}: {
  correction: CorrectionRecord;
  distanceUnit: 'feet' | 'meters';
}) {
  const colors = useColors();

  return (
    <View
      style={[styles.correctionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.correctionHeader}>
        {/* Crosshair icon with skyway color */}
        <View style={styles.correctionIconContainer}>
          <View
            style={[
              styles.correctionCrosshair,
              { borderColor: correction.skywayColor || '#FF3B30' },
            ]}
          />
          <View
            style={[
              styles.correctionDot,
              { backgroundColor: correction.skywayColor || '#FF3B30' },
            ]}
          />
        </View>

        <View style={styles.correctionInfo}>
          <Text style={[styles.correctionTitle, { color: colors.foreground }]}>
            Position Corrected
          </Text>
          <Text style={[styles.correctionOffset, { color: colors.muted }]}>
            GPS was off by {formatDistance(correction.offsetDistanceMeters, distanceUnit)}
          </Text>
        </View>

        {/* Snap badge */}
        {correction.snappedToSkyway && (
          <View style={[styles.snapBadge, { backgroundColor: correction.skywayColor || '#FF3B30' }]}>
            <Text style={styles.snapBadgeText}>Snapped</Text>
          </View>
        )}
      </View>

      {/* Details row */}
      <View style={[styles.correctionDetails, { borderTopColor: colors.border }]}>
        <View style={styles.correctionDetailItem}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>Time</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>
            {formatTimestamp(correction.timestamp)}
          </Text>
        </View>

        <View style={styles.correctionDetailItem}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>BLE Devices</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>
            {correction.bleDeviceCount}
          </Text>
        </View>

        <View style={styles.correctionDetailItem}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>Fingerprint</Text>
          <Text
            style={[
              styles.detailValue,
              { color: correction.fingerprintCaptured ? '#22C55E' : colors.muted },
            ]}
          >
            {correction.fingerprintCaptured ? 'Captured' : 'None'}
          </Text>
        </View>
      </View>

      {/* GPS accuracy note */}
      <Text style={[styles.correctionNote, { color: colors.muted }]}>
        GPS accuracy was ±{Math.round(correction.gpsAccuracy)}m
        {correction.snappedToSkyway
          ? ` · Snapped ${formatDistance(correction.snapDistanceMeters, distanceUnit)} to skyway`
          : ''}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 4 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Path cards (existing)
  pathCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  pathHeader: { flexDirection: 'row', alignItems: 'center' },
  pathRoute: { alignItems: 'center', marginRight: 12, height: 44 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  pathNames: { flex: 1 },
  pathStart: { fontSize: 15, fontWeight: '600' },
  pathEnd: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  pathMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
  },
  pathMetaText: { fontSize: 13 },

  // Correction cards (new)
  correctionCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  correctionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  correctionIconContainer: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctionCrosshair: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
  correctionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  correctionInfo: {
    flex: 1,
  },
  correctionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  correctionOffset: {
    fontSize: 13,
    marginTop: 2,
  },
  snapBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  snapBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  correctionDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
  },
  correctionDetailItem: {
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  correctionNote: {
    fontSize: 11,
    marginTop: 8,
    lineHeight: 15,
  },

  // Empty state
  emptyState: { paddingTop: 100, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', maxWidth: 240 },
});
