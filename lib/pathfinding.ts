import type { SkywayNode, SkywayEdge, NavigationRoute, NavigationStep } from './types';
import { haversine } from './geo';

interface GraphEdge {
  targetId: string;
  distance: number;
  edgeType: string;
}

type AdjacencyMap = Map<string, GraphEdge[]>;

export function buildAdjacencyMap(edges: SkywayEdge[]): AdjacencyMap {
  const adj: AdjacencyMap = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.start_node_id)) adj.set(edge.start_node_id, []);
    if (!adj.has(edge.end_node_id)) adj.set(edge.end_node_id, []);
    adj.get(edge.start_node_id)!.push({
      targetId: edge.end_node_id,
      distance: edge.distance_meters,
      edgeType: edge.edge_type,
    });
    // Bidirectional
    adj.get(edge.end_node_id)!.push({
      targetId: edge.start_node_id,
      distance: edge.distance_meters,
      edgeType: edge.edge_type,
    });
  }
  return adj;
}

function heuristic(a: SkywayNode, b: SkywayNode): number {
  return haversine(a.latitude, a.longitude, b.latitude, b.longitude);
}

export function findPath(
  startId: string,
  endId: string,
  nodes: SkywayNode[],
  edges: SkywayEdge[]
): string[] | null {
  const adj = buildAdjacencyMap(edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const startNode = nodeMap.get(startId);
  const endNode = nodeMap.get(endId);
  if (!startNode || !endNode) return null;

  const openSet = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startId, 0);
  fScore.set(startId, heuristic(startNode, endNode));

  while (openSet.size > 0) {
    // Find node in openSet with lowest fScore
    let current = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }

    if (current === endId) {
      // Reconstruct path
      const path: string[] = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c)!;
        path.unshift(c);
      }
      return path;
    }

    openSet.delete(current);
    const neighbors = adj.get(current) ?? [];

    for (const neighbor of neighbors) {
      const tentativeG = (gScore.get(current) ?? Infinity) + neighbor.distance;
      if (tentativeG < (gScore.get(neighbor.targetId) ?? Infinity)) {
        cameFrom.set(neighbor.targetId, current);
        gScore.set(neighbor.targetId, tentativeG);
        const targetNode = nodeMap.get(neighbor.targetId);
        fScore.set(
          neighbor.targetId,
          tentativeG + (targetNode ? heuristic(targetNode, endNode) : 0)
        );
        openSet.add(neighbor.targetId);
      }
    }
  }

  return null; // No path found
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function getDirection(prevBearing: number, nextBearing: number): NavigationStep['direction'] {
  let diff = nextBearing - prevBearing;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  if (Math.abs(diff) < 20) return 'straight';
  if (diff >= 20 && diff < 60) return 'slight-right';
  if (diff >= 60 && diff < 150) return 'right';
  if (diff >= 150) return 'u-turn';
  if (diff <= -20 && diff > -60) return 'slight-left';
  if (diff <= -60 && diff > -150) return 'left';
  return 'u-turn';
}

function getDirectionText(dir: NavigationStep['direction']): string {
  switch (dir) {
    case 'straight': return 'Continue straight';
    case 'left': return 'Turn left';
    case 'right': return 'Turn right';
    case 'slight-left': return 'Bear left';
    case 'slight-right': return 'Bear right';
    case 'u-turn': return 'Make a U-turn';
    case 'arrive': return 'You have arrived';
  }
}

export function buildRoute(
  pathNodeIds: string[],
  nodes: SkywayNode[],
  edges: SkywayEdge[]
): NavigationRoute {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<string, SkywayEdge>();
  for (const e of edges) {
    edgeMap.set(`${e.start_node_id}-${e.end_node_id}`, e);
    edgeMap.set(`${e.end_node_id}-${e.start_node_id}`, e);
  }

  const steps: NavigationStep[] = [];
  let totalDistance = 0;

  for (let i = 0; i < pathNodeIds.length; i++) {
    const node = nodeMap.get(pathNodeIds[i]);
    if (!node) continue;

    if (i === 0) {
      // Start
      const nextNode = nodeMap.get(pathNodeIds[1]);
      const edge = edgeMap.get(`${pathNodeIds[0]}-${pathNodeIds[1]}`);
      steps.push({
        instruction: `Start at ${node.name}`,
        distance: edge?.distance_meters ?? 0,
        nodeId: node.id,
        nodeName: node.name,
        direction: 'straight',
        latitude: node.latitude,
        longitude: node.longitude,
      });
      totalDistance += edge?.distance_meters ?? 0;
    } else if (i === pathNodeIds.length - 1) {
      // Arrive
      steps.push({
        instruction: `Arrive at ${node.name}`,
        distance: 0,
        nodeId: node.id,
        nodeName: node.name,
        direction: 'arrive',
        latitude: node.latitude,
        longitude: node.longitude,
      });
    } else {
      // Intermediate
      const prevNode = nodeMap.get(pathNodeIds[i - 1])!;
      const nextNode = nodeMap.get(pathNodeIds[i + 1]);
      const edge = edgeMap.get(`${pathNodeIds[i]}-${pathNodeIds[i + 1]}`);

      const prevBearing = calculateBearing(prevNode.latitude, prevNode.longitude, node.latitude, node.longitude);
      const nextBearing = nextNode
        ? calculateBearing(node.latitude, node.longitude, nextNode.latitude, nextNode.longitude)
        : prevBearing;

      const direction = getDirection(prevBearing, nextBearing);
      const dirText = getDirectionText(direction);
      const dist = edge?.distance_meters ?? 0;

      steps.push({
        instruction: `${dirText} at ${node.name}`,
        distance: dist,
        nodeId: node.id,
        nodeName: node.name,
        direction,
        latitude: node.latitude,
        longitude: node.longitude,
      });
      totalDistance += dist;
    }
  }

  const estimatedTime = totalDistance / 1.4; // ~1.4 m/s walking speed

  return {
    steps,
    totalDistance,
    estimatedTime,
    nodeIds: pathNodeIds,
  };
}
