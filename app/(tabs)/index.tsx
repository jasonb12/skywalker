import React, { useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';
import { useNavigation } from '@/lib/navigation-store';
import NativeMapComponent from '@/components/native-map';
import skywayData from '@/assets/skyway-data.json';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Web map using an iframe with Leaflet + OpenStreetMap tiles,
 * rendering the real skyway path GeoJSON data with skyway.run colors.
 */
function WebMapFallback() {
  const colors = useColors();
  const { state } = useNavigation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build the Leaflet HTML with embedded skyway data
  const leafletHtml = useMemo(() => {
    const paths = skywayData.paths;
    const buildings = skywayData.buildings;

    // Convert paths to GeoJSON features
    const pathFeatures = paths.map((p: any) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: p.c,
      },
      properties: {
        color: p.color || '#666666',
        cls: p.cls || 'footway',
        bridge: p.bridge || '',
      },
    }));

    // Convert buildings to GeoJSON features
    const buildingFeatures = buildings.map((b: any) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [b.lon, b.lat],
      },
      properties: {
        name: b.name,
        hours: b.hours || '',
      },
    }));

    // Active route overlay
    let routeCoords: number[][] = [];
    if (state.activeRoute) {
      const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
      routeCoords = state.activeRoute.nodeIds
        .map(id => {
          const n = nodeMap.get(id);
          return n ? [n.longitude, n.latitude] : null;
        })
        .filter(Boolean) as number[][];
    }

    // User position
    const userPos = state.userPosition
      ? [state.userPosition.longitude, state.userPosition.latitude]
      : null;

    // Navigation status
    const navInfo = state.isNavigating && state.activeRoute
      ? {
          step: state.activeRoute.steps[state.currentStepIndex]?.instruction || '',
          totalDist: Math.round(state.activeRoute.totalDistance),
          estTime: Math.round(state.activeRoute.estimatedTime / 60),
        }
      : null;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #map { width: 100%; height: calc(100vh - ${navInfo ? 80 : 0}px); }
  .building-label {
    font-size: 9px;
    font-weight: 700;
    color: #1a1a1a;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    text-shadow: 1px 1px 2px rgba(255,255,255,0.95), -1px -1px 2px rgba(255,255,255,0.95),
                 1px -1px 2px rgba(255,255,255,0.95), -1px 1px 2px rgba(255,255,255,0.95),
                 0 0 4px rgba(255,255,255,0.8);
    pointer-events: none;
  }
  .building-label.zoom-low { display: none; }
  .building-dot-low { display: none; }
  .nav-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(10px);
    padding: 12px 16px;
    border-top: 1px solid #e0e0e0;
    z-index: 1000;
  }
  .nav-step { font-size: 14px; font-weight: 600; color: #1a1a1a; }
  .nav-meta { font-size: 12px; color: #666; margin-top: 2px; }
  .leaflet-control-attribution { font-size: 9px !important; }
</style>
</head>
<body>
<div id="map"></div>
${navInfo ? `<div class="nav-bar">
  <div class="nav-step">${navInfo.step}</div>
  <div class="nav-meta">${navInfo.totalDist}m total · ${navInfo.estTime} min</div>
</div>` : ''}
<script>
  var map = L.map('map', {
    center: [44.9765, -93.2710],
    zoom: 16,
    zoomControl: true,
    attributionControl: true,
  });

  // Light gray map tiles (CartoDB Positron - similar to skyway.run background)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  // Skyway paths
  var pathData = ${JSON.stringify(pathFeatures)};
  var pathLayer = L.geoJSON({type:'FeatureCollection', features: pathData}, {
    style: function(feature) {
      var color = feature.properties.color || '#666666';
      var weight = 5;
      var opacity = 0.85;
      var dashArray = null;
      if (feature.properties.bridge === 'yes') {
        weight = 6;
      }
      if (feature.properties.cls === 'steps') {
        dashArray = '4 4';
        weight = 3;
      }
      return {
        color: color,
        weight: weight,
        opacity: opacity,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: dashArray,
      };
    },
    onEachFeature: function(feature, layer) {
      if (feature.properties.bridge === 'yes') {
        layer.bindPopup('Skyway Bridge');
      }
    }
  }).addTo(map);

  // Building labels - zoom-dependent visibility
  var buildingData = ${JSON.stringify(buildingFeatures)};
  var labelMarkers = [];
  var dotMarkers = [];
  
  // Major buildings always visible
  var majorBuildings = ['IDS CENTER','TARGET CENTER','US BANK STADIUM','MINNEAPOLIS CONVENTION CENTER',
    'CITY CENTER','GAVIIDAE COMMON','NICOLLET MALL','FOSHAY TOWER','WELLS FARGO CENTER',
    'HENNEPIN COUNTY GOVERNMENT CENTER','ORCHESTRA HALL','HILTON MINNEAPOLIS',
    'MAYO CLINIC SQUARE','NORTHSTAR','XCEL ENERGY','THE WESTIN MINNEAPOLIS'];
  
  buildingData.forEach(function(b) {
    var coords = b.geometry.coordinates;
    var name = b.properties.name;
    if (!name) return;
    var isMajor = majorBuildings.indexOf(name.toUpperCase()) >= 0;
    var icon = L.divIcon({
      className: 'building-label',
      html: name.length > 22 ? name.substring(0,20).toUpperCase() + '...' : name.toUpperCase(),
      iconSize: null,
      iconAnchor: [0, -6],
    });
    var marker = L.marker([coords[1], coords[0]], { icon: icon, interactive: false });
    labelMarkers.push({ marker: marker, major: isMajor });
    
    var dot = L.circleMarker([coords[1], coords[0]], {
      radius: 3,
      fillColor: '#444',
      fillOpacity: 0.7,
      color: '#444',
      weight: 1,
      opacity: 0.7,
    });
    dotMarkers.push({ marker: dot, major: isMajor });
  });
  
  function updateLabelVisibility() {
    var zoom = map.getZoom();
    labelMarkers.forEach(function(item) {
      if (zoom >= 17 || item.major) {
        if (!map.hasLayer(item.marker)) item.marker.addTo(map);
      } else {
        if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
      }
    });
    dotMarkers.forEach(function(item) {
      if (zoom >= 16 || item.major) {
        if (!map.hasLayer(item.marker)) item.marker.addTo(map);
      } else {
        if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
      }
    });
  }
  
  updateLabelVisibility();
  map.on('zoomend', updateLabelVisibility);

  ${routeCoords.length > 0 ? `
  // Active navigation route
  var routeLatLngs = ${JSON.stringify(routeCoords.map(c => [c[1], c[0]]))};
  L.polyline(routeLatLngs, {
    color: '#00CC66',
    weight: 8,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);
  ` : ''}

  ${userPos ? `
  // User position
  L.circleMarker([${userPos[1]}, ${userPos[0]}], {
    radius: 8,
    fillColor: '#007AFF',
    fillOpacity: 1,
    color: '#FFFFFF',
    weight: 3,
    opacity: 1,
  }).addTo(map);
  // Accuracy ring
  L.circleMarker([${userPos[1]}, ${userPos[0]}], {
    radius: 20,
    fillColor: '#007AFF',
    fillOpacity: 0.15,
    color: '#007AFF',
    weight: 1,
    opacity: 0.3,
  }).addTo(map);
  ` : ''}
<\/script>
</body>
</html>`;
  }, [state.activeRoute, state.userPosition, state.isNavigating, state.currentStepIndex, state.nodes]);

  return (
    <ScreenContainer edges={['top', 'left', 'right']} className="flex-1">
      <View style={styles.mapContainer}>
        <iframe
          ref={iframeRef as any}
          srcDoc={leafletHtml}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            borderRadius: 0,
          }}
          title="Skyway Map"
        />
      </View>
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
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
  },
});
