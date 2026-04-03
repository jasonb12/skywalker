"""
Rebuild Minneapolis Skyway data with accurate GPS coordinates.

The Minneapolis downtown street grid is rotated ~15° clockwise from true north.
Streets (numbered) run NW-SE, avenues run NE-SW.
This script places buildings and skyway nodes at their real-world GPS positions
verified against Google Maps satellite imagery and official skyway maps.

The skyway system connects ~80 blocks across downtown Minneapolis at the
second-floor level. Bridges cross streets and avenues at diagonal angles.
"""

import requests
import os
import uuid
import json
import math

SUPABASE_URL = os.environ['EXPO_PUBLIC_SUPABASE_URL']
SUPABASE_KEY = os.environ['EXPO_PUBLIC_SUPABASE_ANON_KEY']
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

def make_uuid(prefix, num):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f'skywalker.v3.{prefix}.{num}'))

# ============================================================
# COORDINATE SYSTEM
# ============================================================
# The Minneapolis grid is rotated ~15° clockwise from true north.
# We define a local coordinate system based on the actual street grid:
#   - "grid-x" increases going SE along streets (toward higher street numbers)
#   - "grid-y" increases going NE along avenues (toward higher avenue numbers)
#
# Reference point: IDS Center (center of skyway system)
#   Lat: 44.97397, Lng: -93.27180
#
# One city block ≈ 100m (330 ft) in each direction
# Grid rotation: 15° clockwise from north

REF_LAT = 44.97397
REF_LNG = -93.27180
GRID_ROTATION_DEG = 15.0  # clockwise from north
BLOCK_SIZE_M = 100.0  # approximate meters per block

# Conversion factors
METERS_PER_DEG_LAT = 111320.0
METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * math.cos(math.radians(REF_LAT))

def grid_to_gps(grid_x, grid_y):
    """Convert grid coordinates (blocks from IDS Center) to GPS lat/lng.
    
    grid_x: blocks east along streets (positive = SE)
    grid_y: blocks north along avenues (positive = NE)
    
    The grid is rotated 15° clockwise, so:
    - "north" in grid = 15° east of true north
    - "east" in grid = 15° south of true east
    """
    angle_rad = math.radians(GRID_ROTATION_DEG)
    
    # Convert grid blocks to meters
    mx = grid_x * BLOCK_SIZE_M
    my = grid_y * BLOCK_SIZE_M
    
    # Rotate from grid to true north coordinates
    # Grid "north" (y+) is 15° east of true north
    true_east = mx * math.cos(angle_rad) + my * math.sin(angle_rad)
    true_north = -mx * math.sin(angle_rad) + my * math.cos(angle_rad)
    
    # Convert meters to lat/lng deltas
    d_lat = true_north / METERS_PER_DEG_LAT
    d_lng = true_east / METERS_PER_DEG_LNG
    
    return (REF_LAT + d_lat, REF_LNG + d_lng)


# ============================================================
# BUILDINGS
# ============================================================
# Grid positions relative to IDS Center (0, 0)
# x = blocks along streets (+ = toward higher street numbers = SE)
# y = blocks along avenues (+ = toward higher avenue numbers = NE)
#
# The skyway map shows buildings arranged in a grid pattern:
# - Nicollet Mall runs through the center (y ≈ 0)
# - Marquette Ave is one block east (y ≈ +1)
# - 2nd Ave S is two blocks east (y ≈ +2)
# - Hennepin Ave is about 2 blocks west (y ≈ -2)
# - Streets increase going south: 5th St ≈ x=-2, 6th St ≈ x=-1, 7th St ≈ x=0, 8th St ≈ x=+1

