/**
 * Generates the full HTML page for the skyway map using MapLibre GL JS.
 *
 * Skyway data is loaded from GeoJSON endpoints (one per source layer).
 * Base map uses CARTO raster tiles (free, no API key).
 * All skyway data extracted from OpenStreetMap (ODbL license).
 */

const FONT_GLYPHS_URL =
  "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

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

  // Build GeoJSON base URL — use same origin for dev, or tileUrlTemplate base for production
  const geojsonBase = tileUrlTemplate
    ? tileUrlTemplate.replace(/\/skyway-tiles\/.*$/, "/api/skyway/geojson")
    : "/api/skyway/geojson";

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
</style>
</head>
<body>
<div id="map"></div>
${navBarHTML}
<script>
  var fontUrl = "${FONT_GLYPHS_URL}";
  var geojsonBase = "${geojsonBase}";

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
        id: "simple-footway-path",
        type: "line",
        source: "skyway-footway-simple",
        minzoom: 0,
        maxzoom: 16.5,
        filter: ["all", ["==", ["coalesce", ["get", "layer"], ["get", "level"]], "1"]],
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
        filter: ["all", ["!=", ["coalesce", ["get", "layer"], ["get", "level"]], "1"]],
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
        filter: ["all", ["!has", "dot"]],
        paint: {
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 15, 8, 16, 15],
          "circle-color": ["get", "color"]
        }
      },
      {
        id: "simple-building-name",
        type: "symbol",
        source: "skyway-building-simple",
        minzoom: 15,
        maxzoom: 16.5,
        filter: ["all", ["!has", "dot"]],
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
        filter: ["all", ["!=", ["coalesce", ["get", "layer"], ["get", "level"]], "1"], ["has", "color"]],
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
        filter: ["all", ["==", ["coalesce", ["get", "layer"], ["get", "level"]], "1"], ["has", "color"]],
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
        filter: ["all", ["==", "level", "1"]],
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
    center: [-93.270, 44.976],
    zoom: 15,
    bearing: 30,
    minZoom: 13,
    maxZoom: 19,
    attributionControl: true,
    pitchWithRotate: false,
    dragRotate: true
  });

  // Load GeoJSON data for each skyway layer
  map.on('load', function() {
    var layers = ['footway-simple', 'footway', 'building', 'building-names', 'building-simple', 'roadway', 'poi'];
    layers.forEach(function(layer) {
      fetch(geojsonBase + '/' + layer)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var src = map.getSource('skyway-' + layer);
          if (src) src.setData(data);
        })
        .catch(function(err) { console.warn('Failed to load layer ' + layer + ':', err); });
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
