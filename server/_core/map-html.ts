/**
 * Generates the full HTML page for the skyway map using MapLibre GL JS.
 *
 * Skyway data is loaded from GeoJSON endpoints (one per source layer).
 * Base map uses CARTO raster tiles (free, no API key).
 * All skyway data extracted from OpenStreetMap (ODbL license) via skyway.run.
 */

const FONT_GLYPHS_URL =
  "https://oocciycvadlcculiqpsz.supabase.co/storage/v1/object/public/map-tiles/fonts/{fontstack}/{range}.pbf";

/** Route color definitions from skyway.run data */
const ROUTE_COLORS = [
  { color: '#de1215', name: 'Red', zone: 'Northwest' },
  { color: '#c1105a', name: 'Pink', zone: 'West Central' },
  { color: '#74133f', name: 'Maroon', zone: 'Southwest' },
  { color: '#894406', name: 'Brown', zone: 'Central East' },
  { color: '#008540', name: 'Green', zone: 'Nicollet Mall' },
  { color: '#177eab', name: 'Teal', zone: 'Central West' },
  { color: '#2e3092', name: 'Blue', zone: 'Central South' },
  { color: '#7f3f98', name: 'Purple', zone: 'East' },
  { color: '#666666', name: 'Gray', zone: 'South' },
  { color: '#333333', name: 'Dark Gray', zone: 'Connectors' },
];

/** Bounding box of the skyway network */
const SKYWAY_BOUNDS = {
  sw: [-93.279135, 44.969565],
  ne: [-93.257473, 44.983473],
  center: [-93.268304, 44.976519],
};

