#!/usr/bin/env python3
"""Connect all disconnected skyway components by adding bridge edges."""

import os, math, json, uuid, requests

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

nodes = requests.get(f"{url}/rest/v1/skyway_nodes?select=*", headers=headers).json()
edges = requests.get(f"{url}/rest/v1/skyway_edges?select=*", headers=headers).json()

print(f"Nodes: {len(nodes)}, Edges: {len(edges)}")

# Build adjacency
adj = {n['id']: set() for n in nodes}
for e in edges:
    adj.setdefault(e['start_node_id'], set()).add(e['end_node_id'])
    adj.setdefault(e['end_node_id'], set()).add(e['start_node_id'])

# Find components
visited = set()
components = []
for nid in adj:
    if nid not in visited:
        component = set()
        stack = [nid]
        while stack:
            curr = stack.pop()
            if curr in visited: continue
            visited.add(curr)
            component.add(curr)
            for nb in adj.get(curr, set()):
                if nb not in visited: stack.append(nb)
        components.append(component)

components.sort(key=len, reverse=True)
print(f"Components: {len(components)}")

if len(components) <= 1:
    print("Already fully connected!")
    exit()

# Iteratively connect smallest component to nearest larger one
node_map = {n['id']: n for n in nodes}
bridge_edges = []

while len(components) > 1:
    # Find the two closest components
    best_dist = float('inf')
    best_pair = None
    best_ci = -1
    best_cj = -1
    
    for i in range(len(components)):
        for j in range(i+1, len(components)):
            for nid_i in components[i]:
                ni = node_map.get(nid_i)
                if not ni: continue
                for nid_j in components[j]:
                    nj = node_map.get(nid_j)
                    if not nj: continue
                    d = haversine(ni['latitude'], ni['longitude'], nj['latitude'], nj['longitude'])
                    if d < best_dist:
                        best_dist = d
                        best_pair = (nid_i, nid_j)
                        best_ci = i
                        best_cj = j
    
    if not best_pair or best_dist > 2000:
        print(f"Stopping: nearest components are {best_dist:.0f}m apart")
        break
    
    print(f"  Connecting components ({len(components[best_ci])} + {len(components[best_cj])} nodes, {best_dist:.0f}m)")
    
    bridge_edges.append({
        'id': str(uuid.uuid4()),
        'start_node_id': best_pair[0],
        'end_node_id': best_pair[1],
        'edge_type': 'skyway',
        'distance_meters': round(best_dist, 1),
        'is_accessible': True,
    })
    
    # Merge the two components
    merged = components[best_ci] | components[best_cj]
    components = [c for k, c in enumerate(components) if k != best_ci and k != best_cj]
    components.insert(0, merged)

print(f"\nBridge edges to add: {len(bridge_edges)}")

# Insert bridge edges
if bridge_edges:
    resp = requests.post(f"{url}/rest/v1/skyway_edges", headers=headers, json=bridge_edges)
    print(f"Insert result: {resp.status_code}")
    if resp.status_code not in (200, 201):
        print(f"Error: {resp.text[:300]}")

# Verify
edges2 = requests.get(f"{url}/rest/v1/skyway_edges?select=id,start_node_id,end_node_id", headers=headers).json()
adj2 = {n['id']: set() for n in nodes}
for e in edges2:
    adj2.setdefault(e['start_node_id'], set()).add(e['end_node_id'])
    adj2.setdefault(e['end_node_id'], set()).add(e['start_node_id'])

visited2 = set()
comp_count = 0
for nid in adj2:
    if nid not in visited2:
        comp_count += 1
        stack = [nid]
        while stack:
            curr = stack.pop()
            if curr in visited2: continue
            visited2.add(curr)
            for nb in adj2.get(curr, set()):
                if nb not in visited2: stack.append(nb)

print(f"\nFinal components: {comp_count}")
print(f"Final edges: {len(edges2)}")
print("DONE")
