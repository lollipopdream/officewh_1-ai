'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Map } from 'maplibre-gl';
import type { Route } from '@/types';
import { TRAIL_COORDINATES_3D, type TrailPoint } from '@/data/trailCoordinates3D';
import { TAKAO_TRAILS_GEOJSON } from '@/data/takaoTrailsGeoJson';
import { SURROUNDING_TRAILS_GEOJSON } from '@/data/surroundingTrailsGeoJson';

export const TRAIL_RUNNER_SOURCE    = 'trail-runner-source';
export const TRAIL_COMPLETED_SOURCE = 'trail-completed-source';

interface TrailFollowState {
  isFollowing: boolean;
  isPaused: boolean;
  progressRatio: number; // 0.0 to 1.0
  currentDistanceKm: number;
  totalDistanceKm: number;
  currentLandmark: string | null;
  speedMultiplier: 1 | 2;
  isArrived: boolean;
}

function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/**
 * Computes equirectangular cumulative distances along a trail in meters
 */
function computeCumulativeDistances(points: TrailPoint[]): number[] {
  const dists: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const latAvgRad = ((prev.lat + curr.lat) * Math.PI) / 360;
    const dx = (curr.lng - prev.lng) * Math.cos(latAvgRad) * 111319;
    const dy = (curr.lat - prev.lat) * 111132;
    dists.push(dists[i - 1] + Math.hypot(dx, dy));
  }
  return dists;
}

/**
 * Finds exact interpolated coordinates at a given distance along the trail
 */
function getPositionAtDistance(points: TrailPoint[], dists: number[], d: number): {
  lng: number;
  lat: number;
  index: number;
  segmentRatio: number;
} {
  const total = dists[dists.length - 1];
  const clampedD = Math.max(0, Math.min(total, d));

  let low = 0;
  let high = dists.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (dists[mid] <= clampedD) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const idx = Math.max(0, Math.min(points.length - 2, high));
  const segStart = dists[idx];
  const segEnd = dists[idx + 1];
  const segLen = segEnd - segStart;
  const alpha = segLen > 0.001 ? (clampedD - segStart) / segLen : 0;
  const p1 = points[idx];
  const p2 = points[idx + 1];

  return {
    lng: p1.lng + (p2.lng - p1.lng) * alpha,
    lat: p1.lat + (p2.lat - p1.lat) * alpha,
    index: idx,
    segmentRatio: alpha,
  };
}

/**
 * Looks ahead along the path to calculate a steady forward flight bearing
 */
function getMacroBearing(points: TrailPoint[], dists: number[], currentD: number, lookaheadMeters = 160): number {
  const total = dists[dists.length - 1];
  const aheadD = Math.min(total, currentD + lookaheadMeters);
  const curr = getPositionAtDistance(points, dists, currentD);
  const ahead = getPositionAtDistance(points, dists, aheadD);

  const latAvgRad = ((curr.lat + ahead.lat) * Math.PI) / 360;
  const dx = (ahead.lng - curr.lng) * Math.cos(latAvgRad);
  const dy = ahead.lat - curr.lat;

  if (Math.hypot(dx, dy) < 0.000001) {
    return 0;
  }
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Resolves ordered points for any route, with fallbacks
 */
function resolveTrailPoints(routeId: string): TrailPoint[] {
  if (TRAIL_COORDINATES_3D[routeId]) {
    return TRAIL_COORDINATES_3D[routeId];
  }
  const alt1 = routeId === 'inariyama' ? 'route_inariyama' : routeId.replace('route_', '');
  if (TRAIL_COORDINATES_3D[alt1]) {
    return TRAIL_COORDINATES_3D[alt1];
  }
  const alt2 = `route_${routeId}`;
  if (TRAIL_COORDINATES_3D[alt2]) {
    return TRAIL_COORDINATES_3D[alt2];
  }

  // Fallback: extract from GeoJSON features
  const allFeatures = [...(TAKAO_TRAILS_GEOJSON.features || []), ...(SURROUNDING_TRAILS_GEOJSON.features || [])];
  const feat = allFeatures.find((f) => f.properties?.route_id === routeId || f.properties?.id === routeId);
  if (feat && feat.geometry) {
    if (feat.geometry.type === 'LineString') {
      return (feat.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ lng, lat }));
    }
    if (feat.geometry.type === 'MultiLineString') {
      const flattened = (feat.geometry.coordinates as [number, number][][]).flat();
      return flattened.map(([lng, lat]) => ({ lng, lat }));
    }
  }

  return [];
}

