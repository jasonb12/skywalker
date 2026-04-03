import { describe, it, expect } from 'vitest';
import { formatDistance, formatTime } from '../lib/format';
import { buildAdjacencyMap, findPath, buildRoute } from '../lib/pathfinding';
import { haversine } from '../lib/geo';
import { navigationReducer, initialState } from '../lib/navigation-store';
import type { SkywayNode, SkywayEdge, Business, SavedPath } from '../lib/types';

// ============ Format Tests ============

describe('formatDistance', () => {
  it('formats meters under 1000 as meters', () => {
    expect(formatDistance(500, 'meters')).toBe('500 m');
  });

  it('formats meters over 1000 as km', () => {
    expect(formatDistance(1500, 'meters')).toBe('1.5 km');
  });

  it('formats feet under 1000 as feet', () => {
    expect(formatDistance(100, 'feet')).toBe('328 ft');
  });

  it('formats feet over 1000 as miles', () => {
    expect(formatDistance(2000, 'feet')).toBe('1.2 mi');
  });
});

describe('formatTime', () => {
  it('formats under 60 seconds', () => {
    expect(formatTime(30)).toBe('Less than 1 min');
  });

  it('formats 1 minute', () => {
    expect(formatTime(60)).toBe('1 min');
  });

  it('formats multiple minutes', () => {
    expect(formatTime(300)).toBe('5 min');
  });

  it('formats hours', () => {
    expect(formatTime(3600)).toBe('1 hr');
  });

  it('formats hours and minutes', () => {
    expect(formatTime(3900)).toBe('1 hr 5 min');
  });
});

// ============ Pathfinding Tests ============

const testNodes: SkywayNode[] = [
  { id: 'n1', name: 'Node A', latitude: 44.975, longitude: -93.271, floor_level: 2, node_type: 'intersection', building_id: null },
  { id: 'n2', name: 'Node B', latitude: 44.976, longitude: -93.271, floor_level: 2, node_type: 'intersection', building_id: null },
  { id: 'n3', name: 'Node C', latitude: 44.977, longitude: -93.271, floor_level: 2, node_type: 'intersection', building_id: null },
  { id: 'n4', name: 'Node D', latitude: 44.976, longitude: -93.272, floor_level: 2, node_type: 'intersection', building_id: null },
];

const testEdges: SkywayEdge[] = [
  { id: 'e1', start_node_id: 'n1', end_node_id: 'n2', distance_meters: 100, edge_type: 'skyway', is_accessible: true },
  { id: 'e2', start_node_id: 'n2', end_node_id: 'n3', distance_meters: 100, edge_type: 'skyway', is_accessible: true },
  { id: 'e3', start_node_id: 'n2', end_node_id: 'n4', distance_meters: 150, edge_type: 'skyway', is_accessible: true },
];

describe('buildAdjacencyMap', () => {
  it('creates bidirectional adjacency map', () => {
    const adj = buildAdjacencyMap(testEdges);
    expect(adj.has('n1')).toBe(true);
    expect(adj.has('n2')).toBe(true);
    expect(adj.get('n1')!.length).toBe(1);
    expect(adj.get('n2')!.length).toBe(3); // n1, n3, n4
  });
});

describe('findPath', () => {
  it('finds direct path between adjacent nodes', () => {
    const path = findPath('n1', 'n2', testNodes, testEdges);
    expect(path).toEqual(['n1', 'n2']);
  });

  it('finds multi-hop path', () => {
    const path = findPath('n1', 'n3', testNodes, testEdges);
    expect(path).toEqual(['n1', 'n2', 'n3']);
  });

  it('finds path to branching node', () => {
    const path = findPath('n1', 'n4', testNodes, testEdges);
    expect(path).toEqual(['n1', 'n2', 'n4']);
  });

  it('returns null for disconnected nodes', () => {
    const isolatedNodes: SkywayNode[] = [...testNodes, { id: 'n5', name: 'Isolated', latitude: 45.0, longitude: -93.0, floor_level: 2, node_type: 'intersection', building_id: null }];
    const path = findPath('n1', 'n5', isolatedNodes, testEdges);
    expect(path).toBeNull();
  });

  it('returns null for non-existent start node', () => {
    const path = findPath('nonexistent', 'n2', testNodes, testEdges);
    expect(path).toBeNull();
  });
});

