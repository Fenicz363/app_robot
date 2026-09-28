// =====================================================
// CONFIG — UUIDs de tu ESP32-C3 Super Mini
// =====================================================
const DEVICE_NAME_PREFIX = "ESP32";  // Cambia si tu ESP32 se llama distinto
const SERVICE_UUID  = "12345678-1234-1234-1234-123456789abc";
const CHAR_RX_UUID  = "87654321-4321-4321-4321-cba987654321";
const CHAR_TX_UUID  = "11111111-2222-3333-4444-555555555555";

const INTERVALO_ENVIO_MS = 50;

// =====================================================
// ESTADO
// =====================================================
let device = null;
let server = null;
let charRX = null;
let charTX = null;
let conectado = false;
let motorIzq = 0;
let motorDer = 0;
const teclas = new Set();

// =====================================================
// DOM
// =====================================================
const $ = (id) => document.getElementById(id);
const lblEstado   = $("estado");
const listaDevs   = $("listaDevices");
const btnEscanear = $("btnEscanear");
const btnConectar = $("btnConectar");
const btnDescon   = $("btnDesconectar");
const btnStop     = $("btnStop");
const lblVel      = $("lblVel");
const sliderVel   = $("sliderVel");
const lblIzq      = $("lblIzq");
const lblDer      = $("lblDer");
const joystickEl  = $("joystick");
const knobEl      = $("knob");
const logEl       = $("log");

// =====================================================
// LOG
// =====================================================
function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] > ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

// =====================================================
// SOPORTE
// =====================================================
if (!navigator.bluetooth) {
  $("avisoBLE").classList.remove("hidden");
  log("Web Bluetooth NO disponible. Usa Chrome Android o Chrome/Edge en PC.");
}

// =====================================================
// ESCANEAR + AUTO-CONECTAR
// =====================================================
btnEscanear.addEventListener("click", async () => {
  if (!navigator.bluetooth) { log("Web Bluetooth no soportado."); return; }
  if (conectado) { log("Ya conectado."); return; }

  listaDevs.innerHTML = "";
  log("🔍 Buscando ESP32-C3...");

  try {
    // Filtramos por SERVICE_UUID (lo más confiable) + nombre
    device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID] },
        { namePrefix: DEVICE_NAME_PREFIX }
      ],
      optionalServices: [
        SERVICE_UUID,
        CHAR_RX_UUID,
        CHAR_TX_UUID,
        "00001800-0000-1000-8000-00805f9b34fb",
        "00001801-0000-1000-8000-00805f9b34fb",
        "0000180a-0000-1000-8000-00805f9b34fb",
      ]
    });

    log(`✅ Encontrado: ${device.name || "(sin nombre)"} [${device.id}]`);
    addDeviceToList(device);

    log("🔗 Conectando automáticamente...");
    await conectar();

  } catch (e) {
    if (e.name === "NotFoundError") {
      log("❌ No se encontró. ¿Está encendido el ESP32 y anunciando BLE?");
    } else if (e.name === "SecurityError") {
      log("⚠️ Necesitas HTTPS. Abre la app desde GitHub Pages.");
    } else {
      log(`Error: ${e.message}`);
    }
  }
});

