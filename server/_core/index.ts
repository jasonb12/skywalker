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

  // Serve extracted MVT tiles from public/skyway-tiles/{z}/{x}/{y}.mvt
  app.use("/skyway-tiles", express.static(path.join(projectRoot, "public/skyway-tiles"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mvt")) {
        res.setHeader("Content-Type", "application/vnd.mapbox-vector-tile");
        res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days
      }
    },
  }));

  // Serve GeoJSON files for each skyway layer (fallback for environments where MVT web workers fail)
  const geojsonLayers = ['footway', 'footway-simple', 'building', 'building-names', 'building-simple', 'roadway', 'poi'];
  for (const layer of geojsonLayers) {
    app.get(`/api/skyway/geojson/${layer}`, (_req, res) => {
      const filePath = path.join(projectRoot, `public/skyway-${layer}.geojson`);
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: `Layer ${layer} not found` });
      }
    });
  }

  // Serve map HTML page — uses self-hosted MVT tiles
  app.get("/api/skyway/map", (req, res) => {
    const isDark = req.query.theme === "dark";
    // Use same-origin tile URL for dev (avoids cross-origin issues in sandbox)
    const tileUrl = "/skyway-tiles/{z}/{x}/{y}.mvt";
    const html = getMapHTML("", "", "", isDark, tileUrl);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
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
