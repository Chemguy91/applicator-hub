// "Fog the Storage" — training demo for the Applicator Hub.
// Two modes share one machine/fog simulation and one drawing:
//   mode "game":   free play, each control tagged with its checklist step.
//   mode "guided": the Operational Checklist in three phases (setup taps,
//                  fogging, shutdown/clean-up + post treatment) with a score.
// Plain JS + canvas so it runs inside the app and as a standalone preview.
import CHECKLISTS from "../data/checklist.json";

const W = 360;
const H = 560;
const WALL_Y = 196;
const MELTER = { x: 26, y: 50, w: 112, h: 98 };
const BAG = { x: 152, y: 4 };
const PUMP = { x: 150, y: 126, w: 34, h: 24 };
const MACHINE = { x: 196, y: 92, w: 104, h: 62 };
const OUTLET = { x: 322, y: 224 };
const PORT = { x: 322, y: WALL_Y };
const FAN = { x: 314, y: 262, r: 24 };
const STORE = { x: 14, y: 302, w: 270, h: 246 };
const PLENUM = { x: 288, y: 302, w: 56, h: 246 };
const PANEL = { x: 18, y: 210, w: 52, h: 34 };
const DISC = { x: 228, y: 176, w: 24, h: 17 };
const CLIMA = { x: 258, y: 232, w: 12, h: 62 };
const COILS = { x: 290, y: 304, w: 52, h: 12 };
const BULB = { x: 160, y: 216 };
const PILE = { x: 150, y: 425 };
const DUCT_Y = [330, 380, 430, 480, 530];
const DUCT_NAMES = ["Front", "", "Middle", "", "End"];
const MAX_LBS = 100;
const POUR_LBS = 20;
const TARGET_T = [600, 700]; // shown as "650°F"
const TARGET_FPM = [250, 350];
const STEP_TEXT = Object.fromEntries(CHECKLISTS.setup.steps.map((s) => [s.n, s]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function makePotatoes() {
  const out = [];
  let seed = 7;
  const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 150; i++) {
    out.push({
      x: STORE.x + 8 + r() * (STORE.w - 16), y: STORE.y + 8 + r() * (STORE.h - 16),
      rx: 6 + r() * 4, ry: 4 + r() * 2.5, a: r() * Math.PI, shade: r(),
    });
  }
  return out;
}

function freshState(guided) {
  return {
    solid: 0, liquid: 0, pending: 0,
    blower: false, spark: false, burner: false, pump: false, pumpDir: "off",
    setT: 300, T: 70, fpm: 0,
    cov: DUCT_Y.map(() => 0),
    started: false, elapsed: 0, done: false, fogDone: false,
    pumpTime: 0, tempOk: 0, fanOk: 0, dryCount: 0, wasDry: false,
    pourTimer: 0, fanAngle: 0, spawnAcc: 0, dripAcc: 0, flash: null, flashT: 0,
    warmT: 0, mistakes: 0, blowerTest: 0, solvent: 0, recirc: 0,
    // scene pieces (guided mode starts with the storage as you find it)
    sc: guided
      ? { truckOff: -24, extinguisher: false, cord: false, guard: true, climaOpen: false, refrigOpen: false, plenumBypassClosed: false,
          flag: false, tube: false, thermometer: false, panel: "auto", lights: true, notice: false, portCap: false, dim: 0, fansPower: true }
      : { truckOff: 0, extinguisher: false, cord: false, guard: false, climaOpen: false, refrigOpen: false, plenumBypassClosed: true,
          flag: false, tube: true, thermometer: false, panel: "auto", lights: true, notice: false, portCap: false, dim: 0, fansPower: true },
  };
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
  return e;
}

export function mountSproutNipGame(container, { mode = "game" } = {}) {
  const guided = mode === "guided";

  // ---------- DOM ----------
  const canvas = el("canvas", { class: "sng-canvas", role: "img", "aria-label": "Sprout-Nip machine fogging a potato storage: melter, machine, fans, plenum and ducts" });
  const hint = el("p", { class: "sng-hint", "aria-live": "polite" });
  const card = el("div", { class: "sng-card", "aria-live": "polite" });
  const pourBtn = el("button", { class: "btn sng-pour", type: "button" }, "Pour 20 lbs of pellets");
  const lbsOut = el("span", { class: "sng-lbs" });
  const sw = {
    blower: el("button", { class: "sng-switch", type: "button", "aria-pressed": "false" }, "Blower"),
    spark: el("button", { class: "sng-switch", type: "button", "aria-pressed": "false" }, "Spark"),
    burner: el("button", { class: "sng-switch", type: "button", "aria-pressed": "false" }, "Burner"),
  };
  const tempIn = el("input", { type: "range", min: "200", max: "900", step: "10", value: "300", "aria-label": "Burner temperature setting" });
  const tempOut = el("output", { class: "sng-val" });
  const fanIn = el("input", { type: "range", min: "0", max: "500", step: "10", value: "0", "aria-label": "Fan speed in feet per minute" });
  const fanOut = el("output", { class: "sng-val" });
  const pumpBtn = el("button", { class: "sng-switch sng-pump", type: "button", "aria-pressed": "false" }, "Pump");
  const resetBtn = el("button", { class: "link-btn", type: "button" }, "Start over");
  const covBars = DUCT_Y.map(() => el("span", { class: "sng-bar" }, el("span")));
  const covPct = el("strong", { class: "sng-pct" });
  const covRow = el("div", { class: "sng-cov" },
    el("span", { class: "sng-cov-label" }, "Storage fogged ", covPct),
    el("span", { class: "sng-bars", "aria-hidden": "true" }, ...covBars));
  const doneBox = el("div", { class: "sng-done", hidden: "" });

  const tag = (t) => el("span", { class: "sng-tag" }, t);
  const group = (num, tagText, ...body) => el("div", { class: "sng-group" },
    el("span", { class: "sng-step" }, num), el("div", { class: "sng-body" }, tagText ? tag(tagText) : null, ...body));

  const controls = el("div", { class: "sng-controls" },
    group("1", guided ? null : "Checklist steps 7 and 18: CIPC Melter Box, Loading and Monitoring",
      el("div", { class: "sng-row" }, pourBtn, lbsOut)),
    group("2", guided ? null : "Checklist step 16: Starting the Machine",
      el("span", { class: "sng-label" }, "Start in order"), el("div", { class: "sng-switches" }, sw.blower, sw.spark, sw.burner)),
    group("3", guided ? null : "Checklist steps 16 and 17: Starting the Machine, Starting Chemical Pump",
      el("label", { class: "sng-slider" },
        el("span", { class: "sng-label" }, "Burner temp ", tempOut, el("span", { class: "sng-target" }, guided ? "" : "Target 650°F")), tempIn)),
    group("4", guided ? null : "Checklist step 12: Using the Storage Frequency Drives",
      el("label", { class: "sng-slider" },
        el("span", { class: "sng-label" }, "Fan speed ", fanOut, el("span", { class: "sng-target" }, "Target 250–350 fpm")), fanIn)),
    group("5", guided ? null : "Checklist step 17: Starting Chemical Pump",
      el("div", { class: "sng-row" }, pumpBtn, guided ? null : resetBtn)),
  );

  const ui = el("div", { class: `sng ${guided ? "sng-guided" : ""}` },
    el("div", { class: "sng-top" },
      el("div", { class: "sng-stage" }, canvas, doneBox),
      guided ? card : hint,
      covRow),
    controls,
    guided ? el("div", { class: "sng-row", style: "margin-top:10px" }, resetBtn) : null,
    el("p", { class: "sng-note" }, "Just a training demo, sped up. On a real job, follow the checklist and the product label."),
  );
  container.append(ui);

  // ---------- state ----------
  let s = freshState(guided);
  const pellets = [];
  let fog = [];
  const drips = [];
  const potatoes = makePotatoes();
  const flash = (msg) => { s.flash = msg; s.flashT = 2.8; };
  const mistake = (msg) => { s.mistakes += 1; flash(msg); renderCard(); };

  function pour() {
    if (s.done) return false;
    if (s.solid + s.liquid + s.pending > MAX_LBS - POUR_LBS + 0.01) { flash("The melter is full. Pour more when it drops."); return false; }
    s.pending += POUR_LBS; s.pourTimer = 1.6; s.started = true; return true;
  }
  pourBtn.addEventListener("click", pour);

  // In guided shutdown (step 21) the switches must go off in reverse order.
  const OFF_ORDER = ["burner", "spark", "blower"];
  function toggleSwitch(k) {
    if (guided && cur()?.offOrder) {
      if (!s[k]) return;
      const expect = OFF_ORDER.find((x) => s[x]);
      if (k !== expect) { mistake(`Turn them off in order: burner, spark, then blower. Next is the ${expect}.`); return; }
      s[k] = false; advanceIfDone(); return;
    }
    if (k === "blower") {
      if (s.blower && (s.burner || s.spark)) { s.burner = false; s.spark = false; }
      s.blower = !s.blower; s.started = true;
    } else if (k === "spark") {
      if (!s.spark && !s.blower) { guided ? mistake("Start the blower first. The order is blower, spark, burner.") : flash("Start the blower first. The order is blower, spark, burner."); return; }
      if (s.spark && s.burner) s.burner = false;
      s.spark = !s.spark;
    } else {
      if (!s.burner && !(s.blower && s.spark)) {
        const msg = s.blower ? "Turn on the spark before the burner." : "Start the blower first. The order is blower, spark, burner.";
        guided ? mistake(msg) : flash(msg); return;
      }
      s.burner = !s.burner;
    }
    advanceIfDone();
  }
  for (const k of ["blower", "spark", "burner"]) sw[k].addEventListener("click", () => toggleSwitch(k));
  pumpBtn.addEventListener("click", () => {
    if (s.done) return;
    // Guided: off -> reverse (warming, step 17) -> forward -> reverse ...
    if (guided) { s.pumpDir = s.pumpDir === "reverse" ? "forward" : "reverse"; s.pump = s.pumpDir === "forward"; advanceIfDone(); return; }
    s.pump = !s.pump; s.pumpDir = s.pump ? "forward" : "off";
  });
  tempIn.addEventListener("input", () => { s.setT = Number(tempIn.value); });
  fanIn.addEventListener("input", () => { s.fpm = Number(fanIn.value); s.started = true; });
  resetBtn.addEventListener("click", () => reset());

  function reset() {
    s = freshState(guided); pellets.length = 0; fog = []; drips.length = 0;
    tempIn.value = "300"; fanIn.value = "0"; doneBox.hidden = true; pourBtn.disabled = false;
    if (guided) { gi = 0; ai = 0; startGuided(); }
  }

  // ---------- simulation ----------
  const tempOk = () => s.T >= TARGET_T[0] && s.T <= TARGET_T[1];
  const fanOk = () => s.fpm >= TARGET_FPM[0] && s.fpm <= TARGET_FPM[1];
  const reach = () => (PLENUM.h - 20) * clamp((s.fpm - 100) / 150, 0, 1.15);
  function fogQuality() {
    if (!s.burner || s.T < 500) return 0;
    if (s.T < 600) return 0.4;
    if (s.T <= 800) return 1;
    return 0.6;
  }

  function step(dt) {
    if (s.started && !s.done) s.elapsed += dt;
    if (s.flashT > 0) s.flashT -= dt;
    if (s.blowerTest > 0) s.blowerTest -= dt;

    if (s.pourTimer > 0) s.pourTimer -= dt;
    if (s.pending > 0) {
      const n = Math.min(s.pending, dt * 14);
      s.pending -= n;
      const count = Math.round(n * 2.2) || 1;
      for (let i = 0; i < count && pellets.length < 240; i++) {
        pellets.push({ x: BAG.x + s.sc.truckOff - 6 + rand(-4, 4), y: BAG.y + 48, vx: rand(-120, -55), vy: rand(-10, 30), lbs: n / count });
      }
    }
    const mx = MELTER.x + s.sc.truckOff;
    const surface = MELTER.y + MELTER.h - 6 - ((s.solid + s.liquid) / MAX_LBS) * (MELTER.h - 16);
    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < mx + 10) { p.x = mx + 10; p.vx *= -0.4; }
      if (p.y > MELTER.y && p.x > mx + MELTER.w - 9) { p.x = mx + MELTER.w - 9; p.vx = -Math.abs(p.vx) * 0.5; }
      if (p.y >= surface) { s.solid += p.lbs; pellets.splice(i, 1); }
    }
    const melt = Math.min(s.solid, 6 * dt);
    s.solid -= melt; s.liquid += melt;

    const goal = s.burner ? s.setT : 70;
    const rate = s.burner ? 90 : 45;
    s.T += clamp(goal - s.T, -rate * dt, rate * dt);
    if (!s.blower && s.burner) s.burner = false;
    if (s.burner && s.T >= 700) s.warmT += dt; else if (!s.burner) s.warmT = 0;

    const fanRun = s.sc.fansPower ? s.fpm : 0;
    s.fanAngle += (fanRun / 60) * dt * 2.2;

    let producing = 0;
    if (s.pump && !s.fogDone) {
      s.pumpTime += dt;
      if (tempOk()) s.tempOk += dt;
      if (fanOk()) s.fanOk += dt;
      if (s.liquid > 0) {
        s.liquid = Math.max(0, s.liquid - 1.1 * dt);
        s.wasDry = false;
        producing = s.sc.tube ? fogQuality() : 0;
        if (producing === 0 && s.sc.tube) {
          s.dripAcc += dt * 9;
          while (s.dripAcc > 1) { s.dripAcc -= 1; drips.push({ x: OUTLET.x + rand(-3, 3), y: OUTLET.y + 4, vy: rand(20, 60) }); }
        }
      } else if (!s.wasDry) { s.wasDry = true; s.dryCount += 1; }
    }

    if (producing > 0) {
      s.spawnAcc += dt * 30 * producing;
      const r = reach();
      const reachable = DUCT_Y.map((y, i) => i).filter((i) => DUCT_Y[i] - PLENUM.y <= r + 4);
      while (s.spawnAcc > 1 && fog.length < 520) {
        s.spawnAcc -= 1;
        fog.push({
          x: OUTLET.x + rand(-2, 2), y: OUTLET.y + 2, vx: rand(-20, 10), vy: rand(30, 60),
          r: rand(4, 7), life: 0, max: rand(6.5, 8), phase: "tube",
          duct: fanRun > 0 && reachable.length ? reachable[Math.floor(Math.random() * reachable.length)] : -1,
          stallY: PLENUM.y + Math.min(r, PLENUM.h - 20) * Math.random(),
        });
      }
    }

    const pv = 100 * (fanRun / 300);
    const eff = fanRun > TARGET_FPM[1] ? 0.6 : 1;
    for (let i = fog.length - 1; i >= 0; i--) {
      const f = fog[i];
      f.life += dt;
      f.r = Math.min(f.r + dt * 5, 16);
      if (f.phase === "tube") {
        const pull = fanRun > 0 ? 1 : 0.25;
        f.vx += (FAN.x - f.x) * dt * 2 * pull;
        f.vy = fanRun > 0 ? Math.max(f.vy, 40 + pv * 0.5) : f.vy * (1 - dt * 1.5);
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.y >= PLENUM.y + 4 && fanRun > 0) { f.phase = f.duct >= 0 ? "plenum" : "stall"; f.vx = 0; }
        if (fanRun === 0) { f.life += dt; f.y = Math.min(f.y, PLENUM.y - 4); }
      } else if (f.phase === "plenum") {
        f.y += pv * dt;
        f.x += (PLENUM.x + PLENUM.w / 2 + Math.sin(f.life * 3 + i) * 12 - f.x) * dt * 3;
        if (f.y >= DUCT_Y[f.duct]) { f.y = DUCT_Y[f.duct]; f.phase = "duct"; }
      } else if (f.phase === "stall") {
        f.y += Math.max(0, f.stallY - f.y) * dt * 1.5;
        f.x += Math.sin(f.life * 2 + i) * dt * 8;
        f.life += dt * 0.6;
      } else if (f.phase === "duct") {
        f.x -= (60 + fanRun * 0.15) * dt;
        f.y = DUCT_Y[f.duct] + Math.sin(f.life * 4 + i) * 6;
        // Each fog puff in a duct fills it a little; tuned so a good run takes about 45 seconds.
        s.cov[f.duct] = Math.min(1, s.cov[f.duct] + 0.0016 * eff * dt);
        if (f.x < STORE.x + 10) f.life = f.max;
      }
      if (f.life >= f.max) fog.splice(i, 1);
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i]; d.vy += 300 * dt; d.y += d.vy * dt;
      if (d.y > PLENUM.y - 6) drips.splice(i, 1);
    }
    if (s.recirc > 0) { s.recirc = Math.max(0, s.recirc - dt); }
    if (s.sc.dim < (s.sc.lights ? 0 : 1)) s.sc.dim = Math.min(1, s.sc.dim + dt * 1.2);

    if (!s.fogDone && s.cov.every((c) => c >= 1)) {
      s.fogDone = true;
      if (!guided) finishGame(); else advanceIfDone();
    }
    if (guided) guidedTick(dt);
  }

  function finishGame() {
    s.done = true; s.pump = false;
    const t = Math.round(s.elapsed);
    const tp = s.pumpTime ? Math.round((s.tempOk / s.pumpTime) * 100) : 0;
    const fp = s.pumpTime ? Math.round((s.fanOk / s.pumpTime) * 100) : 0;
    const stars = tp >= 80 && fp >= 80 && s.dryCount === 0 ? 3 : tp >= 60 && fp >= 60 && s.dryCount <= 1 ? 2 : 1;
    showDone(stars, "Storage fogged", [
      `Time: ${fmt(t)}`,
      `Burner on target (600–700°F): ${tp}% of the time`,
      `Fans on target (250–350 fpm): ${fp}% of the time`,
      s.dryCount === 0 ? "Melter never ran dry" : `Melter ran dry ${s.dryCount} time${s.dryCount > 1 ? "s" : ""}`,
    ]);
  }
  const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  function showDone(stars, title, lines) {
    doneBox.replaceChildren(
      el("p", { class: "sng-stars", "aria-label": `${stars} of 3 stars` }, "★".repeat(stars) + "☆".repeat(3 - stars)),
      el("h3", { text: title }),
      el("ul", {}, ...lines.map((l) => el("li", { text: l }))),
      (() => { const b = el("button", { class: "btn", type: "button" }, "Play again"); b.addEventListener("click", reset); return b; })(),
    );
    doneBox.hidden = false;
  }

  // ---------- free-play hint ----------
  function hintText() {
    if (s.flashT > 0 && s.flash) return s.flash;
    if (s.done) return "Done. Recirculate, then clean up.";
    const lbs = s.solid + s.liquid + s.pending;
    if (s.pump && s.liquid <= 0 && s.pending <= 0) return "The melter ran dry. Pour more pellets.";
    if (!s.started || lbs < 1 && !s.pump) return "Tap “Pour 20 lbs of pellets” to fill the melter.";
    if (!s.blower) return "Start the blower.";
    if (!s.spark) return "Turn on the spark.";
    if (!s.burner) return "Light the burner.";
    if (s.T < 500 && s.pump) return "Too cold: the product drips instead of fogging. Get the burner up to 650°F.";
    if (Math.abs(s.setT - 650) > 50) return "Set the burner temperature to 650°F.";
    if (s.fpm === 0) return "Turn on the fans so the fog moves into the plenum.";
    if (s.fpm < TARGET_FPM[0]) return "Fans too slow: fog won't reach the end ducts. Aim for 250–350 fpm.";
    if (s.fpm > TARGET_FPM[1]) return "Fans above 250–350 fpm. Bring them back into range.";
    if (!s.pump) return "Turn the pump on to send product to the burner.";
    if (lbs < 20) return "Keep at least 20 lbs in the melter. Pour more pellets.";
    if (!tempOk()) return "Bring the burner back to 650°F.";
    return "Fogging. Keep the melter topped up until every duct is full.";
  }

  // =====================================================================
  // Guided mode: the Operational Checklist as three phases.
  // Each step has one or more actions. An action is a tap on the scene
  // (hotspot), a choice (buttons), or a condition the controls must reach.
  // =====================================================================
  const volt = Math.random() < 0.5 ? 240 : 480;
  const badPhase = Math.random() < 0.6;
  const panelSettings = "Fans: Auto, Refer.: Off, Heat: Auto, Doors: Auto";
  let gi = 0, ai = 0, holdT = 0, flushes = 0, postDone = new Set();
  let driveStep = 12;
  const anemo = () => [s.fpm * 1.06, s.fpm, s.fpm * 0.93].map((v) => Math.round(v / 5) * 5);
  const anemoOk = () => anemo().every((v) => v >= 250 && v <= 350);

  const tap = (prompt, hot, fallback, onDo) => ({ kind: "tap", prompt, hot, fallback, onDo });
  const choice = (prompt, options) => ({ kind: "choice", prompt, options });
  const until = (prompt, test, show) => ({ kind: "until", prompt, test, show });

  const GUIDE = [
    // ---------------- Phase 1: Setup ----------------
    { n: 1, phase: 1, actions: [tap("Tap the storage to confirm you're at the right location. Write it on your Application Log Sheet.", { ...PILE, r: 70 }, "Confirm the location")] },
    { n: 2, phase: 1, actions: [tap("Before you shut anything down, tap the control panel and note how the switches are set.", { x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2, r: 26 }, "Note the panel settings",
      () => flash(`Noted: ${panelSettings}`))] },
    { n: 3, phase: 1, actions: [tap("Tap the fogging port on the storage to line the truck up with it.", { ...PORT, r: 20 }, "Line up with the fogging port", () => { s.sc.truckTarget = 0; })] },
    { n: 4, phase: 1, actions: [
      tap("Turn the ventilation system off at the control panel.", { x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2, r: 26 }, "Ventilation off", () => { s.sc.panel = "off"; }),
      choice("Check the plenum and climacell. Are they dry?", [
        { label: "Yes, both dry", ok: true },
        { label: "No, still wet", ok: false, why: "In this storage they're dry. If they weren't, you'd contact your supervisor because the application may need to wait." }])] },
    { n: 5, phase: 1, actions: [tap("Set the fire extinguisher beside the truck.", { x: 334, y: 156, r: 20 }, "Set out the fire extinguisher", () => { s.sc.extinguisher = true; })] },
    { n: 6, phase: 1, actions: [
      tap("Find power for the machine: tap the disconnect on the fan house and test the voltage.", { x: DISC.x + DISC.w / 2, y: DISC.y + DISC.h / 2, r: 20 }, "Test the voltage", () => { s.sc.cord = true; }),
      choice(`Your tester reads ${volt}V. Set the machine's 240/480V switch to:`, [
        { label: "240V", ok: volt === 240, why: `The tester read ${volt}V. Match the switch to it.` },
        { label: "480V", ok: volt === 480, why: `The tester read ${volt}V. Match the switch to it.` }]),
      badPhase
        ? choice("Power on. The phase monitor shows the phase is wrong. What now?", [
            { label: "Disconnect and swap any two phases", ok: true },
            { label: "Turn the breakers on anyway", ok: false, why: "Get the phase right first: disconnect, switch any two phases, reconnect and check again." }])
        : choice("Power on. The phase monitor shows the phase is correct. What now?", [
            { label: "Turn all the breakers on", ok: true },
            { label: "Swap two phases", ok: false, why: "The phase is already correct, so leave it and turn the breakers on." }]),
      ...(badPhase ? [choice("Reconnected. The phase monitor now reads correct.", [{ label: "Turn all the breakers on", ok: true }])] : []),
      choice("Pull the emergency switch out and turn the blower on to test its rotation.", [{ label: "Test the blower", ok: true, onDo: () => { s.blowerTest = 2.5; } }])] },
    { n: 7, phase: 1, actions: [
      choice("Turn the melter's top and bottom heater switches to:", [
        { label: "Hand", ok: true }, { label: "Off", ok: false, why: "They go to “hand” so the pellets start melting." }, { label: "Auto", ok: false, why: "The checklist says “hand”." }]),
      tap("Tap the pellet bag to pour 20 lbs into the melter.", { x: BAG.x + 22, y: BAG.y + 26, r: 30 }, "Pour 20 lbs of pellets", () => pour()),
      tap("Tap the melter to close the lid so the cabinet warms up.", { x: MELTER.x + MELTER.w / 2, y: MELTER.y + 20, r: 40 }, "Close the lid")] },
    { n: 8, phase: 1, actions: [
      choice("Before taking the front fan guards off:", [
        { label: "Turn power off to the fans", ok: true, onDo: () => { s.sc.fansPower = false; } },
        { label: "Leave the fans running", ok: false, why: "Always turn the power off to the ventilation fans before removing the guards." }]),
      tap("Tap the fan to remove its front guard.", { ...FAN, r: 32 }, "Remove the fan guard", () => { s.sc.guard = false; })] },
    { n: 9, phase: 1, actions: [tap("Tap the climacell to open its bypass.", { x: CLIMA.x + 10, y: CLIMA.y + CLIMA.h / 2, r: 24 }, "Open the climacell bypass", () => { s.sc.climaOpen = true; })] },
    { n: 10, phase: 1, actions: [
      choice("Does this storage have refrigeration?", [{ label: "Yes, coils at the plenum", ok: true }, { label: "No", ok: false, why: "This one does: the coils are at the top of the plenum." }]),
      tap("Tap the refrigeration coils to open their bypass doors.", { x: COILS.x + COILS.w / 2, y: COILS.y + 6, r: 22 }, "Open the coil bypass", () => { s.sc.refrigOpen = true; })] },
    { n: 11, phase: 1, actions: [tap("Make sure the bypass at the end of the plenum is closed. Tap it to close it.", { x: PLENUM.x + PLENUM.w / 2, y: PLENUM.y + PLENUM.h - 6, r: 22 }, "Close the plenum bypass", () => { s.sc.plenumBypassClosed = true; })] },
    { n: 12, phase: 1, alt: true, actions: [
      choice("Which frequency drives will you use for the fans?", [
        { label: "The storage's drives (step 12)", ok: true, onDo: () => { driveStep = 12; } },
        { label: "The Sprout-Nip machine's drive (step 13)", ok: true, onDo: () => { driveStep = 13; } }]),
      { kind: "dyn", build: () => driveStep === 12
        ? tap("At the control panel: fresh-air doors off; climacell, humidifiers and refrigeration off; fans to manual at 12 Hz.", { x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2, r: 26 }, "Set the control panel", () => { s.sc.panel = "set"; s.sc.fansPower = true; })
        : choice("Turn the fan drives' power off, then connect the Sprout-Nip drive to the load side of each fan you'll use.", [{ label: "Connect the SN drive", ok: true, onDo: () => { s.sc.fansPower = true; } }]) },
      until("Check fpm with the anemometer at the front, middle and end of the plenum. Adjust the speed until all three read 250–350 fpm.", () => anemoOk() && holdT > 1.2, "fan")] },
    { n: 14, phase: 1, actions: [
      tap("Check the top of the pile. Tap it to check pulp temperature and place a white Agri-Stor flag.", { ...PILE, r: 60 }, "Check the pile and place the flag", () => { s.sc.flag = true; }),
      choice("You find a circulation fan running on top of the pile. What do you do?", [
        { label: "Turn it off", ok: true }, { label: "Leave it on", ok: false, why: "Circulation fans and heaters on the pile need to be off." }])] },
    // ---------------- Phase 2: Fog ----------------
    { n: 15, phase: 2, actions: [tap("Tap the fogging port to connect the 4-inch fogging tube. A double-walled heat collar goes where it passes through the wall.", { ...PORT, r: 22 }, "Connect the fogging tube", () => { s.sc.tube = true; })] },
    { n: 16, phase: 2, actions: [
      tap("Insert the barrel thermometer in the port on the tip of the burner.", { x: MACHINE.x + MACHINE.w - 6, y: MACHINE.y + 31, r: 22 }, "Insert the thermometer", () => { s.sc.thermometer = true; }),
      until("Turn on the blower, spark and burner, in that order. Use the controls below.", () => s.blower && s.spark && s.burner, "switches"),
      until("Heat to 750°F and let the fogging tubes warm up.", () => s.T >= 740 && s.warmT > 3, "temp")] },
    { n: 17, phase: 2, actions: [
      until("Turn the pump switch to reverse while the machine warms up.", () => s.pumpDir === "reverse", "pump"),
      until("Switch the pump to forward and set the temperature to 650°F.", () => s.pumpDir === "forward" && Math.abs(s.setT - 650) <= 50 && tempOk(), "temp+pump")] },
    { n: 18, phase: 2, actions: [until("Keep at least 20 lbs in the melter and watch the temperature. Fog until every duct is full.", () => s.fogDone, "all")] },
    // ---------------- Phase 3: Shut down, clean up ----------------
    { n: 19, phase: 3, actions: [
      choice("The tank is empty. Shut the machine down:", [{ label: "Pump to reverse", ok: true, onDo: () => { s.pump = false; s.pumpDir = "reverse"; } }]),
      choice("Then:", [{ label: "Close the liquid valve on the propane tank", ok: true }])] },
    { n: 20, phase: 3, actions: [{ kind: "flush", prompt: "Put the pump tubing in solvent. Pump forward until solvent reaches the burner, then reverse. Do it 3 times." }] },
    { n: 21, phase: 3, offOrder: true, actions: [until("Pump is off. Now turn off the burner, spark and blower, in that order. Use the switches below.", () => !s.blower && !s.spark && !s.burner, "switches")] },
    { n: 22, phase: 3, actions: [choice("Let the ventilation fans recirculate for 30 to 45 minutes.", [{ label: "Let them run (fast-forward)", ok: true, onDo: () => { s.recirc = 3; } }]),
      until("Recirculating…", () => s.recirc <= 0, null)] },
    { n: 23, phase: 3, actions: [
      choice("After the fog settles, turn off the ventilation and put on your respirator.", [{ label: "Done", ok: true, onDo: () => { s.sc.fansPower = false; } }]),
      tap("Tap the port to remove the fogging tube and put it back on the truck.", { ...PORT, r: 22 }, "Remove the fogging tube", () => { s.sc.tube = false; s.sc.thermometer = false; }),
      choice("Blow residue off the fan blades and rinse fans, climacell, coils and floors.", [{ label: "Fans on 10 seconds, then spray", ok: true }]),
      tap("Tap the fan to replace its guard.", { ...FAN, r: 32 }, "Replace the fan guard", () => { s.sc.guard = true; }),
      tap("Tap the climacell to close its bypass.", { x: CLIMA.x + 10, y: CLIMA.y + CLIMA.h / 2, r: 24 }, "Close the climacell bypass", () => { s.sc.climaOpen = false; }),
      tap("Tap the coils to close the refrigeration bypass.", { x: COILS.x + COILS.w / 2, y: COILS.y + 6, r: 22 }, "Close the coil bypass", () => { s.sc.refrigOpen = false; })] },
    { n: 24, phase: 3, actions: [tap(`Tap the control panel to set it back to how you found it (${panelSettings}).`, { x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2, r: 26 }, "Restore the panel", () => { s.sc.panel = "auto"; })] },
    { n: 25, phase: 3, actions: [choice("Reset the system to turn back on:", [
      { label: "Within 4 to 5 hours", ok: true },
      { label: "Right away", ok: false, why: "The system comes back on within 4 to 5 hours after application." },
      { label: "Tomorrow", ok: false, why: "The system comes back on within 4 to 5 hours after application." }])] },
    { n: 26, phase: 3, actions: [tap("Walk through: tap the storage to check nothing is left behind and the electrical room is clean.", { ...PILE, r: 70 }, "Walk through")] },
    { n: 27, phase: 3, actions: [tap("Always turn off the lights. Tap the light.", { ...BULB, r: 20 }, "Turn off the lights", () => { s.sc.lights = false; })] },
    { n: "post", phase: 4, actions: [{ kind: "post", prompt: "Post treatment check list. Tap each item as you confirm it." }] },
  ];

  const cur = () => GUIDE[gi];
  const curAction = () => {
    const a = cur()?.actions[ai];
    return a?.kind === "dyn" ? a.build() : a;
  };

  function startGuided() { gi = 0; ai = 0; holdT = 0; flushes = 0; postDone = new Set(); s.started = true; s.sc.truckTarget = -24; renderCard(); }

  function completeAction() {
    ai += 1; holdT = 0;
    if (ai >= cur().actions.length) {
      gi += 1; ai = 0;
      if (gi >= GUIDE.length) return finishGuided();
    }
    renderCard();
  }
  function advanceIfDone() {
    if (!guided) return;
    const a = curAction();
    if (a?.kind === "until" && a.test()) completeAction();
  }
  function guidedTick(dt) {
    // Truck slides into place for step 3.
    const tt = s.sc.truckTarget ?? s.sc.truckOff;
    if (s.sc.truckOff !== tt) s.sc.truckOff += clamp(tt - s.sc.truckOff, -60 * dt, 60 * dt);
    const a = curAction();
    if (a?.kind === "until") {
      if (a.show === "fan") { holdT = anemoOk() ? holdT + dt : 0; }
      if (a.test()) completeAction();
    }
  }

  function finishGuided() {
    s.done = true;
    const t = Math.round(s.elapsed);
    const tp = s.pumpTime ? Math.round((s.tempOk / s.pumpTime) * 100) : 0;
    const stars = s.mistakes === 0 && s.dryCount === 0 ? 3 : s.mistakes <= 3 && s.dryCount <= 1 ? 2 : 1;
    showDone(stars, "Job complete", [
      `Time: ${fmt(t)}`,
      s.mistakes === 0 ? "No mistakes" : `${s.mistakes} mistake${s.mistakes > 1 ? "s" : ""} along the way`,
      `Burner on target while pumping: ${tp}%`,
      s.dryCount === 0 ? "Melter never ran dry" : `Melter ran dry ${s.dryCount} time${s.dryCount > 1 ? "s" : ""}`,
    ]);
    renderCard();
  }

  const PHASES = { 1: "Phase 1: Setup", 2: "Phase 2: Fogging", 3: "Phase 3: Shut down and clean up", 4: "Post treatment" };
  function renderCard() {
    if (!guided) return;
    const g = cur();
    if (!g) {
      card.replaceChildren(el("p", { class: "sng-card-phase" }, "Done"), el("h3", { class: "sng-card-title" }, "Nice work."),
        el("p", { class: "sng-card-text" }, "Every setup step, the fogging, the clean up and the post-treatment checks are done."));
      controls.hidden = true; covRow.hidden = false;
      return;
    }
    const a = curAction();
    const stepNo = g.n === 12 ? driveStep : g.n;
    const info = typeof stepNo === "number" ? STEP_TEXT[stepNo] : null;
    const title = g.n === "post" ? "Post Treatment Check List" : `${info.title}`;
    const total = GUIDE.length;
    const head = el("div", { class: "sng-card-head" },
      el("span", { class: "sng-card-phase" }, `${PHASES[g.phase]}${typeof stepNo === "number" ? `: step ${stepNo} of 27` : ""}`),
      s.mistakes ? el("span", { class: "sng-card-miss" }, `Mistakes: ${s.mistakes}`) : null);
    const actionsBox = el("div", { class: "sng-card-actions" });

    if (a.kind === "tap") {
      const b = el("button", { class: "sng-chip sng-chip-ghost", type: "button" }, a.fallback);
      b.addEventListener("click", () => doTap());
      actionsBox.append(el("span", { class: "sng-card-or" }, "Tap the glowing spot, or"), b);
    } else if (a.kind === "choice") {
      for (const o of a.options) {
        const b = el("button", { class: "sng-chip", type: "button" }, o.label);
        b.addEventListener("click", () => {
          if (!o.ok) { mistake(o.why || "Not quite. Check the step again."); return; }
          o.onDo?.(); completeAction();
        });
        actionsBox.append(b);
      }
    } else if (a.kind === "flush") {
      const b = el("button", { class: "sng-chip", type: "button" }, `Flush (${flushes} of 3)`);
      b.addEventListener("click", () => { flushes += 1; s.solvent = 1.2; if (flushes >= 3) { s.pumpDir = "off"; completeAction(); } else renderCard(); });
      actionsBox.append(b);
    } else if (a.kind === "post") {
      for (const it of CHECKLISTS.post.steps) {
        const b = el("button", { class: `sng-post ${postDone.has(it.n) ? "on" : ""}`, type: "button", "aria-pressed": String(postDone.has(it.n)) },
          el("strong", {}, it.title), el("span", {}, it.text));
        b.addEventListener("click", () => {
          postDone.has(it.n) ? postDone.delete(it.n) : postDone.add(it.n);
          if (it.n === 1) s.sc.notice = postDone.has(1);
          if (it.n === 2) s.sc.portCap = postDone.has(2);
          if (postDone.size === CHECKLISTS.post.steps.length) completeAction(); else renderCard();
        });
        actionsBox.append(b);
      }
    } else if (a.kind === "until" && a.show === "fan") {
      actionsBox.append(fanCardSlider());
    }

    const detail = info ? el("details", { class: "sng-card-full" }, el("summary", {}, "Full checklist step"), el("p", {}, info.text)) : null;
    // Controls only matter once the machine is running.
    const usingControls = (g.phase === 2 && g.n !== 15 && !(g.n === 16 && ai === 0)) || g.n === 21;
    controls.hidden = !usingControls;
    card.classList.toggle("compact", usingControls);
    card.replaceChildren(...[head, el("h3", { class: "sng-card-title" }, title), el("p", { class: "sng-card-text" }, a.prompt),
      actionsBox, usingControls ? null : detail, el("div", { class: "sng-card-progress" }, el("span", { style: `width:${(gi / total) * 100}%` }))].filter(Boolean));
    covRow.hidden = g.phase === 1;
    lastAnemo = "";
  }

  // Fan slider inside the card for the anemometer step.
  let fanCardEls = null, lastAnemo = "";
  function fanCardSlider() {
    const inp = el("input", { type: "range", min: "0", max: "500", step: "10", value: String(s.fpm), "aria-label": "Fan speed in feet per minute" });
    const out = el("div", { class: "sng-anemo" });
    inp.addEventListener("input", () => { s.fpm = Number(inp.value); fanIn.value = inp.value; });
    fanCardEls = { out };
    return el("div", { class: "sng-card-fan" }, inp, out);
  }

  function doTap() {
    const a = curAction();
    if (a?.kind !== "tap") return;
    a.onDo?.(); completeAction();
  }
  canvas.addEventListener("click", (e) => {
    if (!guided || s.done) return;
    const a = curAction();
    if (a?.kind !== "tap") return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hx = a.hot.x + (isTruck(a.hot) ? s.sc.truckOff : 0);
    if (Math.hypot(x - hx, y - a.hot.y) <= a.hot.r + 8) doTap();
    else flash("Not there. Look for the glowing ring.");
  });
  const isTruck = (h) => h.y < WALL_Y - 8 && h.x < 310;

  // ---------- drawing ----------
  const ctx = canvas.getContext("2d");
  let scale = 1, dpr = 1;
  let colors = {};
  function readColors() {
    const c = getComputedStyle(container);
    const v = (n, d) => c.getPropertyValue(n).trim() || d;
    colors = { ink: v("--ink", "#221616"), muted: v("--muted", "#6e5a5a"), line: v("--line", "#e2dcdc"), surface: v("--surface", "#fff"), red: v("--red", "#d0021b") };
  }
  function resize() {
    // Keep the picture to ~40% of the screen height so the controls stay reachable below it.
    const w = Math.min(container.clientWidth, 560, (window.innerHeight * (guided ? 0.33 : 0.4) * W) / H);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    scale = w / W;
    canvas.style.width = `${w}px`; canvas.style.height = `${H * scale}px`;
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    readColors();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function label(text, x, y, opts = {}) {
    ctx.save(); ctx.fillStyle = opts.color || colors.muted; ctx.font = `${opts.weight || 600} ${opts.size || 10}px Barlow, system-ui, sans-serif`;
    ctx.textAlign = opts.align || "center"; ctx.textBaseline = "middle";
    if (opts.rotate) { ctx.translate(x, y); ctx.rotate(opts.rotate); ctx.fillText(text, 0, 0); } else ctx.fillText(text, x, y);
    ctx.restore();
  }

  function draw() {
    const sc = s.sc;
    const now = performance.now();
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- outside ---
    ctx.fillStyle = colors.surface; ctx.fillRect(0, 0, W, WALL_Y);
    if (guided) {
      // power disconnect on the fan house and the cord to the machine
      roundRect(DISC.x, DISC.y, DISC.w, DISC.h, 3); ctx.fillStyle = "#5b6266"; ctx.fill();
      label("PWR", DISC.x + DISC.w / 2, DISC.y + DISC.h / 2, { size: 8, color: "#fff", weight: 700 });
      if (sc.cord) {
        ctx.strokeStyle = "#1c1f21"; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(DISC.x + DISC.w / 2, DISC.y); ctx.quadraticCurveTo(DISC.x + 8, MACHINE.y + MACHINE.h + 14, MACHINE.x + 40 + sc.truckOff, MACHINE.y + MACHINE.h); ctx.stroke();
      }
      if (sc.extinguisher) {
        roundRect(329, 140, 11, 26, 4); ctx.fillStyle = "#d0021b"; ctx.fill();
        ctx.fillStyle = "#1c1f21"; ctx.fillRect(331, 136, 7, 5);
      }
      if (sc.notice) {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#d0021b"; ctx.lineWidth = 1.5; ctx.fillRect(96, 176, 40, 16); ctx.strokeRect(96, 176, 40, 16);
        label("NOTICE", 116, 184, { size: 8, color: "#d0021b", weight: 700 });
      }
    }

    ctx.save(); ctx.translate(sc.truckOff, 0);
    ctx.fillStyle = colors.line; ctx.fillRect(10, 168, 300, 6);
    label("Application truck", 160, 184, { size: 10 });
    // pellet bag
    ctx.save(); ctx.translate(BAG.x + 22, BAG.y + 26);
    ctx.rotate(s.pourTimer > 0 ? -0.9 : 0);
    roundRect(-18, -24, 40, 50, 6); ctx.fillStyle = "#e9dcc0"; ctx.fill(); ctx.strokeStyle = "#a08a5c"; ctx.lineWidth = 1.5; ctx.stroke();
    label("CIPC", 2, -4, { size: 9, color: "#6b5a33", weight: 700 }); label("pellets", 2, 7, { size: 8, color: "#6b5a33" });
    ctx.restore();
    // melter
    roundRect(MELTER.x, MELTER.y, MELTER.w, MELTER.h, 6);
    ctx.fillStyle = "#cfd5d8"; ctx.fill(); ctx.strokeStyle = "#7d878c"; ctx.lineWidth = 2; ctx.stroke();
    const total = s.solid + s.liquid;
    const fillH = (total / MAX_LBS) * (MELTER.h - 16);
    if (fillH > 0) {
      const top = MELTER.y + MELTER.h - 6 - fillH;
      ctx.fillStyle = "#d99a1e"; ctx.fillRect(MELTER.x + 6, top, MELTER.w - 12, fillH);
      const sh = (s.solid / Math.max(total, 0.001)) * fillH;
      if (sh > 0.5) {
        ctx.fillStyle = "#f2d38a";
        for (let i = 0; i < (MELTER.w - 12) / 6; i++) for (let j = 0; j < sh / 5; j++) {
          ctx.beginPath(); ctx.arc(MELTER.x + 9 + i * 6, top + 2 + j * 5, 2.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.fillStyle = total > 0 ? "rgba(208,2,27,.55)" : "rgba(0,0,0,.15)"; ctx.fillRect(MELTER.x + 6, MELTER.y + MELTER.h - 6, MELTER.w - 12, 3);
    label("MELTER", MELTER.x + MELTER.w / 2, MELTER.y - 9, { size: 11, color: colors.ink, weight: 700 });
    if (total < 19.5 && (!guided || gi >= 6)) label("Low", MELTER.x + MELTER.w / 2, MELTER.y + 18, { color: colors.red, weight: 700, size: 11 });
    ctx.restore();

    ctx.fillStyle = "#f2d38a";
    for (const p of pellets) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill(); }

    ctx.save(); ctx.translate(sc.truckOff, 0);
    // pump line
    ctx.strokeStyle = "#7d878c"; ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(MELTER.x + MELTER.w, MELTER.y + MELTER.h - 10); ctx.lineTo(MACHINE.x, MELTER.y + MELTER.h - 10); ctx.stroke();
    const flowing = (s.pump && s.liquid > 0) || s.solvent > 0;
    if (flowing) {
      ctx.strokeStyle = s.solvent > 0 ? "#8fd3ff" : "#d99a1e"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -now / 40;
      ctx.beginPath(); ctx.moveTo(MELTER.x + MELTER.w, MELTER.y + MELTER.h - 10); ctx.lineTo(MACHINE.x, MELTER.y + MELTER.h - 10); ctx.stroke();
      ctx.setLineDash([]);
    }
    roundRect(PUMP.x, PUMP.y, PUMP.w, PUMP.h, 4); ctx.fillStyle = s.pumpDir === "forward" ? "#2f6b3a" : s.pumpDir === "reverse" ? "#9a6b00" : "#5b6266"; ctx.fill();
    label(s.pumpDir === "reverse" ? "REV" : "PUMP", PUMP.x + PUMP.w / 2, PUMP.y + PUMP.h / 2, { size: 9, color: "#fff", weight: 700 });
    // machine
    roundRect(MACHINE.x, MACHINE.y, MACHINE.w, MACHINE.h, 6); ctx.fillStyle = "#3a3f42"; ctx.fill();
    label("SPROUT-NIP", MACHINE.x + MACHINE.w / 2, MACHINE.y - 9, { size: 11, color: colors.ink, weight: 700 });
    const blowing = s.blower || s.blowerTest > 0;
    ctx.save(); ctx.translate(MACHINE.x + 18, MACHINE.y + 20); ctx.rotate(blowing ? now / 60 : 0);
    ctx.strokeStyle = blowing ? "#9fd3a8" : "#7d878c"; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 0); ctx.stroke(); }
    ctx.restore();
    if (s.spark) { ctx.fillStyle = "#ffe066"; ctx.beginPath(); ctx.arc(MACHINE.x + 18, MACHINE.y + 46, 2 + Math.random() * 2, 0, Math.PI * 2); ctx.fill(); }
    roundRect(MACHINE.x + 36, MACHINE.y + 10, 30, 42, 4); ctx.fillStyle = "#1c1f21"; ctx.fill();
    if (s.burner) {
      const fh = clamp((s.T - 70) / 700, 0.15, 1.2) * 34;
      const g = ctx.createLinearGradient(0, MACHINE.y + 50, 0, MACHINE.y + 50 - fh);
      g.addColorStop(0, "#2a6cff"); g.addColorStop(0.35, "#ff9d00"); g.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(MACHINE.x + 40, MACHINE.y + 50); ctx.quadraticCurveTo(MACHINE.x + 51 + Math.sin(now / 90) * 3, MACHINE.y + 50 - fh * 1.3, MACHINE.x + 62, MACHINE.y + 50); ctx.fill();
    }
    roundRect(MACHINE.x + 70, MACHINE.y + 16, 30, 30, 4); ctx.fillStyle = "#0e1112"; ctx.fill();
    label(`${Math.round(s.T)}`, MACHINE.x + 85, MACHINE.y + 27, { size: 11, weight: 700, color: tempOk() ? "#7CFC9A" : s.T > 500 ? "#ffcc33" : "#ff6b6b" });
    label("°F", MACHINE.x + 85, MACHINE.y + 39, { size: 8, color: "#9aa3a7" });
    if (sc.thermometer) { ctx.strokeStyle = "#e6e6e6"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(MACHINE.x + MACHINE.w - 4, MACHINE.y + 24); ctx.lineTo(MACHINE.x + MACHINE.w + 6, MACHINE.y + 8); ctx.stroke(); ctx.fillStyle = "#e6e6e6"; ctx.beginPath(); ctx.arc(MACHINE.x + MACHINE.w + 7, MACHINE.y + 6, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    // fogging tube or bare port
    if (sc.tube) {
      ctx.strokeStyle = "#b9c0c4"; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.beginPath();
      ctx.moveTo(MACHINE.x + MACHINE.w + sc.truckOff, MACHINE.y + 31); ctx.lineTo(OUTLET.x, MACHINE.y + 31); ctx.lineTo(OUTLET.x, OUTLET.y); ctx.stroke(); ctx.lineCap = "butt";
      ctx.fillStyle = "#8a6d3b"; ctx.fillRect(OUTLET.x - 9, WALL_Y - 5, 18, 10);
    }

    // --- inside ---
    ctx.fillStyle = "#2b2422"; ctx.fillRect(0, WALL_Y, W, H - WALL_Y);
    ctx.fillStyle = "#8f8a87"; ctx.fillRect(0, WALL_Y - 3, W, 6);
    if (!sc.tube) {
      ctx.fillStyle = sc.portCap ? "#5b6266" : "#1c1f21"; ctx.strokeStyle = "#cfc6c2"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PORT.x, PORT.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      label(sc.portCap ? "Port capped" : "Fogging port", PORT.x, WALL_Y - 20, { size: 8, color: colors.muted });
    }
    label("Storage wall", guided ? 108 : 200, WALL_Y + 12, { size: 9, color: "#cfc6c2" });
    if (guided) {
      roundRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 4); ctx.fillStyle = "#4b5458"; ctx.fill();
      label("PANEL", PANEL.x + PANEL.w / 2, PANEL.y + 9, { size: 8, color: "#fff", weight: 700 });
      const lamp = sc.panel === "off" ? "#ff6b6b" : sc.panel === "set" ? "#ffcc33" : "#7CFC9A";
      for (let k = 0; k < 4; k++) { ctx.fillStyle = lamp; ctx.fillRect(PANEL.x + 6 + k * 11, PANEL.y + 20, 6, 8); }
      // light bulb
      ctx.fillStyle = sc.lights ? "#ffe066" : "#5b6266"; ctx.beginPath(); ctx.arc(BULB.x, BULB.y, 6, 0, Math.PI * 2); ctx.fill();
      if (sc.lights) { ctx.fillStyle = "rgba(255,224,102,.12)"; ctx.beginPath(); ctx.arc(BULB.x, BULB.y, 20, 0, Math.PI * 2); ctx.fill(); }
      label("Light", BULB.x + 18, BULB.y, { size: 8, color: "#cfc6c2", align: "left" });
    }
    // fan house
    roundRect(254, WALL_Y + 12, 96, PLENUM.y - WALL_Y - 12, 4); ctx.fillStyle = "#3a312e"; ctx.fill();
    label("Fan house", 280, WALL_Y + 22, { size: 9, color: "#cfc6c2", align: "left" });
    if (guided) {
      ctx.fillStyle = "#6f8f9a"; ctx.fillRect(CLIMA.x, CLIMA.y, CLIMA.w, CLIMA.h);
      label("CLIMACELL", CLIMA.x + CLIMA.w / 2, CLIMA.y + CLIMA.h / 2, { size: 6.5, color: "#fff", weight: 700, rotate: -Math.PI / 2 });
      ctx.fillStyle = sc.climaOpen ? "#ffcc33" : "#8f8a87";
      ctx.fillRect(CLIMA.x + CLIMA.w + 2, sc.climaOpen ? CLIMA.y - 4 : CLIMA.y + 20, 4, 22);
    }
    const fanRun = sc.fansPower ? s.fpm : 0;
    ctx.save(); ctx.translate(FAN.x, FAN.y);
    ctx.strokeStyle = "#8f8a87"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, FAN.r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(s.fanAngle); ctx.fillStyle = "#cfd5d8";
    for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.ellipse(FAN.r * 0.5, 0, FAN.r * 0.5, 6, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#5b6266"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (sc.guard) {
      ctx.strokeStyle = "rgba(220,220,220,.8)"; ctx.lineWidth = 1;
      for (let k = -24; k <= 24; k += 6) { ctx.beginPath(); ctx.moveTo(FAN.x + k, FAN.y - 26); ctx.lineTo(FAN.x + k, FAN.y + 26); ctx.stroke(); ctx.beginPath(); ctx.moveTo(FAN.x - 26, FAN.y + k); ctx.lineTo(FAN.x + 26, FAN.y + k); ctx.stroke(); }
    }
    label(`${fanRun} fpm`, FAN.x, FAN.y + FAN.r + 11, { align: "center", size: 10, weight: 700, color: fanOk() && fanRun ? "#7CFC9A" : fanRun === 0 ? "#cfc6c2" : "#ffcc33" });

    // storage floor
    ctx.fillStyle = "#3d322b"; ctx.fillRect(STORE.x, STORE.y, STORE.w, STORE.h);
    for (const p of potatoes) {
      ctx.fillStyle = p.shade > 0.5 ? "#b88a52" : "#a3773f";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, p.a, 0, Math.PI * 2); ctx.fill();
    }
    DUCT_Y.forEach((y, i) => {
      const c = s.cov[i];
      const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, "rgba(235,240,245,0)"); g.addColorStop(0.5, `rgba(235,240,245,${0.55 * c})`); g.addColorStop(1, "rgba(235,240,245,0)");
      ctx.fillStyle = g; ctx.fillRect(STORE.x, y - 22, STORE.w, 44);
      ctx.fillStyle = "rgba(20,16,15,.75)"; ctx.fillRect(STORE.x + 6, y - 4, STORE.w - 4, 8);
      ctx.fillStyle = c >= 1 ? "#7CFC9A" : "#cfc6c2";
      for (let x = STORE.x + 14; x < STORE.x + STORE.w; x += 12) ctx.fillRect(x, y - 1, 4, 2);
      if (DUCT_NAMES[i]) label(DUCT_NAMES[i], STORE.x + 8, y - 12, { size: 9, align: "left", color: "#efe7e2", weight: 700 });
      label(`${Math.floor(c * 100)}%`, STORE.x + STORE.w - 8, y - 12, { size: 9, align: "right", color: c >= 1 ? "#7CFC9A" : "#efe7e2", weight: 700 });
    });
    if (sc.flag) {
      ctx.strokeStyle = "#efe7e2"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(PILE.x, PILE.y + 8); ctx.lineTo(PILE.x, PILE.y - 14); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(PILE.x, PILE.y - 14); ctx.lineTo(PILE.x + 12, PILE.y - 10); ctx.lineTo(PILE.x, PILE.y - 6); ctx.fill();
    }
    // plenum
    ctx.fillStyle = "#4a3f3b"; ctx.fillRect(PLENUM.x, PLENUM.y, PLENUM.w, PLENUM.h);
    ctx.strokeStyle = "#8f8a87"; ctx.lineWidth = 1.5; ctx.strokeRect(PLENUM.x, PLENUM.y, PLENUM.w, PLENUM.h);
    label("PLENUM", PLENUM.x + PLENUM.w / 2, PLENUM.y + PLENUM.h / 2, { size: 11, color: "#cfc6c2", weight: 700, rotate: -Math.PI / 2 });
    if (guided) {
      ctx.fillStyle = "#7d878c"; ctx.fillRect(COILS.x, COILS.y, COILS.w, COILS.h);
      ctx.strokeStyle = "#4a3f3b"; ctx.lineWidth = 1; for (let x = COILS.x + 3; x < COILS.x + COILS.w; x += 4) { ctx.beginPath(); ctx.moveTo(x, COILS.y + 1); ctx.lineTo(x, COILS.y + COILS.h - 1); ctx.stroke(); }
      label("COILS", COILS.x + COILS.w / 2, COILS.y + COILS.h / 2, { size: 7, color: "#fff", weight: 700 });
      ctx.fillStyle = sc.refrigOpen ? "#ffcc33" : "#8f8a87"; ctx.fillRect(COILS.x + COILS.w - 2, sc.refrigOpen ? COILS.y + 14 : COILS.y, 3, 12);
      // plenum end bypass
      ctx.fillStyle = sc.plenumBypassClosed ? "#8f8a87" : "#ffcc33";
      ctx.fillRect(PLENUM.x + 8, PLENUM.y + PLENUM.h - 6, PLENUM.w - 16, 4);
      if (!sc.plenumBypassClosed) label("Bypass open", PLENUM.x + PLENUM.w / 2, PLENUM.y + PLENUM.h - 14, { size: 7, color: "#ffcc33", weight: 700 });
    }
    if (fanRun > 0) {
      const ry = PLENUM.y + Math.min(reach(), PLENUM.h - 6);
      ctx.strokeStyle = fanOk() ? "rgba(124,252,154,.7)" : "rgba(255,204,51,.8)"; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(PLENUM.x + 2, ry); ctx.lineTo(PLENUM.x + PLENUM.w - 2, ry); ctx.stroke(); ctx.setLineDash([]);
    }

    for (const f of fog) {
      const a = 0.42 * Math.min(1, f.life * 3) * (1 - f.life / f.max);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(240,244,248,${a})`); g.addColorStop(1, "rgba(240,244,248,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#d99a1e";
    for (const d of drips) { ctx.beginPath(); ctx.arc(d.x, d.y, 2, 0, Math.PI * 2); ctx.fill(); }
    if (s.recirc > 0) label(`Recirculating… ${Math.round(45 - (s.recirc / 3) * 45)} min`, 150, 360, { size: 14, color: "#fff", weight: 700 });

    if (sc.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${0.6 * sc.dim})`; ctx.fillRect(0, WALL_Y + 3, W, H - WALL_Y); }

    // Glowing ring on the next thing to tap.
    if (guided && !s.done) {
      const a = curAction();
      if (a?.kind === "tap") {
        const hx = a.hot.x + (isTruck(a.hot) ? sc.truckOff : 0);
        const pulse = (Math.sin(now / 250) + 1) / 2;
        ctx.strokeStyle = `rgba(255,214,0,${0.55 + 0.45 * pulse})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(hx, a.hot.y, Math.min(a.hot.r, 34) * (0.8 + 0.2 * pulse), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // ---------- UI sync ----------
  function syncUi() {
    const lbs = s.solid + s.liquid + s.pending;
    lbsOut.textContent = `Melter: ${Math.round(lbs)} lbs`;
    lbsOut.classList.toggle("low", lbs < 20);
    pourBtn.disabled = s.done || lbs > MAX_LBS - POUR_LBS + 0.01;
    for (const k of ["blower", "spark", "burner"]) sw[k].setAttribute("aria-pressed", String(s[k]));
    pumpBtn.setAttribute("aria-pressed", String(s.pumpDir === "forward"));
    pumpBtn.textContent = s.pumpDir === "forward" ? "Pump: Forward" : s.pumpDir === "reverse" ? "Pump: Reverse" : "Pump: Off";
    tempOut.textContent = `${s.setT}°F`;
    const tGoal = guided && cur()?.n === 16 ? 750 : 650;
    tempOut.classList.toggle("off", Math.abs(s.setT - tGoal) > 50);
    fanOut.textContent = `${s.fpm} fpm`;
    fanOut.classList.toggle("off", !fanOk());
    if (Number(fanIn.value) !== s.fpm) fanIn.value = String(s.fpm);
    const total = s.cov.reduce((a, b) => a + b, 0) / s.cov.length;
    covPct.textContent = `${Math.floor(total * 100)}%`;
    covBars.forEach((b, i) => { b.firstChild.style.width = `${s.cov[i] * 100}%`; });
    if (!guided) {
      const h = hintText();
      if (hint.textContent !== h) hint.textContent = h;
    } else {
      if (fanCardEls && document.contains(fanCardEls.out)) {
        const [f, m, e] = anemo();
        const txt = `Front ${f} · Middle ${m} · End ${e} fpm`;
        if (txt !== lastAnemo) {
          lastAnemo = txt;
          fanCardEls.out.replaceChildren(...[["Front", f], ["Middle", m], ["End", e]].map(([n, v]) =>
            el("span", { class: v >= 250 && v <= 350 ? "ok" : "" }, el("small", {}, n), `${v}`)));
        }
      }
      let fl = card.querySelector(".sng-card-flash");
      if (s.flashT > 0 && s.flash) {
        if (!fl) { fl = el("p", { class: "sng-card-flash", role: "alert" }); card.querySelector(".sng-card-text")?.after(fl); }
        if (fl && fl.textContent !== s.flash) fl.textContent = s.flash;
      } else if (fl) fl.remove();
    }
  }

  // ---------- loop ----------
  let raf = 0, last = performance.now(), uiAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (s.solvent > 0) s.solvent -= dt;
    step(dt); draw();
    uiAcc += dt; if (uiAcc > 0.1) { uiAcc = 0; syncUi(); }
    raf = requestAnimationFrame(frame);
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  window.addEventListener("resize", resize);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", readColors);
  if (guided) startGuided();
  resize(); syncUi(); raf = requestAnimationFrame(frame);

  return {
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", resize); mq.removeEventListener?.("change", readColors); ui.remove(); },
    _state: () => s,
    _guide: () => ({ gi, ai, n: cur()?.n, kind: curAction()?.kind }),
  };
}