describe('buildRoute', () => {
  it('generates navigation steps from path', () => {
    const route = buildRoute(['n1', 'n2', 'n3'], testNodes, testEdges);
    expect(route.steps.length).toBe(3);
    expect(route.steps[0].direction).toBe('straight');
    expect(route.steps[0].instruction).toContain('Start at');
    expect(route.steps[2].direction).toBe('arrive');
    expect(route.steps[2].instruction).toContain('Arrive at');
    expect(route.totalDistance).toBeGreaterThan(0);
    expect(route.estimatedTime).toBeGreaterThan(0);
    expect(route.nodeIds).toEqual(['n1', 'n2', 'n3']);
  });

  it('calculates total distance correctly', () => {
    const route = buildRoute(['n1', 'n2', 'n3'], testNodes, testEdges);
    expect(route.totalDistance).toBe(200); // 100 + 100
  });
});

// ============ Navigation Reducer Tests ============

describe('navigationReducer', () => {
  it('handles SET_DATA', () => {
    const state = navigationReducer(initialState, {
      type: 'SET_DATA',
      buildings: [{ id: 'b1', name: 'Test' }],
      nodes: testNodes,
      edges: testEdges,
      businesses: [],
    });
    expect(state.buildings.length).toBe(1);
    expect(state.nodes.length).toBe(4);
    expect(state.edges.length).toBe(3);
    expect(state.dataLoaded).toBe(true);
  });

  it('handles SET_POSITION', () => {
    const pos = { latitude: 44.975, longitude: -93.271, accuracy: 5, heading: 90, source: 'gps' as const };
    const state = navigationReducer(initialState, { type: 'SET_POSITION', position: pos });
    expect(state.userPosition).toEqual(pos);
  });

  it('handles START_NAVIGATION', () => {
    const route = buildRoute(['n1', 'n2', 'n3'], testNodes, testEdges);
    const state = navigationReducer(initialState, {
      type: 'START_NAVIGATION',
      route,
      business: null,
      destNode: testNodes[2],
    });
    expect(state.isNavigating).toBe(true);
    expect(state.activeRoute).toBe(route);
    expect(state.currentStepIndex).toBe(0);
    expect(state.destinationNode).toBe(testNodes[2]);
  });

  it('handles UPDATE_STEP', () => {
    const state = navigationReducer(initialState, { type: 'UPDATE_STEP', stepIndex: 2 });
    expect(state.currentStepIndex).toBe(2);
  });

  it('handles SET_OFF_COURSE', () => {
    const state = navigationReducer(initialState, { type: 'SET_OFF_COURSE', isOffCourse: true });
    expect(state.isOffCourse).toBe(true);
  });

  it('handles END_NAVIGATION', () => {
    const route = buildRoute(['n1', 'n2', 'n3'], testNodes, testEdges);
    let state = navigationReducer(initialState, {
      type: 'START_NAVIGATION',
      route,
      business: null,
      destNode: testNodes[2],
    });
    state = navigationReducer(state, { type: 'END_NAVIGATION' });
    expect(state.isNavigating).toBe(false);
    expect(state.activeRoute).toBeNull();
    expect(state.currentStepIndex).toBe(0);
  });

  it('handles ADD_SAVED_PATH', () => {
    const path: SavedPath = {
      id: '1',
      startName: 'A',
      endName: 'B',
      startNodeId: 'n1',
      endNodeId: 'n2',
      distance: 100,
      duration: 60,
      timestamp: Date.now(),
      nodeIds: ['n1', 'n2'],
    };
    const state = navigationReducer(initialState, { type: 'ADD_SAVED_PATH', path });
    expect(state.savedPaths.length).toBe(1);
    expect(state.savedPaths[0].startName).toBe('A');
  });

  it('handles TOGGLE_HAPTIC', () => {
    const state = navigationReducer(initialState, { type: 'TOGGLE_HAPTIC' });
    expect(state.hapticEnabled).toBe(false);
    const state2 = navigationReducer(state, { type: 'TOGGLE_HAPTIC' });
    expect(state2.hapticEnabled).toBe(true);
  });

  it('handles SET_DISTANCE_UNIT', () => {
    const state = navigationReducer(initialState, { type: 'SET_DISTANCE_UNIT', unit: 'meters' });
    expect(state.distanceUnit).toBe('meters');
  });
});