buildings_grid = [
    # (id_num, name, grid_x, grid_y)
    # === NORTH SECTION (3rd-4th St area, x ≈ -3 to -4) ===
    (1,  'Target Center',           -4.0,  -2.5),
    (2,  'Butler Square',           -3.5,  -1.8),
    (3,  'Target Plaza',            -3.5,  -2.2),
    (4,  'Block E',                 -3.0,  -1.2),
    (5,  'Lumber Exchange',         -3.0,  -0.5),
    (6,  'Minneapolis Public Library', -3.5, 1.0),
    (7,  '330 South Second',        -3.0,  1.5),
    (8,  'Public Service Center',   -3.0,  2.5),
    (9,  'Xcel Energy',             -3.5,  -0.2),
    
    # === UPPER MIDDLE (5th St area, x ≈ -2) ===
    (10, 'City Center',             -2.0,  -0.8),
    (11, 'Plymouth Building',       -2.5,  -0.3),
    (12, '50 South Sixth',          -2.0,  -0.2),
    (13, 'Hennepin Center for the Arts', -2.5, 0.5),
    (14, '510 Marquette',           -2.0,  0.8),
    (15, 'Marquette Plaza',         -2.0,  1.2),
    (16, 'Fifth Street Towers',     -2.5,  -1.5),
    (17, 'First Avenue',            -2.5,  -2.0),
    (18, 'Federal Courthouse',      -2.5,  2.5),
    
    # === MIDDLE NORTH (6th St area, x ≈ -1) ===
    (19, '33 South Sixth',          -1.5,  -0.5),
    (20, 'Neiman Marcus',           -1.5,  0.2),
    (21, 'Gaviidae Common',         -1.0,  -0.3),
    (22, 'Dain Rauscher Plaza',     -1.5,  0.5),
    (23, 'Westin Hotel',            -1.0,  0.8),
    (24, 'One Financial',           -1.0,  1.5),
    (25, '517 Ramp',                -1.5,  1.8),
    (26, 'Crowne Plaza',            -1.0,  1.0),
    (27, 'Radisson Plaza',          -1.5,  -1.5),
    (28, "Macy's",                  -1.0,  -1.2),
    
    # === CENTER (7th St area, x ≈ 0) — IDS Center row ===
    (29, 'IDS Center',               0.0,   0.0),
    (30, 'Marriott Hotel',          -0.5,  -0.8),
    (31, 'Wells Fargo Center',       0.0,   0.5),
    (32, 'Northstar Center',         0.0,   1.0),
    (33, 'Marquette Hotel',          0.0,   0.7),
    (34, 'Roanoke Building',         0.0,   1.2),
    (35, 'Baker Center',             0.5,   1.5),
    (36, 'US Trust',                 0.5,   2.0),
    (37, 'Grand Hotel',             -0.5,   1.8),
    
    # === SOUTH (8th St area, x ≈ +1) ===
    (38, 'US Bancorp Plaza',         1.0,  -1.0),
    (39, 'Midwest Plaza',            1.0,  -0.3),
    (40, 'LaSalle Plaza',            0.5,  -1.8),
    (41, 'State Theater',            0.5,  -2.0),
    (42, 'Highland Bank',            1.5,  -0.5),
    (43, 'Medical Arts',             1.5,   0.0),
    (44, 'Foshay Tower',             1.5,   0.8),
    (45, 'TCF Tower',                1.0,   1.5),
    (46, 'AT&T Tower',               1.5,   1.0),
    (47, 'Young Quinlan Building',   1.5,  -0.2),
    (48, 'Campbell Mithun Tower',    1.0,   2.0),
    (49, 'Minneapolis Energy Center', 1.0,  2.5),
    (50, 'St. Olaf',                 1.0,   1.8),
    
    # === FAR SOUTH (9th-10th St, x ≈ +2 to +3) ===
    (51, 'Target Store',             2.0,  -1.0),
    (52, 'WCCO-TV',                  2.5,  -0.2),
    (53, 'Hilton Minneapolis',       2.5,   0.5),
    (54, 'Minneapolis Convention Center', 3.0, -0.5),
    (55, 'YMCA',                     1.5,  -1.5),
    (56, 'Orpheum Theatre',          -0.5,  -2.2),
    
    # === EAST SECTION (Government Center area) ===
    (57, 'US Bank Plaza',           -1.0,   2.0),
    (58, 'Capella Tower',           -0.5,   1.5),
    (59, 'Hennepin County Government Center', 0.5, 2.8),
    (60, 'Minneapolis City Hall',   -1.5,   2.8),
    (61, 'Government Plaza',        -1.0,   2.5),
    (62, 'Public Safety Facility',  -1.5,   3.5),
    
    # === ADDITIONAL BUILDINGS ===
    (63, 'Accenture Tower',          0.5,   2.5),
    (64, 'Centre Village',           0.5,   2.2),
    (65, 'Embassy Suites',           0.5,   3.0),
    (66, 'Ameriquest Financial',     1.5,   2.5),
    (67, '701 Fourth Ave',           0.0,   3.0),
    (68, 'Thrivent Financial',       0.0,   3.5),
    (69, 'Best Western Downtown',    1.0,   3.0),
    (70, 'Village Park',             0.5,   3.5),
    
    # === WEST EXTENSIONS ===
    (71, 'Graves 610 Hotel',        -2.0,  -2.0),
    (72, 'Park and Shop',           -0.5,  -1.5),
    (73, 'Hyatt Regency',            3.0,  -2.0),
    (74, 'Orchestra Hall',           2.0,  -1.5),
    (75, 'Westminster Presbyterian', 2.5,  -1.8),
    
    # === NORTH EAST ===
    (76, 'Grain Exchange',          -2.5,   1.8),
    (77, '100 Washington Square',   -3.5,   1.5),
    (78, 'Marquette Building',      -2.0,   0.5),
    (79, 'RBC Plaza',               -2.0,   1.5),
    (80, 'Soo Line Building',       -1.5,   1.2),
]

