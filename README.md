# NPL26

Browser build of the NPL26 cricket game. The game files and WebAssembly engine are distributed as the `assets-v1` release; the Pages workflow verifies the release archive and publishes it with the web frontend.

The first visit downloads the game into the browser's private storage. A WebGPU-capable browser with sufficient storage is required. The first visit reloads once to enable cross-origin isolation for the WebAssembly engine.

The live Director, match compiler and multiplayer services require separate server components and are not provided by this static site.

The isolation worker is [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), MIT licensed; its license accompanies the worker.