export function getMapHTML(
  navBarHTML: string,
  userPosJS: string,
  routeJS: string,
  isDark: boolean,
  tileUrlTemplate?: string
): string {
  const cartoStyle = isDark ? "dark_all" : "light_all";
  const bg = isDark ? "#151718" : "#f0f0f0";
  const navBg = isDark ? "rgba(30,32,34,0.96)" : "rgba(255,255,255,0.96)";
  const navBorder = isDark ? "#334155" : "#d0d0d0";
  const navStepColor = isDark ? "#ECEDEE" : "#1a1a1a";
  const navMetaColor = isDark ? "#9BA1A6" : "#666";
  const attrLinkColor = isDark ? "#7cb8d0" : "#0a7ea4";
  const textColor = isDark ? "rgba(220,220,220,1)" : "rgba(0,0,0,1)";
  const haloColor = isDark ? "rgba(21,23,24,0.9)" : "rgba(255,255,255,0.9)";
  const roadColor = isDark ? "#333" : "#dedcdd";
  const roadTextColor = isDark ? "#888" : "#78787d";
  const buildingFill = isDark ? "#2a2a2a" : "#e8e8e8";
  const buildingOutline = isDark ? "#444" : "#c0c0c0";
  const poiColor = isDark ? "rgba(100,100,100,1)" : "rgba(205,205,205,1)";
  const poiTextColor = isDark ? "rgba(200,200,200,1)" : "rgba(45,45,45,1)";
  const heatStroke = isDark ? "#222" : "#fff";

  // Legend colors
  const legendBg = isDark ? "rgba(21,23,24,0.92)" : "rgba(255,255,255,0.92)";
  const legendText = isDark ? "#ECEDEE" : "#333";
  const legendSubtext = isDark ? "#9BA1A6" : "#666";
  const legendBorder = isDark ? "#334155" : "#e0e0e0";

  // GeoJSON base URL — always use S3 CDN for independence from local server
  const geojsonBase = 'https://d2xsxph8kpxj0f.cloudfront.net/310519663073371114/ni6f2tiWMMwdiAqNoUpTSw/map-tiles';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
  #map { width: 100vw; height: 100vh; }
  .nav-bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: ${navBg};
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 14px 16px; border-top: 1px solid ${navBorder}; z-index: 1000;
  }
  .nav-step { font-size: 15px; font-weight: 600; color: ${navStepColor}; }
  .nav-meta { font-size: 12px; color: ${navMetaColor}; margin-top: 3px; }
  .maplibregl-ctrl-attrib { font-size: 9px !important; opacity: 0.7; }
  .maplibregl-ctrl-attrib a { color: ${attrLinkColor}; text-decoration: none; }
  .maplibregl-ctrl-attrib a:hover { text-decoration: underline; }

  /* Legend */
  .legend-toggle {
    position: fixed;
    bottom: 32px;
    left: 10px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: ${legendBg};
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border: 1px solid ${legendBorder};
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 1001;
    font-size: 16px;
    color: ${legendText};
    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    transition: opacity 0.2s;
  }
  .legend-toggle:hover { opacity: 0.85; }
  .legend-panel {
    position: fixed;
    bottom: 70px;
    left: 10px;
    background: ${legendBg};
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border: 1px solid ${legendBorder};
    border-radius: 10px;
    padding: 10px 12px;
    z-index: 1001;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    max-height: 320px;
    overflow-y: auto;
    display: none;
  }
  .legend-panel.open { display: block; }
  .legend-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: ${legendSubtext};
    margin-bottom: 6px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }
  .legend-swatch {
    width: 20px;
    height: 4px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .legend-swatch.dashed {
    background: repeating-linear-gradient(
      90deg,
      currentColor 0px, currentColor 4px,
      transparent 4px, transparent 7px
    );
    height: 4px;
  }
  .legend-label {
    font-size: 11px;
    color: ${legendText};
    line-height: 1.2;
  }
  .legend-zone {
    font-size: 10px;
    color: ${legendSubtext};
    margin-left: auto;
    white-space: nowrap;
  }
  .legend-divider {
    height: 1px;
    background: ${legendBorder};
    margin: 6px 0;
  }

  /* Fix Position crosshair mode */
  .crosshair-overlay {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    z-index: 2000;
  }
  .crosshair-overlay.active { display: block; }
  .crosshair-center {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 44px; height: 44px;
  }
  .crosshair-ring {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 44px; height: 44px;
    border: 2.5px solid #FF3B30;
    border-radius: 50%;
    opacity: 0.35;
    animation: crosshair-pulse 2s ease-in-out infinite;
  }
  @keyframes crosshair-pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.35; }
    50% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.15; }
  }
  .crosshair-dot {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 10px; height: 10px;
    background: #FF3B30;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .crosshair-line-h, .crosshair-line-v {
    position: absolute;
    background: rgba(255, 59, 48, 0.4);
  }
  .crosshair-line-h {
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 44px; height: 1.5px;
  }
  .crosshair-line-v {
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 1.5px; height: 44px;
  }
  .fix-banner {
    display: none;
    position: fixed;
    top: 60px; left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 59, 48, 0.92);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    color: #fff;
    padding: 10px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    z-index: 2001;
    box-shadow: 0 2px 12px rgba(255, 59, 48, 0.3);
    pointer-events: none;
    white-space: nowrap;
  }
  .fix-banner.active { display: block; }
  .fix-coords {
    display: none;
    position: fixed;
    bottom: 80px; left: 50%;
    transform: translateX(-50%);
    background: ${legendBg};
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border: 1px solid ${legendBorder};
    color: ${legendText};
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 11px;
    font-family: 'SF Mono', 'Menlo', monospace;
    z-index: 2001;
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }
  .fix-coords.active { display: block; }
</style>
</head>
<body>
<div id="map"></div>
${navBarHTML}

<!-- Crosshair overlay for Fix Position mode -->
<div class="crosshair-overlay" id="crosshairOverlay">
  <div class="crosshair-center">
    <div class="crosshair-ring"></div>
    <div class="crosshair-line-h"></div>
    <div class="crosshair-line-v"></div>
    <div class="crosshair-dot"></div>
  </div>
</div>
<div class="fix-banner" id="fixBanner">Drag map to your actual location</div>
<div class="fix-coords" id="fixCoords"></div>

<!-- Legend toggle button -->
<div class="legend-toggle" id="legendToggle" title="Route Legend">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="2" width="14" height="3" rx="1.5" fill="${legendSubtext}" opacity="0.4"/>
    <rect x="1" y="7" width="14" height="3" rx="1.5" fill="${legendSubtext}" opacity="0.4"/>
    <rect x="1" y="12" width="10" height="3" rx="1.5" fill="${legendSubtext}" opacity="0.4"/>
  </svg>
</div>

<!-- Legend panel -->
<div class="legend-panel" id="legendPanel">
  <div class="legend-title">Skyway Routes</div>
  <div id="legendItems"></div>
  <div class="legend-divider"></div>
  <div class="legend-item">
    <div class="legend-swatch dashed" style="color: #666"></div>
    <span class="legend-label">Tunnel</span>
    <span class="legend-zone">Below street</span>
  </div>
</div>

