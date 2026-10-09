# Aperture Shader Metrics Viewer

A single-page React aplication for locally viewing Aperture shader metrics in real-time.


## Run locally from VS Code

Best for working on the metrics-viewer application directly. Starts a local webserver hosting the viewer application.
- **Local**: Connect to a running Minecraft + Aperture websocket for actual shader metrics.
- **Simulated**: Starts a new websocket for generating simulated shader metrics.

Run `npm install` once first if dependencies are not installed.


## Run locally from IntelliJ IDEA

1. Start Minecraft with Aperture and enable its metrics WebSocket (the default
   listener is `ws://127.0.0.1:17866`).
2. Open this directory in IDEA and select **Metrics Viewer (Local)** from the
   run-configuration selector. Click Run.
3. IDEA starts Vite at `http://127.0.0.1:17868` and opens it in your browser.

The shared run configuration runs `npm run dev:local`. If IDEA has not yet
installed dependencies, run `npm install` once (or use IDEA's npm tool window).

## Preview with simulated metrics

For a local UI walkthrough without Minecraft, run `npm run dev:simulate`.
This starts the same interface with a generated metrics stream. Simulation is
enabled only in Vite development mode on localhost and does not affect regular
`dev`, `dev:local`, production builds, or the live WebSocket connection. The
top bar labels the data source as **SIMULATED**.
