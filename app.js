// =====================================================
// CONFIG
// =====================================================
const CHAR_RX_UUID = "87654321-4321-4321-4321-CBA987654321";
const CHAR_TX_UUID = "11111111-2222-3333-4444-555555555555";
const SERVICE_UUID = null; // null = descubrir automáticamente

const INTERVALO_ENVIO_MS = 50;

// =====================================================
// ESTADO GLOBAL
// =====================================================
let device = null;
let server = null;
let charRX = null;   // característica de escritura (recibe comandos)
let charTX = null;   // característica de notificación (envía datos)
let conectado = false;

let motorIzq = 0;
let motorDer = 0;
const teclas = new Set();
let joystickVec = { x: 0, y: 0 };

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
  log("Web Bluetooth NO disponible en este navegador.");
}

// =====================================================
// ESCANEO
// =====================================================
btnEscanear.addEventListener("click", async () => {
  if (!navigator.bluetooth) {
    log("Web Bluetooth no soportado.");
    return;
  }
  if (conectado) { log("Ya conectado."); return; }

  listaDevs.innerHTML = "";
  log("Abriendo selector BLE...");

  try {
    // Web Bluetooth muestra un selector nativo con los dispositivos
    // No hay API pública para "discover()" y listar; el usuario elige.
    // Filtramos por servicios comunes o aceptamos todos.
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: collectPossibleServices()
    });

    log(`Dispositivo seleccionado: ${device.name || "(sin nombre)"} [${device.id}]`);
    addDeviceToList(device);
  } catch (e) {
    if (e.name === "NotFoundError") {
      log("Selección cancelada.");
    } else {
      log(`Error: ${e.message}`);
    }
  }
});

function collectPossibleServices() {
  // Lista de servicios UUID comunes (custom + estándar) que podamos necesitar
  return [
    CHAR_RX_UUID,
    CHAR_TX_UUID,
    "0000ffe0-0000-1000-8000-00805f9b34fb",
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART
    "0000180a-0000-1000-8000-00805f9b34fb", // Device Info
  ];
}

let selectedDevice = null;

function addDeviceToList(dev) {
  listaDevs.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${dev.name || "(sin nombre)"}  —  ${dev.id}`;
  li.dataset.id = dev.id;
  li.addEventListener("click", () => {
    document.querySelectorAll("#listaDevices li").forEach(x => x.classList.remove("selected"));
    li.classList.add("selected");
    selectedDevice = dev;
  });
  listaDevs.appendChild(li);
  li.click(); // auto-seleccionar
}

// =====================================================
// CONECTAR
// =====================================================
btnConectar.addEventListener("click", conectar);

async function conectar() {
  if (!device) { log("Primero escanea y selecciona un dispositivo."); return; }
  if (conectado) { log("Ya conectado."); return; }

  try {
    log("Conectando...");
    server = await device.gatt.connect();

    // Descubrir servicio que contenga nuestras características
    const services = await server.getPrimaryServices();

    charRX = null;
    charTX = null;

    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const ch of chars) {
        const u = ch.uuid.toLowerCase();
        if (u === CHAR_RX_UUID.toLowerCase()) charRX = ch;
        if (u === CHAR_TX_UUID.toLowerCase()) charTX = ch;
      }
    }

    if (!charRX) {
      log("⚠️ No se encontró CHAR_RX_UUID. Revisa el UUID del firmware.");
      // fallback: usar la primera característica escribible
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            charRX = ch;
            log(`Usando característica alternativa: ${ch.uuid}`);
            break;
          }
        }
        if (charRX) break;
      }
    }

    if (charRX && charTX) {
      try {
        await charTX.startNotifications();
        charTX.addEventListener("characteristicvaluechanged", onNotify);
        log("Notificaciones activadas.");
      } catch (e) {
        log("No se pudieron activar notificaciones: " + e.message);
      }
    }

    device.addEventListener("gattserverdisconnected", onDisconnect);

    conectado = true;
    lblEstado.textContent = "● ONLINE";
    lblEstado.className = "online";
    log("Conectado correctamente.");

  } catch (e) {
    log(`ERROR al conectar: ${e.message}`);
    conectado = false;
  }
}

function onDisconnect() {
  conectado = false;
  lblEstado.textContent = "● OFFLINE";
  lblEstado.className = "offline";
  stop();
  log("Desconectado.");
}

btnDescon.addEventListener("click", () => {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }
});

// =====================================================
// NOTIFY
// =====================================================
function onNotify(event) {
  const value = event.target.value;
  const decoder = new TextDecoder();
  const text = decoder.decode(value);
  console.log("RX:", text);
  // Aquí puedes procesar datos del ESP32
}

// =====================================================
// JOYSTICK
// =====================================================
let dragging = false;
let rect = null;

function updateRect() {
  rect = joystickEl.getBoundingClientRect();
}

function getKnobCenter() {
  const r = joystickEl.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function moveKnob(clientX, clientY) {
  const r = joystickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const maxR = r.width / 2 - 12;

  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = dx / dist * maxR;
    dy = dy / dist * maxR;
  }

  // Mover knob
  const kx = r.width / 2 + dx;
  const ky = r.height / 2 + dy;
  knobEl.style.left = kx + "px";
  knobEl.style.top  = ky + "px";
  knobEl.style.transform = "translate(-50%, -50%)";

  // Normalizar -1..1 (Y invertida: arriba positivo)
  const nx = dx / maxR;
  const ny = -dy / maxR;
  joystickVec = { x: nx, y: ny };
  onJoystick(nx, ny);
}

function resetKnob() {
  knobEl.style.left = "50%";
  knobEl.style.top  = "50%";
  knobEl.style.transform = "translate(-50%, -50%)";
  knobEl.classList.remove("active");
  joystickVec = { x: 0, y: 0 };
  onJoystick(0, 0);
}

joystickEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dragging = true;
  knobEl.classList.add("active");
  joystickEl.setPointerCapture(e.pointerId);
  updateRect();
  moveKnob(e.clientX, e.clientY);
});
joystickEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  e.preventDefault();
  moveKnob(e.clientX, e.clientY);
});
joystickEl.addEventListener("pointerup", (e) => {
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
  const izq = Math.round(adelante + giro);
  const der = Math.round(adelante - giro);
  setMotores(izq, der);
}

// =====================================================
// TECLADO (para PC)
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
  const k = e.key.toLowerCase();
  teclas.delete(k);
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
// SLIDER VELOCIDAD
// =====================================================
sliderVel.addEventListener("input", () => {
  lblVel.textContent = sliderVel.value;
});
lblVel.textContent = sliderVel.value;

// =====================================================
// LOOP DE ENVÍO BLE
// =====================================================
setInterval(async () => {
  if (!conectado || !charRX) return;
  try {
    const cmd = `M:${motorIzq},${motorDer}`;
    const data = new TextEncoder().encode(cmd);
    // Intentar writeWithoutResponse si está disponible (más rápido)
    if (charRX.properties.writeWithoutResponse) {
      await charRX.writeValueWithoutResponse(data);
    } else {
      await charRX.writeValue(data);
    }
  } catch (e) {
    // Silencioso para no saturar el log
  }
}, INTERVALO_ENVIO_MS);

// =====================================================
// SERVICE WORKER (para PWA offline)
// =====================================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

log("Sistema listo. Pulsa ESCANEAR para buscar dispositivos BLE.");