export function useTrailFollowCamera({
  map,
  selectedRoute,
  language,
}: {
  map: Map | null;
  selectedRoute: Route | null;
  language: 'ja' | 'en' | 'zh';
}) {
  const [state, setState] = useState<TrailFollowState>({
    isFollowing: false,
    isPaused: false,
    progressRatio: 0,
    currentDistanceKm: 0,
    totalDistanceKm: 0,
    currentLandmark: null,
    speedMultiplier: 1,
    isArrived: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const currentRouteIdRef = useRef<string | null>(null);
  const pointsRef = useRef<TrailPoint[]>([]);
  const distsRef = useRef<number[]>([]);
  const totalDistRef = useRef<number>(0);
  const currentDistRef = useRef<number>(0);
  const currentBearingRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const userInteractedRef = useRef<boolean>(false);
  const initialEaseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Updates MapLibre point and line sources for the runner beacon and walked trail
  const updateMapRunnerVisuals = useCallback(
    (curr: { lng: number; lat: number; index: number }, points: TrailPoint[]) => {
      if (!map || !map.isStyleLoaded()) return;

      try {
        const runnerSource = map.getSource(TRAIL_RUNNER_SOURCE) as any;
        if (runnerSource) {
          runnerSource.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { id: 'runner-beacon' },
                geometry: {
                  type: 'Point',
                  coordinates: [curr.lng, curr.lat],
                },
              },
            ],
          });
        }

        const completedSource = map.getSource(TRAIL_COMPLETED_SOURCE) as any;
        if (completedSource) {
          const completedCoords = points.slice(0, curr.index + 1).map((p) => [p.lng, p.lat]);
          completedCoords.push([curr.lng, curr.lat]);
          completedSource.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { id: 'completed-path' },
                geometry: {
                  type: 'LineString',
                  coordinates: completedCoords,
                },
              },
            ],
          });
        }
      } catch {
        // Safe ignore during style transitions
      }
    },
    [map]
  );

  // Clears runner and completed line from map
  const clearMapRunnerVisuals = useCallback(() => {
    if (!map || !map.isStyleLoaded()) return;
    try {
      (map.getSource(TRAIL_RUNNER_SOURCE) as any)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
      (map.getSource(TRAIL_COMPLETED_SOURCE) as any)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
    } catch {
      // ignore
    }
  }, [map]);

  // Main follow animation frame loop
  const stepFollow = useCallback(
    (timestamp: number) => {
      if (!map || !stateRef.current.isFollowing) {
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }
      const deltaMs = Math.min(80, Math.max(10, timestamp - lastTimeRef.current));
      lastTimeRef.current = timestamp;

      // When paused (user is exploring free-look or pressed pause)
      if (stateRef.current.isPaused) {
        animFrameRef.current = requestAnimationFrame(stepFollow);
        return;
      }

      const totalDist = totalDistRef.current;
      const points = pointsRef.current;
      const dists = distsRef.current;

      if (points.length < 2 || totalDist <= 0) {
        return;
      }

      // Flight speed formula: realistic cinematic helicopter speed (~90-130 m/s)
      // Normal full flight takes ~30 - 36s per trail at 1x
      const baseSpeed = Math.max(75, Math.min(130, totalDist / 32));
      const effectiveSpeed = baseSpeed * stateRef.current.speedMultiplier;
      const stepDist = (effectiveSpeed * deltaMs) / 1000;

      currentDistRef.current += stepDist;

      // Reached the summit/finish
      if (currentDistRef.current >= totalDist) {
        currentDistRef.current = totalDist;
        const finalPt = points[points.length - 1];
        updateMapRunnerVisuals(
          { lng: finalPt.lng, lat: finalPt.lat, index: points.length - 1 },
          points
        );

        setState((prev) => ({
          ...prev,
          progressRatio: 1.0,
          currentDistanceKm: Number((totalDist / 1000).toFixed(2)),
          isArrived: true,
          isPaused: true,
        }));
        return;
      }

      const curr = getPositionAtDistance(points, dists, currentDistRef.current);
      updateMapRunnerVisuals(curr, points);

      // Macro-heading calculation with gyro-stabilized gimbal damping:
      // Looks ahead ~130m along the trail to anticipate curves and bank into ridges
      const naturalBearing = getMacroBearing(points, dists, currentDistRef.current, 130);
      let currB = currentBearingRef.current;
      const diffBearing = normalizeAngle(naturalBearing - currB);

      // Responsive, silky smooth exponential damping (~260ms response time)
      const damping = 1 - Math.exp(-deltaMs / 260);
      currB = normalizeAngle(currB + diffBearing * damping);
      currentBearingRef.current = currB;

      // Golden broadcast chase drone perspective:
      // The camera looks along the forward flight vector.
      // Offset [0, -75] positions the runner slightly above the screen center,
      // perfectly framing the runner and the trail unfolding ahead in the open kiosk area.
      const targetZoom = totalDist > 8000 ? 15.6 : 16.55;
      const targetPitch = 63;

      try {
        map.jumpTo({
          center: [curr.lng, curr.lat],
          bearing: currB,
          pitch: targetPitch,
          zoom: targetZoom,
          offset: [0, -75],
        } as any);
      } catch {
        // safe
      }

      // Check for landmark / waypoint proximity (within 70m)
      let nearbyLandmark: string | null = null;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.label) {
          const ptDist = dists[i];
          if (Math.abs(currentDistRef.current - ptDist) < 70) {
            nearbyLandmark = p.label;
            break;
          }
        }
      }

      const ratio = currentDistRef.current / totalDist;
      setState((prev) => ({
        ...prev,
        progressRatio: ratio,
        currentDistanceKm: Number((currentDistRef.current / 1000).toFixed(2)),
        currentLandmark: nearbyLandmark,
      }));

      animFrameRef.current = requestAnimationFrame(stepFollow);
    },
    [map, updateMapRunnerVisuals]
  );

  // Starts or switches follow camera to a specific route
  const startFollowRoute = useCallback(
    (routeId: string) => {
      if (!map) return;

      const pts = resolveTrailPoints(routeId);
      if (pts.length < 2) {
        clearMapRunnerVisuals();
        setState((prev) => ({ ...prev, isFollowing: false }));
        return;
      }

      if (initialEaseTimeoutRef.current) {
        clearTimeout(initialEaseTimeoutRef.current);
        initialEaseTimeoutRef.current = null;
      }

      pointsRef.current = pts;
      distsRef.current = computeCumulativeDistances(pts);
      totalDistRef.current = distsRef.current[distsRef.current.length - 1];
      currentDistRef.current = 0;
      userInteractedRef.current = false;
      currentRouteIdRef.current = routeId;

      const startPt = pts[0];
      const initialBearing = getMacroBearing(pts, distsRef.current, 0, 130);
      currentBearingRef.current = initialBearing;

      const targetZoom = totalDistRef.current > 8000 ? 15.6 : 16.55;
      const targetPitch = 63;

      // Smooth camera transition to the trailhead to commence the professional follow
      map.easeTo({
        center: [startPt.lng, startPt.lat],
        bearing: initialBearing,
        pitch: targetPitch,
        zoom: targetZoom,
        offset: [0, -75],
        duration: 1300,
        essential: true,
      });

      setState({
        isFollowing: true,
        isPaused: false,
        progressRatio: 0,
        currentDistanceKm: 0,
        totalDistanceKm: Number((totalDistRef.current / 1000).toFixed(2)),
        currentLandmark: pts[0]?.label ?? null,
        speedMultiplier: 1,
        isArrived: false,
      });

      lastTimeRef.current = 0;

      // Launch follow loop after initial fly to trailhead
      initialEaseTimeoutRef.current = setTimeout(() => {
        if (animFrameRef.current !== null) {
          cancelAnimationFrame(animFrameRef.current);
        }
        animFrameRef.current = requestAnimationFrame(stepFollow);
      }, 900);
    },
    [map, clearMapRunnerVisuals, stepFollow]
  );

  // Stop follow and return to wide whole-mountain overview
  const stopAndOverview = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    clearMapRunnerVisuals();
    setState((prev) => ({
      ...prev,
      isFollowing: false,
      isPaused: false,
      isArrived: false,
    }));

    if (map) {
      map.flyTo({
        center: [139.2485, 35.6275],
        zoom: 13.7,
        pitch: 58,
        bearing: -22,
        duration: 1200,
        essential: true,
        padding: { top: 90, bottom: 280, left: 360, right: 360 },
      });
    }
  }, [map, clearMapRunnerVisuals]);

  // Replay current route from start
  const replay = useCallback(() => {
    if (!map || pointsRef.current.length < 2) return;
    currentDistRef.current = 0;
    lastTimeRef.current = 0;
    const initialBearing = getMacroBearing(pointsRef.current, distsRef.current, 0, 150);
    currentBearingRef.current = initialBearing;

    setState((prev) => ({
      ...prev,
      isPaused: false,
      isArrived: false,
      progressRatio: 0,
      currentDistanceKm: 0,
    }));

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(stepFollow);
  }, [map, stepFollow]);

  const togglePlayPause = useCallback(() => {
    setState((prev) => {
      const nextPaused = !prev.isPaused;
      if (!nextPaused) {
        lastTimeRef.current = 0;
        if (animFrameRef.current !== null) {
          cancelAnimationFrame(animFrameRef.current);
        }
        animFrameRef.current = requestAnimationFrame(stepFollow);
      }
      return { ...prev, isPaused: nextPaused };
    });
  }, [stepFollow]);

  const setSpeedMultiplier = useCallback((mult: 1 | 2) => {
    setState((prev) => ({ ...prev, speedMultiplier: mult }));
  }, []);

  const seekTo = useCallback(
    (ratio: number) => {
      const clampedRatio = Math.max(0, Math.min(1.0, ratio));
      currentDistRef.current = clampedRatio * totalDistRef.current;
      lastTimeRef.current = 0;

      const pts = pointsRef.current;
      const dists = distsRef.current;
      if (pts.length >= 2 && map) {
        const curr = getPositionAtDistance(pts, dists, currentDistRef.current);
        updateMapRunnerVisuals(curr, pts);
        const b = getMacroBearing(pts, dists, currentDistRef.current, 130);
        currentBearingRef.current = b;
        const targetZoom = totalDistRef.current > 8000 ? 15.6 : 16.55;
        map.jumpTo({
          center: [curr.lng, curr.lat],
          bearing: b,
          pitch: 63,
          zoom: targetZoom,
          offset: [0, -75],
        } as any);
      }

      setState((prev) => ({
        ...prev,
        progressRatio: clampedRatio,
        currentDistanceKm: Number((currentDistRef.current / 1000).toFixed(2)),
        isArrived: clampedRatio >= 1.0,
      }));
    },
    [map, updateMapRunnerVisuals]
  );

  // Resume camera follow after user free-look pan
  const resumeFollow = useCallback(() => {
    if (!map || pointsRef.current.length < 2) return;
    const pts = pointsRef.current;
    const dists = distsRef.current;
    const curr = getPositionAtDistance(pts, dists, currentDistRef.current);
    const b = currentBearingRef.current;
    const targetZoom = totalDistRef.current > 8000 ? 15.6 : 16.55;

    map.easeTo({
      center: [curr.lng, curr.lat],
      bearing: b,
      pitch: 63,
      zoom: targetZoom,
      offset: [0, -75],
      duration: 800,
      essential: true,
    });

    setState((prev) => ({ ...prev, isPaused: false }));
    lastTimeRef.current = 0;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(stepFollow);
    }, 600);
  }, [map, stepFollow]);

  // Sync with selectedRoute changes
  useEffect(() => {
    if (!selectedRoute || selectedRoute.id === 'all' || selectedRoute.id === 'all_routes') {
      if (stateRef.current.isFollowing) {
        stopAndOverview();
      }
      return;
    }

    // A specific trail was selected! Start the professional follow camera
    startFollowRoute(selectedRoute.id);
  }, [selectedRoute, startFollowRoute, stopAndOverview]);

  // Handle user manual drag/zoom on map: gracefully pause follow camera
  useEffect(() => {
    if (!map) return;

    const handleUserInteraction = (e: any) => {
      // Only pause if this was a real user pointer / touch interaction (not programmatic camera jump)
      if (!e || e.originalEvent) {
        if (stateRef.current.isFollowing && !stateRef.current.isPaused) {
          userInteractedRef.current = true;
          setState((prev) => ({ ...prev, isPaused: true }));
        }
      }
    };

    map.on('dragstart', handleUserInteraction);
    map.on('rotatestart', handleUserInteraction);
    map.on('pitchstart', handleUserInteraction);

    return () => {
      map.off('dragstart', handleUserInteraction);
      map.off('rotatestart', handleUserInteraction);
      map.off('pitchstart', handleUserInteraction);
    };
  }, [map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (initialEaseTimeoutRef.current) {
        clearTimeout(initialEaseTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...state,
    play: () => setState((prev) => ({ ...prev, isPaused: false })),
    pause: () => setState((prev) => ({ ...prev, isPaused: true })),
    togglePlayPause,
    replay,
    seekTo,
    setSpeedMultiplier,
    stopAndOverview,
    resumeFollow,
  };
}
