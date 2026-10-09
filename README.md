# Aperture Metrics Viewer

The viewer connects to an Aperture WebSocket exposed by an already running
Minecraft instance; it does not start Minecraft or Aperture itself.

## Run locally from IntelliJ IDEA

1. Start Minecraft with Aperture and enable its metrics WebSocket (the default
   listener is `ws://127.0.0.1:17866`).
2. Open this directory in IDEA and select **Metrics Viewer (Local)** from the
   run-configuration selector. Click Run.
3. IDEA starts Vite at `http://127.0.0.1:17868` and opens it in your browser.

The shared run configuration runs `npm run dev:local`. If IDEA has not yet
installed dependencies, run `npm install` once (or use IDEA's npm tool window).

## Run locally from VS Code

Start Minecraft with Aperture and enable its metrics WebSocket, then select
**Metrics Viewer (Local)** in the Run and Debug view and start it. VS Code runs
`npm run dev:local` and opens the viewer in your browser. Run `npm install`
once first if dependencies are not installed.

## Preview with simulated metrics

For a local UI walkthrough without Minecraft, run `npm run dev:simulate`.
This starts the same interface with a generated metrics stream. Simulation is
enabled only in Vite development mode on localhost and does not affect regular
`dev`, `dev:local`, production builds, or the live WebSocket connection. The
top bar labels the data source as **SIMULATED**.

## Connecting to another listener

Set `VITE_APERTURE_WS_URL` in the run configuration's environment variables,
for example:

```text
VITE_APERTURE_WS_URL=ws://minecraft-host.example:17866
```

Restart the Vite run configuration after changing the value. The default stays
`ws://127.0.0.1:17866` for a locally running Minecraft+Aperture server.
