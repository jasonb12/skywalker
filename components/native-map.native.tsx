import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { formatDistance, formatTime } from '@/lib/format';
import { findNearestNode, haversine } from '@/lib/skyway-data';
import { findPath, buildRoute } from '@/lib/pathfinding';
import { savePath } from '@/lib/storage';
import type { SavedPath, NavigationStep } from '@/lib/types';
import { IconSymbol } from '@/components/ui/icon-symbol';

const MPLS_CENTER = { latitude: 44.9755, longitude: -93.2713 };
const MPLS_DELTA = { latitudeDelta: 0.012, longitudeDelta: 0.008 };

function getDirectionIcon(dir: NavigationStep['direction']): string {
  switch (dir) {
    case 'left': return '← ';
    case 'right': return '→ ';
    case 'slight-left': return '↰ ';
    case 'slight-right': return '↱ ';
    case 'u-turn': return '↩ ';
    case 'arrive': return '🏁 ';
    default: return '↑ ';
  }
}

export default function NativeMap() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useNavigation();
  const mapRef = useRef<MapView>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const nodeMap = useMemo(
    () => new Map(state.nodes.map((n) => [n.id, n])),
    [state.nodes]
  );

  const buildingMap = useMemo(
    () => new Map(state.buildings.map((b) => [b.id, b])),
    [state.buildings]
  );

  // Skyway polyline coordinates
  const skywayLines = useMemo(() => {
    return state.edges.map((edge) => {
      const start = nodeMap.get(edge.start_node_id);
      const end = nodeMap.get(edge.end_node_id);
      if (!start || !end) return null;
      return {
        id: edge.id,
        coordinates: [
          { latitude: start.latitude, longitude: start.longitude },
          { latitude: end.latitude, longitude: end.longitude },
        ],
        type: edge.edge_type,
      };
    }).filter(Boolean) as { id: string; coordinates: { latitude: number; longitude: number }[]; type: string }[];
  }, [state.edges, nodeMap]);

  // Active route coordinates
  const routeCoords = useMemo(() => {
    if (!state.activeRoute) return [];
    return state.activeRoute.nodeIds
      .map((id) => {
        const node = nodeMap.get(id);
        return node ? { latitude: node.latitude, longitude: node.longitude } : null;
      })
      .filter(Boolean) as { latitude: number; longitude: number }[];
  }, [state.activeRoute, nodeMap]);

  // Navigation tracking
  useEffect(() => {
    if (!state.isNavigating || !state.userPosition || !state.activeRoute) return;

    const pos = state.userPosition;
    const steps = state.activeRoute.steps;
    const currentStep = steps[state.currentStepIndex];

    if (!currentStep) return;

    const distToStep = haversine(pos.latitude, pos.longitude, currentStep.latitude, currentStep.longitude);

    if (distToStep < 15 && state.currentStepIndex < steps.length - 1) {
      const nextIndex = state.currentStepIndex + 1;
      dispatch({ type: 'UPDATE_STEP', stepIndex: nextIndex });

      if (state.hapticEnabled) {
        const nextStep = steps[nextIndex];
        if (nextStep.direction === 'arrive') {
          haptic.success();
        } else if (nextStep.direction !== 'straight') {
          haptic.turnApproaching();
        }
      }
    }

    if (state.currentStepIndex === steps.length - 1 && distToStep < 15) {
      if (state.hapticEnabled) haptic.success();
      const sp: SavedPath = {
        id: Date.now().toString(),
        startName: steps[0].nodeName,
        endName: steps[steps.length - 1].nodeName,
        startNodeId: steps[0].nodeId,
        endNodeId: steps[steps.length - 1].nodeId,
        distance: state.activeRoute.totalDistance,
        duration: state.activeRoute.estimatedTime,
        timestamp: Date.now(),
        nodeIds: state.activeRoute.nodeIds,
      };
      savePath(sp);
      dispatch({ type: 'ADD_SAVED_PATH', path: sp });
      dispatch({ type: 'END_NAVIGATION' });
      return;
    }

    let minDist = Infinity;
    for (const nid of state.activeRoute.nodeIds) {
      const n = nodeMap.get(nid);
      if (n) {
        const d = haversine(pos.latitude, pos.longitude, n.latitude, n.longitude);
        if (d < minDist) minDist = d;
      }
    }

    if (minDist > 50 && !state.isOffCourse) {
      dispatch({ type: 'SET_OFF_COURSE', isOffCourse: true });
      if (state.hapticEnabled) haptic.offCourse();
    } else if (minDist <= 50 && state.isOffCourse) {
      dispatch({ type: 'SET_OFF_COURSE', isOffCourse: false });
    }
  }, [state.userPosition, state.isNavigating, state.currentStepIndex]);

  const handleRecenter = useCallback(() => {
    haptic.light();
    if (state.userPosition && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: state.userPosition.latitude,
          longitude: state.userPosition.longitude,
          ...MPLS_DELTA,
        },
        500
      );
    } else if (mapRef.current) {
      mapRef.current.animateToRegion({ ...MPLS_CENTER, ...MPLS_DELTA }, 500);
    }
  }, [state.userPosition]);

  const handleNavigateTo = useCallback(
    async (businessId: string) => {
      haptic.medium();
      const business = state.businesses.find((b) => b.id === businessId);
      if (!business) return;

      const userPos = state.userPosition ?? { latitude: MPLS_CENTER.latitude, longitude: MPLS_CENTER.longitude };
      const startNode = await findNearestNode(userPos.latitude, userPos.longitude);
      if (!startNode) return;

      const endNode = await findNearestNode(business.latitude, business.longitude);
      if (!endNode) return;

      const pathIds = findPath(startNode.id, endNode.id, state.nodes, state.edges);
      if (!pathIds) return;

      const route = buildRoute(pathIds, state.nodes, state.edges);
      dispatch({ type: 'START_NAVIGATION', route, business, destNode: endNode });
      setSelectedBusiness(null);

      if (mapRef.current) {
        try {
          mapRef.current.fitToCoordinates(
            pathIds.map((id) => {
              const n = nodeMap.get(id);
              return n ? { latitude: n.latitude, longitude: n.longitude } : null;
            }).filter(Boolean) as { latitude: number; longitude: number }[],
            { edgePadding: { top: 120, right: 40, bottom: 200, left: 40 }, animated: true }
          );
        } catch (e) {
          // ignore
        }
      }
    },
    [state.businesses, state.userPosition, state.nodes, state.edges, nodeMap, dispatch]
  );

  const handleEndNavigation = useCallback(() => {
    haptic.medium();
    dispatch({ type: 'END_NAVIGATION' });
  }, [dispatch]);

  const currentStep = state.activeRoute?.steps[state.currentStepIndex];
  const nextStep = state.activeRoute?.steps[state.currentStepIndex + 1];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ ...MPLS_CENTER, ...MPLS_DELTA }}
        showsUserLocation={false}
        showsCompass={true}
        showsScale={true}
        mapType="standard"
      >
        {/* Skyway route lines */}
        {skywayLines.map((line) => (
          <Polyline
            key={line.id}
            coordinates={line.coordinates}
            strokeColor={line.type === 'skyway' ? '#0066CC88' : '#8B5CF688'}
            strokeWidth={3}
            lineDashPattern={line.type === 'skyway' ? undefined : [5, 5]}
          />
        ))}

        {/* Active route highlight */}
        {state.isNavigating && routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#0066CC"
            strokeWidth={6}
          />
        )}

        {/* Building entrance markers */}
        {state.nodes
          .filter((n) => n.node_type === 'entrance' || n.node_type === 'landmark')
          .map((node) => {
            const building = node.building_id ? buildingMap.get(node.building_id) : null;
            return (
              <Marker
                key={node.id}
                coordinate={{ latitude: node.latitude, longitude: node.longitude }}
                title={building?.name ?? node.name}
                description={node.node_type === 'landmark' ? 'Landmark' : 'Skyway Entrance'}
                pinColor="#8B5CF6"
                opacity={0.8}
              />
            );
          })}

        {/* Business markers */}
        {state.businesses.map((biz) => (
          <Marker
            key={biz.id}
            coordinate={{ latitude: biz.latitude, longitude: biz.longitude }}
            title={biz.name}
            description={biz.category}
            pinColor="#0066CC"
            onCalloutPress={() => {
              setSelectedBusiness(biz.id);
            }}
          />
        ))}

        {/* User position dot */}
        {state.userPosition && (
          <>
            <Circle
              center={{ latitude: state.userPosition.latitude, longitude: state.userPosition.longitude }}
              radius={state.userPosition.accuracy}
              fillColor="rgba(0, 102, 204, 0.1)"
              strokeColor="rgba(0, 102, 204, 0.3)"
              strokeWidth={1}
            />
            <Circle
              center={{ latitude: state.userPosition.latitude, longitude: state.userPosition.longitude }}
              radius={4}
              fillColor="#0066CC"
              strokeColor="#FFFFFF"
              strokeWidth={2}
            />
          </>
        )}

        {/* Destination marker */}
        {state.destinationNode && state.isNavigating && (
          <Marker
            coordinate={{
              latitude: state.destinationNode.latitude,
              longitude: state.destinationNode.longitude,
            }}
            title={state.destinationBusiness?.name ?? state.destinationNode.name}
            pinColor="#10B981"
          />
        )}
      </MapView>

      {/* Top navigation banner */}
      {state.isNavigating && currentStep && (
        <View style={[styles.navBanner, { top: insets.top + 8, backgroundColor: state.isOffCourse ? '#EF4444' : '#0066CC' }]}>
          <View style={styles.navBannerContent}>
            <Text style={styles.navBannerDirection}>
              {getDirectionIcon(nextStep?.direction ?? currentStep.direction)}
            </Text>
            <View style={styles.navBannerTextWrap}>
              <Text style={styles.navBannerInstruction} numberOfLines={2}>
                {state.isOffCourse ? 'Off course — recalculating...' : (nextStep?.instruction ?? currentStep.instruction)}
              </Text>
              <Text style={styles.navBannerMeta}>
                {formatDistance(state.activeRoute!.totalDistance, state.distanceUnit)} · {formatTime(state.activeRoute!.estimatedTime)}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => setShowSteps(!showSteps)}
            style={styles.navStepsToggle}
          >
            <Text style={styles.navStepsToggleText}>{showSteps ? 'Hide' : 'Steps'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Step list */}
      {state.isNavigating && showSteps && state.activeRoute && (
        <View style={[styles.stepList, { top: insets.top + 80, backgroundColor: colors.background }]}>
          {state.activeRoute.steps.map((step, i) => (
            <View
              key={i}
              style={[
                styles.stepItem,
                { borderBottomColor: colors.border },
                i === state.currentStepIndex && { backgroundColor: '#0066CC15' },
              ]}
            >
              <Text style={[styles.stepIcon, { color: i <= state.currentStepIndex ? '#0066CC' : colors.muted }]}>
                {getDirectionIcon(step.direction)}
              </Text>
              <View style={styles.stepTextWrap}>
                <Text
                  style={[
                    styles.stepInstruction,
                    { color: i <= state.currentStepIndex ? colors.foreground : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {step.instruction}
                </Text>
                {step.distance > 0 && (
                  <Text style={[styles.stepDistance, { color: colors.muted }]}>
                    {formatDistance(step.distance, state.distanceUnit)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Bottom controls */}
      {state.isNavigating && (
        <View style={[styles.bottomBar, { bottom: insets.bottom + 64, backgroundColor: colors.background }]}>
          <TouchableOpacity
            onPress={handleEndNavigation}
            style={[styles.endNavButton, { backgroundColor: '#EF4444' }]}
          >
            <Text style={styles.endNavText}>End Navigation</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Business detail card */}
      {selectedBusiness && !state.isNavigating && (
        <View style={[styles.businessCard, { bottom: insets.bottom + 72, backgroundColor: colors.background, borderColor: colors.border }]}>
          {(() => {
            const biz = state.businesses.find((b) => b.id === selectedBusiness);
            if (!biz) return null;
            const building = buildingMap.get(biz.building_id);
            return (
              <>
                <View style={styles.bizCardHeader}>
                  <View style={styles.bizCardInfo}>
                    <Text style={[styles.bizCardName, { color: colors.foreground }]}>{biz.name}</Text>
                    <Text style={[styles.bizCardCategory, { color: colors.muted }]}>{biz.category}</Text>
                    <Text style={[styles.bizCardBuilding, { color: colors.muted }]}>{building?.name}</Text>
                    <Text style={[styles.bizCardHours, { color: colors.muted }]}>{biz.skyway_hours}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedBusiness(null)}
                    style={styles.bizCardClose}
                  >
                    <IconSymbol name="xmark" size={20} color={colors.muted} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => handleNavigateTo(biz.id)}
                  style={[styles.directionsButton, { backgroundColor: '#0066CC' }]}
                >
                  <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />
                  <Text style={styles.directionsButtonText}>Get Directions</Text>
                </TouchableOpacity>
              </>
            );
          })()}
        </View>
      )}

      {/* Recenter button */}
      {!state.isNavigating && (
        <TouchableOpacity
          onPress={handleRecenter}
          style={[styles.recenterButton, { bottom: insets.bottom + 72, backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <IconSymbol name="location.fill" size={22} color="#0066CC" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  navBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  navBannerContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  navBannerDirection: { fontSize: 28, marginRight: 12 },
  navBannerTextWrap: { flex: 1 },
  navBannerInstruction: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  navBannerMeta: { color: '#FFFFFFCC', fontSize: 13, marginTop: 2 },
  navStepsToggle: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFFFFF30', borderRadius: 8 },
  navStepsToggleText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  stepList: {
    position: 'absolute',
    left: 12,
    right: 12,
    maxHeight: 300,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    overflow: 'hidden',
  },
  stepItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  stepIcon: { fontSize: 20, width: 32 },
  stepTextWrap: { flex: 1 },
  stepInstruction: { fontSize: 14, fontWeight: '500' },
  stepDistance: { fontSize: 12, marginTop: 2 },
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  endNavButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  endNavText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  businessCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  bizCardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  bizCardInfo: { flex: 1 },
  bizCardName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  bizCardCategory: { fontSize: 14, marginBottom: 2 },
  bizCardBuilding: { fontSize: 13, marginBottom: 2 },
  bizCardHours: { fontSize: 12 },
  bizCardClose: { padding: 4 },
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
    gap: 8,
  },
  directionsButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  recenterButton: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
});
