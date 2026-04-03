#!/usr/bin/env python3
"""Re-seed businesses table with real Minneapolis Skyway businesses."""

import os, uuid, requests, json

url = os.environ.get('EXPO_PUBLIC_SUPABASE_URL')
key = os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')
headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# Get all buildings
resp = requests.get(f'{url}/rest/v1/buildings?select=id,name', headers=headers)
buildings = {b['name']: b['id'] for b in resp.json()}

# Get nodes with building associations for lat/lng
resp = requests.get(f'{url}/rest/v1/skyway_nodes?select=id,latitude,longitude,building_id&node_type=eq.entrance', headers=headers)
entrance_nodes = resp.json()
building_coords = {}
for n in entrance_nodes:
    if n['building_id'] and n['building_id'] not in building_coords:
        building_coords[n['building_id']] = (n['latitude'], n['longitude'])

def find_building(name_fragment):
    """Find building ID by partial name match."""
    for bname, bid in buildings.items():
        if name_fragment.lower() in bname.lower():
            return bid
    return None

def make_biz(name, category, building_name, floor=2):
    bid = find_building(building_name)
    coords = building_coords.get(bid, (44.9755, -93.2710))
    return {
        'id': str(uuid.uuid4()),
        'name': name,
        'category': category,
        'building_id': bid,
        'floor_level': floor,
        'latitude': coords[0],
        'longitude': coords[1],
        'description': f'{name} in the Minneapolis Skyway',
        'skyway_hours': '7:00 AM - 6:00 PM',
    }

businesses = [
    # Food & Dining
    make_biz("Caribou Coffee", "food", "IDS Center"),
    make_biz("Starbucks", "food", "Baker Center"),
    make_biz("Potbelly Sandwich", "food", "City Center"),
    make_biz("Subway", "food", "Gaviidae Common"),
    make_biz("Chipotle", "food", "50 South Sixth"),
    make_biz("Noodles & Company", "food", "US Bank Plaza"),
    make_biz("Panera Bread", "food", "Northstar Center"),
    make_biz("Jimmy John's", "food", "Young Quinlan"),
    make_biz("Dunn Bros Coffee", "food", "Foshay Tower"),
    make_biz("Bruegger's Bagels", "food", "Campbell Mithun"),
    make_biz("Panda Express", "food", "Crystal Court"),
    make_biz("Leeann Chin", "food", "Skyway Level"),
    make_biz("D'Amico & Sons", "food", "Gaviidae Common"),
    make_biz("Hen House Eatery", "food", "Baker Center"),
    make_biz("Sushi Tango", "food", "IDS Center"),
    
    # Retail & Shopping
    make_biz("Target", "shopping", "City Center"),
    make_biz("Macy's", "shopping", "Gaviidae Common"),
    make_biz("CVS Pharmacy", "shopping", "Baker Center"),
    make_biz("Walgreens", "shopping", "Northstar Center"),
    make_biz("Saks Off 5th", "shopping", "Gaviidae Common"),
    make_biz("Lunds & Byerlys", "shopping", "Twelve20"),
    make_biz("The UPS Store", "shopping", "IDS Center"),
    make_biz("Marshalls", "shopping", "City Center"),
    
    # Services
    make_biz("US Bank Branch", "services", "US Bank Plaza"),
    make_biz("Wells Fargo Branch", "services", "Wells Fargo"),
    make_biz("FedEx Office", "services", "Northstar Center"),
    make_biz("Great Clips", "services", "Baker Center"),
    make_biz("Massage Envy", "services", "City Center"),
    make_biz("Xcel Energy Customer Service", "services", "Xcel Energy"),
    
    # Health & Fitness
    make_biz("LifeTime Fitness", "health", "Target Center"),
    make_biz("HCMC Clinic", "health", "HCMC"),
    make_biz("Hennepin Healthcare", "health", "HCMC"),
    
    # Hotels
    make_biz("Hilton Minneapolis", "hotel", "Hilton Minneapolis"),
    make_biz("Hyatt Regency", "hotel", "Hyatt Regency"),
    make_biz("Marriott City Center", "hotel", "Marriott"),
    make_biz("AC Hotel Minneapolis", "hotel", "AC Hotel"),
    
    # Entertainment
    make_biz("Target Center Arena", "entertainment", "Target Center"),
    make_biz("State Theatre", "entertainment", "State Theatre"),
    make_biz("Orpheum Theatre", "entertainment", "Orpheum"),
    
    # Government & Civic
    make_biz("Minneapolis City Hall", "government", "Minneapolis City"),
    make_biz("Hennepin County Government Center", "government", "Government Center"),
    make_biz("US Courthouse", "government", "US Courthouse"),
    make_biz("Minneapolis Central Library", "government", "Central Library"),
]

# Filter out businesses without a valid building_id
valid = [b for b in businesses if b['building_id'] is not None]
invalid = [b for b in businesses if b['building_id'] is None]

print(f"Valid businesses: {len(valid)}")
print(f"Skipped (no matching building): {len(invalid)}")
for b in invalid:
    print(f"  - {b['name']}")

# Insert in batches
for i in range(0, len(valid), 20):
    batch = valid[i:i+20]
    resp = requests.post(f'{url}/rest/v1/businesses', headers=headers, json=batch)
    if resp.status_code in (200, 201):
        print(f"  Inserted batch {i//20 + 1}: {len(batch)} businesses")
    else:
        print(f"  ERROR: {resp.status_code} {resp.text[:200]}")

# Verify
resp = requests.get(f'{url}/rest/v1/businesses?select=id,name,category&limit=5', headers=headers)
print(f"\nVerification - first 5:")
for b in resp.json():
    print(f"  {b['name']} ({b['category']})")