<script>
  var fontUrl = "${FONT_GLYPHS_URL}";
  var geojsonBase = "${geojsonBase}";
  var routeColors = ${JSON.stringify(ROUTE_COLORS)};
  var skywayBounds = ${JSON.stringify(SKYWAY_BOUNDS)};

  // Build legend items
  var legendItems = document.getElementById('legendItems');
  routeColors.forEach(function(rc) {
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = '<div class="legend-swatch" style="background:' + rc.color + '"></div>' +
      '<span class="legend-label">' + rc.name + '</span>' +
      '<span class="legend-zone">' + rc.zone + '</span>';
    legendItems.appendChild(item);
  });

  // Toggle legend
  document.getElementById('legendToggle').addEventListener('click', function() {
    document.getElementById('legendPanel').classList.toggle('open');
  });

  // Empty GeoJSON placeholder
  var emptyFC = { type: "FeatureCollection", features: [] };

  var style = {
    version: 8,
    sources: {
      "carto-positron": {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/${cartoStyle}/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/${cartoStyle}/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/${cartoStyle}/{z}/{x}/{y}@2x.png"
        ],
        tileSize: 256,
        attribution: "&copy; <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions' target='_blank'>CARTO</a>"
      },
      "skyway-footway-simple": { type: "geojson", data: emptyFC, attribution: "Skyway data &copy; <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a> contributors (ODbL)" },
      "skyway-footway": { type: "geojson", data: emptyFC },
      "skyway-building": { type: "geojson", data: emptyFC },
      "skyway-building-names": { type: "geojson", data: emptyFC },
      "skyway-building-simple": { type: "geojson", data: emptyFC },
      "skyway-roadway": { type: "geojson", data: emptyFC },
      "skyway-poi": { type: "geojson", data: emptyFC },
      "location": { type: "geojson", data: emptyFC },
      "route": { type: "geojson", data: emptyFC },
      "heatmap": { type: "geojson", data: emptyFC }
    },
    glyphs: fontUrl,
    layers: [
      {
        id: "base-map",
        type: "raster",
        source: "carto-positron",
        minzoom: 0,
        maxzoom: 20
      },
      {
        id: "roadway-path",
        type: "line",
        source: "skyway-roadway",
        paint: { "line-color": "${roadColor}", "line-width": 8 }
      },
      {
        id: "roadway-name",
        type: "symbol",
        source: "skyway-roadway",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Overpass Italic"],
          "text-rotation-alignment": "map",
          "symbol-placement": "line",
          "text-size": { stops: [[14, 6], [18, 18]], base: 2 },
          "text-transform": "uppercase",
          "text-allow-overlap": false,
          "text-keep-upright": true,
          "text-ignore-placement": true
        },
        paint: { "text-color": "${roadTextColor}" }
      },
      {
        id: "simple-footway-path",
        type: "line",
        source: "skyway-footway-simple",
        minzoom: 0,
        maxzoom: 16.5,
        filter: ["all", ["has", "color"], ["any", ["==", ["coalesce", ["get", "layer"], ["get", "level"]], "1"], ["all", ["!", ["has", "layer"]], ["!", ["has", "level"]]]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["exponential", 2], ["zoom"], 14, 4, 15, 9, 16, 12]
        }
      },
      {
        id: "simple-footway-tunnel",
        type: "line",
        source: "skyway-footway-simple",
        minzoom: 0,
        maxzoom: 16.5,
        filter: ["all", ["has", "color"], ["has", "layer"], ["!=", ["get", "layer"], "1"]],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["exponential", 2], ["zoom"], 14, 4, 15, 9, 16, 12],
          "line-dasharray": [0.9, 0.9]
        }
      },
      {
        id: "simple-building-dot",
        type: "circle",
        source: "skyway-building-simple",
        minzoom: 15,
        maxzoom: 16.5,
        filter: ["all", ["has", "name"]],
        paint: {
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 15, 6, 16, 10],
          "circle-color": "${isDark ? '#555' : '#999'}"
        }
      },
      {
        id: "simple-building-name",
        type: "symbol",
        source: "skyway-building-simple",
        minzoom: 15,
        maxzoom: 16.5,
        filter: ["all", ["has", "name"]],
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "name"],
          "text-font": ["Overpass Bold"],
          "text-size": 8,
          "text-transform": "uppercase",
          "text-allow-overlap": false,
          "text-anchor": "center",
          "text-max-width": 8,
          "text-padding": 0,
          "text-variable-anchor-offset": ["literal", ["top", [0, -4], "bottom", [0, 4], "top-right", [-1, 2]]]
        },
        paint: { "text-color": "${textColor}" }
      },
      {
        id: "building-fill",
        type: "fill",
        source: "skyway-building",
        minzoom: 16.5,
        paint: { "fill-color": "${buildingFill}", "fill-opacity": 0.8 }
      },
      {
        id: "building-outline",
        type: "line",
        source: "skyway-building",
        minzoom: 16.5,
        paint: { "line-color": "${buildingOutline}", "line-width": 1 }
      },
      {
        id: "footway-tunnel",
        type: "line",
        source: "skyway-footway",
        minzoom: 16.5,
        filter: ["all", ["has", "color"], ["has", "layer"], ["!=", ["get", "layer"], "1"]],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": { stops: [[14, 1], [17, 6]], base: 2 },
          "line-dasharray": [0.4, 0.6]
        }
      },
      {
        id: "footway-path",
        type: "line",
        source: "skyway-footway",
        minzoom: 16.5,
        filter: ["all", ["has", "color"], ["any", ["==", ["coalesce", ["get", "layer"], ["get", "level"]], "1"], ["all", ["!", ["has", "layer"]], ["!", ["has", "level"]]]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": { stops: [[14, 1], [15, 6], [18, 9]], base: 2 }
        }
      },
      {
        id: "building-name",
        type: "symbol",
        source: "skyway-building-names",
        minzoom: 16.5,
        filter: ["all", ["has", "name"]],
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "name"],
          "text-font": ["Overpass Bold"],
          "text-size": { stops: [[16, 9], [18, 14]], base: 2 },
          "text-transform": "uppercase",
          "text-allow-overlap": false,
          "text-anchor": "center",
          "text-max-width": 8,
          "text-padding": 2,
          "text-variable-anchor-offset": ["literal", ["top", [0, -1], "bottom", [0, 1], "left", [-1, 0], "right", [1, 0]]]
        },
        paint: {
          "text-color": "${textColor}",
          "text-halo-color": "${haloColor}",
          "text-halo-width": 2
        }
      },
      {
        id: "poi-spot",
        type: "circle",
        source: "skyway-poi",
        maxzoom: 17.5,
        paint: { "circle-radius": 2, "circle-color": "${poiColor}" }
      },
      {
        id: "label-poi-active",
        type: "symbol",
        source: "skyway-poi",
        minzoom: 17.5,
        filter: ["all", ["has", "name"]],
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "name"],
          "text-font": ["Overpass Regular"],
          "text-size": 12
        },
        paint: { "text-color": "${poiTextColor}" }
      },
      {
        id: "heatmap-heat",
        source: "heatmap",
        type: "circle",
        layout: { "visibility": "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 16, 12, 18, 20],
          "circle-color": ["interpolate", ["linear"], ["get", "deviceCount"],
            1, "rgba(0, 128, 255, 0.3)",
            5, "rgba(0, 200, 100, 0.4)",
            10, "rgba(255, 200, 0, 0.5)",
            20, "rgba(255, 80, 0, 0.6)"
          ],
          "circle-blur": 0.8,
          "circle-opacity": 0.7
        }
      },
      {
        id: "heatmap-points",
        source: "heatmap",
        type: "circle",
        minzoom: 17,
        layout: { "visibility": "none" },
        paint: {
          "circle-radius": 4,
          "circle-color": ["case",
            ["==", ["get", "source"], "calibration"], "#FF6600",
            "#0088FF"
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "${heatStroke}"
        }
      },
      {
        id: "route-outline",
        source: "route",
        type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 10, "line-color": "#1a73e8", "line-opacity": 0.3 }
      },
      {
        id: "route-path",
        source: "route",
        type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 5, "line-color": "#1a73e8" }
      },
      {
        id: "location-pulse",
        source: "location",
        type: "circle",
        paint: { "circle-radius": 20, "circle-color": "#4285f4", "circle-opacity": 0.15 }
      },
      {
        id: "location-dot",
        source: "location",
        type: "circle",
        paint: { "circle-radius": 8, "circle-color": "#4285f4", "circle-stroke-width": 2.5, "circle-stroke-color": "#ffffff" }
      }
    ]
  };

  var map = new maplibregl.Map({
    container: 'map',
    style: style,
    center: skywayBounds.center,
    zoom: 15,
    bearing: 0,
    minZoom: 13,
    maxZoom: 19,
    attributionControl: true,
    pitchWithRotate: false,
    dragRotate: true
  });

  // Load GeoJSON data for each skyway layer, then auto-zoom to fit
  map.on('load', function() {
    var layers = ['footway-simple', 'footway', 'building', 'building-names', 'building-simple', 'roadway', 'poi'];
    var loadedCount = 0;
    var totalLayers = layers.length;

    layers.forEach(function(layer) {
      fetch(geojsonBase + '/' + layer + '?_t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var src = map.getSource('skyway-' + layer);
          if (src) src.setData(data);
          loadedCount++;
          // After all layers loaded, fit bounds to show full skyway network
          if (loadedCount === totalLayers) {
            map.fitBounds(
              [skywayBounds.sw, skywayBounds.ne],
              { padding: { top: 20, bottom: 40, left: 20, right: 20 }, duration: 800 }
            );
          }
        })
        .catch(function(err) {
          console.warn('Failed to load layer ' + layer + ':', err);
          loadedCount++;
        });
    });

    ${userPosJS}
    ${routeJS}

    window.addEventListener('message', function(e) {
      try {
        var msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg.type === 'updateLocation' && msg.lng && msg.lat) {
          map.getSource('location').setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [msg.lng, msg.lat] },
              properties: {}
            }]
          });
          if (msg.flyTo) {
            map.flyTo({ center: [msg.lng, msg.lat], zoom: 16 });
          }
        }
        if (msg.type === 'updateRoute' && msg.coordinates) {
          map.getSource('route').setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: msg.coordinates },
              properties: {}
            }]
          });
          if (msg.coordinates.length > 1) {
            var bounds = msg.coordinates.reduce(function(b, c) {
              return b.extend(c);
            }, new maplibregl.LngLatBounds(msg.coordinates[0], msg.coordinates[0]));
            map.fitBounds(bounds, { padding: 60 });
          }
        }
        if (msg.type === 'flyTo' && msg.lng && msg.lat) {
          map.flyTo({ center: [msg.lng, msg.lat], zoom: msg.zoom || 16 });
        }
        if (msg.type === 'updateHeatmap' && msg.features) {
          map.getSource('heatmap').setData({
            type: 'FeatureCollection',
            features: msg.features
          });
        }
        if (msg.type === 'toggleHeatmap') {
          var vis = map.getLayoutProperty('heatmap-heat', 'visibility');
          var newVis = vis === 'visible' ? 'none' : 'visible';
          map.setLayoutProperty('heatmap-heat', 'visibility', newVis);
          map.setLayoutProperty('heatmap-points', 'visibility', newVis);
          window.parent.postMessage(JSON.stringify({ type: 'heatmapState', visible: newVis === 'visible' }), '*');
        }
        // Fix Position mode
        if (msg.type === 'enterFixMode') {
          document.getElementById('crosshairOverlay').classList.add('active');
          document.getElementById('fixBanner').classList.add('active');
          document.getElementById('fixCoords').classList.add('active');
          if (msg.lng && msg.lat) {
            map.flyTo({ center: [msg.lng, msg.lat], zoom: 17, duration: 600 });
          }
          var sendCenter = function() {
            var c = map.getCenter();
            document.getElementById('fixCoords').textContent = c.lat.toFixed(6) + ', ' + c.lng.toFixed(6);
            window.parent.postMessage(JSON.stringify({
              type: 'crosshairCoords',
              lat: c.lat,
              lng: c.lng
            }), '*');
          };
          map.on('move', sendCenter);
          sendCenter();
          window._fixModeCleanup = function() {
            map.off('move', sendCenter);
          };
        }
        if (msg.type === 'exitFixMode') {
          document.getElementById('crosshairOverlay').classList.remove('active');
          document.getElementById('fixBanner').classList.remove('active');
          document.getElementById('fixCoords').classList.remove('active');
          if (window._fixModeCleanup) {
            window._fixModeCleanup();
            window._fixModeCleanup = null;
          }
          if (msg.correctedLng && msg.correctedLat) {
            map.getSource('location').setData({
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [msg.correctedLng, msg.correctedLat] },
                properties: {}
              }]
            });
          }
        }
      } catch(err) {}
    });
  });

  map.on('error', function(e) {
    console.error('Map error:', e.error ? e.error.message : e);
  });
<\/script>
</body>
</html>`;
}