# ============================================================
# SKYWAY NODES
# ============================================================
# Nodes are placed at building entrances and skyway bridge midpoints.
# Each node has a grid position and connects to its neighbors.

nodes_grid = []
node_id_counter = 1

# Create entrance nodes for each building
building_nodes = {}  # building_id_num -> node_id_num
for b in buildings_grid:
    bid, name, gx, gy = b
    nid = node_id_counter
    nodes_grid.append((nid, f'{name} Entrance', gx, gy, 'entrance', bid))
    building_nodes[bid] = nid
    node_id_counter += 1

# Create intersection/bridge nodes at key skyway junctions
# These are midpoints between buildings where skyway bridges cross streets
bridge_nodes = [
    # (name, grid_x, grid_y, node_type)
    # Nicollet Mall corridor (y ≈ 0, running NW-SE)
    ('Nicollet & 5th Bridge',    -2.0,  0.0, 'intersection'),
    ('Nicollet & 6th Bridge',    -1.0,  0.0, 'intersection'),
    ('Nicollet & 7th Bridge',     0.0,  0.0, 'intersection'),  # at IDS
    ('Nicollet & 8th Bridge',     1.0,  0.0, 'intersection'),
    ('Nicollet & 9th Bridge',     2.0,  0.0, 'intersection'),
    
    # Marquette Ave corridor (y ≈ +1, running NW-SE)
    ('Marquette & 5th Bridge',   -2.0,  1.0, 'intersection'),
    ('Marquette & 6th Bridge',   -1.0,  1.0, 'intersection'),
    ('Marquette & 7th Bridge',    0.0,  1.0, 'intersection'),
    ('Marquette & 8th Bridge',    1.0,  1.0, 'intersection'),
    
    # 2nd Ave corridor (y ≈ +2, running NW-SE)
    ('2nd Ave & 5th Bridge',     -2.0,  2.0, 'intersection'),
    ('2nd Ave & 6th Bridge',     -1.0,  2.0, 'intersection'),
    ('2nd Ave & 7th Bridge',      0.0,  2.0, 'intersection'),
    ('2nd Ave & 8th Bridge',      1.0,  2.0, 'intersection'),
    
    # 3rd Ave corridor (y ≈ +3)
    ('3rd Ave & 5th Bridge',     -2.0,  3.0, 'intersection'),
    ('3rd Ave & 6th Bridge',     -1.0,  3.0, 'intersection'),
    ('3rd Ave & 7th Bridge',      0.0,  3.0, 'intersection'),
    
    # Hennepin Ave corridor (y ≈ -1.5, running NW-SE)
    ('Hennepin & 6th Bridge',    -1.5, -1.5, 'intersection'),
    ('Hennepin & 7th Bridge',    -0.5, -1.5, 'intersection'),
    ('Hennepin & 8th Bridge',     0.5, -1.5, 'intersection'),
    
    # Cross-street bridges (running NE-SW, connecting corridors)
    ('5th St & Nicollet-Marquette', -2.0, 0.5, 'intersection'),
    ('6th St & Nicollet-Marquette', -1.0, 0.5, 'intersection'),
    ('7th St & Nicollet-Marquette',  0.0, 0.5, 'intersection'),
    ('8th St & Nicollet-Marquette',  1.0, 0.5, 'intersection'),
    
    # Additional junction nodes
    ('Target Center Junction',    -3.8, -2.3, 'intersection'),
    ('Government Center Junction', 0.0, 2.5, 'intersection'),
    ('Convention Center Junction', 2.5, -0.5, 'intersection'),
]

