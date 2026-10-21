// Records the demo video against a running stack (docker compose up, web on :5173).
// Usage: PUPPETEER_CORE_PATH=/path/to/puppeteer-core node scripts/demo-video.mjs
// Output: docs/demo.mp4 and docs/demo.gif. Each scene is captured as steady screenshots (pauses between
// LLM calls, needed on free-tier token limits, are not recorded) and joined with ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE_PATH ?? "puppeteer-core");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";
const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const PACE_MS = Number(process.env.PACE_MS ?? 45000);
const DOCS = new URL("../docs/", import.meta.url).pathname;
mkdirSync(DOCS, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "saw-demo-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"], protocolTimeout: 300000, defaultViewport: { width: 1280, height: 760, deviceScaleFactor: 1 } });
const clips = [];

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:9999;background:rgba(17,24,39,.92);color:#fff;padding:8px 16px;border-radius:999px;font:600 14px -apple-system,Segoe UI,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:90%;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

// Frames come from the browser's screencast (pushed whenever the page changes). Time spent waiting for the LLM
// is shortened (at most 0.3 s per frame gap); typing and deliberate holds keep their real timing.
const holds = [];
const hold = async (ms) => {
  const s = Date.now();
  await sleep(ms);
  holds.push({ s, e: Date.now() });
};
const frames = [];
async function clip(page, name, fn) {
  const client = await page.createCDPSession();
  const mine = [];
  client.on("Page.screencastFrame", (f) => {
    mine.push({ buf: Buffer.from(f.data, "base64"), t: Date.now() });
    client.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 760, everyNthFrame: 1 });
  try {
    await fn();
  } finally {
    await hold(400);
    await client.send("Page.stopScreencast").catch(() => undefined);
    await client.detach().catch(() => undefined);
  }
  const end = Date.now();
  mine.forEach((f, i) => {
    const next = mine[i + 1]?.t ?? end;
    const held = holds.reduce((sum, h) => sum + Math.max(0, Math.min(h.e, next) - Math.max(h.s, f.t)), 0);
    const rest = Math.max(0, next - f.t - held);
    frames.push({ buf: f.buf, dur: (held + Math.min(rest, 300)) / 1000 });
  });
  console.log("clip", name, mine.length, "frames");
}

async function login(page, user) {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await hold(1600);
  await page.click("button.btn.primary");
  await page.waitForSelector("#username");
  await page.type("#username", user, { delay: 60 });
  await page.type("#password", user, { delay: 60 });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#kc-login")]);
  await page.waitForSelector(".sidebar");
}

async function ask(page, text, waitFor = ".answer") {
  await page.waitForSelector("textarea:not([disabled])");
  await page.type("textarea", text, { delay: 28 });
  await sleep(300);
  await page.keyboard.press("Enter");
  await page.waitForSelector(waitFor, { timeout: 240000 });
  await hold(1920);
}
const clickText = (page, selector, text) =>
  page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent?.trim() === t || b.textContent?.includes(t))?.click(), selector, text);
const newChat = async (page) => {
  await clickText(page, "button", "New chat");
  await sleep(500);
};

// Viewer
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await clip(page, "1-viewer-read", async () => {
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await caption(page, "Sign in with Keycloak (PKCE) as the sample user: viewer");
    await hold(2880);
    await login(page, "viewer");
    await caption(page, "Read question: the agent calls SecureMCP with the viewer's own token");
    await ask(page, "List the pending orders");
    await hold(4000);
  });
  await sleep(PACE_MS);
  await clip(page, "2-knowledge", async () => {
    await newChat(page);
    await caption(page, "Knowledge question: hybrid search (full-text + vector) with citations");
    await ask(page, "What is the return policy for keyboards?");
    await page.evaluate(() => document.querySelector(".cite")?.click());
    await hold(5600);
  });
  await sleep(PACE_MS);
  await clip(page, "3-viewer-write", async () => {
    await newChat(page);
    await caption(page, "A write waits for human approval (LangGraph interrupt)");
    await ask(page, "Mark order 17 as shipped", ".approval");
    await hold(4000);
    await caption(page, "Approve it as a viewer: SecureMCP still refuses (role check)");
    await clickText(page, ".approval button", "Approve");
    await page.waitForSelector(".answer", { timeout: 240000 });
    await page.evaluate(() => [...document.querySelectorAll(".step-head")].find((b) => b.textContent?.includes("update_order_status"))?.click());
    await hold(5600);
  });
  await ctx.close();
}

// Admin
{
  await sleep(PACE_MS);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await clip(page, "4-admin-write", async () => {
    await caption(page, "Now as admin");
    await login(page, "admin");
    await caption(page, "Same request as admin: approval, then it goes through");
    await ask(page, "Mark order 12 as shipped", ".approval");
    await hold(3520);
    await clickText(page, ".approval button", "Approve");
    await page.waitForSelector(".answer", { timeout: 240000 });
    await hold(4800);
  });
  await clip(page, "5-traces", async () => {
    await clickText(page, ".nav a", "Traces");
    await page.waitForSelector(".span-row");
    await caption(page, "Every run is traced: guardrails, LLM calls, tools, retrieval, tokens and cost estimates");
    await hold(8000);
  });
  await ctx.close();
}
await browser.close();

import { writeFileSync as wf } from "node:fs";
const lines = [];
frames.forEach((f, i) => {
  const file = join(tmp, `f${String(i).padStart(5, "0")}.jpg`);
  wf(file, f.buf);
  lines.push(`file '${file}'`, `duration ${f.dur.toFixed(3)}`);
});
lines.push(`file '${join(tmp, `f${String(frames.length - 1).padStart(5, "0")}.jpg`)}'`);
const list = join(tmp, "list.txt");
wf(list, lines.join("\n"));
const mp4 = join(DOCS, "demo.mp4");
execFileSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=15,scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "29", "-preset", "slow", "-movflags", "+faststart", "-an", mp4], { stdio: "ignore" });
execFileSync(FFMPEG, ["-y", "-i", mp4, "-vf", "fps=9,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", join(DOCS, "demo.gif")], { stdio: "ignore" });
console.log("done");
