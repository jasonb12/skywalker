/**
 * Position Fusion Engine
 *
 * Combines GPS, BLE trilateration, BLE fingerprinting, and dead-reckoning
 * into a single fused position estimate using a weighted approach.
 *
 * Priority:
 * 1. User correction (highest confidence — user explicitly indicated position)
 * 2. BLE fingerprint matching (good indoors, 5-15m accuracy)
 * 3. BLE trilateration (best indoors with beacons, 2-5m accuracy)
 * 4. GPS with offset correction (adjusted for known indoor error)
 * 5. Raw GPS (best outdoors, 5-15m accuracy)
 * 6. Dead reckoning (fallback when all others unavailable)
 *
 * The fused position uses confidence-weighted averaging where the
 * source with lower accuracy radius gets more weight.
 */

import type { UserPosition, DetectedBeacon } from './types';
import { trilateratePosition } from './trilateration';
import { applyOffset, hasActiveOffset, getOffsetDecayFactor } from './gps-offset';

interface FusionConfig {
  /** Maximum GPS accuracy to consider reliable (meters) */
  maxGpsAccuracy: number;
  /** Maximum BLE accuracy to consider reliable (meters) */
  maxBleAccuracy: number;
  /** Weight multiplier for BLE when indoors (0-1, higher = trust BLE more) */
  bleIndoorWeight: number;
  /** Weight multiplier for GPS when outdoors (0-1, higher = trust GPS more) */
  gpsOutdoorWeight: number;
  /** Dead reckoning decay factor (position gets less reliable over time) */
  deadReckoningDecay: number;
  /** Maximum time (ms) before dead reckoning position is considered stale */
  maxDeadReckoningAge: number;
}

const DEFAULT_CONFIG: FusionConfig = {
  maxGpsAccuracy: 30,
  maxBleAccuracy: 20,
  bleIndoorWeight: 0.7,
  gpsOutdoorWeight: 0.6,
  deadReckoningDecay: 0.95,
  maxDeadReckoningAge: 30000, // 30 seconds
};

interface PositionSource {
  position: UserPosition;
  timestamp: number;
  confidence: number; // 0-1, higher is better
}

export class PositionFusionEngine {
  private config: FusionConfig;
  private lastGps: PositionSource | null = null;
  private lastBle: PositionSource | null = null;
  private lastDeadReckoning: PositionSource | null = null;
  private lastUserCorrection: PositionSource | null = null;
  private lastFingerprintEstimate: PositionSource | null = null;
  private lastFused: UserPosition | null = null;
  private lastFusedTimestamp: number = 0;