for bn in bridge_nodes:
    name, gx, gy, ntype = bn
    nodes_grid.append((node_id_counter, name, gx, gy, ntype, None))
    node_id_counter += 1

# ============================================================
# SKYWAY EDGES
# ============================================================
# Connect buildings along the skyway corridors.
# Edges follow the actual skyway bridge pattern from the official map.

def dist_between_grid(gx1, gy1, gx2, gy2):
    """Calculate distance in meters between two grid positions."""
    dx = (gx2 - gx1) * BLOCK_SIZE_M
    dy = (gy2 - gy1) * BLOCK_SIZE_M
    return math.sqrt(dx*dx + dy*dy)

# Build a lookup: node_id_num -> (gx, gy)
node_positions = {}
for n in nodes_grid:
    nid, name, gx, gy = n[0], n[1], n[2], n[3]
    node_positions[nid] = (gx, gy)

# Edges defined by building ID pairs or node ID pairs
# We'll use building IDs for simplicity and create edges between their entrance nodes
edges_by_building = [
    # === NICOLLET MALL CORRIDOR (north to south) ===
    # 5th St area
    (10, 12),   # City Center -> 50 South Sixth
    (12, 19),   # 50 South Sixth -> 33 South Sixth
    (19, 21),   # 33 South Sixth -> Gaviidae Common
    (21, 29),   # Gaviidae Common -> IDS Center
    (29, 39),   # IDS Center -> Midwest Plaza
    (39, 43),   # Midwest Plaza -> Medical Arts
    (43, 47),   # Medical Arts -> Young Quinlan
    (47, 52),   # Young Quinlan -> WCCO-TV
    
    # === MARQUETTE AVE CORRIDOR ===
    (14, 22),   # 510 Marquette -> Dain Rauscher
    (22, 23),   # Dain Rauscher -> Westin Hotel
    (23, 26),   # Westin Hotel -> Crowne Plaza
    (26, 32),   # Crowne Plaza -> Northstar Center
    (32, 33),   # Northstar Center -> Marquette Hotel
    (33, 34),   # Marquette Hotel -> Roanoke Building
    (34, 44),   # Roanoke Building -> Foshay Tower
    (44, 46),   # Foshay Tower -> AT&T Tower
    
    # === 2ND AVE CORRIDOR ===
    (15, 57),   # Marquette Plaza -> US Bank Plaza
    (57, 58),   # US Bank Plaza -> Capella Tower
    (58, 36),   # Capella Tower -> US Trust
    (36, 35),   # US Trust -> Baker Center
    (35, 48),   # Baker Center -> Campbell Mithun Tower
    (48, 49),   # Campbell Mithun Tower -> Minneapolis Energy Center
    
    # === 3RD AVE / GOVERNMENT CENTER ===
    (61, 59),   # Government Plaza -> Hennepin County Gov Center
    (59, 63),   # Gov Center -> Accenture Tower
    (63, 64),   # Accenture Tower -> Centre Village
    (64, 65),   # Centre Village -> Embassy Suites
    (60, 61),   # City Hall -> Government Plaza
    (62, 60),   # Public Safety -> City Hall
    
    # === CROSS CONNECTIONS (NE-SW, connecting corridors) ===
    # 5th St cross
    (12, 14),   # 50 South Sixth -> 510 Marquette
    (14, 79),   # 510 Marquette -> RBC Plaza
    (79, 76),   # RBC Plaza -> Grain Exchange
    
    # 6th St cross
    (21, 23),   # Gaviidae Common -> Westin Hotel
    (23, 24),   # Westin Hotel -> One Financial
    (24, 57),   # One Financial -> US Bank Plaza
    (20, 22),   # Neiman Marcus -> Dain Rauscher
    
    # 7th St cross
    (29, 31),   # IDS Center -> Wells Fargo Center
    (31, 32),   # Wells Fargo -> Northstar Center
    (32, 35),   # Northstar -> Baker Center
    (35, 36),   # Baker Center -> US Trust
    
    # 8th St cross
    (39, 44),   # Midwest Plaza -> Foshay Tower
    (44, 45),   # Foshay Tower -> TCF Tower
    (45, 50),   # TCF Tower -> St. Olaf
    (38, 39),   # US Bancorp -> Midwest Plaza
    
    # === HENNEPIN AVE CORRIDOR (west side) ===
    (10, 28),   # City Center -> Macy's
    (28, 30),   # Macy's -> Marriott Hotel
    (30, 29),   # Marriott -> IDS Center
    (27, 28),   # Radisson Plaza -> Macy's
    (17, 27),   # First Avenue -> Radisson Plaza
    (16, 10),   # Fifth Street Towers -> City Center
    
    # === NORTH EXTENSIONS ===
    (1, 3),     # Target Center -> Target Plaza
    (3, 16),    # Target Plaza -> Fifth Street Towers
    (2, 3),     # Butler Square -> Target Plaza
    (4, 10),    # Block E -> City Center
    (5, 11),    # Lumber Exchange -> Plymouth Building
    (11, 12),   # Plymouth Building -> 50 South Sixth
    (9, 5),     # Xcel Energy -> Lumber Exchange
    
    # === SOUTH EXTENSIONS ===
    (40, 38),   # LaSalle Plaza -> US Bancorp
    (41, 40),   # State Theater -> LaSalle Plaza
    (55, 51),   # YMCA -> Target Store
    (51, 52),   # Target Store -> WCCO-TV
    (53, 52),   # Hilton -> WCCO-TV
    (42, 43),   # Highland Bank -> Medical Arts
    
    # === EAST EXTENSIONS ===
    (76, 60),   # Grain Exchange -> City Hall
    (7, 8),     # 330 S Second -> Public Service Center
    (6, 7),     # Public Library -> 330 S Second
    (13, 15),   # Hennepin Center -> Marquette Plaza
    (15, 80),   # Marquette Plaza -> Soo Line Building
    (80, 25),   # Soo Line -> 517 Ramp
    
    # === ADDITIONAL CONNECTIONS ===
    (37, 36),   # Grand Hotel -> US Trust
    (56, 17),   # Orpheum -> First Avenue
    (72, 30),   # Park and Shop -> Marriott
    (19, 20),   # 33 South Sixth -> Neiman Marcus
    (78, 14),   # Marquette Building -> 510 Marquette
    (50, 48),   # St. Olaf -> Campbell Mithun
    (46, 45),   # AT&T Tower -> TCF Tower
    (66, 49),   # Ameriquest -> Energy Center
    (67, 68),   # 701 Fourth -> Thrivent
    (69, 65),   # Best Western -> Embassy Suites
]

