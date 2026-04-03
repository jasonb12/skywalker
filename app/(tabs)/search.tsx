import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { formatDistance } from '@/lib/format';
import { haversine, findNearestNode } from '@/lib/skyway-data';
import { findPath, buildRoute } from '@/lib/pathfinding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BUSINESS_CATEGORIES, type BusinessCategory, type Business } from '@/lib/types';
import { useRouter } from 'expo-router';

const CATEGORY_ICONS: Record<string, string> = {
  'All': '📍',
  'food': '🍽️',
  'shopping': '🛍️',
  'services': '✂️',
  'health': '💊',
  'hotel': '🏨',
  'entertainment': '🎭',
  'government': '🏛️',
};

const CATEGORY_LABELS: Record<string, string> = {
  'All': 'All',
  'food': 'Food & Dining',
  'shopping': 'Shopping',
  'services': 'Services',
  'health': 'Health',
  'hotel': 'Hotels',
  'entertainment': 'Entertainment',
  'government': 'Government',
};

const MPLS_CENTER = { latitude: 44.9755, longitude: -93.2713 };

export default function SearchScreen() {
  const colors = useColors();
  const { state, dispatch } = useNavigation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory>('All');

  const buildingMap = useMemo(
    () => new Map(state.buildings.map((b) => [b.id, b])),
    [state.buildings]
  );

  const userLat = state.userPosition?.latitude ?? MPLS_CENTER.latitude;
  const userLng = state.userPosition?.longitude ?? MPLS_CENTER.longitude;

  const filteredBusinesses = useMemo(() => {
    const q = query.toLowerCase().trim();
    return state.businesses
      .filter((b) => {
        const matchesQuery =
          !q ||
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q);
        const matchesCategory = selectedCategory === 'All' || b.category === selectedCategory;
        return matchesQuery && matchesCategory;
      })
      .map((b) => ({
        ...b,
        distance: haversine(userLat, userLng, b.latitude, b.longitude),
      }))
      .sort((a, b) => a.distance - b.distance);
  }, [state.businesses, query, selectedCategory, userLat, userLng]);

  const handleNavigate = useCallback(
    async (business: Business) => {
      haptic.medium();
      const startNode = await findNearestNode(userLat, userLng);
      if (!startNode) return;
      const endNode = await findNearestNode(business.latitude, business.longitude);
      if (!endNode) return;
      const pathIds = findPath(startNode.id, endNode.id, state.nodes, state.edges);
      if (!pathIds) return;
      const route = buildRoute(pathIds, state.nodes, state.edges);
      dispatch({ type: 'START_NAVIGATION', route, business, destNode: endNode });
      router.push('/(tabs)');
    },
    [userLat, userLng, state.nodes, state.edges, dispatch, router]
  );

  const renderBusiness = useCallback(
    ({ item }: { item: Business & { distance: number } }) => {
      const building = buildingMap.get(item.building_id);
      return (
        <TouchableOpacity
          style={[styles.bizCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => handleNavigate(item)}
          activeOpacity={0.7}
        >
          <View style={styles.bizCardLeft}>
            <Text style={styles.bizCardIcon}>{CATEGORY_ICONS[item.category] ?? '📍'}</Text>
          </View>
          <View style={styles.bizCardCenter}>
            <Text style={[styles.bizCardName, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.bizCardMeta, { color: colors.muted }]} numberOfLines={1}>
              {CATEGORY_LABELS[item.category] ?? item.category} · {building?.name ?? ''}
            </Text>
            <Text style={[styles.bizCardHours, { color: colors.muted }]} numberOfLines={1}>
              {item.skyway_hours}
            </Text>
          </View>
          <View style={styles.bizCardRight}>
            <Text style={[styles.bizCardDist, { color: colors.tint }]}>
              {formatDistance(item.distance, state.distanceUnit)}
            </Text>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </View>
        </TouchableOpacity>
      );
    },
    [buildingMap, colors, state.distanceUnit, handleNavigate]
  );

  return (
    <ScreenContainer className="flex-1">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Search</Text>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search businesses, restaurants..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <IconSymbol name="xmark" size={16} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipContainer}
        style={styles.chipScroll}
      >
        {BUSINESS_CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => {
                haptic.selection();
                setSelectedCategory(cat);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? '#0066CC' : colors.surface,
                  borderColor: isActive ? '#0066CC' : colors.border,
                },
              ]}
            >
              <Text style={styles.chipIcon}>{CATEGORY_ICONS[cat] ?? '📍'}</Text>
              <Text
                style={[
                  styles.chipText,
                  { color: isActive ? '#FFFFFF' : colors.foreground },
                ]}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Results */}
      <FlatList
        data={filteredBusinesses}
        keyExtractor={(item) => item.id}
        renderItem={renderBusiness}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {query ? 'No businesses found' : 'Search for a business in the skyway'}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 16 },
  chipScroll: { maxHeight: 48, marginTop: 12 },
  chipContainer: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  chipIcon: { fontSize: 14 },
  chipText: { fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 },
  bizCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  bizCardLeft: { width: 40, alignItems: 'center' },
  bizCardIcon: { fontSize: 24 },
  bizCardCenter: { flex: 1, marginLeft: 10 },
  bizCardName: { fontSize: 16, fontWeight: '600' },
  bizCardMeta: { fontSize: 13, marginTop: 2 },
  bizCardHours: { fontSize: 12, marginTop: 1 },
  bizCardRight: { alignItems: 'flex-end', gap: 4 },
  bizCardDist: { fontSize: 13, fontWeight: '600' },
  emptyState: { paddingTop: 60, alignItems: 'center' },
  emptyText: { fontSize: 16 },
});
