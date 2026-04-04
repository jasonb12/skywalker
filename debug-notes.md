# Map Debug Notes - RESOLVED

## Solution
The map now renders skyway paths correctly by serving the map HTML from the Express server
(/api/skyway/map) instead of using srcDoc iframe. This gives the iframe a proper origin so
MapLibre's web workers can fetch tiles without CORS issues.

## Architecture
1. Express server serves tiles at /api/skyway/tile/{z}/{x}/{y}.mvt (local cache + upstream proxy)
2. Express server serves fonts at /api/skyway/fonts/{fontstack}/{range}.pbf (local cache + upstream proxy)
3. Express server serves map HTML at /api/skyway/map (with query params for state)
4. React component uses src iframe pointing to the Express server
5. PostMessage API used for real-time location/route updates without full reload