// =====================================================
// LISTA VISUAL
// =====================================================
function addDeviceToList(dev) {
  listaDevs.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${dev.name || "(sin nombre)"}  —  ${dev.id}`;
  li.classList.add("selected");
  listaDevs.appendChild(li);
}

// =====================================================
// CONECTAR
// =====================================================
btnConectar.addEventListener("click", conectar);

async function conectar() {
  if (!device) { log("Primero escanea."); return; }
  if (conectado) { log("Ya conectado."); return; }

  try {
    log("🔗 Conectando a GATT...");
    server = await device.gatt.connect();

    // Pedimos el servicio específico
    let service;
    try {
      service = await server.getPrimaryService(SERVICE_UUID);
      log(`✅ Servicio encontrado: ${SERVICE_UUID.slice(0,8)}...`);
    } catch (e) {
      log("⚠️ Service UUID no encontrado, escaneando todos...");
      const services = await server.getPrimaryServices();
      log(`Servicios: ${services.length}`);
    }

    // Obtener características
    charRX = null;
    charTX = null;

    if (service) {
      const chars = await service.getCharacteristics();
      log(`Características: ${chars.length}`);
      for (const ch of chars) {
        const u = ch.uuid.toLowerCase();
        log(`  → ${u}`);
        if (u === CHAR_RX_UUID.toLowerCase()) charRX = ch;
        if (u === CHAR_TX_UUID.toLowerCase()) charTX = ch;
      }
      // Fallback dentro del servicio
      if (!charRX) {
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            charRX = ch;
            log(`⚠️ Usando writable alterna: ${ch.uuid}`);
            break;
          }
        }
      }
    } else {
      // Escanear todos los servicios
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          const u = ch.uuid.toLowerCase();
          if (u === CHAR_RX_UUID.toLowerCase()) charRX = ch;
          if (u === CHAR_TX_UUID.toLowerCase()) charTX = ch;
        }
      }
    }

    if (!charRX) {
      log("❌ No hay característica escribible. Revisa UUIDs del firmware.");
      return;
    }

    log(`✅ RX listo: ${charRX.uuid}`);

    // Notificaciones
    if (charTX) {
      try {
        await charTX.startNotifications();
        charTX.addEventListener("characteristicvaluechanged", onNotify);
        log("🔔 Notificaciones activadas.");
      } catch (e) {
        log("No se pudieron activar notificaciones: " + e.message);
      }
    }

    device.addEventListener("gattserverdisconnected", onDisconnect);

    conectado = true;
    lblEstado.textContent = "● ONLINE";
    lblEstado.className = "online";
    log("✅ CONECTADO. ¡Listo para controlar!");

  } catch (e) {
    log(`❌ ERROR al conectar: ${e.message}`);
    conectado = false;
  }
}

function onDisconnect() {
  conectado = false;
  lblEstado.textContent = "● OFFLINE";
  lblEstado.className = "offline";
  stop();
  log("🔌 Desconectado.");
}

btnDescon.addEventListener("click", () => {
  if (device && device.gatt.connected) device.gatt.disconnect();
});

// =====================================================
// NOTIFY
// =====================================================
function onNotify(event) {
  const text = new TextDecoder().decode(event.target.value);
  console.log("RX desde ESP32:", text);
}

// =====================================================
// JOYSTICK
// =====================================================
let dragging = false;

function moveKnob(clientX, clientY) {
  const r = joystickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const maxR = r.width / 2 - 12;

  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }

  knobEl.style.left = (r.width / 2 + dx) + "px";
  knobEl.style.top  = (r.height / 2 + dy) + "px";
  knobEl.style.transform = "translate(-50%, -50%)";

  const nx = dx / maxR;
  const ny = -dy / maxR;
  onJoystick(nx, ny);
}

function resetKnob() {
  knobEl.style.left = "50%";
  knobEl.style.top  = "50%";
  knobEl.style.transform = "translate(-50%, -50%)";
  knobEl.classList.remove("active");
  onJoystick(0, 0);
}

joystickEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dragging = true;
  knobEl.classList.add("active");
  joystickEl.setPointerCapture(e.pointerId);
  moveKnob(e.clientX, e.clientY);
});
joystickEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  e.preventDefault();
  moveKnob(e.clientX, e.clientY);
});
joystickEl.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  resetKnob();
});
joystickEl.addEventListener("pointercancel", () => {
  dragging = false;
  resetKnob();
});

// =====================================================
// MOVIMIENTO
// =====================================================
function onJoystick(nx, ny) {
  const v = parseInt(sliderVel.value, 10);
  const adelante = ny * v;
  const giro = nx * v;
  setMotores(Math.round(adelante + giro), Math.round(adelante - giro));
}

// =====================================================
// TECLADO
// =====================================================
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) {
    e.preventDefault();
    teclas.add(k);
    actualizarDesdeTeclas();
  }
});
window.addEventListener("keyup", (e) => {
  teclas.delete(e.key.toLowerCase());
  actualizarDesdeTeclas();
});

function actualizarDesdeTeclas() {
  const v = parseInt(sliderVel.value, 10);
  let izq = 0, der = 0;
  if (teclas.has("w") || teclas.has("arrowup"))    { izq += v; der += v; }
  if (teclas.has("s") || teclas.has("arrowdown"))  { izq -= v; der -= v; }
  if (teclas.has("a") || teclas.has("arrowleft"))  { izq -= v; der += v; }
  if (teclas.has("d") || teclas.has("arrowright")) { izq += v; der -= v; }
  setMotores(izq, der);
}

// =====================================================
// MOTORES
// =====================================================
function setMotores(izq, der) {
  motorIzq = Math.max(-255, Math.min(255, Math.round(izq)));
  motorDer = Math.max(-255, Math.min(255, Math.round(der)));
  lblIzq.textContent = (motorIzq >= 0 ? "+" : "") + String(motorIzq).padStart(4, "0");
  lblDer.textContent = (motorDer >= 0 ? "+" : "") + String(motorDer).padStart(4, "0");
}

function stop() {
  teclas.clear();
  resetKnob();
  setMotores(0, 0);
}
btnStop.addEventListener("click", stop);

// =====================================================
// SLIDER
// =====================================================
sliderVel.addEventListener("input", () => { lblVel.textContent = sliderVel.value; });
lblVel.textContent = sliderVel.value;

// =====================================================
// ENVÍO BLE
// =====================================================
setInterval(async () => {
  if (!conectado || !charRX) return;
  try {
    const data = new TextEncoder().encode(`M:${motorIzq},${motorDer}`);
    if (charRX.properties.writeWithoutResponse) {
      await charRX.writeValueWithoutResponse(data);
    } else {
      await charRX.writeValue(data);
    }
  } catch (e) { /* silencioso */ }
}, INTERVALO_ENVIO_MS);

// =====================================================
// PWA
// =====================================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

log("Sistema listo. Pulsa ESCANEAR → se conectará solo al ESP32-C3.");
