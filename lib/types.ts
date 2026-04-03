// Skyway data models

export interface Building {
  id: string;
  name: string;
  map_graph?: {
    latitude: number;
    longitude: number;
    skyway_hours?: string;
    address?: string;
    osmid?: string;
  } | null;
  creator_user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SkywayNode {
  id: string;
  building_id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  floor_level: number;
  node_type: 'entrance' | 'intersection' | 'landmark' | 'elevator' | 'stairs';
  created_at?: string;
}

export interface SkywayEdge {
  id: string;
  start_node_id: string;
  end_node_id: string;
  distance_meters: number;
  is_accessible: boolean;
  edge_type: 'skyway' | 'corridor' | 'tunnel' | 'elevator' | 'stairs';
  created_at?: string;
}

export interface Business {
  id: string;
  building_id: string;
  name: string;
  category: string;
  description: string;
  floor_level: number;
  latitude: number;
  longitude: number;
  skyway_hours: string;
  created_at?: string;
}

export interface NavigationStep {
  instruction: string;
  distance: number; // meters
  nodeId: string;
  nodeName: string;
  direction: 'straight' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'u-turn' | 'arrive';
  latitude: number;
  longitude: number;
}

export interface NavigationRoute {
  steps: NavigationStep[];
  totalDistance: number; // meters
  estimatedTime: number; // seconds (avg walking speed ~1.4 m/s)
  nodeIds: string[];
}

export interface SavedPath {
  id: string;
  startName: string;
  endName: string;
  startNodeId: string;
  endNodeId: string;
  distance: number;
  duration: number;
  timestamp: number;
  nodeIds: string[];
}

export interface Beacon {
  id: string;
  building_id: string | null;
  hw_id: string;
  label: string | null;
  beacon_uuid: string;
  major: number;
  minor: number;
  latitude: number;
  longitude: number;
  floor_level: number;
  tx_power: number;
  metadata: Record<string, unknown> | null;
  created_at?: string;
}

export interface DetectedBeacon {
  hw_id: string;
  rssi: number;
  distance: number; // estimated meters from RSSI
  beacon?: Beacon; // matched beacon from DB
}

export interface UserPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  source: 'gps' | 'ble' | 'fused' | 'dead-reckoning' | 'snapped';
  bleBeaconsInRange?: number;
}

export const BUSINESS_CATEGORIES = [
  'All',
  'food',
  'shopping',
  'services',
  'health',
  'hotel',
  'entertainment',
  'government',
] as const;

export type BusinessCategory = typeof BUSINESS_CATEGORIES[number];
