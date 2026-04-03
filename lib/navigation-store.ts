import { createContext, useContext } from 'react';
import type {
  Building,
  SkywayNode,
  SkywayEdge,
  Business,
  NavigationRoute,
  SavedPath,
  UserPosition,
} from './types';

export interface NavigationState {
  // Data
  buildings: Building[];
  nodes: SkywayNode[];
  edges: SkywayEdge[];
  businesses: Business[];
  dataLoaded: boolean;

  // User position
  userPosition: UserPosition | null;

  // Active navigation
  activeRoute: NavigationRoute | null;
  currentStepIndex: number;
  destinationBusiness: Business | null;
  destinationNode: SkywayNode | null;
  isNavigating: boolean;
  isOffCourse: boolean;

  // History
  savedPaths: SavedPath[];

  // Settings
  hapticEnabled: boolean;
  distanceUnit: 'feet' | 'meters';
}

export type NavigationAction =
  | { type: 'SET_DATA'; buildings: Building[]; nodes: SkywayNode[]; edges: SkywayEdge[]; businesses: Business[] }
  | { type: 'SET_POSITION'; position: UserPosition | null }
  | { type: 'START_NAVIGATION'; route: NavigationRoute; business: Business | null; destNode: SkywayNode }
  | { type: 'UPDATE_STEP'; stepIndex: number }
  | { type: 'SET_OFF_COURSE'; isOffCourse: boolean }
  | { type: 'END_NAVIGATION' }
  | { type: 'ADD_SAVED_PATH'; path: SavedPath }
  | { type: 'SET_SAVED_PATHS'; paths: SavedPath[] }
  | { type: 'TOGGLE_HAPTIC' }
  | { type: 'SET_DISTANCE_UNIT'; unit: 'feet' | 'meters' };

export const initialState: NavigationState = {
  buildings: [],
  nodes: [],
  edges: [],
  businesses: [],
  dataLoaded: false,
  userPosition: null,
  activeRoute: null,
  currentStepIndex: 0,
  destinationBusiness: null,
  destinationNode: null,
  isNavigating: false,
  isOffCourse: false,
  savedPaths: [],
  hapticEnabled: true,
  distanceUnit: 'feet',
};

export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'SET_DATA':
      return {
        ...state,
        buildings: action.buildings,
        nodes: action.nodes,
        edges: action.edges,
        businesses: action.businesses,
        dataLoaded: true,
      };
    case 'SET_POSITION':
      return { ...state, userPosition: action.position };
    case 'START_NAVIGATION':
      return {
        ...state,
        activeRoute: action.route,
        currentStepIndex: 0,
        destinationBusiness: action.business,
        destinationNode: action.destNode,
        isNavigating: true,
        isOffCourse: false,
      };
    case 'UPDATE_STEP':
      return { ...state, currentStepIndex: action.stepIndex };
    case 'SET_OFF_COURSE':
      return { ...state, isOffCourse: action.isOffCourse };
    case 'END_NAVIGATION':
      return {
        ...state,
        activeRoute: null,
        currentStepIndex: 0,
        destinationBusiness: null,
        destinationNode: null,
        isNavigating: false,
        isOffCourse: false,
      };
    case 'ADD_SAVED_PATH':
      return { ...state, savedPaths: [action.path, ...state.savedPaths] };
    case 'SET_SAVED_PATHS':
      return { ...state, savedPaths: action.paths };
    case 'TOGGLE_HAPTIC':
      return { ...state, hapticEnabled: !state.hapticEnabled };
    case 'SET_DISTANCE_UNIT':
      return { ...state, distanceUnit: action.unit };
    default:
      return state;
  }
}

export interface NavigationContextType {
  state: NavigationState;
  dispatch: React.Dispatch<NavigationAction>;
}

export const NavigationContext = createContext<NavigationContextType>({
  state: initialState,
  dispatch: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}
