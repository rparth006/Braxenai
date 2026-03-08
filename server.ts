import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("guardian.db");
const JWT_SECRET = process.env.JWT_SECRET || "braxenai-super-secret-key";

// Initialize DB with Auth tables
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT,
    size TEXT,
    industry TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'analyst',
    org_id TEXT,
    device_fingerprint TEXT,
    is_verified INTEGER DEFAULT 0,
    otp_code TEXT,
    otp_expires DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    last_ip TEXT,
    failed_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    FOREIGN KEY(org_id) REFERENCES organizations(id)
  );
`);

// Migration: Ensure all columns exist in users table
const expectedColumns = [
  { name: 'full_name', type: 'TEXT' },
  { name: 'org_id', type: 'TEXT' },
  { name: 'device_fingerprint', type: 'TEXT' },
  { name: 'is_verified', type: 'INTEGER DEFAULT 0' },
  { name: 'otp_code', type: 'TEXT' },
  { name: 'otp_expires', type: 'DATETIME' },
  { name: 'last_ip', type: 'TEXT' },
  { name: 'failed_attempts', type: 'INTEGER DEFAULT 0' },
  { name: 'locked_until', type: 'DATETIME' }
];

for (const col of expectedColumns) {
  try {
    db.prepare(`SELECT ${col.name} FROM users LIMIT 1`).get();
  } catch (e) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
      console.log(`[DB] Migration: Added ${col.name} column to users table`);
    } catch (err) {
      console.error(`[DB] Migration failed for ${col.name}:`, err);
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    token TEXT,
    device_info TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    risk_score REAL,
    is_deepfake INTEGER,
    heart_rate INTEGER,
    liveness_score REAL,
    anomalies TEXT,
    ai_assessment TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Middleware to verify JWT
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { fullName, email, password, deviceInfo } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = Math.random().toString(36).substring(7);

    try {
      db.prepare("INSERT INTO users (id, full_name, email, password, device_fingerprint, role) VALUES (?, ?, ?, ?, ?, ?)")
        .run(userId, fullName, email, hashedPassword, deviceInfo?.fingerprint, 'admin');

      // Audit log
      db.prepare("INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)")
        .run(Math.random().toString(36).substring(7), userId, "REGISTER", `User ${fullName} registered`);

      res.json({ success: true });
    } catch (e) {
      console.error("Registration error:", e);
      res.status(400).json({ error: "User already exists or registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password, deviceInfo } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;

    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    
    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: "Account locked. Try again later." });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const attempts = user.failed_attempts + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, lockUntil, user.id);
      } else {
        db.prepare("UPDATE users SET failed_attempts = ? WHERE id = ?").run(attempts, user.id);
      }
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Reset failed attempts and update login
    db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_ip = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?")
      .run(ip, user.id);

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
    
    // Record session
    const sessionId = Math.random().toString(36).substring(7);
    db.prepare("INSERT INTO sessions (id, user_id, token, device_info) VALUES (?, ?, ?, ?)").run(sessionId, user.id, token, JSON.stringify(deviceInfo));

    // Audit log
    db.prepare("INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)")
      .run(Math.random().toString(36).substring(7), user.id, "LOGIN_SUCCESS", `Login verified from ${deviceInfo?.browser || "unknown"}`);

    res.json({ token, user: { id: user.id, email: user.email, role: user.role, last_login: user.last_login } });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (user) {
      // In real app, send reset link.
      db.prepare("INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)")
        .run(Math.random().toString(36).substring(7), user.id, "PASSWORD_RESET_REQ", "Password reset requested");
    }
    res.json({ message: "If an account exists, a reset link has been sent." });
  });

  app.get("/api/auth/me", authenticate, (req: any, res) => {
    const user = db.prepare("SELECT id, email, role, last_login FROM users WHERE id = ?").get(req.user.id);
    res.json(user);
  });

  // Protected Scan Routes
  app.get("/api/scans", authenticate, (req: any, res) => {
    const scans = db.prepare("SELECT * FROM scans WHERE user_id = ? OR ? = 'admin' ORDER BY timestamp DESC LIMIT 50")
      .all(req.user.id, req.user.role);
    res.json(scans);
  });

  app.post("/api/scans", authenticate, (req: any, res) => {
    const { id, risk_score, is_deepfake, heart_rate, liveness_score, anomalies, ai_assessment } = req.body;
    const stmt = db.prepare(`
      INSERT INTO scans (id, user_id, risk_score, is_deepfake, heart_rate, liveness_score, anomalies, ai_assessment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, req.user.id, risk_score, is_deepfake ? 1 : 0, heart_rate, liveness_score, JSON.stringify(anomalies), ai_assessment);
    res.json({ success: true });
  });

  app.get("/api/stats", authenticate, (req: any, res) => {
    const total = db.prepare("SELECT COUNT(*) as count FROM scans WHERE user_id = ? OR ? = 'admin'").get(req.user.id, req.user.role) as any;
    const deepfakes = db.prepare("SELECT COUNT(*) as count FROM scans WHERE (user_id = ? OR ? = 'admin') AND is_deepfake = 1").get(req.user.id, req.user.role) as any;
    const avgRisk = db.prepare("SELECT AVG(risk_score) as avg FROM scans WHERE user_id = ? OR ? = 'admin'").get(req.user.id, req.user.role) as any;
    res.json({
      totalScans: total.count,
      deepfakeAttempts: deepfakes.count,
      averageRisk: avgRisk.avg || 0
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
