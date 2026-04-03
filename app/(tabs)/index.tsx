import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import Svg, {
  Line,
  Circle,
  Text as SvgText,
  G,
  Rect,
  ClipPath,
} from 'react-native-svg';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import NativeMapComponent from '@/components/native-map';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SVG_WIDTH = Math.min(SCREEN_WIDTH - 24, 600);
const SVG_HEIGHT = SVG_WIDTH * 1.3;
const PADDING = 15;

// Use percentile bounds to clip outliers and focus on core skyway
function percentileBounds(values: number[], lo: number, hi: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const loIdx = Math.floor(sorted.length * lo);
  const hiIdx = Math.ceil(sorted.length * hi) - 1;
  return { min: sorted[Math.max(0, loIdx)], max: sorted[Math.min(sorted.length - 1, hiIdx)] };
}

// Deduplicate labels that are too close together, prioritizing shorter names (more recognizable)
function deduplicateLabels(
  items: Array<{ x: number; y: number; label: string; id: string }>,
  minDist: number
): Array<{ x: number; y: number; label: string; id: string }> {
  // Sort by label length (shorter = more recognizable landmark names)
  const sorted = [...items].sort((a, b) => a.label.length - b.label.length);
  const result: typeof items = [];
  for (const item of sorted) {
    const tooClose = result.some(
      (r) => Math.hypot(r.x - item.x, r.y - item.y) < minDist
    );
    if (!tooClose) {
      result.push(item);
    }
  }
  return result;
}