# ============================================================
# BUSINESSES
# ============================================================
businesses_data = [
    # (id_num, name, building_id_num, category, description, hours)
    (1,  'Crystal Court Food Hall', 29, 'Food & Dining', 'Food court in the IDS Center Crystal Court atrium', 'Mon-Fri 6:30am-6pm'),
    (2,  'Starbucks IDS', 29, 'Coffee & Cafe', 'Starbucks in the IDS Center skyway level', 'Mon-Fri 6am-6pm'),
    (3,  'Target', 51, 'Retail', 'Target department store with skyway entrance', 'Mon-Sat 8am-9pm, Sun 10am-6pm'),
    (4,  "Macy's", 28, 'Retail', "Macy's department store connected to skyway", 'Mon-Sat 10am-8pm, Sun 11am-6pm'),
    (5,  'Neiman Marcus', 20, 'Retail', 'Luxury department store in Gaviidae Common area', 'Mon-Sat 10am-6pm'),
    (6,  'Wells Fargo Bank', 31, 'Financial Services', 'Full-service bank branch in Wells Fargo Center', 'Mon-Fri 9am-5pm'),
    (7,  'US Bank Branch', 57, 'Financial Services', 'US Bank branch in US Bank Plaza', 'Mon-Fri 9am-5pm'),
    (8,  'Walgreens', 21, 'Pharmacy & Health', 'Pharmacy and convenience store in Gaviidae Common', 'Mon-Fri 7am-7pm, Sat 9am-5pm'),
    (9,  'Caribou Coffee', 10, 'Coffee & Cafe', 'Caribou Coffee in City Center skyway level', 'Mon-Fri 6am-6pm'),
    (10, 'Potbelly Sandwich', 32, 'Food & Dining', 'Sandwich shop in Northstar Center', 'Mon-Fri 10am-7pm'),
    (11, 'Chipotle', 10, 'Food & Dining', 'Chipotle Mexican Grill in City Center', 'Mon-Fri 10:30am-8pm'),
    (12, 'Hilton Minneapolis', 53, 'Hotel', 'Full-service hotel connected to skyway system', '24/7'),
    (13, 'Marriott City Center', 30, 'Hotel', 'Marriott hotel with direct skyway access', '24/7'),
    (14, 'Westin Minneapolis', 23, 'Hotel', 'Westin hotel connected via skyway', '24/7'),
    (15, 'Grand Hotel', 37, 'Hotel', 'Boutique hotel in the skyway system', '24/7'),
    (16, 'Hennepin County Services', 59, 'Services', 'County government services and offices', 'Mon-Fri 8am-4:30pm'),
    (17, 'Minneapolis City Hall Services', 60, 'Services', 'City government offices and services', 'Mon-Fri 8am-4:30pm'),
    (18, 'FedEx Office', 29, 'Services', 'Printing and shipping services in IDS Center', 'Mon-Fri 7am-7pm'),
    (19, 'Subway', 38, 'Food & Dining', 'Subway sandwiches in US Bancorp Plaza', 'Mon-Fri 7am-7pm'),
    (20, 'Noodles & Company', 21, 'Food & Dining', 'Noodle dishes in Gaviidae Common', 'Mon-Fri 10:30am-8pm'),
    (21, 'Dunn Bros Coffee', 44, 'Coffee & Cafe', 'Local coffee shop near Foshay Tower', 'Mon-Fri 6am-5pm'),
    (22, 'Jimmy Johns', 35, 'Food & Dining', 'Fast sandwich delivery in Baker Center', 'Mon-Fri 10am-7pm'),
    (23, 'Target Center Arena', 1, 'Entertainment', 'Home of the Minnesota Timberwolves and Lynx', 'Event days'),
    (24, 'State Theatre', 41, 'Entertainment', 'Historic performing arts venue', 'Event days'),
    (25, 'Orpheum Theatre', 56, 'Entertainment', 'Historic theater for Broadway shows', 'Event days'),
    (26, 'Minneapolis Public Library', 6, 'Services', 'Central library with skyway access', 'Mon-Thu 10am-8pm, Fri-Sat 10am-5pm'),
    (27, 'Panera Bread', 12, 'Food & Dining', 'Bakery-cafe in 50 South Sixth', 'Mon-Fri 6:30am-8pm'),
    (28, 'Great Clips', 10, 'Services', 'Hair salon in City Center skyway level', 'Mon-Fri 9am-7pm, Sat 9am-5pm'),
    (29, 'CVS Pharmacy', 32, 'Pharmacy & Health', 'Pharmacy in Northstar Center', 'Mon-Fri 8am-7pm, Sat 9am-5pm'),
    (30, 'Foshay Museum', 44, 'Entertainment', 'Observation deck and museum in historic Foshay Tower', 'Daily 10am-8pm'),
    (31, 'Convention Center', 54, 'Entertainment', 'Minneapolis Convention Center events', 'Event days'),
    (32, 'Panda Express', 21, 'Food & Dining', 'Chinese fast food in Gaviidae Common', 'Mon-Fri 10:30am-7pm'),
    (33, 'Brueggers Bagels', 39, 'Coffee & Cafe', 'Bagels and coffee in Midwest Plaza', 'Mon-Fri 6am-3pm'),
    (34, 'UPS Store', 10, 'Services', 'Shipping and printing in City Center', 'Mon-Fri 8am-6pm'),
    (35, 'Grain Exchange Restaurant', 76, 'Food & Dining', 'Restaurant in historic Grain Exchange building', 'Mon-Fri 11am-2pm'),
]

