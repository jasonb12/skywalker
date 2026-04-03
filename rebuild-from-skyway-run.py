#!/usr/bin/env python3
"""Rebuild Supabase skyway data from skyway.run vector tile data.

Uses actual OSM-sourced path data representing the skyway as walkable paths.
Column names match the actual Supabase table schemas.
"""

import json
import os
import uuid
import math
import requests

SUPABASE_URL = os.environ.get('EXPO_PUBLIC_SUPABASE_URL', 'https://oocciycvadlcculiqpsz.supabase.co')
SUPABASE_KEY = os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY', '')

headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

def supabase_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code not in (200, 201):
        print(f"  ERROR {table}: {resp.status_code} {resp.text[:200]}")
        return False
    return True

def batch_insert(table, rows, batch_size=50):
    success = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        if supabase_post(table, batch):
            success += len(batch)
    print(f"  Inserted {success}/{len(rows)} into {table}")
    return success

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# Load the parsed skyway.run data
with open('skyway-run-data.json') as f:
    data = json.load(f)

footways = data['footways']
buildings_data = data['buildings']
pois_data = data['pois']

# Filter to skyway-specific paths
skyway_paths = [fw for fw in footways if 
    fw.get('class') == 'corridor' or 
    fw.get('bridge') in ('covered', 'yes') or
    fw.get('tunnel') in ('building_passage', 'yes')]

# Filter buildings with names
named_buildings = [b for b in buildings_data if b.get('name')]

# Filter and deduplicate POIs
seen_poi_names = set()
unique_named_pois = []
for p in pois_data:
    if p.get('name') and p['name'] not in seen_poi_names:
        seen_poi_names.add(p['name'])
        unique_named_pois.append(p)

print(f"Skyway paths: {len(skyway_paths)}")
print(f"Named buildings: {len(named_buildings)}")
print(f"Unique named POIs: {len(unique_named_pois)}")

# ============================================================
# 1. Buildings (schema: id, name, map_graph, creator_user_id)
# Store lat/lng/hours in map_graph jsonb
# ============================================================
building_records = []
building_id_map = {}  # name -> id

for b in named_buildings:
    bid = str(uuid.uuid4())
    building_id_map[b['name']] = bid
    building_records.append({
        'id': bid,
        'name': b['name'],
        'creator_user_id': None,
        'map_graph': json.dumps({
            'latitude': b['lat'],
            'longitude': b['lng'],
            'skyway_hours': b.get('skyway_hours', ''),
            'address': b.get('address', ''),
            'osmid': b.get('osmid', '')
        })
    })

# ============================================================
# 2. Skyway nodes (schema: id, building_id, name, latitude, longitude, floor_level, node_type)
# ============================================================
node_records = []
node_id_map = {}  # (lat, lng) -> id

def coord_key(lat, lng):
    return (round(lat, 7), round(lng, 7))

def find_nearest_building(lat, lng, max_dist=0.0005):
    best = None
    best_dist = max_dist
    for b in named_buildings:
        d = ((b['lat'] - lat)**2 + (b['lng'] - lng)**2)**0.5
        if d < best_dist:
            best_dist = d
            best = b
    return best

for path in skyway_paths:
    for coord in path['coords']:
        key = coord_key(coord['lat'], coord['lng'])
        if key not in node_id_map:
            nid = str(uuid.uuid4())
            node_id_map[key] = nid
            
            nearest = find_nearest_building(coord['lat'], coord['lng'])
            nearest_bid = building_id_map.get(nearest['name']) if nearest else None
            
            node_records.append({
                'id': nid,
                'name': path.get('name') or None,
                'node_type': 'entrance' if nearest else 'intersection',
                'latitude': coord['lat'],
                'longitude': coord['lng'],
                'floor_level': 2,
                'building_id': nearest_bid
            })

# ============================================================
# 3. Edges (schema: id, start_node_id, end_node_id, distance_meters, is_accessible, edge_type)
# ============================================================
edge_records = []

