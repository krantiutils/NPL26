'use strict';
document.getElementById('check').onclick = async function () {
  this.disabled = true;
  const out = document.getElementById('results');
  out.textContent = '';
  const log = (name, value) => { out.textContent += `${name}: ${JSON.stringify(value)}\n`; };
  const test = async (name, fn) => {
    try { log(name, await fn()); }
    catch (e) { log(name, { error: `${e.name}: ${e.message}` }); }
  };
  log('time', new Date().toISOString());
  log('browser', navigator.userAgent);
  log('secureContext', isSecureContext);
  log('crossOriginIsolated', crossOriginIsolated);
  await test('WebGPU', async () => {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No compatible GPU adapter');
    const device = await adapter.requestDevice();
    const info = adapter.info;
    device.destroy();
    return { vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description };
  });
  await test('storage', async () => {
    const response = await fetch('game/index.json');
    if (!response.ok) throw new Error(`Game index HTTP ${response.status}`);
    const index = await response.json();
    const estimate = await navigator.storage.estimate();
    const bytes = index.files.reduce((sum, file) => sum + file.size, 0);
    return { gameBytes: bytes, ...estimate, available: estimate.quota - estimate.usage,
      enough: estimate.quota - estimate.usage >= bytes,
      note: 'Quota is not a reservation; engine and browser need additional free space.' };
  });
  await test('OPFS', async () => {
    const root = await navigator.storage.getDirectory();
    const name = `.npl26-check-${crypto.randomUUID()}`;
    let created = false;
    let failure = null;
    try {
      const file = await root.getFileHandle(name, { create: true });
      created = true;
      const writer = await file.createWritable();
      await writer.write('NPL26');
      await writer.close();
      if (await (await file.getFile()).text() !== 'NPL26') throw new Error('Readback mismatch');
      return 'write/read passed';
    } catch (e) {
      failure = e;
      throw e;
    } finally {
      if (created) {
        try { await root.removeEntry(name); }
        catch (e) {
          if (!failure) throw e;
          log('OPFS cleanup error', `${e.name}: ${e.message}`);
        }
      }
    }
  });
  await test('shared wasm memory', () => {
    // Mirrors guest allocation size, not total engine usage or its thread stacks.
    const memory = new WebAssembly.Memory({ initial: 20481, maximum: 65536, shared: true });
    return { bytes: memory.buffer.byteLength, shared: memory.buffer instanceof SharedArrayBuffer,
      note: 'Allocation only; engine and all worker threads must still start successfully.' };
  });
  await test('AudioWorklet', async () => {
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule('audio-worklet.js');
      return { available: true, state: context.state, note: 'Audible game playback still requires a touch after launch.' };
    } finally { await context.close(); }
  });
  this.disabled = false;
};
