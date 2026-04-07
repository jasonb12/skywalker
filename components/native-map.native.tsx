import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  MapView,
  Camera,
  RasterSource,
  RasterLayer,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  FillLayer,
  ShapeSource,
  UserLocation,
  type MapViewRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNavigation } from '@/lib/navigation-store';
import { haptic } from '@/lib/haptics';
import { formatDistance, formatTime } from '@/lib/format';
import { findNearestNode, haversine } from '@/lib/skyway-data';
import { findPath, buildRoute } from '@/lib/pathfinding';
import { savePath } from '@/lib/storage';
import type { SavedPath, NavigationStep } from '@/lib/types';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getGeojsonUrl, getFontGlyphsUrl, SKYWAY_BOUNDS } from '@/lib/map-config';

const MPLS_CENTER: [number, number] = [-93.270, 44.976];
const DEFAULT_ZOOM = 15;

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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useNavigation();
  const mapRef = useRef<MapViewRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const fontUrl = useMemo(() => getFontGlyphsUrl(), []);

  // S3 CDN GeoJSON URLs for each skyway layer
  const geojsonUrls = useMemo(() => ({
    footwaySimple: getGeojsonUrl('footway-simple'),
    footway: getGeojsonUrl('footway'),
    building: getGeojsonUrl('building'),
    buildingNames: getGeojsonUrl('building-names'),
    buildingSimple: getGeojsonUrl('building-simple'),
    roadway: getGeojsonUrl('roadway'),
    poi: getGeojsonUrl('poi'),
  }), []);

  const nodeMap = useMemo(
    () => new Map(state.nodes.map((n) => [n.id, n])),
    [state.nodes]
  );

  const buildingMap = useMemo(
    () => new Map(state.buildings.map((b) => [b.id, b])),
    [state.buildings]
  );

  // Build the MapLibre style JSON — base map only (CARTO raster tiles)
  // Skyway layers are added as ShapeSource components with url prop pointing to S3 CDN
  const mapStyle = useMemo(() => {
    const baseTile = isDark ? 'dark_all' : 'light_all';
    return {
      version: 8 as const,
      sources: {
        'carto-positron': {
          type: 'raster' as const,
          tiles: [
            `https://a.basemaps.cartocdn.com/${baseTile}/{z}/{x}/{y}@2x.png`,
            `https://b.basemaps.cartocdn.com/${baseTile}/{z}/{x}/{y}@2x.png`,
            `https://c.basemaps.cartocdn.com/${baseTile}/{z}/{x}/{y}@2x.png`,
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap © CARTO',
        },
      },
      glyphs: fontUrl,
      layers: [
        {
          id: 'base-map',
          type: 'raster' as const,
          source: 'carto-positron',
          minzoom: 0,
          maxzoom: 20,
        },
      ],
    };
  }, [isDark, fontUrl]);

  // Route GeoJSON for active navigation
  const routeGeoJSON = useMemo(() => {
    if (!state.activeRoute) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const coords = state.activeRoute.nodeIds
      .map((id) => {
        const n = nodeMap.get(id);
        return n ? [n.longitude, n.latitude] : null;
      })
      .filter(Boolean) as [number, number][];

    if (coords.length < 2) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {},
      }],
    };
  }, [state.activeRoute, nodeMap]);

  // User location GeoJSON
  const userLocationGeoJSON = useMemo(() => {
    if (!state.userPosition) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [state.userPosition.longitude, state.userPosition.latitude],
        },
        properties: {},
      }],
    };
  }, [state.userPosition]);

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
    if (state.userPosition && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [state.userPosition.longitude, state.userPosition.latitude],
        zoomLevel: 16,
        animationDuration: 500,
      });
    } else if (cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: MPLS_CENTER,
        zoomLevel: DEFAULT_ZOOM,
        animationDuration: 500,
      });
    }
  }, [state.userPosition]);

  const handleNavigateTo = useCallback(
    async (businessId: string) => {
      haptic.medium();
      const business = state.businesses.find((b) => b.id === businessId);
      if (!business) return;

      const userPos = state.userPosition ?? { latitude: 44.976, longitude: -93.270 };
      const startNode = await findNearestNode(userPos.latitude, userPos.longitude);
      if (!startNode) return;

      const endNode = await findNearestNode(business.latitude, business.longitude);
      if (!endNode) return;

      const pathIds = findPath(startNode.id, endNode.id, state.nodes, state.edges);
      if (!pathIds) return;

      const route = buildRoute(pathIds, state.nodes, state.edges);
      dispatch({ type: 'START_NAVIGATION', route, business, destNode: endNode });
      setSelectedBusiness(null);

      // Fit camera to route bounds
      const routeNodes = pathIds
        .map((id) => nodeMap.get(id))
        .filter(Boolean);
      if (routeNodes.length > 0 && cameraRef.current) {
        const lngs = routeNodes.map((n) => n!.longitude);
        const lats = routeNodes.map((n) => n!.latitude);
        const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
        const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
        cameraRef.current.fitBounds(ne, sw, [120, 40, 200, 40], 500);
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

  // Style colors based on theme
  const textColor = isDark ? 'rgba(220,220,220,1)' : 'rgba(0,0,0,1)';
  const haloColor = isDark ? 'rgba(21,23,24,0.9)' : 'rgba(255,255,255,0.9)';
  const roadColor = isDark ? '#333' : '#dedcdd';
  const roadTextColor = isDark ? '#888' : '#78787d';
  const buildingFillColor = isDark ? '#2a2a2a' : '#e8e8e8';
  const buildingOutlineColor = isDark ? '#444' : '#c0c0c0';
  const poiColor = isDark ? 'rgba(100,100,100,1)' : 'rgba(205,205,205,1)';
  const poiTextColor = isDark ? 'rgba(200,200,200,1)' : 'rgba(45,45,45,1)';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={mapStyle as any}
        logoEnabled={false}
        attributionEnabled={true}
        attributionPosition={{ bottom: 8, left: 8 }}
        compassEnabled={true}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: MPLS_CENTER,
            zoomLevel: DEFAULT_ZOOM,
          }}
        />

        {/* ─── Skyway GeoJSON layers from S3 CDN ─── */}

        {/* Roadway — rendered first so skyways appear above roads */}
        <ShapeSource id="skyway-roadway" url={geojsonUrls.roadway}>
          <LineLayer
            id="roadway-path"
            style={{
              lineColor: roadColor,
              lineWidth: 8,
            }}
          />
          <SymbolLayer
            id="roadway-name"
            style={{
              textField: ['get', 'name'],
              textFont: ['Overpass Italic'],
              textRotationAlignment: 'map',
              symbolPlacement: 'line',
              textSize: ['interpolate', ['exponential', 2], ['zoom'], 14, 6, 18, 18],
              textTransform: 'uppercase',
              textAllowOverlap: false,
              textKeepUpright: true,
              textColor: roadTextColor,
            }}
          />
        </ShapeSource>

        {/* Zoomed out: footway-simple — above roads */}
        <ShapeSource id="skyway-footway-simple" url={geojsonUrls.footwaySimple}>
          <LineLayer
            id="simple-footway-path"
            minZoomLevel={0}
            maxZoomLevel={16.5}
            filter={['all', ['has', 'color'], ['any', ['==', ['coalesce', ['get', 'layer'], ['get', 'level']], '1'], ['all', ['!', ['has', 'layer']], ['!', ['has', 'level']]]]]}
            style={{
              lineCap: 'round',
              lineJoin: 'round',
              lineColor: ['get', 'color'],
              lineWidth: ['interpolate', ['exponential', 2], ['zoom'], 14, 4, 15, 9, 16, 12],
            }}
          />
          <LineLayer
            id="simple-footway-tunnel"
            minZoomLevel={0}
            maxZoomLevel={16.5}
            filter={['all', ['has', 'color'], ['has', 'layer'], ['!=', ['get', 'layer'], '1']]}
            style={{
              lineCap: 'butt' as any,
              lineJoin: 'round',
              lineColor: ['get', 'color'],
              lineWidth: ['interpolate', ['exponential', 2], ['zoom'], 14, 4, 15, 9, 16, 12],
              lineDasharray: [0.9, 0.9],
            }}
          />
        </ShapeSource>

        {/* Zoomed out: building-simple — above skyway paths */}
        <ShapeSource id="skyway-building-simple" url={geojsonUrls.buildingSimple}>
          <CircleLayer
            id="simple-building-dot"
            minZoomLevel={15}
            maxZoomLevel={16.5}
            filter={['all', ['has', 'name']]}
            style={{
              circleRadius: ['interpolate', ['exponential', 2], ['zoom'], 15, 6, 16, 10],
              circleColor: isDark ? '#555' : '#999',
            }}
          />
          <SymbolLayer
            id="simple-building-name"
            minZoomLevel={15}
            maxZoomLevel={16.5}
            filter={['all', ['has', 'name']]}
            style={{
              symbolPlacement: 'point',
              textField: ['get', 'name'],
              textFont: ['Overpass Bold'],
              textSize: 8,
              textTransform: 'uppercase',
              textAllowOverlap: false,
              textAnchor: 'center',
              textMaxWidth: 8,
              textPadding: 0,
              textColor: textColor,
            }}
          />
        </ShapeSource>

        {/* Building polygons (zoomed in) */}
        <ShapeSource id="skyway-building" url={geojsonUrls.building}>
          <FillLayer
            id="building-fill"
            minZoomLevel={16.5}
            style={{
              fillColor: buildingFillColor,
              fillOpacity: 0.8,
            }}
          />
          <LineLayer
            id="building-outline"
            minZoomLevel={16.5}
            style={{
              lineColor: buildingOutlineColor,
              lineWidth: 1,
            }}
          />
        </ShapeSource>

        {/* Footway detail (zoomed in) */}
        <ShapeSource id="skyway-footway" url={geojsonUrls.footway}>
          <LineLayer
            id="footway-tunnel"
            minZoomLevel={16.5}
            filter={['all', ['has', 'color'], ['has', 'layer'], ['!=', ['get', 'layer'], '1']]}
            style={{
              lineCap: 'butt' as any,
              lineJoin: 'round',
              lineColor: ['get', 'color'],
              lineWidth: ['interpolate', ['exponential', 2], ['zoom'], 14, 1, 17, 6],
              lineDasharray: [0.4, 0.6],
            }}
          />
          <LineLayer
            id="footway-path"
            minZoomLevel={16.5}
            filter={['all', ['has', 'color'], ['any', ['==', ['coalesce', ['get', 'layer'], ['get', 'level']], '1'], ['all', ['!', ['has', 'layer']], ['!', ['has', 'level']]]]]}
            style={{
              lineCap: 'round',
              lineJoin: 'round',
              lineColor: ['get', 'color'],
              lineWidth: ['interpolate', ['exponential', 2], ['zoom'], 14, 1, 15, 6, 18, 9],
            }}
          />
        </ShapeSource>

        {/* Building names (zoomed in) */}
        <ShapeSource id="skyway-building-names" url={geojsonUrls.buildingNames}>
          <SymbolLayer
            id="building-name"
            minZoomLevel={16.5}
            filter={['all', ['has', 'name']]}
            style={{
              symbolPlacement: 'point',
              textField: ['get', 'name'],
              textFont: ['Overpass Bold'],
              textSize: ['interpolate', ['exponential', 2], ['zoom'], 16, 9, 18, 14],
              textTransform: 'uppercase',
              textAllowOverlap: false,
              textAnchor: 'center',
              textMaxWidth: 8,
              textPadding: 2,
              textColor: textColor,
              textHaloColor: haloColor,
              textHaloWidth: 2,
            }}
          />
        </ShapeSource>

        {/* POI */}
        <ShapeSource id="skyway-poi" url={geojsonUrls.poi}>
          <CircleLayer
            id="poi-spot"
            maxZoomLevel={17.5}
            style={{
              circleRadius: 2,
              circleColor: poiColor,
            }}
          />
          <SymbolLayer
            id="label-poi-active"
            minZoomLevel={17.5}
            filter={['all', ['has', 'name']]}
            style={{
              symbolPlacement: 'point',
              textField: ['get', 'name'],
              textFont: ['Overpass Regular'],
              textSize: 12,
              textColor: poiTextColor,
            }}
          />
        </ShapeSource>

        {/* ─── Route overlay ─── */}
        <ShapeSource id="route-source" shape={routeGeoJSON as any}>
          <LineLayer
            id="route-outline"
            style={{
              lineWidth: 10,
              lineColor: '#1a73e8',
              lineOpacity: 0.3,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="route-path"
            style={{
              lineWidth: 5,
              lineColor: '#1a73e8',
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {/* User location overlay */}
        <ShapeSource id="user-location-source" shape={userLocationGeoJSON as any}>
          <CircleLayer
            id="user-location-pulse"
            style={{
              circleRadius: 20,
              circleColor: '#4285f4',
              circleOpacity: 0.15,
            }}
          />
          <CircleLayer
            id="user-location-dot"
            style={{
              circleRadius: 8,
              circleColor: '#4285f4',
              circleStrokeWidth: 2.5,
              circleStrokeColor: '#ffffff',
            }}
          />
        </ShapeSource>
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
