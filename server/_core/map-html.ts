/**
 * Generates the full HTML page for the skyway map using MapLibre GL JS.
 * This is served from the Express server so the iframe has a proper origin
 * and MapLibre's web workers can fetch tiles without CORS issues.
 */
export function getMapHTML(
  navBarHTML: string,
  userPosJS: string,
  routeJS: string,
  isDark: boolean
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${isDark ? '#151718' : '#f0f0f0'}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
  #map { width: 100vw; height: 100vh; }
  .nav-bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: ${isDark ? 'rgba(30,32,34,0.96)' : 'rgba(255,255,255,0.96)'};
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 14px 16px; border-top: 1px solid ${isDark ? '#334155' : '#d0d0d0'}; z-index: 1000;
  }
  .nav-step { font-size: 15px; font-weight: 600; color: ${isDark ? '#ECEDEE' : '#1a1a1a'}; }
  .nav-meta { font-size: 12px; color: ${isDark ? '#9BA1A6' : '#666'}; margin-top: 3px; }
  .maplibregl-ctrl-attrib { font-size: 9px !important; opacity: 0.7; }
  .maplibregl-ctrl-attrib a { color: ${isDark ? '#7cb8d0' : '#0a7ea4'}; text-decoration: none; }
  .maplibregl-ctrl-attrib a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="map"></div>
${navBarHTML}
<script>
  var style = {
    version: 8,
    sources: {
      "carto-positron": {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/${isDark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/${isDark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/${isDark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}@2x.png"
        ],
        tileSize: 256,
        attribution: "&copy; <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions' target='_blank'>CARTO</a>"
      },
      "skyway": {
        type: "vector",
        tiles: [window.location.origin + "/api/skyway/tile/{z}/{x}/{y}.mvt"],
        minzoom: 14,
        maxzoom: 15,
        bounds: [-93.3032865, 44.9504244, -93.2271296, 44.9908446],
        attribution: "Skyway data &copy; <a href='https://skyway.run' target='_blank'>Skyway.run</a> via <a href='https://www.openstreetmap.org/user/hankbp/diary' target='_blank'>OpenStreetMap</a>"
      },
      "location": {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      },
      "route": {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      }
    },
    glyphs: window.location.origin + "/api/skyway/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "base-map",
        type: "raster",
        source: "carto-positron",
        minzoom: 0,
        maxzoom: 20
      },

      // === ZOOMED OUT (z < 16.5): footway-simple + building-simple ===
      {
        id: "simple-footway-path",
        type: "line",
        source: "skyway",
        "source-layer": "footway-simple",
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
        source: "skyway",
        "source-layer": "footway-simple",
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
        source: "skyway",
        "source-layer": "building-simple",
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
        source: "skyway",
        "source-layer": "building-simple",
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
        paint: {
          "text-color": "${isDark ? 'rgba(220,220,220,1)' : 'rgba(0,0,0,1)'}"
        }
      },

      // === ZOOMED IN (z >= 16.5): footway + building + poi ===
      {
        id: "roadway-path",
        type: "line",
        source: "skyway",
        "source-layer": "roadway",
        paint: { "line-color": "${isDark ? '#333' : '#dedcdd'}", "line-width": 8 }
      },
      {
        id: "roadway-name",
        type: "symbol",
        source: "skyway",
        "source-layer": "roadway",
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
        paint: { "text-color": "${isDark ? '#888' : '#78787d'}" }
      },
      {
        id: "building-fill",
        type: "fill",
        source: "skyway",
        "source-layer": "building",
        minzoom: 16.5,
        paint: {
          "fill-color": "${isDark ? '#2a2a2a' : '#e8e8e8'}",
          "fill-opacity": 0.8
        }
      },
      {
        id: "building-outline",
        type: "line",
        source: "skyway",
        "source-layer": "building",
        minzoom: 16.5,
        paint: { "line-color": "${isDark ? '#444' : '#c0c0c0'}", "line-width": 1 }
      },
      {
        id: "footway-tunnel",
        type: "line",
        source: "skyway",
        "source-layer": "footway",
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
        source: "skyway",
        "source-layer": "footway",
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
        source: "skyway",
        "source-layer": "building-names",
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
          "text-color": "${isDark ? 'rgba(220,220,220,1)' : 'rgba(0,0,0,1)'}",
          "text-halo-color": "${isDark ? 'rgba(21,23,24,0.9)' : 'rgba(255,255,255,0.9)'}",
          "text-halo-width": 2
        }
      },
      {
        id: "poi-spot",
        type: "circle",
        source: "skyway",
        "source-layer": "poi",
        maxzoom: 17.5,
        paint: { "circle-radius": 2, "circle-color": "${isDark ? 'rgba(100,100,100,1)' : 'rgba(205,205,205,1)'}" }
      },
      {
        id: "label-poi-active",
        type: "symbol",
        source: "skyway",
        "source-layer": "poi",
        minzoom: 17.5,
        filter: ["all", ["==", "level", "1"]],
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "name"],
          "text-font": ["Overpass Regular"],
          "text-size": 12
        },
        paint: { "text-color": "${isDark ? 'rgba(200,200,200,1)' : 'rgba(45,45,45,1)'}" }
      },

      // === Navigation overlays ===
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
    minZoom: 13,
    maxZoom: 19,
    attributionControl: true,
    pitchWithRotate: false,
    dragRotate: false
  });

  map.on('load', function() {
    ${userPosJS}
    ${routeJS}

    // Listen for postMessage from parent to update location/route
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
          // Fit to route bounds
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
      } catch(err) {
        // ignore parse errors
      }
    });
  });

  map.on('error', function(e) {
    console.error('Map error:', e.error ? e.error.message : e);
  });
<\/script>
</body>
</html>`;
}
