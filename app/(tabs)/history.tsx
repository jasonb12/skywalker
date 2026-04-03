import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { formatDistance, formatTime, formatTimestamp } from '@/lib/format';
import { buildRoute } from '@/lib/pathfinding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { SavedPath } from '@/lib/types';
import { useRouter } from 'expo-router';

export default function HistoryScreen() {
  const colors = useColors();
  const { state, dispatch } = useNavigation();
  const router = useRouter();

  const handleReplay = useCallback(
    (path: SavedPath) => {
      haptic.medium();
      // Build route from saved node IDs
      if (path.nodeIds.length < 2) return;
      const route = buildRoute(path.nodeIds, state.nodes, state.edges);
      const destNode = state.nodes.find((n) => n.id === path.endNodeId);
      if (!destNode) return;
      dispatch({ type: 'START_NAVIGATION', route, business: null, destNode });
      router.push('/(tabs)');
    },
    [state.nodes, state.edges, dispatch, router]
  );

  const renderPath = useCallback(
    ({ item }: { item: SavedPath }) => (
      <TouchableOpacity
        style={[styles.pathCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => handleReplay(item)}
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
              {item.startName}
            </Text>
            <Text style={[styles.pathEnd, { color: colors.foreground }]} numberOfLines={1}>
              {item.endName}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </View>
        <View style={styles.pathMeta}>
          <Text style={[styles.pathMetaText, { color: colors.muted }]}>
            {formatTimestamp(item.timestamp)}
          </Text>
          <Text style={[styles.pathMetaText, { color: colors.muted }]}>
            {formatDistance(item.distance, state.distanceUnit)} · {formatTime(item.duration)}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [colors, state.distanceUnit, handleReplay]
  );

  return (
    <ScreenContainer className="flex-1">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>History</Text>
      </View>
      <FlatList
        data={state.savedPaths}
        keyExtractor={(item) => item.id}
        renderItem={renderPath}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <IconSymbol name="clock.fill" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No navigation history</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              Your completed routes will appear here
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 12 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
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
    borderTopColor: '#E2E5E9',
  },
  pathMetaText: { fontSize: 13 },
  emptyState: { paddingTop: 100, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', maxWidth: 240 },
});
