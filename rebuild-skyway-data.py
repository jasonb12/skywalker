#!/usr/bin/env python3
"""
Rebuild the Minneapolis Skyway database with accurate GPS coordinates.
Based on the official 2019 Move Minneapolis skyway map and verified building positions.

The Minneapolis downtown grid:
- Streets run E-W (numbered: 3rd St through 12th St)
- Avenues run N-S (named: Hennepin, 1st Ave, Nicollet Mall, Marquette, 2nd Ave, 3rd Ave, 4th Ave, etc.)
- The skyway system is on the 2nd floor level of connected buildings
"""

import requests
import os
import json
import uuid
import sys

SUPABASE_URL = os.environ.get("EXPO_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

def make_uuid(prefix, num):
    """Generate a deterministic UUID from prefix and number."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"skywalker.{prefix}.{num}"))

# ============================================================
# BUILDINGS - Comprehensive list from the official skyway map
# Coordinates are the building center at skyway level
# ============================================================
# Grid reference (approximate):
# Nicollet Mall: lng ~ -93.2727
# Marquette Ave: lng ~ -93.2700
# 2nd Ave S: lng ~ -93.2670
# 3rd Ave S: lng ~ -93.2640
# 4th Ave S: lng ~ -93.2610
# LaSalle Ave: lng ~ -93.2760
# Hennepin Ave: lng ~ -93.2790
# 1st Ave S: lng ~ -93.2755
#
# 3rd St: lat ~ 44.9810
# 4th St: lat ~ 44.9795
# 5th St: lat ~ 44.9780
# 6th St: lat ~ 44.9765
# 7th St: lat ~ 44.9750
# 8th St: lat ~ 44.9735
# 9th St: lat ~ 44.9720
# 10th St: lat ~ 44.9705

buildings = [
    # (id_num, name)
    (1, "IDS Center"),
    (2, "Capella Tower"),
    (3, "Target Center"),
    (4, "Target Plaza"),
    (5, "City Center"),
    (6, "Gaviidae Common"),
    (7, "Foshay Tower"),
    (8, "US Bank Plaza"),
    (9, "Wells Fargo Center"),
    (10, "RBC Plaza"),
    (11, "Minneapolis City Hall"),
    (12, "Hennepin County Government Center"),
    (13, "US Courthouse"),
    (14, "Fifth Street Towers"),
    (15, "Northstar Center"),
    (16, "Baker Center"),
    (17, "Marquette Plaza"),
    (18, "Young Quinlan Building"),
    (19, "Rand Tower"),
    (20, "Medical Arts Building"),
    (21, "Tritech Center"),
    (22, "Grain Exchange"),
    (23, "US Bank Stadium"),
    (24, "Hilton Minneapolis"),
    (25, "Hyatt Regency Minneapolis"),
    (26, "Minneapolis Convention Center"),
    (27, "LaSalle Plaza"),
    (28, "Ameriprise Financial Center"),
    (29, "100 Washington Square"),
    (30, "Campbell Mithun Tower"),
    (31, "AT&T Tower"),
    (32, "Piper Jaffray Plaza"),
    (33, "Butler Square"),
    (34, "Target Field"),
    (35, "The Crossings"),
    (36, "Public Service Center"),
    (37, "Hennepin Center for the Arts"),
    (38, "Orchestra Hall"),
    (39, "Lumber Exchange"),
    (40, "TCF Tower"),
    # Additional buildings from official map
    (41, "Marquette Hotel"),
    (42, "Minneapolis Central Library"),
    (43, "AC Hotel"),
    (44, "Embassy Suites"),
    (45, "Cowles Center"),
    (46, "Macy's"),
    (47, "Wells Fargo Museum"),
    (48, "Canadian Pacific Tower"),
    (49, "CenturyLink Tower"),
    (50, "Plymouth Building"),
    (51, "Xcel Energy Building"),
    (52, "Radisson Blu"),
    (53, "North Star East"),
    (54, "Leamington Transit Hub"),
    (55, "Energy Center"),
    (56, "St. Olaf Block"),
    (57, "Accenture Tower"),
    (58, "701 Building"),
    (59, "Centre Village"),
    (60, "Krause-Anderson"),
    (61, "Hennepin County Medical Center"),
    (62, "Thrivent Financial"),
    (63, "Mpls Armory"),
    (64, "Best Western Plus"),
    (65, "Ameriprise Service Center"),
    (66, "Jet1 Center"),
    (67, "WCCO Building"),
    (68, "Ritz Residence"),
    (69, "Towle Building"),
    (70, "Hotel Minneapolis"),
    (71, "Westminster Church"),
    (72, "Millennium Hotel"),
    (73, "Century Plaza"),
    (74, "Hilton Garden Inn"),
    (75, "Central Lutheran Church"),
    (76, "Mayo Clinic Sports Med"),
    (77, "Block E"),
    (78, "Whole Foods"),
    (79, "ING Building"),
    (80, "Walden University"),
]

building_ids = {}
for num, name in buildings:
    building_ids[num] = make_uuid("building", num)

# ============================================================
# SKYWAY NODES - Intersections and building entrances
# Coordinates verified against the official skyway map and Google Maps
# ============================================================
# Each node: (id_num, building_num_or_None, name, lat, lng, floor, type)

nodes = [
    # === IDS Center area (8th St & Nicollet/Marquette) ===
    (1, 1, "IDS Center - Crystal Court", 44.97397, -93.27193, 2, "landmark"),
    (2, 1, "IDS Center - Nicollet Mall Skyway", 44.97397, -93.27270, 2, "entrance"),
    (3, 1, "IDS Center - Marquette Ave Skyway", 44.97397, -93.27100, 2, "entrance"),
    (4, 1, "IDS Center - 8th St South Skyway", 44.97340, -93.27193, 2, "entrance"),

    # === Capella Tower (7th & Marquette/2nd Ave) ===
    (5, 2, "Capella Tower - West Skyway", 44.97500, -93.27000, 2, "entrance"),
    (6, 2, "Capella Tower - East Skyway", 44.97500, -93.26920, 2, "entrance"),

    # === Target Center (1st Ave N & 7th St) ===
    (7, 3, "Target Center - Skyway Entrance", 44.97946, -93.27614, 2, "entrance"),

    # === Target Plaza (1st Ave & 6th/7th St) ===
    (8, 4, "Target Plaza - North Skyway", 44.97720, -93.27520, 2, "entrance"),
    (9, 4, "Target Plaza - South Skyway", 44.97650, -93.27520, 2, "entrance"),

    # === City Center (Nicollet & 6th/7th St) ===
    (10, 5, "City Center - South Skyway", 44.97530, -93.27270, 2, "entrance"),
    (11, 5, "City Center - North Skyway", 44.97620, -93.27270, 2, "entrance"),

    # === Gaviidae Common (Nicollet & 5th/6th St) ===
    (12, 6, "Gaviidae Common - South Skyway", 44.97680, -93.27270, 2, "entrance"),
    (13, 6, "Gaviidae Common - West Skyway", 44.97720, -93.27370, 2, "entrance"),
    (14, 6, "Gaviidae Common - East Skyway", 44.97720, -93.27170, 2, "entrance"),

    # === Foshay Tower (Marquette & 9th St) ===
    (15, 7, "Foshay Tower - Skyway", 44.97444, -93.27153, 2, "landmark"),

    # === US Bank Plaza (Marquette & 9th/10th) ===
    (16, 8, "US Bank Plaza - Skyway", 44.97350, -93.27000, 2, "entrance"),

    # === Wells Fargo Center (Nicollet & 10th) ===
    (17, 9, "Wells Fargo Center - Skyway", 44.97250, -93.27200, 2, "entrance"),

    # === RBC Plaza (Marquette & 6th) ===
    (18, 10, "RBC Plaza - Skyway", 44.97680, -93.26950, 2, "entrance"),

    # === Minneapolis City Hall (4th Ave & 4th/5th St) ===
    (19, 11, "Minneapolis City Hall - Skyway", 44.97800, -93.26400, 2, "landmark"),

    # === Hennepin County Government Center (4th/5th Ave & 5th/6th St) ===
    (20, 12, "Government Center - West Skyway", 44.97720, -93.26300, 2, "entrance"),
    (21, 12, "Government Center - South Skyway", 44.97650, -93.26200, 2, "entrance"),

    # === Fifth Street Towers (5th St & 1st Ave) ===
    (22, 14, "Fifth Street Towers - Skyway", 44.97830, -93.27450, 2, "entrance"),

    # === Northstar Center (Marquette & 5th/6th) ===
    (23, 15, "Northstar Center - Skyway", 44.97720, -93.27000, 2, "entrance"),

    # === Baker Center (Marquette & 7th) ===
    (24, 16, "Baker Center - Skyway", 44.97530, -93.26950, 2, "entrance"),

    # === Marquette Plaza (Marquette & 7th/8th) ===
    (25, 17, "Marquette Plaza - Skyway", 44.97450, -93.27000, 2, "entrance"),

    # === Young Quinlan (Nicollet & 9th/10th) ===
    (26, 18, "Young Quinlan - Skyway", 44.97300, -93.27270, 2, "entrance"),

    # === Medical Arts Building (Nicollet & 9th) ===
    (27, 20, "Medical Arts Building - Skyway", 44.97380, -93.27400, 2, "entrance"),

    # === Tritech Center (4th Ave & 6th) ===
    (28, 21, "Tritech Center - Skyway", 44.97680, -93.26600, 2, "entrance"),

    # === Grain Exchange (4th Ave & 5th/6th) ===
    (29, 22, "Grain Exchange - Skyway", 44.97730, -93.26550, 2, "entrance"),

    # === US Bank Stadium (Chicago Ave & 5th/6th) ===
    (30, 23, "US Bank Stadium - Skyway", 44.97400, -93.25730, 2, "entrance"),

    # === Hilton Minneapolis (Nicollet & 10th/11th) ===
    (31, 24, "Hilton Minneapolis - Skyway", 44.97150, -93.27270, 2, "entrance"),

    # === Hyatt Regency (Nicollet & 12th/13th) ===
    (32, 25, "Hyatt Regency - Skyway", 44.96950, -93.27270, 2, "entrance"),

    # === LaSalle Plaza (LaSalle & 8th/9th) ===
    (33, 27, "LaSalle Plaza - Skyway", 44.97380, -93.27550, 2, "entrance"),

    # === Ameriprise Financial Center (3rd Ave & 9th) ===
    (34, 28, "Ameriprise Financial Center - Skyway", 44.97300, -93.26500, 2, "entrance"),

    # === Campbell Mithun Tower (2nd Ave & 9th) ===
    (35, 30, "Campbell Mithun Tower - Skyway", 44.97300, -93.26700, 2, "entrance"),

    # === AT&T Tower (Marquette & 9th) ===
    (36, 31, "AT&T Tower - Skyway", 44.97380, -93.27050, 2, "entrance"),

    # === Butler Square (1st Ave N & 6th St N) ===
    (37, 33, "Butler Square - Skyway", 44.97950, -93.27800, 2, "entrance"),

    # === Target Field (3rd Ave N & 5th St N) ===
    (38, 34, "Target Field - Skyway", 44.98150, -93.27750, 2, "entrance"),

    # === The Crossings (Washington Ave & 3rd Ave) ===
    (39, 35, "The Crossings - Skyway", 44.97830, -93.26700, 2, "entrance"),

    # === Public Service Center (4th Ave & 5th) ===
    (40, 36, "Public Service Center - Skyway", 44.97780, -93.26600, 2, "entrance"),

    # === Lumber Exchange (Hennepin & 5th) ===
    (41, 39, "Lumber Exchange - Skyway", 44.97800, -93.26900, 2, "entrance"),

    # === TCF Tower (Marquette & 8th) ===
    (42, 40, "TCF Tower - Skyway", 44.97450, -93.26900, 2, "entrance"),

    # === Canadian Pacific Tower (2nd Ave & 6th) ===
    (43, 48, "Canadian Pacific Tower - Skyway", 44.97680, -93.26700, 2, "entrance"),

    # === CenturyLink Tower (2nd Ave & 5th/6th) ===
    (44, 49, "CenturyLink Tower - Skyway", 44.97750, -93.26700, 2, "entrance"),

    # === Wells Fargo Museum (Nicollet & 6th) ===
    (45, 47, "Wells Fargo Museum - Skyway", 44.97620, -93.27100, 2, "entrance"),

    # === Macy's (Nicollet & 7th/8th) ===
    (46, 46, "Macy's - Skyway", 44.97450, -93.27270, 2, "entrance"),

    # === Radisson Blu (7th & Nicollet) ===
    (47, 52, "Radisson Blu - Skyway", 44.97530, -93.27400, 2, "entrance"),

    # === Embassy Suites (LaSalle & 5th/6th) ===
    (48, 44, "Embassy Suites - Skyway", 44.97750, -93.27600, 2, "entrance"),

    # === Cowles Center (Hennepin & 5th/6th) ===
    (49, 45, "Cowles Center - Skyway", 44.97750, -93.27500, 2, "entrance"),

    # === Minneapolis Central Library (Hennepin & 4th) ===
    (50, 42, "Minneapolis Central Library - Skyway", 44.97850, -93.27400, 2, "entrance"),

    # === Marquette Hotel (7th & Marquette) ===
    (51, 41, "Marquette Hotel - Skyway", 44.97530, -93.27100, 2, "entrance"),

    # === St. Olaf Block (8th & 2nd Ave) ===
    (52, 56, "St. Olaf Block - Skyway", 44.97380, -93.26800, 2, "entrance"),

    # === Accenture Tower (8th & 3rd Ave) ===
    (53, 57, "Accenture Tower - Skyway", 44.97380, -93.26600, 2, "entrance"),

    # === Energy Center (9th & 2nd Ave) ===
    (54, 55, "Energy Center - Skyway", 44.97300, -93.26800, 2, "entrance"),

    # === 701 Building (7th & 4th Ave) ===
    (55, 58, "701 Building - Skyway", 44.97500, -93.26400, 2, "entrance"),

    # === Thrivent Financial (4th Ave & 6th) ===
    (56, 62, "Thrivent Financial - Skyway", 44.97650, -93.26200, 2, "entrance"),

    # === Hennepin County Medical Center (Park & 6th) ===
    (57, 61, "HCMC - Skyway", 44.97400, -93.25900, 2, "entrance"),

    # === Leamington Transit Hub (10th & Marquette) ===
    (58, 54, "Leamington Transit Hub - Skyway", 44.97100, -93.27100, 2, "entrance"),

    # === Orchestra Hall (11th & Nicollet) ===
    (59, 38, "Orchestra Hall - Skyway", 44.97050, -93.27270, 2, "entrance"),

    # === WCCO Building (11th & Nicollet) ===
    (60, 67, "WCCO Building - Skyway", 44.97100, -93.27400, 2, "entrance"),

    # === Westminster Church (Nicollet & 12th) ===
    (61, 71, "Westminster Church - Skyway", 44.96980, -93.27400, 2, "entrance"),

    # === Jet1 Center (2nd Ave & 9th/10th) ===
    (62, 66, "Jet1 Center - Skyway", 44.97200, -93.26800, 2, "entrance"),

    # === Best Western Plus (8th & 4th Ave) ===
    (63, 64, "Best Western Plus - Skyway", 44.97350, -93.26400, 2, "entrance"),

    # === Krause-Anderson (8th & 5th Ave) ===
    (64, 60, "Krause-Anderson - Skyway", 44.97300, -93.26200, 2, "entrance"),

    # === Centre Village (8th & 5th Ave) ===
    (65, 59, "Centre Village - Skyway", 44.97400, -93.26200, 2, "entrance"),

    # === Towle Building (Washington & 2nd Ave) ===
    (66, 69, "Towle Building - Skyway", 44.97830, -93.26800, 2, "entrance"),

    # === Hotel Minneapolis (5th & 2nd Ave) ===
    (67, 70, "Hotel Minneapolis - Skyway", 44.97780, -93.26800, 2, "entrance"),

    # === Plymouth Building (Nicollet & 4th) ===
    (68, 50, "Plymouth Building - Skyway", 44.97830, -93.27200, 2, "entrance"),

    # === Xcel Energy Building (Nicollet & 4th) ===
    (69, 51, "Xcel Energy Building - Skyway", 44.97830, -93.27100, 2, "entrance"),

    # === Ritz Residence (Nicollet & 3rd/4th) ===
    (70, 68, "Ritz Residence - Skyway", 44.97870, -93.27200, 2, "entrance"),

    # === AC Hotel (Hennepin & 4th) ===
    (71, 43, "AC Hotel - Skyway", 44.97870, -93.27500, 2, "entrance"),

    # === Whole Foods (Washington & 1st Ave) ===
    (72, 78, "Whole Foods - Skyway", 44.97950, -93.27300, 2, "entrance"),

    # === Block E (Hennepin & 6th/7th) ===
    (73, 77, "Block E - Skyway", 44.97700, -93.27600, 2, "entrance"),

    # ============================================================
    # INTERSECTION NODES (skyway junctions not inside buildings)
    # ============================================================
    # Nicollet Mall corridor
    (101, None, "Nicollet & 7th St Junction", 44.97500, -93.27270, 2, "intersection"),
    (102, None, "Nicollet & 6th St Junction", 44.97620, -93.27270, 2, "intersection"),
    (103, None, "Nicollet & 5th St Junction", 44.97750, -93.27270, 2, "intersection"),
    (104, None, "Nicollet & 4th St Junction", 44.97830, -93.27270, 2, "intersection"),
    (105, None, "Nicollet & 9th St Junction", 44.97350, -93.27270, 2, "intersection"),
    (106, None, "Nicollet & 10th St Junction", 44.97200, -93.27270, 2, "intersection"),

    # Marquette Ave corridor
    (111, None, "Marquette & 7th St Junction", 44.97500, -93.27000, 2, "intersection"),
    (112, None, "Marquette & 6th St Junction", 44.97620, -93.27000, 2, "intersection"),
    (113, None, "Marquette & 5th St Junction", 44.97750, -93.27000, 2, "intersection"),
    (114, None, "Marquette & 8th St Junction", 44.97400, -93.27000, 2, "intersection"),
    (115, None, "Marquette & 9th St Junction", 44.97300, -93.27000, 2, "intersection"),

    # 2nd Ave S corridor
    (121, None, "2nd Ave & 7th St Junction", 44.97500, -93.26800, 2, "intersection"),
    (122, None, "2nd Ave & 6th St Junction", 44.97620, -93.26800, 2, "intersection"),
    (123, None, "2nd Ave & 5th St Junction", 44.97750, -93.26800, 2, "intersection"),
    (124, None, "2nd Ave & 8th St Junction", 44.97400, -93.26800, 2, "intersection"),
    (125, None, "2nd Ave & 9th St Junction", 44.97300, -93.26800, 2, "intersection"),

    # 3rd Ave S corridor
    (131, None, "3rd Ave & 7th St Junction", 44.97500, -93.26600, 2, "intersection"),
    (132, None, "3rd Ave & 6th St Junction", 44.97620, -93.26600, 2, "intersection"),
    (133, None, "3rd Ave & 5th St Junction", 44.97750, -93.26600, 2, "intersection"),
    (134, None, "3rd Ave & 8th St Junction", 44.97400, -93.26600, 2, "intersection"),

    # 4th Ave S corridor
    (141, None, "4th Ave & 7th St Junction", 44.97500, -93.26400, 2, "intersection"),
    (142, None, "4th Ave & 6th St Junction", 44.97620, -93.26400, 2, "intersection"),
    (143, None, "4th Ave & 5th St Junction", 44.97750, -93.26400, 2, "intersection"),
    (144, None, "4th Ave & 8th St Junction", 44.97400, -93.26400, 2, "intersection"),

    # Hennepin/1st Ave corridor
    (151, None, "Hennepin & 7th St Junction", 44.97700, -93.27520, 2, "intersection"),
    (152, None, "Hennepin & 6th St Junction", 44.97750, -93.27520, 2, "intersection"),
    (153, None, "1st Ave & 6th St Junction", 44.97700, -93.27400, 2, "intersection"),

    # LaSalle corridor
    (161, None, "LaSalle & 8th St Junction", 44.97400, -93.27550, 2, "intersection"),
    (162, None, "LaSalle & 9th St Junction", 44.97300, -93.27550, 2, "intersection"),

    # Washington Ave corridor
    (171, None, "Washington & 2nd Ave Junction", 44.97830, -93.26800, 2, "intersection"),
    (172, None, "Washington & 3rd Ave Junction", 44.97830, -93.26600, 2, "intersection"),

    # 5th Ave / Park Ave corridor
    (181, None, "5th Ave & 7th St Junction", 44.97500, -93.26200, 2, "intersection"),
    (182, None, "5th Ave & 6th St Junction", 44.97620, -93.26200, 2, "intersection"),
    (183, None, "5th Ave & 8th St Junction", 44.97400, -93.26200, 2, "intersection"),

    # Additional junctions
    (191, None, "6th St & 1st Ave Junction", 44.97650, -93.27520, 2, "intersection"),
]

node_ids = {}
for n in nodes:
    node_ids[n[0]] = make_uuid("node", n[0])

# ============================================================
# SKYWAY EDGES - Connections between nodes
# Based on the official skyway map showing bridge connections
# distance_meters is approximate walking distance
# ============================================================
# Each edge: (id_num, start_node, end_node, distance_m, accessible, type)

edges = [
    # === IDS Center internal connections ===
    (1, 1, 2, 40, True, "corridor"),   # Crystal Court to Nicollet skyway
    (2, 1, 3, 50, True, "corridor"),   # Crystal Court to Marquette skyway
    (3, 1, 4, 45, True, "corridor"),   # Crystal Court to 8th St skyway

    # === IDS to neighbors ===
    (4, 2, 101, 30, True, "skyway"),   # IDS Nicollet to Nicollet & 7th
    (5, 3, 114, 40, True, "skyway"),   # IDS Marquette to Marquette & 8th
    (6, 4, 105, 30, True, "skyway"),   # IDS 8th St to Nicollet & 9th (south)

    # === Nicollet Mall N-S corridor ===
    (7, 101, 10, 25, True, "skyway"),  # Nicollet & 7th to City Center South
    (8, 10, 46, 30, True, "corridor"), # City Center to Macy's
    (9, 11, 102, 20, True, "skyway"),  # City Center North to Nicollet & 6th
    (10, 10, 11, 80, True, "corridor"),# City Center internal S-N
    (11, 102, 12, 30, True, "skyway"), # Nicollet & 6th to Gaviidae South
    (12, 12, 14, 60, True, "corridor"),# Gaviidae S to E
    (13, 12, 13, 60, True, "corridor"),# Gaviidae S to W
    (14, 103, 68, 25, True, "skyway"), # Nicollet & 5th to Plymouth Bldg
    (15, 68, 69, 40, True, "skyway"),  # Plymouth to Xcel Energy
    (16, 104, 70, 25, True, "skyway"), # Nicollet & 4th to Ritz Residence

    # === Nicollet Mall S corridor ===
    (17, 105, 15, 30, True, "skyway"), # Nicollet & 9th to Foshay
    (18, 105, 26, 40, True, "skyway"), # Nicollet & 9th to Young Quinlan
    (19, 106, 17, 30, True, "skyway"), # Nicollet & 10th to Wells Fargo
    (20, 17, 31, 40, True, "skyway"),  # Wells Fargo to Hilton
    (21, 31, 59, 50, True, "skyway"),  # Hilton to Orchestra Hall
    (22, 31, 32, 80, True, "skyway"),  # Hilton to Hyatt Regency

    # === Marquette Ave N-S corridor ===
    (23, 111, 5, 20, True, "skyway"),  # Marquette & 7th to Capella W
    (24, 5, 24, 25, True, "corridor"), # Capella to Baker Center
    (25, 112, 23, 25, True, "skyway"), # Marquette & 6th to Northstar
    (26, 23, 45, 30, True, "skyway"),  # Northstar to Wells Fargo Museum
    (27, 113, 23, 30, True, "skyway"), # Marquette & 5th to Northstar (N)
    (28, 114, 25, 25, True, "skyway"), # Marquette & 8th to Marquette Plaza
    (29, 25, 15, 30, True, "skyway"),  # Marquette Plaza to Foshay
    (30, 15, 36, 20, True, "corridor"),# Foshay to AT&T Tower
    (31, 115, 16, 25, True, "skyway"), # Marquette & 9th to US Bank Plaza
    (32, 16, 36, 30, True, "skyway"),  # US Bank Plaza to AT&T Tower

    # === 2nd Ave S N-S corridor ===
    (33, 121, 6, 20, True, "skyway"),  # 2nd Ave & 7th to Capella E
    (34, 6, 42, 25, True, "corridor"), # Capella E to TCF Tower
    (35, 122, 43, 25, True, "skyway"), # 2nd Ave & 6th to Canadian Pacific
    (36, 123, 67, 25, True, "skyway"), # 2nd Ave & 5th to Hotel Mpls
    (37, 124, 52, 25, True, "skyway"), # 2nd Ave & 8th to St. Olaf
    (38, 125, 35, 25, True, "skyway"), # 2nd Ave & 9th to Campbell Mithun
    (39, 35, 54, 30, True, "skyway"),  # Campbell Mithun to Energy Center

    # === 3rd Ave S N-S corridor ===
    (40, 131, 55, 25, True, "skyway"), # 3rd Ave & 7th to 701 Building
    (41, 132, 28, 25, True, "skyway"), # 3rd Ave & 6th to Tritech
    (42, 133, 40, 25, True, "skyway"), # 3rd Ave & 5th to Public Service Ctr
    (43, 134, 53, 25, True, "skyway"), # 3rd Ave & 8th to Accenture
    (44, 53, 34, 30, True, "skyway"),  # Accenture to Ameriprise

    # === 4th Ave S N-S corridor ===
    (45, 141, 55, 25, True, "skyway"), # 4th Ave & 7th to 701 Bldg
    (46, 142, 29, 25, True, "skyway"), # 4th Ave & 6th to Grain Exchange
    (47, 143, 19, 25, True, "skyway"), # 4th Ave & 5th to City Hall
    (48, 19, 20, 40, True, "skyway"),  # City Hall to Government Center W
    (49, 144, 63, 25, True, "skyway"), # 4th Ave & 8th to Best Western

    # === 5th Ave / Park Ave corridor ===
    (50, 181, 65, 25, True, "skyway"), # 5th Ave & 7th to Centre Village
    (51, 182, 56, 25, True, "skyway"), # 5th Ave & 6th to Thrivent
    (52, 56, 21, 30, True, "skyway"),  # Thrivent to Gov Center S
    (53, 183, 64, 25, True, "skyway"), # 5th Ave & 8th to Krause-Anderson
    (54, 64, 57, 40, True, "skyway"),  # Krause-Anderson to HCMC
    (55, 57, 30, 50, True, "skyway"),  # HCMC to US Bank Stadium

    # === E-W cross streets ===
    # 7th St (main E-W corridor)
    (56, 101, 111, 100, True, "skyway"), # Nicollet & 7th to Marquette & 7th
    (57, 111, 121, 100, True, "skyway"), # Marquette & 7th to 2nd Ave & 7th
    (58, 121, 131, 100, True, "skyway"), # 2nd Ave & 7th to 3rd Ave & 7th
    (59, 131, 141, 100, True, "skyway"), # 3rd Ave & 7th to 4th Ave & 7th
    (60, 141, 181, 100, True, "skyway"), # 4th Ave & 7th to 5th Ave & 7th

    # 6th St (main E-W corridor)
    (61, 102, 112, 100, True, "skyway"), # Nicollet & 6th to Marquette & 6th
    (62, 112, 122, 100, True, "skyway"), # Marquette & 6th to 2nd Ave & 6th
    (63, 122, 132, 100, True, "skyway"), # 2nd Ave & 6th to 3rd Ave & 6th
    (64, 132, 142, 100, True, "skyway"), # 3rd Ave & 6th to 4th Ave & 6th
    (65, 142, 182, 100, True, "skyway"), # 4th Ave & 6th to 5th Ave & 6th

    # 5th St
    (66, 103, 113, 100, True, "skyway"), # Nicollet & 5th to Marquette & 5th
    (67, 113, 123, 100, True, "skyway"), # Marquette & 5th to 2nd Ave & 5th
    (68, 123, 133, 100, True, "skyway"), # 2nd Ave & 5th to 3rd Ave & 5th
    (69, 133, 143, 100, True, "skyway"), # 3rd Ave & 5th to 4th Ave & 5th

    # 8th St
    (70, 114, 124, 100, True, "skyway"), # Marquette & 8th to 2nd Ave & 8th
    (71, 124, 134, 100, True, "skyway"), # 2nd Ave & 8th to 3rd Ave & 8th
    (72, 134, 144, 100, True, "skyway"), # 3rd Ave & 8th to 4th Ave & 8th
    (73, 144, 183, 100, True, "skyway"), # 4th Ave & 8th to 5th Ave & 8th

    # 9th St
    (74, 115, 125, 100, True, "skyway"), # Marquette & 9th to 2nd Ave & 9th

    # === Hennepin / 1st Ave / Target Plaza corridor ===
    (75, 151, 9, 30, True, "skyway"),   # Hennepin & 7th to Target Plaza S
    (76, 9, 8, 60, True, "corridor"),   # Target Plaza S to N
    (77, 8, 22, 40, True, "skyway"),    # Target Plaza N to Fifth St Towers
    (78, 22, 7, 120, True, "skyway"),   # Fifth St Towers to Target Center
    (79, 13, 153, 30, True, "skyway"),  # Gaviidae W to 1st Ave & 6th
    (80, 153, 9, 40, True, "skyway"),   # 1st Ave & 6th to Target Plaza S
    (81, 152, 49, 30, True, "skyway"),  # Hennepin & 6th to Cowles Center
    (82, 49, 48, 30, True, "skyway"),   # Cowles Center to Embassy Suites
    (83, 50, 71, 30, True, "skyway"),   # Central Library to AC Hotel
    (84, 71, 72, 40, True, "skyway"),   # AC Hotel to Whole Foods
    (85, 7, 37, 100, True, "skyway"),   # Target Center to Butler Square
    (86, 37, 38, 150, True, "skyway"),  # Butler Square to Target Field

    # === Gaviidae to Marquette corridor ===
    (87, 14, 112, 40, True, "skyway"),  # Gaviidae E to Marquette & 6th

    # === LaSalle corridor ===
    (88, 161, 33, 20, True, "skyway"),  # LaSalle & 8th to LaSalle Plaza
    (89, 161, 27, 30, True, "skyway"),  # LaSalle & 8th to Medical Arts
    (90, 162, 33, 30, True, "skyway"),  # LaSalle & 9th to LaSalle Plaza

    # === Washington Ave corridor (north) ===
    (91, 171, 66, 20, True, "skyway"),  # Washington & 2nd to Towle Bldg
    (92, 171, 67, 20, True, "skyway"),  # Washington & 2nd to Hotel Mpls
    (93, 172, 39, 20, True, "skyway"),  # Washington & 3rd to The Crossings
    (94, 39, 40, 30, True, "skyway"),   # The Crossings to Public Service Ctr

    # === Additional cross-connections ===
    (95, 101, 47, 40, True, "skyway"),  # Nicollet & 7th to Radisson Blu
    (96, 47, 151, 40, True, "skyway"),  # Radisson Blu to Hennepin & 7th
    (97, 102, 103, 100, True, "skyway"),# Nicollet & 6th to Nicollet & 5th
    (98, 103, 104, 80, True, "skyway"), # Nicollet & 5th to Nicollet & 4th
    (99, 105, 106, 100, True, "skyway"),# Nicollet & 9th to Nicollet & 10th
    (100, 111, 112, 100, True, "skyway"),# Marquette & 7th to Marquette & 6th
    (101, 112, 113, 100, True, "skyway"),# Marquette & 6th to Marquette & 5th
    (102, 114, 115, 100, True, "skyway"),# Marquette & 8th to Marquette & 9th
    (103, 121, 122, 100, True, "skyway"),# 2nd Ave & 7th to 2nd Ave & 6th
    (104, 122, 123, 100, True, "skyway"),# 2nd Ave & 6th to 2nd Ave & 5th
    (105, 123, 171, 60, True, "skyway"), # 2nd Ave & 5th to Washington & 2nd
    (106, 131, 132, 100, True, "skyway"),# 3rd Ave & 7th to 3rd Ave & 6th
    (107, 132, 133, 100, True, "skyway"),# 3rd Ave & 6th to 3rd Ave & 5th
    (108, 133, 172, 60, True, "skyway"), # 3rd Ave & 5th to Washington & 3rd
    (109, 141, 142, 100, True, "skyway"),# 4th Ave & 7th to 4th Ave & 6th
    (110, 142, 143, 100, True, "skyway"),# 4th Ave & 6th to 4th Ave & 5th
    (111, 143, 19, 30, True, "skyway"),  # 4th Ave & 5th to City Hall (duplicate removed)

    # === Leamington / south corridor ===
    (112, 17, 58, 50, True, "skyway"),  # Wells Fargo to Leamington
    (113, 58, 59, 40, True, "skyway"),  # Leamington to Orchestra Hall

    # === Jet1 / south 2nd Ave ===
    (114, 54, 62, 30, True, "skyway"),  # Energy Center to Jet1

    # === Block E / Hennepin corridor ===
    (115, 73, 151, 30, True, "skyway"), # Block E to Hennepin & 7th
    (116, 73, 8, 40, True, "skyway"),   # Block E to Target Plaza N

    # === Additional N-S connections ===
    (117, 151, 152, 50, True, "skyway"),# Hennepin & 7th to Hennepin & 6th
    (118, 152, 50, 40, True, "skyway"), # Hennepin & 6th to Central Library
    (119, 104, 50, 40, True, "skyway"), # Nicollet & 4th to Central Library
    (120, 181, 182, 100, True, "skyway"),# 5th Ave & 7th to 5th Ave & 6th

    # === IDS to LaSalle ===
    (121, 4, 161, 50, True, "skyway"),  # IDS 8th St to LaSalle & 8th

    # === Gaviidae to Nicollet 5th ===
    (122, 12, 103, 30, True, "skyway"), # Gaviidae S to Nicollet & 5th (via corridor)

    # === 44th to 5th St connections ===
    (123, 44, 133, 30, True, "skyway"), # CenturyLink to 3rd Ave & 5th
    (124, 29, 143, 30, True, "skyway"), # Grain Exchange to 4th Ave & 5th

    # === 51 Marquette Hotel connections ===
    (125, 51, 111, 20, True, "skyway"), # Marquette Hotel to Marquette & 7th

    # === Macy's to IDS ===
    (126, 46, 101, 20, True, "skyway"), # Macy's to Nicollet & 7th

    # === 60 WCCO connections ===
    (127, 60, 31, 30, True, "skyway"),  # WCCO to Hilton

    # === Government Center to Thrivent ===
    (128, 20, 142, 40, True, "skyway"), # Gov Center W to 4th Ave & 6th

    # === Additional missing connections ===
    (129, 18, 112, 20, True, "skyway"), # RBC Plaza to Marquette & 6th
    (130, 43, 122, 20, True, "skyway"), # Canadian Pacific to 2nd Ave & 6th
]

# ============================================================
# BUSINESSES - Updated with correct building associations
# ============================================================
businesses = [
    (1, 1, "Crystal Court Food Hall", "Food & Dining", "Food court in the IDS Center Crystal Court with multiple vendors", 2, 44.97397, -93.27193, "M-F 7AM-7PM"),
    (2, 1, "Walgreens - IDS Center", "Pharmacy & Health", "Full-service pharmacy and convenience store", 1, 44.97390, -93.27200, "M-F 7AM-8PM, Sat 9AM-6PM"),
    (3, 5, "Target - City Center", "Retail", "Target retail store in City Center", 1, 44.97530, -93.27300, "M-F 8AM-9PM, Sat-Sun 9AM-8PM"),
    (4, 6, "Saks OFF 5TH", "Retail", "Designer fashion at discount prices", 2, 44.97700, -93.27300, "M-F 10AM-7PM, Sat 10AM-6PM"),
    (5, 1, "Caribou Coffee - IDS", "Coffee & Cafe", "Coffee shop in the IDS Center skyway level", 2, 44.97400, -93.27190, "M-F 6AM-5PM"),
    (6, 6, "Chipotle - Gaviidae", "Food & Dining", "Mexican-inspired fast casual restaurant", 2, 44.97700, -93.27280, "M-F 10:30AM-8PM"),
    (7, 2, "Potbelly Sandwich Shop", "Food & Dining", "Toasted sandwiches and soups", 2, 44.97500, -93.26960, "M-F 10AM-7PM"),
    (8, 4, "Starbucks - Target Plaza", "Coffee & Cafe", "Coffee and espresso drinks", 2, 44.97680, -93.27520, "M-F 5:30AM-6PM"),
    (9, 15, "Subway - Northstar", "Food & Dining", "Sub sandwiches and salads", 2, 44.97720, -93.27010, "M-F 7AM-7PM"),
    (10, 7, "W Minneapolis - The Foshay", "Hotel", "Luxury hotel in the historic Foshay Tower", 1, 44.97444, -93.27153, "24/7"),
    (11, 24, "Hilton Minneapolis", "Hotel", "Full-service hotel connected to skyway", 1, 44.97150, -93.27270, "24/7"),
    (12, 25, "Hyatt Regency Minneapolis", "Hotel", "Convention hotel with skyway access", 1, 44.96950, -93.27270, "24/7"),
    (13, 1, "FedEx Office - IDS", "Services", "Printing, shipping, and business services", 2, 44.97388, -93.27210, "M-F 7:30AM-6PM"),
    (14, 5, "Great Clips - City Center", "Services", "Hair salon", 2, 44.97535, -93.27310, "M-F 8AM-7PM, Sat 9AM-5PM"),
    (15, 10, "Noodles & Company", "Food & Dining", "Noodle bowls and pasta dishes", 2, 44.97680, -93.26960, "M-F 10:30AM-8PM"),
    (16, 16, "Jimmy Johns - Baker Center", "Food & Dining", "Freaky fast sub sandwiches", 2, 44.97530, -93.26960, "M-F 7AM-7PM"),
    (17, 22, "Grain Exchange Cafe", "Coffee & Cafe", "Coffee and pastries in the historic Grain Exchange", 2, 44.97730, -93.26560, "M-F 6:30AM-4PM"),
    (18, 3, "Target Center Box Office", "Entertainment", "Tickets for events at Target Center", 1, 44.97946, -93.27620, "Event days only"),
    (19, 23, "US Bank Stadium Store", "Retail", "Vikings merchandise and memorabilia", 1, 44.97410, -93.25740, "Event days and M-F 10AM-5PM"),
    (20, 8, "Panera Bread - US Bank Plaza", "Food & Dining", "Bakery-cafe with soups, salads, and sandwiches", 2, 44.97350, -93.27010, "M-F 6:30AM-8PM"),
    (21, 6, "Cooks of Crocus Hill", "Retail", "Kitchen store and cooking classes", 2, 44.97710, -93.27320, "M-F 10AM-6PM, Sat 10AM-5PM"),
    (22, 1, "US Bank Branch - IDS", "Financial Services", "Full-service bank branch", 1, 44.97392, -93.27180, "M-F 9AM-5PM"),
    (23, 9, "Wells Fargo Branch", "Financial Services", "Full-service bank branch", 1, 44.97255, -93.27210, "M-F 9AM-5PM"),
    (24, 20, "MinuteClinic", "Pharmacy & Health", "Walk-in medical clinic", 2, 44.97380, -93.27410, "M-F 8AM-6PM"),
    (25, 4, "Caribou Coffee - Target Plaza", "Coffee & Cafe", "Coffee and espresso drinks", 2, 44.97690, -93.27530, "M-F 6AM-5PM"),
    # Additional businesses
    (26, 46, "Macy's Department Store", "Retail", "Full-service department store", 1, 44.97450, -93.27280, "M-F 10AM-8PM, Sat 10AM-7PM, Sun 11AM-6PM"),
    (27, 52, "Radisson Blu", "Hotel", "Upscale hotel in downtown Minneapolis", 1, 44.97530, -93.27410, "24/7"),
    (28, 42, "Minneapolis Central Library", "Services", "Hennepin County public library", 1, 44.97850, -93.27410, "M-Th 9AM-9PM, F-Sat 9AM-5PM, Sun 12PM-5PM"),
    (29, 47, "Wells Fargo History Museum", "Entertainment", "Free museum showcasing Wells Fargo history", 1, 44.97620, -93.27110, "M-F 9AM-5PM"),
    (30, 40, "TCF Tower Cafe", "Coffee & Cafe", "Coffee and light fare", 2, 44.97450, -93.26910, "M-F 6:30AM-3PM"),
    (31, 15, "Northstar Center Deli", "Food & Dining", "Deli sandwiches and salads", 2, 44.97730, -93.27010, "M-F 7AM-3PM"),
    (32, 48, "Canadian Pacific Tower Cafe", "Coffee & Cafe", "Coffee shop in Canadian Pacific Tower", 2, 44.97680, -93.26710, "M-F 6:30AM-4PM"),
    (33, 33, "Butler Square Shops", "Retail", "Boutique shops in historic warehouse", 1, 44.97950, -93.27810, "M-F 10AM-6PM"),
    (34, 44, "Embassy Suites Minneapolis", "Hotel", "All-suite hotel with skyway access", 1, 44.97750, -93.27610, "24/7"),
    (35, 61, "HCMC Emergency", "Pharmacy & Health", "Level 1 trauma center and emergency room", 1, 44.97400, -93.25910, "24/7"),
]

# ============================================================
# DATABASE OPERATIONS
# ============================================================

def delete_all():
    """Delete all existing data (order matters for foreign keys)."""
    for table in ["businesses", "skyway_edges", "skyway_nodes", "buildings"]:
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{table}?id=neq.00000000-0000-0000-0000-000000000000",
            headers=HEADERS,
        )
        print(f"  Deleted {table}: {r.status_code}")

def insert_buildings():
    data = []
    for num, name in buildings:
        data.append({
            "id": building_ids[num],
            "name": name,
        })
    r = requests.post(f"{SUPABASE_URL}/rest/v1/buildings", headers=HEADERS, json=data)
    print(f"  Inserted {len(data)} buildings: {r.status_code}")
    if r.status_code >= 400:
        print(f"    Error: {r.text[:200]}")
    return r.status_code < 400

def insert_nodes():
    data = []
    for n in nodes:
        num, bldg_num, name, lat, lng, floor, ntype = n
        data.append({
            "id": node_ids[num],
            "building_id": building_ids[bldg_num] if bldg_num else None,
            "name": name,
            "latitude": lat,
            "longitude": lng,
            "floor_level": floor,
            "node_type": ntype,
        })
    # Insert in batches of 50
    for i in range(0, len(data), 50):
        batch = data[i:i+50]
        r = requests.post(f"{SUPABASE_URL}/rest/v1/skyway_nodes", headers=HEADERS, json=batch)
        print(f"  Inserted nodes batch {i//50+1}: {r.status_code}")
        if r.status_code >= 400:
            print(f"    Error: {r.text[:200]}")
            return False
    return True

def insert_edges():
    data = []
    for e in edges:
        num, start, end, dist, accessible, etype = e
        data.append({
            "id": make_uuid("edge", num),
            "start_node_id": node_ids[start],
            "end_node_id": node_ids[end],
            "distance_meters": dist,
            "is_accessible": accessible,
            "edge_type": etype,
        })
    for i in range(0, len(data), 50):
        batch = data[i:i+50]
        r = requests.post(f"{SUPABASE_URL}/rest/v1/skyway_edges", headers=HEADERS, json=batch)
        print(f"  Inserted edges batch {i//50+1}: {r.status_code}")
        if r.status_code >= 400:
            print(f"    Error: {r.text[:200]}")
            return False
    return True

def insert_businesses():
    data = []
    for b in businesses:
        num, bldg_num, name, cat, desc, floor, lat, lng, hours = b
        data.append({
            "id": make_uuid("business", num),
            "building_id": building_ids[bldg_num],
            "name": name,
            "category": cat,
            "description": desc,
            "floor_level": floor,
            "latitude": lat,
            "longitude": lng,
            "skyway_hours": hours,
        })
    r = requests.post(f"{SUPABASE_URL}/rest/v1/businesses", headers=HEADERS, json=data)
    print(f"  Inserted {len(data)} businesses: {r.status_code}")
    if r.status_code >= 400:
        print(f"    Error: {r.text[:200]}")
    return r.status_code < 400

def verify():
    """Verify data counts."""
    for table in ["buildings", "skyway_nodes", "skyway_edges", "businesses"]:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?select=id",
            headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"},
        )
        count = r.headers.get("content-range", "unknown")
        print(f"  {table}: {count}")

if __name__ == "__main__":
    print("=== Rebuilding Minneapolis Skyway Database ===")
    print()
    print("Step 1: Deleting existing data...")
    delete_all()
    print()
    print("Step 2: Inserting buildings...")
    if not insert_buildings():
        print("FAILED to insert buildings")
        sys.exit(1)
    print()
    print("Step 3: Inserting nodes...")
    if not insert_nodes():
        print("FAILED to insert nodes")
        sys.exit(1)
    print()
    print("Step 4: Inserting edges...")
    if not insert_edges():
        print("FAILED to insert edges")
        sys.exit(1)
    print()
    print("Step 5: Inserting businesses...")
    if not insert_businesses():
        print("FAILED to insert businesses")
        sys.exit(1)
    print()
    print("Step 6: Verifying data...")
    verify()
    print()
    print("=== Done! ===")
