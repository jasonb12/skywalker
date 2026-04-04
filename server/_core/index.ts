import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import fs from "fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getMapHTML } from "./map-html";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// Resolve the project root (where public/ lives)
const projectRoot = path.resolve(__dirname, "../..");

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  // Also accept "null" origin from srcDoc iframes
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      // srcDoc iframes send origin: null - allow all for tile/font proxy routes
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    // Only set credentials for non-wildcard origins
    if (origin && origin !== "null") {
      res.header("Access-Control-Allow-Credentials", "true");
    }

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // === Skyway tile proxy ===
  // Serve pre-downloaded MVT tiles from public/tiles/
  // Falls back to proxying from skyway.run if tile not found locally
  app.get("/api/skyway/tile/:z/:x/:y.mvt", async (req, res) => {
    const { z, x, y } = req.params;
    const localPath = path.join(projectRoot, "public", "tiles", z, x, `${y}.mvt`);

    // Try local file first
    if (fs.existsSync(localPath)) {
      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(localPath);
      return;
    }

    // Proxy from skyway.run
    try {
      const upstream = `https://skyway.run/api/tile/${z}/${x}/${y}.mvt`;
      const response = await fetch(upstream);
      if (!response.ok) {
        res.status(response.status).send("Tile not found");
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Cache locally for future requests
      const tileDir = path.join(projectRoot, "public", "tiles", z, x);
      fs.mkdirSync(tileDir, { recursive: true });
      fs.writeFileSync(path.join(tileDir, `${y}.mvt`), buffer);

      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    } catch (err) {
      console.error("Tile proxy error:", err);
      res.status(502).send("Tile proxy error");
    }
  });

  // Serve tile.json metadata
  app.get("/api/skyway/tile.json", (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    res.json({
      tilejson: "3.0.0",
      scheme: "xyz",
      tiles: [`${baseUrl}/api/skyway/tile/{z}/{x}/{y}.mvt`],
      vector_layers: [
        { id: "building", fields: { building: "String", opening_hours: "String", osmid: "String", region: "String", skyway_hours: "String" }, minzoom: 14, maxzoom: 15 },
        { id: "building-names", fields: { address: "String", amenity: "String", branch: "String", brand: "String", building: "String", kind: "String", leisure: "String", level: "String", name: "String", office: "String", opening_hours: "String", osmid: "String", region: "String", shop: "String", skyway_hours: "String", tourism: "String", website: "String" }, minzoom: 14, maxzoom: 15 },
        { id: "poi", fields: { address: "String", amenity: "String", branch: "String", brand: "String", craft: "String", cuisine: "String", inside: "String", kind: "String", leisure: "String", level: "String", name: "String", office: "String", opening_hours: "String", osmid: "String", region: "String", shop: "String", tourism: "String", website: "String" }, minzoom: 15, maxzoom: 15 },
        { id: "footway", fields: { bridge: "String", class: "String", color: "String", layer: "String", level: "String", name: "String", osmid: "String", owner: "String", region: "String", tunnel: "String" }, minzoom: 14, maxzoom: 15 },
        { id: "footway-simple", fields: { bridge: "String", class: "String", color: "String", layer: "String", level: "String", owner: "String", region: "String", route: "String", tunnel: "String" }, minzoom: 14, maxzoom: 15 },
        { id: "roadway", fields: { class: "String", name: "String", osmid: "String", region: "String" }, minzoom: 14, maxzoom: 15 },
        { id: "building-simple", fields: { color: "String", dot: "String", name: "String", region: "String", route: "String", type: "String" }, minzoom: 14, maxzoom: 15 },
      ],
      description: "Skyway buildings and footways connecting them",
      name: "Skyway app tilemaker",
      bounds: [-93.3032865, 44.9504244, -93.2271296, 44.9908446],
      center: [-93.265208, 44.9706345, 14],
      minzoom: 14,
      maxzoom: 15,
    });
  });

  // === Font/glyph proxy ===
  // Serve pre-downloaded font PBF files from public/fonts/
  app.get("/api/skyway/fonts/:fontstack/:range.pbf", async (req, res) => {
    const { fontstack, range } = req.params;
    const localPath = path.join(projectRoot, "public", "fonts", fontstack, `${range}.pbf`);

    if (fs.existsSync(localPath)) {
      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.sendFile(localPath);
      return;
    }

    // Proxy from skyway.run
    try {
      const upstream = `https://skyway.run/api/${encodeURIComponent(fontstack)}/${range}.pbf`;
      const response = await fetch(upstream);
      if (!response.ok) {
        res.status(response.status).send("Font not found");
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // Cache locally
      const fontDir = path.join(projectRoot, "public", "fonts", fontstack);
      fs.mkdirSync(fontDir, { recursive: true });
      fs.writeFileSync(path.join(fontDir, `${range}.pbf`), buffer);

      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.send(buffer);
    } catch (err) {
      console.error("Font proxy error:", err);
      res.status(502).send("Font proxy error");
    }
  });

  // === Serve map HTML page ===
  // Served from Express so the iframe has the same origin as the tile server
  // This avoids the srcDoc null-origin issue with MapLibre web workers
  app.get("/api/skyway/map", (req, res) => {
    // Accept query params for route, user position, nav state
    const { userLng, userLat, routeCoords, navStep, navDist, navTime, isDark } = req.query;

    const userPosJS = userLng && userLat
      ? `map.getSource('location').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [${userLng}, ${userLat}] }, properties: {} }] });`
      : '';

    const routeJS = routeCoords
      ? `map.getSource('route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: ${routeCoords} }, properties: {} }] });`
      : '';

    const navBarHTML = navStep
      ? `<div class="nav-bar"><div class="nav-step">${navStep}</div><div class="nav-meta">${navDist || ''}m total · ~${navTime || ''} min</div></div>`
      : '';

    const html = getMapHTML(navBarHTML, userPosJS, routeJS, isDark === 'true');
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(html);
  });

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