function WebMapFallback() {
  const colors = useColors();
  const { state } = useNavigation();

  const mapData = useMemo(() => {
    if (state.nodes.length === 0) return null;

    const lats = state.nodes.map((n) => n.latitude);
    const lngs = state.nodes.map((n) => n.longitude);

    // Use 5th-95th percentile to clip outliers and focus on the core skyway
    const latBounds = percentileBounds(lats, 0.03, 0.97);
    const lngBounds = percentileBounds(lngs, 0.03, 0.97);

    // Add a small margin
    const margin = 0.0003;
    const minLat = latBounds.min - margin;
    const maxLat = latBounds.max + margin;
    const minLng = lngBounds.min - margin;
    const maxLng = lngBounds.max + margin;

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;

    const drawW = SVG_WIDTH - PADDING * 2;
    const drawH = SVG_HEIGHT - PADDING * 2;

    // Cosine correction for longitude at this latitude
    const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const adjustedLngRange = lngRange * cosLat;

    const latScale = drawH / latRange;
    const lngScale = drawW / adjustedLngRange;
    const scale = Math.min(latScale, lngScale);

    const offsetX = (drawW - adjustedLngRange * scale) / 2 + PADDING;
    const offsetY = (drawH - latRange * scale) / 2 + PADDING;

    const toSvg = (lat: number, lng: number) => ({
      x: (lng - minLng) * cosLat * scale + offsetX,
      y: (maxLat - lat) * scale + offsetY,
    });

    const inBounds = (lat: number, lng: number) =>
      lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;

    // Build node position lookup (only nodes in bounds)
    const nodePos: Record<string, { x: number; y: number }> = {};
    for (const n of state.nodes) {
      nodePos[n.id] = toSvg(n.latitude, n.longitude);
    }

    // Build edges with SVG coords, colored by type
    const edgeLines = state.edges
      .map((e) => {
        const from = nodePos[e.start_node_id];
        const to = nodePos[e.end_node_id];
        if (!from || !to) return null;
        // Skip edges that are entirely outside the visible area
        if (
          (from.x < -20 && to.x < -20) ||
          (from.x > SVG_WIDTH + 20 && to.x > SVG_WIDTH + 20) ||
          (from.y < -20 && to.y < -20) ||
          (from.y > SVG_HEIGHT + 20 && to.y > SVG_HEIGHT + 20)
        )
          return null;
        return {
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          type: e.edge_type,
        };
      })
      .filter(Boolean) as Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      type: string;
    }>;

    // Build entrance nodes with building labels (only in bounds)
    const buildingMap = new Map(state.buildings.map((b) => [b.id, b]));
    const entranceNodesRaw = state.nodes
      .filter(
        (n) =>
          n.node_type === 'entrance' &&
          n.building_id &&
          inBounds(n.latitude, n.longitude)
      )
      .map((n) => {
        const pos = nodePos[n.id];
        const building = buildingMap.get(n.building_id!);
        const label = building ? building.name : n.name || '';
        const shortLabel =
          label.length > 16 ? label.substring(0, 14) + '…' : label;
        return { ...pos, label: shortLabel, id: n.id };
      })
      .filter((n) => n.label);

    // Deduplicate labels that are too close
    const entranceNodes = deduplicateLabels(entranceNodesRaw, 22);

    // Intersection nodes (small dots, only in bounds)
    const junctionNodes = state.nodes
      .filter(
        (n) =>
          (n.node_type === 'intersection' || !n.building_id) &&
          inBounds(n.latitude, n.longitude)
      )
      .map((n) => nodePos[n.id]);

    // User position
    let userDot = null;
    if (state.userPosition) {
      userDot = toSvg(
        state.userPosition.latitude,
        state.userPosition.longitude
      );
    }

    // Active route
    let routeLines: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }> = [];
    if (state.activeRoute) {
      for (let i = 0; i < state.activeRoute.nodeIds.length - 1; i++) {
        const from = nodePos[state.activeRoute.nodeIds[i]];
        const to = nodePos[state.activeRoute.nodeIds[i + 1]];
        if (from && to) {
          routeLines.push({
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
          });
        }
      }
    }

    return {
      edgeLines,
      entranceNodes,
      junctionNodes,
      userDot,
      routeLines,
    };
  }, [
    state.nodes,
    state.edges,
    state.buildings,
    state.businesses,
    state.userPosition,
    state.activeRoute,
  ]);

  const edgeColor = (type: string) => {
    switch (type) {
      case 'skyway':
        return '#4DA6FF';
      case 'corridor':
        return '#2E86DE';
      case 'tunnel':
        return '#8B5CF6';
      default:
        return '#2E86DE';
    }
  };

  const edgeWidth = (type: string) => {
    switch (type) {
      case 'skyway':
        return 3;
      case 'corridor':
        return 2;
      case 'tunnel':
        return 2;
      default:
        return 2;
    }
  };

  return (
    <ScreenContainer className="flex-1">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.webMapTitle, { color: colors.foreground }]}>
            Minneapolis Skyway
          </Text>
          <Text style={[styles.webMapSubtitle, { color: colors.muted }]}>
            {state.buildings.length} buildings · {state.edges.length} paths ·{' '}
            {state.businesses.length} businesses
          </Text>
        </View>

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendLine, { backgroundColor: '#4DA6FF' }]}
            />
            <Text style={[styles.legendText, { color: colors.muted }]}>
              Skyway
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendLine, { backgroundColor: '#2E86DE' }]}
            />
            <Text style={[styles.legendText, { color: colors.muted }]}>
              Corridor
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendLine, { backgroundColor: '#8B5CF6' }]}
            />
            <Text style={[styles.legendText, { color: colors.muted }]}>
              Tunnel
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendDot, { backgroundColor: '#FF6B35' }]}
            />
            <Text style={[styles.legendText, { color: colors.muted }]}>
              Building
            </Text>
          </View>
        </View>

        {mapData ? (
          <View
            style={[
              styles.svgContainer,
              { backgroundColor: '#0B1929', borderColor: colors.border },
            ]}
          >
            <Svg width={SVG_WIDTH} height={SVG_HEIGHT}>
              {/* Clip to SVG bounds */}
              <ClipPath id="mapClip">
                <Rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} />
              </ClipPath>

              <G clipPath="url(#mapClip)">
                {/* Background */}
                <Rect
                  x={0}
                  y={0}
                  width={SVG_WIDTH}
                  height={SVG_HEIGHT}
                  fill="#0B1929"
                />

                {/* Draw all path edges */}
                {mapData.edgeLines.map((e, i) => (
                  <Line
                    key={`e-${i}`}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke={edgeColor(e.type)}
                    strokeWidth={edgeWidth(e.type)}
                    strokeLinecap="round"
                    opacity={0.8}
                  />
                ))}

                {/* Draw active route on top */}
                {mapData.routeLines.map((e, i) => (
                  <Line
                    key={`r-${i}`}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke="#00FF88"
                    strokeWidth={4.5}
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                ))}

                {/* Draw junction nodes (small dots) */}
                {mapData.junctionNodes.map((n, i) => (
                  <Circle
                    key={`j-${i}`}
                    cx={n.x}
                    cy={n.y}
                    r={1.5}
                    fill="#2E86DE"
                    opacity={0.5}
                  />
                ))}

                {/* Draw building entrance nodes with labels */}
                {mapData.entranceNodes.map((n, i) => (
                  <G key={`b-${i}`}>
                    <Circle cx={n.x} cy={n.y} r={3} fill="#FF6B35" />
                    <SvgText
                      x={n.x}
                      y={n.y - 5}
                      fontSize={4}
                      fill="#E0E8F0"
                      textAnchor="middle"
                      fontWeight="600"
                    >
                      {n.label}
                    </SvgText>
                  </G>
                ))}

                {/* User position dot */}
                {mapData.userDot && (
                  <G>
                    <Circle
                      cx={mapData.userDot.x}
                      cy={mapData.userDot.y}
                      r={10}
                      fill="#007AFF"
                      opacity={0.2}
                    />
                    <Circle
                      cx={mapData.userDot.x}
                      cy={mapData.userDot.y}
                      r={6}
                      fill="#007AFF"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                  </G>
                )}
              </G>
            </Svg>
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.tint} />
        )}

        {/* Navigation status */}
        {state.isNavigating && state.activeRoute && (
          <View
            style={[
              styles.navStatusCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.navStatusTitle, { color: colors.foreground }]}>
              Navigating
            </Text>
            <Text style={[styles.navStatusStep, { color: colors.muted }]}>
              {state.activeRoute.steps[state.currentStepIndex]?.instruction ??
                ''}
            </Text>
            <Text style={[styles.navStatusDist, { color: colors.primary }]}>
              {Math.round(state.activeRoute.totalDistance)}m total ·{' '}
              {Math.round(state.activeRoute.estimatedTime / 60)} min
            </Text>
          </View>
        )}

        <Text style={[styles.webNote, { color: colors.muted }]}>
          On iPhone, the map uses Apple Maps with live GPS positioning,
          turn-by-turn navigation, and BLE beacon indoor tracking.
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
        <Text style={[styles.loadingText, { color: colors.muted }]}>
          Loading skyway data...
        </Text>
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
  scrollContent: {
    paddingBottom: 100,
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    alignItems: 'center',
  },
  webMapTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  webMapSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: 11,
  },
  svgContainer: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginHorizontal: 12,
    marginBottom: 12,
    alignSelf: 'center',
  },
  navStatusCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  navStatusTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  navStatusStep: {
    fontSize: 14,
    marginBottom: 4,
  },
  navStatusDist: {
    fontSize: 13,
    fontWeight: '600',
  },
  webNote: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 17,
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
});