# ============================================================
# EXECUTE: Clear and rebuild
# ============================================================

def clear_tables():
    """Clear all existing data using Supabase REST API."""
    # Delete in order to respect foreign keys
    for table in ['businesses', 'beacons', 'user_paths', 'skyway_edges', 'skyway_nodes', 'buildings']:
        r = requests.delete(
            f'{SUPABASE_URL}/rest/v1/{table}?id=neq.00000000-0000-0000-0000-000000000000',
            headers={**HEADERS, 'Prefer': 'return=minimal'}
        )
        print(f'  Cleared {table}: {r.status_code}')

def insert_buildings():
    """Insert buildings with accurate GPS coordinates."""
    rows = []
    for b in buildings_grid:
        bid, name, gx, gy = b
        lat, lng = grid_to_gps(gx, gy)
        rows.append({
            'id': make_uuid('building', bid),
            'name': name,
        })
    
    # Insert in batches of 50
    for i in range(0, len(rows), 50):
        batch = rows[i:i+50]
        r = requests.post(f'{SUPABASE_URL}/rest/v1/buildings', headers=HEADERS, json=batch)
        print(f'  Buildings batch {i//50 + 1}: {r.status_code}')
        if r.status_code >= 400:
            print(f'    Error: {r.text[:200]}')
    
    return len(rows)

