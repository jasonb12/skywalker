#!/usr/bin/env python3
"""Download and parse skyway.run MVT tiles to extract footway paths and building data."""

import requests
import mapbox_vector_tile
import json
import math
import gzip

def tile_to_latlng(z, x, y, extent, px, py):
    """Convert tile pixel coordinates to lat/lng."""
    n = 2 ** z
    # Tile bounds
    lon1 = x / n * 360.0 - 180.0
    lon2 = (x + 1) / n * 360.0 - 180.0
    lat1_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat2_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))
    lat1 = math.degrees(lat1_rad)
    lat2 = math.degrees(lat2_rad)
    
    # Interpolate within tile
    frac_x = px / extent
    frac_y = py / extent
    
    lng = lon1 + (lon2 - lon1) * frac_x
    lat = lat1 + (lat2 - lat1) * frac_y
    
    return lat, lng

# Tiles covering the skyway area
z = 15
tiles = [
    (7893, 11789), (7893, 11790), (7893, 11791),
    (7894, 11789), (7894, 11790), (7894, 11791),
    (7895, 11789), (7895, 11790), (7895, 11791),
]

all_footways = []
all_buildings = []
all_pois = []
all_building_names = []

for (tx, ty) in tiles:
    url = f"https://skyway.run/api/tile/{z}/{tx}/{ty}.mvt"
    print(f"Downloading tile {z}/{tx}/{ty}...")
    resp = requests.get(url)
    if resp.status_code != 200:
        print(f"  Failed: {resp.status_code}")
        continue
    
    data = resp.content
    # Try decompressing if gzipped
    try:
        data = gzip.decompress(data)
    except:
        pass
    
    try:
        tile_data = mapbox_vector_tile.decode(data)
    except Exception as e:
        print(f"  Parse error: {e}")
        continue
    
    print(f"  Layers: {list(tile_data.keys())}")
    
    # Extract footways
    if 'footway' in tile_data:
        layer = tile_data['footway']
        extent = layer.get('extent', 4096)
        for feature in layer.get('features', []):
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            geom_type = geom.get('type', '')
            
            if geom_type in ('LineString', 'MultiLineString'):
                coords_list = geom.get('coordinates', [])
                if geom_type == 'LineString':
                    coords_list = [coords_list]
                
                for coords in coords_list:
                    path_coords = []
                    for c in coords:
                        lat, lng = tile_to_latlng(z, tx, ty, extent, c[0], c[1])
                        path_coords.append({'lat': round(lat, 7), 'lng': round(lng, 7)})
                    
                    all_footways.append({
                        'name': props.get('name', ''),
                        'osmid': props.get('osmid', ''),
                        'bridge': props.get('bridge', ''),
                        'tunnel': props.get('tunnel', ''),
                        'level': props.get('level', ''),
                        'layer': props.get('layer', ''),
                        'class': props.get('class', ''),
                        'coords': path_coords
                    })
    
    # Extract building names (POIs inside buildings)
    if 'building-names' in tile_data:
        layer = tile_data['building-names']
        extent = layer.get('extent', 4096)
        for feature in layer.get('features', []):
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            if geom.get('type') == 'Point':
                coords = geom.get('coordinates', [0, 0])
                lat, lng = tile_to_latlng(z, tx, ty, extent, coords[0], coords[1])
                all_building_names.append({
                    'name': props.get('name', ''),
                    'address': props.get('address', ''),
                    'osmid': props.get('osmid', ''),
                    'building': props.get('building', ''),
                    'skyway_hours': props.get('skyway_hours', ''),
                    'lat': round(lat, 7),
                    'lng': round(lng, 7)
                })
    
    # Extract POIs
    if 'poi' in tile_data:
        layer = tile_data['poi']
        extent = layer.get('extent', 4096)
        for feature in layer.get('features', []):
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            if geom.get('type') == 'Point':
                coords = geom.get('coordinates', [0, 0])
                lat, lng = tile_to_latlng(z, tx, ty, extent, coords[0], coords[1])
                all_pois.append({
                    'name': props.get('name', ''),
                    'amenity': props.get('amenity', ''),
                    'shop': props.get('shop', ''),
                    'cuisine': props.get('cuisine', ''),
                    'osmid': props.get('osmid', ''),
                    'inside': props.get('inside', ''),
                    'level': props.get('level', ''),
                    'website': props.get('website', ''),
                    'lat': round(lat, 7),
                    'lng': round(lng, 7)
                })

# Deduplicate by osmid
seen_footway_ids = set()
unique_footways = []
for fw in all_footways:
    key = fw['osmid'] + str(fw['coords'][:2])
    if key not in seen_footway_ids:
        seen_footway_ids.add(key)
        unique_footways.append(fw)

seen_building_ids = set()
unique_buildings = []
for b in all_building_names:
    if b['osmid'] and b['osmid'] not in seen_building_ids:
        seen_building_ids.add(b['osmid'])
        unique_buildings.append(b)
    elif not b['osmid']:
        unique_buildings.append(b)

seen_poi_ids = set()
unique_pois = []
for p in all_pois:
    if p['osmid'] and p['osmid'] not in seen_poi_ids:
        seen_poi_ids.add(p['osmid'])
        unique_pois.append(p)
    elif not p['osmid']:
        unique_pois.append(p)

print(f"\n=== RESULTS ===")
print(f"Unique footway segments: {len(unique_footways)}")
print(f"Unique buildings: {len(unique_buildings)}")
print(f"Unique POIs: {len(unique_pois)}")

# Save all data
output = {
    'footways': unique_footways,
    'buildings': unique_buildings,
    'pois': unique_pois
}

with open('skyway-run-data.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"\nSaved to skyway-run-data.json")

# Print some samples
print(f"\n--- Sample footways ---")
for fw in unique_footways[:5]:
    print(f"  {fw['name'] or 'unnamed'} (osmid={fw['osmid']}, bridge={fw['bridge']}, class={fw['class']}): {len(fw['coords'])} points")
    if fw['coords']:
        print(f"    Start: ({fw['coords'][0]['lat']}, {fw['coords'][0]['lng']})")
        print(f"    End:   ({fw['coords'][-1]['lat']}, {fw['coords'][-1]['lng']})")

print(f"\n--- Sample buildings ---")
for b in unique_buildings[:10]:
    print(f"  {b['name']} ({b['lat']}, {b['lng']}) skyway_hours={b['skyway_hours']}")

print(f"\n--- Sample POIs ---")
for p in unique_pois[:10]:
    print(f"  {p['name']} ({p['lat']}, {p['lng']}) amenity={p['amenity']} shop={p['shop']}")
