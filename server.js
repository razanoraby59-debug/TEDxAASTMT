/* local-server.js — zero-dependency local dev server for TEDxAASTMT.
   Run: node local-server.js   then open http://localhost:5000/register.html
   No MongoDB, no .env, no npm install. Stores registrations in registrations.json.
   For production / Vercel keep using your original server.js. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "registrations.json");
const EVENT_CAPACITY = 150;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadRegistrations() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveRegistrations(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-checkin-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function newTicketFields() {
  return {
    ticketToken: crypto.randomBytes(24).toString("hex"),
    ticketId: "TDX-" + crypto.randomBytes(4).toString("hex").toUpperCase()
  };
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/") rel = "/register.html";

  const candidates = [
    path.join(PUBLIC_DIR, rel),
    path.join(ROOT, rel)
  ];

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(ROOT)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(resolved).pipe(res);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-checkin-key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && urlPath === "/status") {
    return sendJSON(res, 200, { status: "online", message: "TEDxAASTMT local server is running." });
  }

  if (req.method === "GET" && urlPath === "/event-status") {
    const list = loadRegistrations();
    const active = list.filter((r) => r.status === "registered" || r.status === "checked_in");
    const checkedIn = list.filter((r) => r.status === "checked_in");
    const remaining = Math.max(EVENT_CAPACITY - active.length, 0);
    return sendJSON(res, 200, {
      registeredCount: active.length,
      seatsRemaining: remaining,
      checkedInCount: checkedIn.length,
      registrationOpen: remaining > 0,
      eventDate: null,
      eventTime: null,
      location: null
    });
  }

  if (req.method === "POST" && urlPath === "/register") {
    const body = await readBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const regNo = typeof body.registration_number === "string" ? body.registration_number.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";

    if (!name || !regNo || !email) return sendJSON(res, 400, { message: "Please fill in all fields." });
    if (!["AbuQir", "Miami", "Alamein"].includes(branch)) return sendJSON(res, 400, { message: "Please select your branch." });
    if (name.length < 3 || name.length > 120) return sendJSON(res, 400, { message: "Please enter your full name." });
    if (!/^\d{9}$/.test(regNo)) return sendJSON(res, 400, { message: "Registration number must be exactly 9 digits." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return sendJSON(res, 400, { message: "Please enter a valid email address." });

    const list = loadRegistrations();
    if (list.some((r) => r.email === email)) return sendJSON(res, 400, { message: "This email is already registered." });
    if (list.some((r) => r.registration_number === regNo)) return sendJSON(res, 400, { message: "This registration number is already registered." });

    const active = list.filter((r) => r.status === "registered" || r.status === "checked_in");
    if (active.length >= EVENT_CAPACITY) return sendJSON(res, 400, { message: "Sorry, all seats are full." });

    const registration = {
      name,
      registration_number: regNo,
      email,
      branch,
      status: "registered",
      registeredAt: new Date().toISOString(),
      checkedInAt: null,
      ...newTicketFields()
    };
    list.push(registration);
    saveRegistrations(list);

    return sendJSON(res, 201, {
      message: "Seat reserved successfully!",
      registration: {
        name: registration.name,
        registration_number: registration.registration_number,
        email: registration.email,
        branch: registration.branch,
        ticketId: registration.ticketId,
        ticketToken: registration.ticketToken
      }
    });
  }

  if (req.method === "POST" && urlPath === "/api/checkin") {
    const body = await readBody(req);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^[a-f0-9]{48}$/.test(token)) {
      return sendJSON(res, 400, { result: "invalid", message: "This is not a valid TEDxAASTMT ticket." });
    }
    const list = loadRegistrations();
    const reg = list.find((r) => r.ticketToken === token);
    if (!reg) return sendJSON(res, 404, { result: "invalid", message: "Ticket not found." });
    if (reg.status === "checked_in") {
      return sendJSON(res, 409, { result: "already_used", message: "This ticket has already been used.", name: reg.name, ticketId: reg.ticketId, checkedInAt: reg.checkedInAt });
    }
    if (reg.status !== "registered") {
      return sendJSON(res, 403, { result: "invalid", message: "This ticket is not valid.", name: reg.name, ticketId: reg.ticketId });
    }
    reg.status = "checked_in";
    reg.checkedInAt = new Date().toISOString();
    saveRegistrations(list);
    return sendJSON(res, 200, { result: "ok", message: "Check-in successful.", name: reg.name, ticketId: reg.ticketId });
  }

  if (req.method === "GET") {
    return serveStatic(req, res, urlPath);
  }

  sendJSON(res, 405, { message: "Method not allowed." });
});

server.listen(PORT, () => {
  console.log("TEDxAASTMT local server running on http://localhost:" + PORT);
  console.log("Open http://localhost:" + PORT + "/register.html");
});