for path in skyway_paths:
    coords = path['coords']
    is_bridge = path.get('bridge') in ('covered', 'yes')
    is_tunnel = path.get('tunnel') in ('building_passage', 'yes')
    
    if is_bridge:
        edge_type = 'skyway'
    elif is_tunnel:
        edge_type = 'tunnel'
    else:
        edge_type = 'corridor'
    
    for i in range(len(coords) - 1):
        key1 = coord_key(coords[i]['lat'], coords[i]['lng'])
        key2 = coord_key(coords[i+1]['lat'], coords[i+1]['lng'])
        
        node1_id = node_id_map.get(key1)
        node2_id = node_id_map.get(key2)
        
        if node1_id and node2_id and node1_id != node2_id:
            dist = haversine(coords[i]['lat'], coords[i]['lng'], coords[i+1]['lat'], coords[i+1]['lng'])
            
            edge_records.append({
                'id': str(uuid.uuid4()),
                'start_node_id': node1_id,
                'end_node_id': node2_id,
                'edge_type': edge_type,
                'distance_meters': round(dist, 1),
                'is_accessible': True
            })

# ============================================================
# 4. Businesses (schema: id, building_id, node_id, name, category, description, floor_level, phone, website, skyway_hours, latitude, longitude)
# ============================================================
business_records = []
for p in unique_named_pois[:100]:
    amenity = p.get('amenity', '')
    shop = p.get('shop', '')
    
    if amenity in ('restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'food_court'):
        category = 'food'
    elif shop in ('convenience', 'supermarket', 'department_store', 'clothes', 'jewelry', 'books', 'gift'):
        category = 'retail'
    elif amenity in ('bank', 'post_office', 'pharmacy'):
        category = 'services'
    elif amenity in ('theatre', 'events_venue', 'arts_centre', 'nightclub'):
        category = 'entertainment'
    elif shop in ('hairdresser', 'beauty', 'optician'):
        category = 'services'
    else:
        category = 'other'
    
    nearest = find_nearest_building(p['lat'], p['lng'], max_dist=0.001)
    nearest_bid = building_id_map.get(nearest['name']) if nearest else None
    
    business_records.append({
        'id': str(uuid.uuid4()),
        'name': p['name'],
        'category': category,
        'building_id': nearest_bid,
        'node_id': None,
        'floor_level': 2,
        'latitude': p['lat'],
        'longitude': p['lng'],
        'description': f"{amenity or shop or 'Business'} in the Minneapolis Skyway",
        'website': p.get('website', '') or None,
        'phone': None,
        'skyway_hours': None
    })

# ============================================================
# 5. Beacons (schema: id, building_id, hw_id, label, metadata, beacon_uuid, major, minor, latitude, longitude, floor_level, tx_power)
# ============================================================
beacon_records = []
junction_nodes = [n for n in node_records if n['building_id'] is not None][:30]
for i, node in enumerate(junction_nodes):
    beacon_records.append({
        'id': str(uuid.uuid4()),
        'building_id': node['building_id'],
        'hw_id': f'SKYWLK-{i+1:04d}',
        'label': f'Beacon {i+1}',
        'beacon_uuid': f'SKYWLK-{i+1:04d}-MPLS-BLE1',
        'major': 1,
        'minor': i + 1,
        'latitude': node['latitude'],
        'longitude': node['longitude'],
        'floor_level': 2,
        'tx_power': -59,
        'metadata': json.dumps({'node_id': node['id']})
    })

# ============================================================
# Insert into Supabase
# ============================================================
print(f"\nBuildings: {len(building_records)}")
print(f"Nodes: {len(node_records)}")
print(f"Edges: {len(edge_records)}")
print(f"Businesses: {len(business_records)}")
print(f"Beacons: {len(beacon_records)}")

print("\n=== Inserting into Supabase ===")
print("Inserting buildings...")
batch_insert('buildings', building_records)

print("Inserting nodes...")
batch_insert('skyway_nodes', node_records)

print("Inserting edges...")
batch_insert('skyway_edges', edge_records)

print("Inserting businesses...")
batch_insert('businesses', business_records)

print("Inserting beacons...")
batch_insert('beacons', beacon_records)

print("\n=== DONE ===")
