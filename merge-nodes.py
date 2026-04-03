#!/usr/bin/env python3
"""
Merge nearby skyway nodes to create a connected graph.

The OSM data has each skyway bridge/corridor as a separate segment with
slightly different GPS coordinates at shared intersections. This script
merges nodes that are within MERGE_RADIUS meters of each other, creating
a properly connected network for pathfinding.
"""

import os
import math
import json
import uuid
import requests

MERGE_RADIUS = 25  # meters - merge nodes within this distance

url = os.environ.get('EXPO_PUBLIC_SUPABASE_URL')
key = os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')
headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# Fetch all data
print("Fetching data...")
nodes = requests.get(f"{url}/rest/v1/skyway_nodes?select=*", headers=headers).json()
edges = requests.get(f"{url}/rest/v1/skyway_edges?select=*", headers=headers).json()
buildings = requests.get(f"{url}/rest/v1/buildings?select=id,name", headers=headers).json()
print(f"  Nodes: {len(nodes)}, Edges: {len(edges)}, Buildings: {len(buildings)}")

# Step 1: Find clusters of nearby nodes using Union-Find
parent = {}
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb

for n in nodes:
    parent[n['id']] = n['id']

# Compare all pairs (O(n^2) but n=356 is fine)
merge_count = 0
for i in range(len(nodes)):
    for j in range(i + 1, len(nodes)):
        d = haversine(nodes[i]['latitude'], nodes[i]['longitude'],
                      nodes[j]['latitude'], nodes[j]['longitude'])
        if d < MERGE_RADIUS:
            union(nodes[i]['id'], nodes[j]['id'])
            merge_count += 1

print(f"\nMerge pairs found: {merge_count}")

# Step 2: Build merged node set
# For each cluster, pick the node with a building_id (entrance) as the representative,
# or the one with the most connections, and average the coordinates
clusters = {}
for n in nodes:
    root = find(n['id'])
    if root not in clusters:
        clusters[root] = []
    clusters[root].append(n)

print(f"Clusters: {len(clusters)} (from {len(nodes)} nodes)")

# Build new merged nodes
merged_nodes = []
old_to_new = {}  # old node id -> new merged node id

for root, cluster_nodes in clusters.items():
    # Pick the best representative
    # Prefer entrance nodes with building_id
    entrances = [n for n in cluster_nodes if n.get('building_id')]
    representative = entrances[0] if entrances else cluster_nodes[0]
    
    # Average coordinates
    avg_lat = sum(n['latitude'] for n in cluster_nodes) / len(cluster_nodes)
    avg_lng = sum(n['longitude'] for n in cluster_nodes) / len(cluster_nodes)
    
    new_id = representative['id']  # reuse the representative's ID
    
    merged_node = {
        'id': new_id,
        'name': representative.get('name') or None,
        'node_type': representative.get('node_type', 'intersection'),
        'latitude': round(avg_lat, 7),
        'longitude': round(avg_lng, 7),
        'floor_level': representative.get('floor_level', 2),
        'building_id': representative.get('building_id'),
    }
    merged_nodes.append(merged_node)
    
    for n in cluster_nodes:
        old_to_new[n['id']] = new_id

print(f"Merged nodes: {len(merged_nodes)}")

# Step 3: Rebuild edges with merged node IDs, removing self-loops and duplicates
new_edges = []
seen_edges = set()

for e in edges:
    start = old_to_new.get(e['start_node_id'], e['start_node_id'])
    end = old_to_new.get(e['end_node_id'], e['end_node_id'])
    
    if start == end:
        continue  # self-loop after merge
    
    # Canonical edge key (undirected)
    edge_key = tuple(sorted([start, end]))
    if edge_key in seen_edges:
        continue
    seen_edges.add(edge_key)
    
    # Recalculate distance
    start_node = next((n for n in merged_nodes if n['id'] == start), None)
    end_node = next((n for n in merged_nodes if n['id'] == end), None)
    if not start_node or not end_node:
        continue
    
    dist = haversine(start_node['latitude'], start_node['longitude'],
                     end_node['latitude'], end_node['longitude'])
    
    new_edges.append({
        'id': str(uuid.uuid4()),
        'start_node_id': start,
        'end_node_id': end,
        'edge_type': e.get('edge_type', 'corridor'),
        'distance_meters': round(dist, 1),
        'is_accessible': True,
    })

