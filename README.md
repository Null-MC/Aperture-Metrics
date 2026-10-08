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

## Connecting to another listener

Set `VITE_APERTURE_WS_URL` in the run configuration's environment variables,
for example:

```text
VITE_APERTURE_WS_URL=ws://minecraft-host.example:17866
```

Restart the Vite run configuration after changing the value. The default stays
`ws://127.0.0.1:17866` for a locally running Minecraft+Aperture server.