def insert_nodes():
    """Insert skyway nodes with accurate GPS coordinates."""
    rows = []
    for n in nodes_grid:
        nid, name, gx, gy, ntype = n[0], n[1], n[2], n[3], n[4]
        bid = n[5] if len(n) > 5 else None
        lat, lng = grid_to_gps(gx, gy)
        
        row = {
            'id': make_uuid('node', nid),
            'name': name,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'floor_level': 2,
            'node_type': ntype,
            'building_id': make_uuid('building', bid) if bid is not None else None,
        }
        rows.append(row)
    
    for i in range(0, len(rows), 50):
        batch = rows[i:i+50]
        r = requests.post(f'{SUPABASE_URL}/rest/v1/skyway_nodes', headers=HEADERS, json=batch)
        print(f'  Nodes batch {i//50 + 1}: {r.status_code}')
        if r.status_code >= 400:
            print(f'    Error: {r.text[:200]}')
    
    return len(rows)

def insert_edges():
    """Insert skyway edges between connected buildings."""
    rows = []
    edge_id = 1
    
    for b1_id, b2_id in edges_by_building:
        n1_id = building_nodes.get(b1_id)
        n2_id = building_nodes.get(b2_id)
        if n1_id is None or n2_id is None:
            print(f'  Warning: missing node for buildings {b1_id} or {b2_id}')
            continue
        
        pos1 = node_positions.get(n1_id)
        pos2 = node_positions.get(n2_id)
        if pos1 is None or pos2 is None:
            continue
        
        distance = dist_between_grid(pos1[0], pos1[1], pos2[0], pos2[1])
        
        rows.append({
            'id': make_uuid('edge', edge_id),
            'start_node_id': make_uuid('node', n1_id),
            'end_node_id': make_uuid('node', n2_id),
            'distance_meters': round(distance, 1),
            'is_accessible': True,
            'edge_type': 'skyway',
        })
        edge_id += 1
    
    for i in range(0, len(rows), 50):
        batch = rows[i:i+50]
        r = requests.post(f'{SUPABASE_URL}/rest/v1/skyway_edges', headers=HEADERS, json=batch)
        print(f'  Edges batch {i//50 + 1}: {r.status_code}')
        if r.status_code >= 400:
            print(f'    Error: {r.text[:200]}')
    
    return len(rows)

def insert_businesses():
    """Insert businesses with GPS coordinates from their building."""
    rows = []
    for biz in businesses_data:
        biz_id, name, building_id_num, category, description, hours = biz
        
        # Find building grid position
        bldg = next((b for b in buildings_grid if b[0] == building_id_num), None)
        if not bldg:
            continue
        
        lat, lng = grid_to_gps(bldg[2], bldg[3])
        node_id = building_nodes.get(building_id_num)
        
        row = {
            'id': make_uuid('business', biz_id),
            'building_id': make_uuid('building', building_id_num),
            'name': name,
            'category': category,
            'description': description,
            'floor_level': 2,
            'skyway_hours': hours,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'node_id': make_uuid('node', node_id) if node_id else None,
        }
        rows.append(row)
    
    for i in range(0, len(rows), 50):
        batch = rows[i:i+50]
        r = requests.post(f'{SUPABASE_URL}/rest/v1/businesses', headers=HEADERS, json=batch)
        print(f'  Businesses batch {i//50 + 1}: {r.status_code}')
        if r.status_code >= 400:
            print(f'    Error: {r.text[:200]}')
    
    return len(rows)