  constructor(config?: Partial<FusionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update with a new GPS position.
   * If a GPS offset is active (from user correction), the offset is applied
   * with exponential decay before fusion.
   */
  updateGps(position: UserPosition): void {
    let adjustedPosition = position;

    // Apply GPS offset if active
    if (hasActiveOffset()) {
      const { lat, lng, decayFactor } = applyOffset(
        position.latitude,
        position.longitude
      );
      adjustedPosition = {
        ...position,
        latitude: lat,
        longitude: lng,
        // Improve reported accuracy proportional to decay factor
        // When offset is fresh (decay~1), we trust the corrected position more
        accuracy: position.accuracy * (1 - decayFactor * 0.5),
        source: 'gps',
      };
    }

    const confidence = this.gpsConfidence(adjustedPosition.accuracy);
    this.lastGps = {
      position: adjustedPosition,
      timestamp: Date.now(),
      confidence,
    };
  }

  /**
   * Update with new BLE beacon detections.
   * Performs trilateration and stores the result.
   */
  updateBle(detectedBeacons: DetectedBeacon[]): void {
    const blePosition = trilateratePosition(detectedBeacons);
    if (!blePosition) return;

    const confidence = this.bleConfidence(blePosition.accuracy, detectedBeacons.length);

    this.lastBle = {
      position: {
        latitude: blePosition.latitude,
        longitude: blePosition.longitude,
        accuracy: blePosition.accuracy,
        heading: null,
        source: 'ble',
        bleBeaconsInRange: detectedBeacons.length,
      },
      timestamp: Date.now(),
      confidence,
    };
  }

  /**
   * Update with a BLE fingerprint-based position estimate.
   * This comes from the WKNN matching engine in ble-fingerprint-store.
   */
  updateFingerprintEstimate(
    latitude: number,
    longitude: number,
    accuracy: number,
    matchCount: number
  ): void {
    // Fingerprint estimates are good when we have many matches
    let confidence = 0.4;
    if (matchCount >= 5) confidence = 0.85;
    else if (matchCount >= 3) confidence = 0.7;
    else if (matchCount >= 2) confidence = 0.55;

    // Boost confidence if GPS offset is active (we're likely indoors)
    if (hasActiveOffset()) {
      confidence = Math.min(confidence * 1.3, 0.95);
    }

    this.lastFingerprintEstimate = {
      position: {
        latitude,
        longitude,
        accuracy,
        heading: null,
        source: 'ble',
      },
      timestamp: Date.now(),
      confidence,
    };
  }

  /**
   * Update with a user-corrected position.
   * This is the highest-confidence source — the user explicitly said "I am here."
   * The position is valid for 30 seconds with decaying confidence.
   */
  updateUserCorrection(latitude: number, longitude: number): void {
    this.lastUserCorrection = {
      position: {
        latitude,
        longitude,
        accuracy: 3, // User-indicated, assume ~3m accuracy
        heading: null,
        source: 'snapped',
      },
      timestamp: Date.now(),
      confidence: 0.98, // Highest confidence
    };

    console.log(
      `[Fusion] User correction applied at (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
    );
  }

  /**
   * Update with a dead-reckoning position estimate.
   */
  updateDeadReckoning(position: UserPosition): void {
    this.lastDeadReckoning = {
      position,
      timestamp: Date.now(),
      confidence: 0.3, // low base confidence
    };
  }

  /**
   * Get the best fused position estimate.
   *
   * Combines available sources using confidence-weighted averaging.
   * Returns the most reliable position available.
   */
  getFusedPosition(): UserPosition | null {
    const now = Date.now();
    const sources: PositionSource[] = [];

    // Check user correction freshness (valid for 30 seconds with decay)
    if (this.lastUserCorrection && now - this.lastUserCorrection.timestamp < 30000) {
      const age = now - this.lastUserCorrection.timestamp;
      // Decay from 0.98 to ~0.3 over 30 seconds
      const decayFactor = Math.exp(-age / 15000);
      this.lastUserCorrection.confidence = 0.98 * decayFactor;
      if (this.lastUserCorrection.confidence > 0.1) {
        sources.push(this.lastUserCorrection);
      }
    }

    // Check fingerprint estimate freshness (valid for 8 seconds)
    if (this.lastFingerprintEstimate && now - this.lastFingerprintEstimate.timestamp < 8000) {
      sources.push(this.lastFingerprintEstimate);
    }

    // Check GPS freshness (valid for 10 seconds)
    if (this.lastGps && now - this.lastGps.timestamp < 10000) {
      sources.push(this.lastGps);
    }

    // Check BLE freshness (valid for 5 seconds)
    if (this.lastBle && now - this.lastBle.timestamp < 5000) {
      sources.push(this.lastBle);
    }

    // Check dead reckoning freshness
    if (
      this.lastDeadReckoning &&
      now - this.lastDeadReckoning.timestamp < this.config.maxDeadReckoningAge
    ) {
      // Decay confidence over time
      const age = now - this.lastDeadReckoning.timestamp;
      const decayFactor = Math.pow(
        this.config.deadReckoningDecay,
        age / 1000
      );
      this.lastDeadReckoning.confidence = 0.3 * decayFactor;
      sources.push(this.lastDeadReckoning);
    }

    if (sources.length === 0) {
      return this.lastFused; // return last known position
    }

    if (sources.length === 1) {
      this.lastFused = sources[0].position;
      this.lastFusedTimestamp = now;
      return this.lastFused;
    }

    // Weighted fusion of multiple sources
    let totalWeight = 0;
    let latSum = 0;
    let lngSum = 0;
    let bestHeading: number | null = null;
    let bestSource: UserPosition['source'] = 'fused';
    let bestConfidence = 0;
    let totalBleBeacons = 0;

    for (const src of sources) {
      const weight = src.confidence;
      latSum += src.position.latitude * weight;
      lngSum += src.position.longitude * weight;
      totalWeight += weight;

      // Use heading from the most confident source
      if (src.confidence > bestConfidence) {
        bestConfidence = src.confidence;
        bestHeading = src.position.heading;
      }

      if (src.position.bleBeaconsInRange) {
        totalBleBeacons = Math.max(totalBleBeacons, src.position.bleBeaconsInRange);
      }
    }

    // Determine dominant source for labeling
    const hasUserCorrection = sources.some((s) => s.position.source === 'snapped');
    const hasBle = sources.some((s) => s.position.source === 'ble');
    const hasGps = sources.some((s) => s.position.source === 'gps');

    if (hasUserCorrection) {
      bestSource = 'snapped';
    } else if (hasBle && hasGps) {
      bestSource = 'fused';
    } else if (hasBle) {
      bestSource = 'ble';
    } else if (hasGps) {
      bestSource = 'gps';
    } else {
      bestSource = 'dead-reckoning';
    }

    // Calculate fused accuracy (weighted harmonic mean)
    const accuracyWeights = sources.map((s) => s.confidence / s.position.accuracy);
    const fusedAccuracy = totalWeight / accuracyWeights.reduce((a, b) => a + b, 0);

    this.lastFused = {
      latitude: latSum / totalWeight,
      longitude: lngSum / totalWeight,
      accuracy: Math.max(fusedAccuracy, 1),
      heading: bestHeading,
      source: bestSource,
      bleBeaconsInRange: totalBleBeacons || undefined,
    };
    this.lastFusedTimestamp = now;

    return this.lastFused;
  }

  /**
   * Get the current positioning source status.
   */
  getStatus(): {
    gpsAvailable: boolean;
    bleAvailable: boolean;
    deadReckoningActive: boolean;
    bleBeaconCount: number;
    fusedSource: string;
    userCorrectionActive: boolean;
    gpsOffsetActive: boolean;
    gpsOffsetDecay: number;
    fingerprintEstimateActive: boolean;
  } {
    const now = Date.now();
    return {
      gpsAvailable: !!this.lastGps && now - this.lastGps.timestamp < 10000,
      bleAvailable: !!this.lastBle && now - this.lastBle.timestamp < 5000,
      deadReckoningActive:
        !!this.lastDeadReckoning &&
        now - this.lastDeadReckoning.timestamp < this.config.maxDeadReckoningAge,
      bleBeaconCount: this.lastBle?.position.bleBeaconsInRange ?? 0,
      fusedSource: this.lastFused?.source ?? 'none',
      userCorrectionActive:
        !!this.lastUserCorrection && now - this.lastUserCorrection.timestamp < 30000,
      gpsOffsetActive: hasActiveOffset(),
      gpsOffsetDecay: getOffsetDecayFactor(),
      fingerprintEstimateActive:
        !!this.lastFingerprintEstimate && now - this.lastFingerprintEstimate.timestamp < 8000,
    };
  }

  /**
   * Reset all position sources.
   */
  reset(): void {
    this.lastGps = null;
    this.lastBle = null;
    this.lastDeadReckoning = null;
    this.lastUserCorrection = null;
    this.lastFingerprintEstimate = null;
    this.lastFused = null;
    this.lastFusedTimestamp = 0;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private gpsConfidence(accuracy: number): number {
    // If GPS offset is active, reduce GPS confidence (we know GPS is wrong here)
    const offsetPenalty = hasActiveOffset() ? 0.5 : 1.0;

    let base: number;
    if (accuracy <= 5) base = 0.9;
    else if (accuracy <= 10) base = 0.7;
    else if (accuracy <= 20) base = 0.4;
    else if (accuracy <= this.config.maxGpsAccuracy) base = 0.2;
    else base = 0.1;

    return base * offsetPenalty;
  }

  private bleConfidence(accuracy: number, beaconCount: number): number {
    // More beacons = higher confidence
    let base = 0.3;
    if (beaconCount >= 4) base = 0.9;
    else if (beaconCount >= 3) base = 0.8;
    else if (beaconCount >= 2) base = 0.6;

    // Penalize high accuracy radius
    if (accuracy > 10) base *= 0.7;
    if (accuracy > 20) base *= 0.5;

    return Math.min(base, 1);
  }
}
