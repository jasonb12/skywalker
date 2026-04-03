"""
Extract skyway path data from skyway.run vector tiles as GeoJSON.
The tiles contain footway paths with color and region attributes.
"""
import requests
import json
import math
import mapbox_vector_tile

# Tile coordinates for downtown Minneapolis at zoom 15
# lat: 44.970-44.982, lon: -93.280 to -93.260
# At zoom 15, each tile covers ~0.011 degrees lat, ~0.011 degrees lon

def lat_lon_to_tile(lat, lon, zoom):
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_rad) + 1/math.cos(lat_rad)) / math.pi) / 2 * n)
    return x, y

# Get tile range for downtown Minneapolis
zoom = 15
min_lat, max_lat = 44.965, 44.985
min_lon, max_lon = -93.285, -93.255

x_min, y_max = lat_lon_to_tile(min_lat, min_lon, zoom)
x_max, y_min = lat_lon_to_tile(max_lat, max_lon, zoom)

print(f"Tile range: x={x_min}-{x_max}, y={y_min}-{y_max} at zoom {zoom}")

all_footways = []
all_buildings = []
all_pois = []

def tile_to_lat_lon(x, y, z):
    """Convert tile coordinates to lat/lon (top-left corner)"""
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon

for tx in range(x_min, x_max + 1):
    for ty in range(y_min, y_max + 1):
        url = f"https://skyway.run/api/tile/{zoom}/{tx}/{ty}.mvt"
        print(f"  Fetching tile {zoom}/{tx}/{ty}...")
        resp = requests.get(url, timeout=15)
        if resp.status_code != 200:
            print(f"    Skip (status {resp.status_code})")
            continue
        
        try:
            tile_data = mapbox_vector_tile.decode(resp.content)
        except Exception as e:
            print(f"    Error decoding: {e}")
            continue
        
        # Get tile bounds for coordinate conversion
        tile_lat_top, tile_lon_left = tile_to_lat_lon(tx, ty, zoom)
        tile_lat_bottom, tile_lon_right = tile_to_lat_lon(tx + 1, ty + 1, zoom)
        
        # MVT uses 4096x4096 extent by default
        extent = 4096
        
        def mvt_to_latlon(coords):
            """Convert MVT pixel coordinates to lat/lon"""
            result = []
            for c in coords:
                if isinstance(c[0], (list, tuple)):
                    result.append(mvt_to_latlon(c))
                else:
                    px, py = c
                    lon = tile_lon_left + (px / extent) * (tile_lon_right - tile_lon_left)
                    lat = tile_lat_top + (py / extent) * (tile_lat_bottom - tile_lat_top)
                    result.append([lon, lat])
            return result
        
        for layer_name, layer in tile_data.items():
            for feature in layer.get('features', []):
                geom = feature.get('geometry', {})
                props = feature.get('properties', {})
                geom_type = geom.get('type', '')
                coords = geom.get('coordinates', [])
                
                if layer_name in ('footway', 'footway-simple'):
                    if geom_type == 'LineString':
                        converted = mvt_to_latlon(coords)
                        all_footways.append({
                            'type': 'Feature',
                            'geometry': {'type': 'LineString', 'coordinates': converted},
                            'properties': {
                                'color': props.get('color', '#666666'),
                                'region': props.get('region', ''),
                                'bridge': props.get('bridge', ''),
                                'tunnel': props.get('tunnel', ''),
                                'class': props.get('class', ''),
                                'name': props.get('name', ''),
                                'owner': props.get('owner', ''),
                                'layer': layer_name,
                            }
                        })
                    elif geom_type == 'MultiLineString':
                        for line in coords:
                            converted = mvt_to_latlon(line)
                            all_footways.append({
                                'type': 'Feature',
                                'geometry': {'type': 'LineString', 'coordinates': converted},
                                'properties': {
                                    'color': props.get('color', '#666666'),
                                    'region': props.get('region', ''),
                                    'bridge': props.get('bridge', ''),
                                    'tunnel': props.get('tunnel', ''),
                                    'class': props.get('class', ''),
                                    'name': props.get('name', ''),
                                    'owner': props.get('owner', ''),
                                    'layer': layer_name,
                                }
                            })
                
                elif layer_name == 'building-names':
                    if geom_type == 'Point':
                        converted = mvt_to_latlon([coords])[0]
                        all_buildings.append({
                            'type': 'Feature',
                            'geometry': {'type': 'Point', 'coordinates': converted},
                            'properties': {
                                'name': props.get('name', ''),
                                'region': props.get('region', ''),
                                'skyway_hours': props.get('skyway_hours', ''),
                                'opening_hours': props.get('opening_hours', ''),
                            }
                        })
                
                elif layer_name == 'poi':
                    if geom_type == 'Point':
                        converted = mvt_to_latlon([coords])[0]
                        all_pois.append({
                            'type': 'Feature',
                            'geometry': {'type': 'Point', 'coordinates': converted},
                            'properties': {
                                'name': props.get('name', ''),
                                'amenity': props.get('amenity', ''),
                                'shop': props.get('shop', ''),
                                'cuisine': props.get('cuisine', ''),
                                'opening_hours': props.get('opening_hours', ''),
                                'website': props.get('website', ''),
                                'region': props.get('region', ''),
                                'inside': props.get('inside', ''),
                            }
                        })

print(f"\nExtracted: {len(all_footways)} footway segments, {len(all_buildings)} buildings, {len(all_pois)} POIs")

# Get unique colors and regions
colors = set()
regions = set()
for f in all_footways:
    c = f['properties'].get('color', '')
    r = f['properties'].get('region', '')
    if c: colors.add(c)
    if r: regions.add(r)

print(f"Unique colors: {sorted(colors)}")
print(f"Unique regions: {sorted(regions)}")

# Save as GeoJSON
footway_geojson = {
    'type': 'FeatureCollection',
    'features': all_footways
}
building_geojson = {
    'type': 'FeatureCollection',
    'features': all_buildings
}
poi_geojson = {
    'type': 'FeatureCollection',
    'features': all_pois
}

with open('skyway-footways.geojson', 'w') as f:
    json.dump(footway_geojson, f)
with open('skyway-buildings.geojson', 'w') as f:
    json.dump(building_geojson, f)
with open('skyway-pois.geojson', 'w') as f:
    json.dump(poi_geojson, f)

print(f"\nSaved to skyway-footways.geojson, skyway-buildings.geojson, skyway-pois.geojson")

# Print sample footway
if all_footways:
    print(f"\nSample footway: {json.dumps(all_footways[0], indent=2)}")