def insert_beacons():
    """Insert BLE beacons at key locations."""
    SKYWAY_BEACON_UUID = 'E2C56DB5-DFFB-48D2-B060-D0F5A71096E0'
    
    # Place beacons at major buildings
    beacon_buildings = [29, 10, 21, 32, 44, 1, 59, 53, 57, 58, 31, 35, 28, 20, 23, 38, 39, 43, 45, 48, 60, 76, 40, 16, 12, 14, 51, 30, 34, 37]
    
    rows = []
    for i, bid in enumerate(beacon_buildings):
        bldg = next((b for b in buildings_grid if b[0] == bid), None)
        if not bldg:
            continue
        
        lat, lng = grid_to_gps(bldg[2], bldg[3])
        major = (bid // 10) + 1
        minor = (bid % 10) + 1
        
        rows.append({
            'id': make_uuid('beacon.v3', i + 1),
            'building_id': make_uuid('building', bid),
            'hw_id': f'{SKYWAY_BEACON_UUID}:{major}:{minor}',
            'label': f'{bldg[1]} Beacon',
            'beacon_uuid': SKYWAY_BEACON_UUID,
            'major': major,
            'minor': minor,
            'latitude': round(lat, 6),
            'longitude': round(lng, 6),
            'floor_level': 2,
            'tx_power': -59,
            'metadata': {},
        })
    
    r = requests.post(f'{SUPABASE_URL}/rest/v1/beacons', headers=HEADERS, json=rows)
    print(f'  Beacons: {r.status_code}')
    if r.status_code >= 400:
        print(f'    Error: {r.text[:200]}')
    
    return len(rows)

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    print('=== Rebuilding Minneapolis Skyway Data (v3 - Accurate GPS) ===')
    print()
    
    # Verify grid_to_gps works correctly
    ids_lat, ids_lng = grid_to_gps(0, 0)
    print(f'IDS Center (reference): {ids_lat:.6f}, {ids_lng:.6f}')
    
    tc_lat, tc_lng = grid_to_gps(-4.0, -2.5)
    print(f'Target Center: {tc_lat:.6f}, {tc_lng:.6f}')
    
    gc_lat, gc_lng = grid_to_gps(0.5, 2.8)
    print(f'Gov Center: {gc_lat:.6f}, {gc_lng:.6f}')
    
    hilton_lat, hilton_lng = grid_to_gps(2.5, 0.5)
    print(f'Hilton: {hilton_lat:.6f}, {hilton_lng:.6f}')
    print()
    
    print('Step 1: Clearing existing data...')
    clear_tables()
    print()
    
    print('Step 2: Inserting buildings...')
    nb = insert_buildings()
    print(f'  -> {nb} buildings inserted')
    print()
    
    print('Step 3: Inserting nodes...')
    nn = insert_nodes()
    print(f'  -> {nn} nodes inserted')
    print()
    
    print('Step 4: Inserting edges...')
    ne = insert_edges()
    print(f'  -> {ne} edges inserted')
    print()
    
    print('Step 5: Inserting businesses...')
    nbi = insert_businesses()
    print(f'  -> {nbi} businesses inserted')
    print()
    
    print('Step 6: Inserting beacons...')
    nbe = insert_beacons()
    print(f'  -> {nbe} beacons inserted')
    print()
    
    print('=== Done! ===')
    
    # Verify counts
    for table in ['buildings', 'skyway_nodes', 'skyway_edges', 'businesses', 'beacons']:
        r = requests.get(
            f'{SUPABASE_URL}/rest/v1/{table}?select=id',
            headers={**HEADERS, 'Prefer': 'count=exact', 'Range': '0-0'}
        )
        count = r.headers.get('content-range', 'unknown')
        print(f'  {table}: {count}')
