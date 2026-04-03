import { supabase } from './supabase';
import { haversine } from './geo';
import type { Building, SkywayNode, SkywayEdge, Business } from './types';

let cachedNodes: SkywayNode[] | null = null;
let cachedEdges: SkywayEdge[] | null = null;
let cachedBuildings: Building[] | null = null;
let cachedBusinesses: Business[] | null = null;

export async function fetchBuildings(): Promise<Building[]> {
  if (cachedBuildings) return cachedBuildings;
  const { data, error } = await supabase.from('buildings').select('*');
  if (error) {
    console.warn('Failed to fetch buildings:', error.message);
    return [];
  }
  cachedBuildings = data ?? [];
  return cachedBuildings;
}

export async function fetchNodes(): Promise<SkywayNode[]> {
  if (cachedNodes) return cachedNodes;
  const { data, error } = await supabase.from('skyway_nodes').select('*');
  if (error) {
    console.warn('Failed to fetch nodes:', error.message);
    return [];
  }
  cachedNodes = data ?? [];
  return cachedNodes;
}

export async function fetchEdges(): Promise<SkywayEdge[]> {
  if (cachedEdges) return cachedEdges;
  const { data, error } = await supabase.from('skyway_edges').select('*');
  if (error) {
    console.warn('Failed to fetch edges:', error.message);
    return [];
  }
  cachedEdges = data ?? [];
  return cachedEdges;
}

export async function fetchBusinesses(): Promise<Business[]> {
  if (cachedBusinesses) return cachedBusinesses;
  const { data, error } = await supabase.from('businesses').select('*');
  if (error) {
    console.warn('Failed to fetch businesses:', error.message);
    return [];
  }
  cachedBusinesses = data ?? [];
  return cachedBusinesses;
}

export function clearCache() {
  cachedNodes = null;
  cachedEdges = null;
  cachedBuildings = null;
  cachedBusinesses = null;
}

export async function searchBusinesses(query: string, category?: string): Promise<Business[]> {
  const businesses = await fetchBusinesses();
  const q = query.toLowerCase().trim();
  return businesses.filter((b) => {
    const matchesQuery = !q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.category.toLowerCase().includes(q);
    const matchesCategory = !category || category === 'All' || b.category === category;
    return matchesQuery && matchesCategory;
  });
}

export async function findNearestNode(lat: number, lng: number): Promise<SkywayNode | null> {
  const nodes = await fetchNodes();
  if (nodes.length === 0) return null;
  let nearest: SkywayNode | null = null;
  let minDist = Infinity;
  for (const node of nodes) {
    const d = haversine(lat, lng, node.latitude, node.longitude);
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

export { haversine } from './geo';