print(f"Merged edges: {len(new_edges)} (from {len(edges)})")

# Step 4: Check connectivity of merged graph
adj = {}
for n in merged_nodes:
    adj[n['id']] = set()
for e in new_edges:
    adj.setdefault(e['start_node_id'], set()).add(e['end_node_id'])
    adj.setdefault(e['end_node_id'], set()).add(e['start_node_id'])

visited = set()
components = []
for nid in adj:
    if nid not in visited:
        component = set()
        stack = [nid]
        while stack:
            curr = stack.pop()
            if curr in visited:
                continue
            visited.add(curr)
            component.add(curr)
            for neighbor in adj.get(curr, set()):
                if neighbor not in visited:
                    stack.append(neighbor)
        components.append(component)

components.sort(key=len, reverse=True)
print(f"\nConnected components after merge: {len(components)}")
for i, comp in enumerate(components[:5]):
    print(f"  Component {i+1}: {len(comp)} nodes")

# Step 5: If still fragmented, try to connect nearby components
# Find the nearest node in the largest component for each smaller component
if len(components) > 1:
    main_component = components[0]
    main_nodes = [n for n in merged_nodes if n['id'] in main_component]
    
    bridge_edges = []
    for comp in components[1:]:
        comp_nodes = [n for n in merged_nodes if n['id'] in comp]
        
        best_dist = float('inf')
        best_pair = None
        
        for cn in comp_nodes:
            for mn in main_nodes:
                d = haversine(cn['latitude'], cn['longitude'], mn['latitude'], mn['longitude'])
                if d < best_dist:
                    best_dist = d
                    best_pair = (cn['id'], mn['id'])
        
        if best_pair and best_dist < 500:  # Connect if within 500m (covers the full skyway area)
            bridge_edges.append({
                'id': str(uuid.uuid4()),
                'start_node_id': best_pair[0],
                'end_node_id': best_pair[1],
                'edge_type': 'skyway',
                'distance_meters': round(best_dist, 1),
                'is_accessible': True,
            })
            # Add to main component for subsequent connections
            main_component.update(comp)
            main_nodes.extend(comp_nodes)
    
    print(f"\nBridge edges added: {len(bridge_edges)}")
    new_edges.extend(bridge_edges)

# Step 6: Write to Supabase
print(f"\n=== Writing to Supabase ===")
print(f"  Nodes: {len(merged_nodes)}")
print(f"  Edges: {len(new_edges)}")

# Clear existing nodes and edges
from subprocess import run
result = run(['manus-mcp-cli', 'tool', 'call', 'execute_sql', '--server', 'supabase', 
              '--input', json.dumps({
                  'project_id': 'oocciycvadlcculiqpsz',
                  'query': 'TRUNCATE skyway_edges, skyway_nodes CASCADE;'
              })], capture_output=True, text=True)
print(f"  Truncated tables: {result.returncode == 0}")

# Insert merged nodes in batches
def batch_insert(table, rows, batch_size=50):
    success = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        resp = requests.post(f"{url}/rest/v1/{table}", headers=headers, json=batch)
        if resp.status_code in (200, 201):
            success += len(batch)
        else:
            print(f"  ERROR {table}: {resp.status_code} {resp.text[:200]}")
    print(f"  Inserted {success}/{len(rows)} into {table}")

print("Inserting merged nodes...")
batch_insert('skyway_nodes', merged_nodes)

print("Inserting merged edges...")
batch_insert('skyway_edges', new_edges)

# Final connectivity check
print("\n=== Final verification ===")
adj2 = {}
for n in merged_nodes:
    adj2[n['id']] = set()
for e in new_edges:
    adj2.setdefault(e['start_node_id'], set()).add(e['end_node_id'])
    adj2.setdefault(e['end_node_id'], set()).add(e['start_node_id'])

visited2 = set()
components2 = []
for nid in adj2:
    if nid not in visited2:
        component = set()
        stack = [nid]
        while stack:
            curr = stack.pop()
            if curr in visited2:
                continue
            visited2.add(curr)
            component.add(curr)
            for neighbor in adj2.get(curr, set()):
                if neighbor not in visited2:
                    stack.append(neighbor)
        components2.append(component)

components2.sort(key=len, reverse=True)
print(f"Final connected components: {len(components2)}")
for i, comp in enumerate(components2[:3]):
    print(f"  Component {i+1}: {len(comp)} nodes")

print("\n=== DONE ===")
