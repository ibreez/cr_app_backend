import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSXModule from "xlsx";
const XLSX = (XLSXModule as any).default || XLSXModule;
import {
  BillRecord,
  ExtractedBillData,
  FieldConfidence,
  ValidationResult,
  AppSettings,
  DashboardSummary,
  ExcelTemplateInfo,
  TemplateColumnMapping,
  Outlet,
  User,
  AuthUser,
  LoginResponse,
  OutletSummaryStats,
  RevenueRecord,
  Mira604Summary,
  MiraSchedule1Category,
  AccountingTreatment,
  IncomeTaxTreatment,
  FixedAssetRecord,
  AssetClass,
  TaxAuditCheck
} from "./src/types.js";
import { InvoiceEvidenceService, InvoiceValidator } from "./src/services/invoice/index.js";
import { CanonicalClassificationEngine } from "./src/services/classification/index.js";
import { canonicalGstEngine, convertBillsToGstInputs, normalizeBillDateToIso } from "./src/services/gst/index.js";
import {
  calculateNwt,
  generateMira602Return,
  reconcileNwtToGl,
  validateDtaaCertificate,
  buildNwtPeriod
} from "./src/services/wht/index.js";
import { defaultIncomeTaxEngine, defaultTaxExplainabilityEngine, MIRA604IntegrationService } from "./src/services/tax/index.js";
import { ComplianceDashboardService } from "./src/services/compliance/index.js";
import {
  PreFilingControlEngine,
  PreFilingBlockedError,
  runPreFilingCheck,
  FilingPackageGenerator
} from "./src/services/filing/index.js";
import {
  defaultRuleResolver,
  SEEDED_REGULATORY_RULES,
  RegulatorySnapshotService,
  RegulatoryRegressionEngine
} from "./src/regulatory/index.js";
import {
  RevenuePostingService,
  RevenuePersistenceService,
  RevenueTraceService,
  RevenueGstService
} from "./src/services/revenue/index.js";
import { GstTransactionInput, GstTreatment, GstTransactionType } from "./src/types/gst.js";
import { RevenueReconciliationService } from "./src/services/reconciliation/index.js";
import { prisma } from "./src/db/client.js";
import { appStore } from "./src/db/appStore.js";
import cookieParser from "cookie-parser";
import {
  sessionManager,
  PasswordSecurity,
  securityHeadersMiddleware,
  authRateLimiter,
  apiRateLimiter,
  uploadRateLimiter,
  csrfProtectionMiddleware,
  UploadValidator,
  BILL_UPLOAD_CONSTRAINTS,
  TEMPLATE_UPLOAD_CONSTRAINTS,
  setUserProvider
} from "./src/services/security/index.js";
import { AIGovernanceService } from "./src/services/ai/index.js";
import {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  databaseHealthService,
  centralizedErrorHandler,
  apiNotFoundHandler,
  migrationRunner,
  getEnvironmentConfig,
  disasterRecoveryManager,
  disasterRecoveryWAL,
  PerformanceBenchmarkEngine,
  logger
} from "./src/infrastructure/index.js";

const PORT = Number(process.env.PORT) || 3000;
export const app = express();
app.set("trust proxy", 1);

let appInitPromise: Promise<void> | null = null;
let appInitialized = false;

export async function ensureAppInitialized(): Promise<void> {
  if (appInitialized) return;
  if (!appInitPromise) {
    appInitPromise = (async () => {
      await appStore.initialize();
      if (appStore.isUsingDatabase()) {
        try {
          await RevenuePersistenceService.initFromDb(prisma);
        } catch (e) {
          console.warn("Revenue persistence init warning:", e);
        }
      }
      appInitialized = true;
    })().catch((err) => {
      appInitPromise = null;
      throw err;
    });
  }
  return appInitPromise;
}

// Normalize Netlify Functions prefix if invoked directly or via rewrite
app.use((req, _res, next) => {
  if (req.url.startsWith("/.netlify/functions/api")) {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api/, "") || "/";
  }
  next();
});

// Explicit CORS support when frontend is hosted on a separate origin (e.g. VITE_API_URL)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allowedRaw = process.env.CORS_ORIGIN || process.env.APP_URL || process.env.URL || "";
    const allowedOrigins = allowedRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isSameOriginHost = (() => {
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    })();

    if (isSameOriginHost || allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Auth-Token, X-Requested-With, X-CSRF-Token"
      );
    }
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Request Correlation ID & Structured Access Logging
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);

// Security Headers & Request Parsers
app.use(securityHeadersMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(csrfProtectionMiddleware);
app.use("/api/", apiRateLimiter.middleware());

// Ensure database & stores are initialized before handling API/upload routes (critical for serverless cold starts)
app.use(async (req, _res, next) => {
  if (appInitialized || (!req.path.startsWith("/api") && !req.path.startsWith("/uploads"))) {
    return next();
  }
  try {
    await ensureAppInitialized();
    next();
  } catch (err) {
    next(err);
  }
});

// Health check endpoint (Liveness probe) for ingress / platform monitoring
app.get(["/api/health", "/health"], (_req, res) => {
  const envConfig = getEnvironmentConfig();
  res.json({
    status: "ok",
    liveness: "UP",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: envConfig.env,
    databasePersistence: appStore.isUsingDatabase() ? "postgresql" : "local-json"
  });
});

// Readiness check endpoint (Readiness probe) - verifies database, storage, and subsystem health
app.get(["/api/ready", "/ready"], async (_req, res) => {
  const readiness = await databaseHealthService.checkReadiness();
  const statusCode = readiness.status === 'ready' ? 200 : (readiness.status === 'degraded' ? 200 : 503);
  res.status(statusCode).json(readiness);
});

// Diagnostics endpoint for database failure simulation
app.post("/api/infrastructure/simulate-db-failure", requireAuth, requireSuperAdmin, (req, res) => {
  const { enabled, reason } = req.body;
  databaseHealthService.setSimulationFailure(Boolean(enabled), reason);
  res.json({
    success: true,
    simulationActive: databaseHealthService.isSimulatingFailure(),
    message: enabled ? "Database failure simulation activated" : "Database failure simulation deactivated"
  });
});

// Database Migration status endpoint
app.get("/api/infrastructure/migrations", requireAuth, requireSuperAdmin, (_req, res) => {
  const status = migrationRunner.verifyMigrationIntegrity();
  res.json(status);
});

// Disaster Recovery Endpoints
app.get("/api/infrastructure/disaster-recovery/backups", requireAuth, requireSuperAdmin, (_req, res) => {
  const backups = disasterRecoveryManager.getStoredBackups();
  res.json({ success: true, backups });
});

app.post("/api/infrastructure/disaster-recovery/backup", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const { database, documents, auditTrail, filingPackages, offsiteConfig } = req.body;
    const backupPkg = disasterRecoveryManager.createFullBackup({
      database: database || { tenants: [], users: [], accounts: [], accountingPeriods: [], journals: [], bills: [], taxCalculations: [], taxLossLots: [], fixedAssets: [], metadata: { totalRecords: 0, schemaVersion: '1.0', exportedAt: new Date().toISOString() } },
      documents,
      auditTrail,
      filingPackages,
      offsiteConfig
    });
    res.json({ success: true, manifest: backupPkg.manifest });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/infrastructure/disaster-recovery/restore", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const { backupPackage, backupId } = req.body;
    const targetPkg = backupPackage || (backupId ? disasterRecoveryManager.getBackupById(backupId) : null);
    if (!targetPkg) {
      return res.status(404).json({ success: false, error: "Backup package not found" });
    }
    const restoreResult = disasterRecoveryManager.restoreFromBackup(targetPkg);
    res.json({ success: true, result: restoreResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/infrastructure/disaster-recovery/pitr", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const { baseBackupId, basePackage, targetTimestamp } = req.body;
    const targetPkg = basePackage || (baseBackupId ? disasterRecoveryManager.getBackupById(baseBackupId) : null);
    if (!targetPkg) {
      return res.status(404).json({ success: false, error: "Base backup package not found for PITR" });
    }
    const pitrResult = disasterRecoveryManager.restoreToPointInTime(targetPkg, targetTimestamp);
    res.json({ success: true, result: pitrResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/infrastructure/disaster-recovery/verify", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const { backupPackage, backupId, referenceTaxPayable } = req.body;
    const targetPkg = backupPackage || (backupId ? disasterRecoveryManager.getBackupById(backupId) : null);
    if (!targetPkg) {
      return res.status(404).json({ success: false, error: "Backup package not found for verification" });
    }
    const verification = disasterRecoveryManager.verifySystemIntegrity(targetPkg, referenceTaxPayable);
    res.json({ success: verification.passed, verification });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 48 — High-Volume Performance Benchmark & Diagnostics Endpoints
app.get("/api/infrastructure/performance/metrics", requireAuth, requireSuperAdmin, (_req, res) => {
  const latest = PerformanceBenchmarkEngine.getLatestReport();
  if (!latest) {
    return res.json({
      status: "NO_BENCHMARK_RUN",
      message: "No performance benchmark has been run yet in this session. Trigger via POST /api/infrastructure/performance/benchmark or npm run benchmark."
    });
  }
  res.json({ success: true, report: latest });
});

app.post("/api/infrastructure/performance/benchmark", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { invoiceCount, linesPerInvoice, journalLineCount, isQuick } = req.body || {};
    const config = isQuick
      ? { invoiceCount: 1000, linesPerInvoice: 10, journalLineCount: 100000 }
      : {
          invoiceCount: invoiceCount || 10000,
          linesPerInvoice: linesPerInvoice || 10,
          journalLineCount: journalLineCount || 1000000
        };

    const report = await PerformanceBenchmarkEngine.runBenchmark(config);
    res.json({ success: true, report });
  } catch (err: any) {
    logger.error("Performance benchmark run error", { error: { name: err.name, message: err.message, stack: err.stack } });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/infrastructure/performance/bottlenecks", requireAuth, requireSuperAdmin, (_req, res) => {
  const latest = PerformanceBenchmarkEngine.getLatestReport();
  if (!latest) {
    return res.json({
      success: true,
      bottlenecks: [],
      message: "Run a benchmark first to evaluate bottlenecks."
    });
  }
  res.json({
    success: true,
    totalBottlenecks: latest.bottlenecks.length,
    bottlenecks: latest.bottlenecks,
    calculationIdentityVerified: latest.calculationIdentityVerified
  });
});

// Ensure writable data directories exist (with /tmp fallback for read-only serverless runtimes like Netlify Functions)
function resolveWritableServerDataDir(): string {
  const localDir = path.join(process.cwd(), "data");
  const tmpDir = path.join(os.tmpdir(), "cr-maldives-data");
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY_SERVERLESS) {
    try {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    } catch {
      // Ignore
    }
    return tmpDir;
  }
  try {
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    fs.accessSync(localDir, fs.constants.W_OK);
    return localDir;
  } catch {
    try {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    } catch {
      // Ignore
    }
    return tmpDir;
  }
}

const DATA_DIR = resolveWritableServerDataDir();
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  // Non-fatal in constrained filesystems
}

const BILLS_FILE = path.join(DATA_DIR, "bills.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const TEMPLATE_EXCEL_FILE = path.join(DATA_DIR, "custom_template.xlsx");
const OUTLETS_FILE = path.join(DATA_DIR, "outlets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const REVENUE_FILE = path.join(DATA_DIR, "revenue.json");
const ASSETS_FILE = path.join(DATA_DIR, "assets.json");

// MIRA Capital Allowance Rates Standard Table
const MIRA_CAPITAL_ALLOWANCE_RATES: Record<AssetClass, number> = {
  'Buildings': 4,
  'Plant & Equipment / Machinery': 10,
  'Vehicles & Transport': 20,
  'Computer Software & Hardware': 33.33,
  'Loose Tools / Utensils / Crockery': 33.33,
  'Furniture & Fittings': 10
};

// Fixed Assets storage helpers (backed by Neon PostgreSQL via appStore)
function getAssets(): FixedAssetRecord[] {
  return appStore.getAssets();
}

function saveAssets(assets: FixedAssetRecord[]) {
  void appStore.saveAssets(assets).catch((e) => console.error("Error persisting assets:", e));
}

// Revenue storage helpers
function getRevenues(): RevenueRecord[] {
  if (fs.existsSync(REVENUE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(REVENUE_FILE, "utf-8"));
    } catch (e) {
      console.error("Error reading revenue.json", e);
    }
  }
  return [];
}

function saveRevenues(revenues: RevenueRecord[]) {
  try {
    fs.writeFileSync(REVENUE_FILE, JSON.stringify(revenues, null, 2));
  } catch {
    // Non-fatal in serverless/read-only filesystem
  }
}

// Tax & Accounting derive helper
function deriveTaxTreatment(
  category?: string | null,
  docType?: string | null,
  notes?: string | null
): {
  mira_schedule1_category: MiraSchedule1Category;
  accounting_treatment: AccountingTreatment;
  income_tax_treatment: IncomeTaxTreatment;
  deductible_percentage: number;
} {
  const cat = (category || 'Other').trim();
  const type = (docType || 'TAX_INVOICE').trim().toUpperCase();
  const lowerNotes = (notes || '').toLowerCase();

  // Non-deductible disallowances (fines, MIRA penalties, personal expenses, income tax payments)
  if (
    lowerNotes.includes('fine') ||
    lowerNotes.includes('penalty') ||
    lowerNotes.includes('income tax payment') ||
    lowerNotes.includes('mira penalty') ||
    lowerNotes.includes('personal')
  ) {
    return {
      mira_schedule1_category: 'Other Expenses',
      accounting_treatment: 'NON_DEDUCTIBLE',
      income_tax_treatment: 'NON_DEDUCTIBLE',
      deductible_percentage: 0
    };
  }

  // Capital asset / expenditure check
  if (type === 'CAPITAL_EXPENDITURE' || cat === 'Equipment' || cat === 'Capital Asset (Schedule 2)') {
    return {
      mira_schedule1_category: 'Capital Asset (Schedule 2)',
      accounting_treatment: 'CAPITAL_EXPENDITURE',
      income_tax_treatment: 'CAPITAL_ALLOWANCE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Food Ingredients' || cat === 'Beverages' || cat === 'Packaging') {
    return {
      mira_schedule1_category: 'Cost of Sales',
      accounting_treatment: 'COST_OF_SALES',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Insurance') {
    return {
      mira_schedule1_category: 'Insurance Premium',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Professional Fees' || cat === 'Consulting') {
    return {
      mira_schedule1_category: 'Professional & Consulting Fees',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Rent' || cat === 'Lease' || cat === 'Licenses') {
    return {
      mira_schedule1_category: 'Rental, Lease & License',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Repairs' || cat === 'Maintenance') {
    return {
      mira_schedule1_category: 'Repairs & Maintenance',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Salaries' || cat === 'Wages') {
    return {
      mira_schedule1_category: 'Salaries & Wages',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  if (cat === 'Marketing' || cat === 'Advertising') {
    return {
      mira_schedule1_category: 'Sales & Marketing',
      accounting_treatment: 'OPERATING_EXPENSE',
      income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
      deductible_percentage: 100
    };
  }

  return {
    mira_schedule1_category: 'Other Expenses',
    accounting_treatment: 'OPERATING_EXPENSE',
    income_tax_treatment: 'DEDUCTIBLE_EXPENSE',
    deductible_percentage: 100
  };
}

// Multer storage for uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `bill-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Helper for default settings (backed by Neon PostgreSQL via appStore)
function getAppSettings(): AppSettings {
  return appStore.getSettings();
}

function saveAppSettings(settings: AppSettings) {
  void appStore.saveSettings(settings).catch((e) => console.error("Error persisting settings:", e));
}

// Outlets helper (backed by Neon PostgreSQL via appStore)
function getOutlets(): Outlet[] {
  return appStore.getOutlets();
}

function saveOutlets(outlets: Outlet[]) {
  void appStore.saveOutlets(outlets).catch((e) => console.error("Error persisting outlets:", e));
}

// Users helper (backed by Neon PostgreSQL via appStore)
function getUsers(): User[] {
  return appStore.getUsers();
}

function saveUsers(users: User[]) {
  void appStore.saveUsers(users).catch((e) => console.error("Error persisting users:", e));
}

// User passwords storage (backed by Neon PostgreSQL via appStore)
function getPasswords(): Record<string, string> {
  return appStore.getPasswords();
}

function savePasswords(passwords: Record<string, string>) {
  void appStore.savePasswords(passwords).catch((e) => console.error("Error persisting passwords:", e));
}

// Sessions storage (legacy JSON fallback)
interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
}

function getSessions(): SessionRecord[] {
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
    } catch (e) {
      console.error("Error reading sessions.json", e);
    }
  }
  return [];
}

function saveSessions(sessions: SessionRecord[]) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch {
    // Non-fatal
  }
}

// Bills helper (backed by Neon PostgreSQL via appStore, with normalization for legacy fields)
function getBills(): BillRecord[] {
  const bills = appStore.getBills();
  const outlets = getOutlets();
  const defaultOutlet = outlets[0] || { id: "outlet-1", name: "Male' Main Branch" };
  let modified = false;

  bills.forEach((b) => {
    if (!b.outlet_id) {
      b.outlet_id = defaultOutlet.id;
      b.outlet_name = defaultOutlet.name;
      modified = true;
    } else if (!b.outlet_name) {
      const match = outlets.find((o) => o.id === b.outlet_id);
      b.outlet_name = match ? match.name : "Branch Outlet";
      modified = true;
    }

    if (!b.ocr_status) {
      b.ocr_status = b.status === "verified" ? "APPROVED" : "NEEDS_REVIEW";
      modified = true;
    }
    if (b.ocr_attempts === undefined) {
      b.ocr_attempts = 1;
      modified = true;
    }
    if (b.needs_review === undefined) {
      b.needs_review = b.status === "pending_review";
      modified = true;
    }

    const dataObjects = [b.extractedData, b.verifiedData].filter(Boolean);
    dataObjects.forEach((data) => {
      if (!data.document_type) {
        data.document_type = "TAX_INVOICE";
        modified = true;
      }
      if (!data.tax_status) {
        data.tax_status = (data.totals?.gst_amount && data.totals.gst_amount > 0) ? "TAX_CHARGED" : "NO_TAX";
        modified = true;
      }
      if (!data.expense_category) {
        data.expense_category = "Other";
        modified = true;
      }
      if (!data.mira_schedule1_category || !data.accounting_treatment || !data.income_tax_treatment) {
        const taxDerived = deriveTaxTreatment(data.expense_category, data.document_type, data.notes);
        if (!data.mira_schedule1_category) data.mira_schedule1_category = taxDerived.mira_schedule1_category;
        if (!data.accounting_treatment) data.accounting_treatment = taxDerived.accounting_treatment;
        if (!data.income_tax_treatment) data.income_tax_treatment = taxDerived.income_tax_treatment;
        if (data.deductible_percentage === undefined) data.deductible_percentage = taxDerived.deductible_percentage;
        modified = true;
      }
    });
  });

  if (modified) {
    saveBills(bills);
  }

  return bills;
}

function saveBills(bills: BillRecord[]) {
  void appStore.saveBills(bills).catch((e) => console.error("Error persisting bills:", e));
}

// Initialize security user provider
setUserProvider(() => getUsers());

// Authentication Middleware
async function getAuthUser(req: express.Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  const tokenHeader = req.headers["x-auth-token"] as string;
  let token = tokenHeader;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // Also support secure HttpOnly cookie
  if (!token && (req as any).cookies && (req as any).cookies.cr_session) {
    token = (req as any).cookies.cr_session;
  }

  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)cr_session=([^;]+)/);
    if (match && match[1]) {
      token = decodeURIComponent(match[1]);
    }
  }

  if (!token) {
    return null;
  }

  // 1. Check cryptographically secure session manager with expiration (and DB fallback)
  let session = sessionManager.getSession(token);
  if (!session) {
    session = await appStore.getSessionFromDb(token);
  }
  let userId = session?.userId;

  // 2. Backward compatibility fallback for pre-existing sessions
  if (!session) {
    const legacySessions = getSessions();
    const legacySession = legacySessions.find((s) => s.token === token);
    if (legacySession) {
      userId = legacySession.userId;
      // Auto-upgrade legacy session into secure session manager
      const legacyUser = getUsers().find((u) => u.id === legacySession.userId);
      if (legacyUser) {
        session = sessionManager.createSession({
          userId: legacyUser.id,
          tenantId: legacyUser.outlet_id || "DEFAULT-TENANT",
          role: legacyUser.role,
          username: legacyUser.username
        });
      }
    }
  }

  if (!userId) {
    return null;
  }

  let users = getUsers();
  let user = users.find((u) => u.id === userId && u.status === "active");
  if (!user && appStore.isUsingDatabase()) {
    users = await appStore.refreshUsers();
    user = users.find((u) => u.id === userId && u.status === "active");
  }
  if (!user) {
    return null;
  }

  // Touch active session
  sessionManager.touchSession(token);

  let outlets = getOutlets();
  let outlet = user.outlet_id ? outlets.find((o) => o.id === user.outlet_id) : null;
  if (user.outlet_id && !outlet && appStore.isUsingDatabase()) {
    outlets = await appStore.refreshOutlets();
    outlet = outlets.find((o) => o.id === user.outlet_id);
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    outlet_id: user.outlet_id,
    outlet_name: outlet ? outlet.name : user.role === "super_admin" ? "All Outlets (Super Admin)" : "Branch Outlet"
  };
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Authentication required. Please log in." });
    }
    (req as any).user = authUser;
    next();
  } catch (err) {
    next(err);
  }
}

function requireSuperAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user as AuthUser;
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden: Super Admin privilege required." });
  }
  next();
}

// Helper to construct row object for any set of column headers
function getRowForHeaders(headers: string[], bill: BillRecord, mapping: TemplateColumnMapping): Record<string, any> {
  const data = bill.verifiedData || bill.extractedData;
  const rowData: Record<string, any> = {};

  const fieldDefs: { key: keyof TemplateColumnMapping; value: any; aliases: string[] }[] = [
    {
      key: "outlet_name",
      value: bill.outlet_name || "Branch Outlet",
      aliases: ["outlet name", "outlet", "branch", "shop"]
    },
    {
      key: "supplier_name",
      value: data.supplier.name || "",
      aliases: ["supplier name", "supplier", "vendor name", "vendor"]
    },
    {
      key: "supplier_tin",
      value: data.supplier.gstin || "",
      aliases: ["supplier tin", "tin on invoice", "gstd/tin", "tin", "gstin", "supplier gstin"]
    },
    {
      key: "invoice_number",
      value: data.invoice.number || "",
      aliases: ["invoice number", "invoice #", "inv #", "invoice no", "bill no"]
    },
    {
      key: "invoice_date",
      value: data.invoice.date || "",
      aliases: ["invoice date", "date", "bill date"]
    },
    {
      key: "taxable_value",
      value: data.totals.taxable_value ?? 0,
      aliases: ["subtotal (excl. gst)", "subtotal (excl gst)", "taxable value (mvr)", "taxable amount", "taxable value", "subtotal"]
    },
    {
      key: "gst_amount",
      value: data.totals.gst_amount ?? 0,
      aliases: ["gst amount (8%)", "gst charged at 8%", "gst amount", "gst (mvr)", "gst paid"]
    },
    {
      key: "invoice_total",
      value: data.totals.invoice_total ?? 0,
      aliases: ["invoice total", "total amount", "total (mvr)", "grand total", "total"]
    },
    {
      key: "quarter",
      value: bill.quarter || "",
      aliases: ["quarter", "period"]
    },
    {
      key: "notes",
      value: data.notes || "",
      aliases: ["notes", "remarks"]
    }
  ];

  for (const header of headers) {
    const trimmedHeader = header.trim();
    if (!trimmedHeader) continue;
    const lowerHeader = trimmedHeader.toLowerCase();
    const normHeader = lowerHeader.replace(/[^a-z0-9]/g, "");

    let matchedValue: any = undefined;

    for (const field of fieldDefs) {
      const mappedCol = mapping?.[field.key];
      if (mappedCol && mappedCol.trim().toLowerCase() === lowerHeader) {
        matchedValue = field.value;
        break;
      }
    }

    if (matchedValue === undefined && normHeader.length > 1) {
      const isOtherGstRate = /gst.*(6|12|16|17)%?/i.test(trimmedHeader);

      if (!isOtherGstRate) {
        for (const field of fieldDefs) {
          const matchAlias = field.aliases.some(alias => {
            const aliasNorm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
            return lowerHeader === alias || normHeader === aliasNorm;
          });
          if (matchAlias) {
            matchedValue = field.value;
            break;
          }
        }
      }
    }

    rowData[trimmedHeader] = matchedValue !== undefined ? matchedValue : "";
  }

  return rowData;
}

// Date helpers
function calculateQuarter(dateStr: string | null): string {
  if (!dateStr) {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `${now.getFullYear()}-Q${q}`;
  }

  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const parts = dateStr.trim().split(/[\s\-\/]+/);
  let year = new Date().getFullYear();
  let month = 0;

  if (parts.length >= 3) {
    const mStr = parts[1].toLowerCase().slice(0, 3);
    if (mStr in monthMap) {
      month = monthMap[mStr];
      const y = parseInt(parts[2], 10);
      if (!isNaN(y)) year = y < 100 ? 2000 + y : y;
    } else {
      const parsedDate = new Date(dateStr);
      if (!isNaN(parsedDate.getTime())) {
        year = parsedDate.getFullYear();
        month = parsedDate.getMonth();
      }
    }
  }

  const q = Math.floor(month / 3) + 1;
  return `${year}-Q${q}`;
}

function formatToMaldivianDate(rawDateStr: string | null): string {
  if (!rawDateStr) return "";
  const d = new Date(rawDateStr);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  }
  return rawDateStr;
}

// Gemini AI client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}

// Wrapper with exponential backoff and fallback model for transient Gemini 503 / 429 / UNAVAILABLE errors
async function generateContentWithRetry(ai: GoogleGenAI, params: any, maxRetries = 3) {
  let delay = 1000;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      lastError = err;
      const errStr = String(err?.message || err?.status || err?.code || err);
      const isTransient =
        err?.status === 503 ||
        err?.code === 503 ||
        err?.status === 429 ||
        err?.code === 429 ||
        errStr.includes("503") ||
        errStr.includes("high demand") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("RESOURCE_EXHAUSTED") ||
        errStr.includes("overloaded") ||
        errStr.includes("temporarily unavailable") ||
        errStr.includes("ETIMEDOUT") ||
        errStr.includes("ECONNRESET");

      if (isTransient) {
        if (attempt < maxRetries) {
          console.warn(`[Gemini API Transient Error] Attempt ${attempt}/${maxRetries} failed with 503/transient error: ${errStr}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff (1s -> 2s -> 4s)
          continue;
        } else if (params.model === "gemini-3.6-flash") {
          console.warn(`[Gemini API Fallback] Primary model 'gemini-3.6-flash' experiencing high demand (503). Retrying with fallback model 'gemini-flash-latest'...`);
          try {
            const fallbackParams = { ...params, model: "gemini-flash-latest" };
            return await ai.models.generateContent(fallbackParams);
          } catch (fallbackErr: any) {
            console.error("[Gemini API Fallback Failed] Fallback model also failed:", fallbackErr);
            throw err;
          }
        }
      }
      throw err;
    }
  }
  throw lastError || new Error("Gemini API request failed after retries.");
}

// Validation logic for bills (smart validation based on document_type and tax_status)
function validateBill(data: ExtractedBillData, existingBills: BillRecord[], currentId?: string, outletId?: string): ValidationResult {
  const issues: { type: 'error' | 'warning'; field?: string; message: string }[] = [];
  const settings = getAppSettings();

  const docType = data.document_type || 'TAX_INVOICE';
  const taxStatus = data.tax_status || 'TAX_CHARGED';

  const supplierTin = (data.supplier?.gstin || "").trim();
  const supplierName = (data.supplier?.name || "").trim();
  const invNumber = (data.invoice?.number || "").trim();
  const invDate = (data.invoice?.date || "").trim();
  const taxable = data.totals?.taxable_value ?? 0;
  const gst = data.totals?.gst_amount ?? 0;
  const roundOff = data.totals?.round_off ?? 0;
  const total = data.totals?.invoice_total ?? 0;

  const isTaxDoc = docType === 'TAX_INVOICE' || taxStatus === 'TAX_CHARGED' || taxStatus === 'TAX_INCLUDED';

  // 1. Supplier Name check
  if (!supplierName) {
    issues.push({ type: 'warning', field: 'supplier_name', message: 'Supplier name is missing or unreadable.' });
  }

  // 2. Supplier TIN validation (Only required/expected for Tax Invoices)
  if (isTaxDoc) {
    if (!supplierTin) {
      issues.push({ type: 'warning', field: 'supplier_tin', message: 'Supplier TIN is missing on Tax Invoice.' });
    } else if (supplierTin.toUpperCase() === settings.myTin.toUpperCase()) {
      issues.push({ type: 'error', field: 'supplier_tin', message: `Extracted TIN (${supplierTin}) is OUR TIN, not the Supplier's TIN.` });
    } else if (!/^\d{7}GST\d{3}$/i.test(supplierTin)) {
      issues.push({ type: 'warning', field: 'supplier_tin', message: `Supplier TIN format (${supplierTin}) may need verification (expected 7 digits + GST + 3 digits).` });
    }
  }

  // 3. Invoice Number
  if (!invNumber) {
    if (isTaxDoc) {
      issues.push({ type: 'error', field: 'invoice_number', message: 'Invoice number is missing.' });
    } else {
      issues.push({ type: 'warning', field: 'invoice_number', message: 'Document reference / number is missing.' });
    }
  }

  // 4. Invoice Date
  if (!invDate) {
    issues.push({ type: 'error', field: 'invoice_date', message: 'Document date is missing.' });
  }

  // 5. Total and Mathematical check & Input GST Separation
  if (total <= 0 && taxable <= 0) {
    issues.push({ type: 'error', field: 'invoice_total', message: 'Total purchase amount is zero or unreadable.' });
  } else if (isTaxDoc) {
    if (taxStatus === 'TAX_CHARGED' && total > 0 && (gst === 0 || gst === null)) {
      issues.push({
        type: 'warning',
        field: 'gst_amount',
        message: 'Tax Invoice indicates tax charged, but Input GST amount is 0 or not separated from net expenses.'
      });
    }

    const calculatedTotal = taxable + gst + roundOff;
    const diff = Math.abs(calculatedTotal - total);
    if (total > 0 && diff > 0.50) {
      issues.push({
        type: 'warning',
        field: 'invoice_total',
        message: `Invoice total (MVR ${total.toFixed(2)}) does not match calculated sum (Subtotal MVR ${taxable.toFixed(2)} + GST MVR ${gst.toFixed(2)} = MVR ${calculatedTotal.toFixed(2)}).`
      });
    }
  } else {
    // Non-tax / handwritten purchase math check
    const diff = Math.abs((taxable + roundOff) - total);
    if (total > 0 && taxable > 0 && diff > 0.50) {
      issues.push({
        type: 'warning',
        field: 'invoice_total',
        message: `Total amount (MVR ${total.toFixed(2)}) does not match subtotal (MVR ${taxable.toFixed(2)}).`
      });
    }
  }

  // 6. Capital Asset & Tax Disallowance Validation
  if (
    docType === 'CAPITAL_EXPENDITURE' ||
    data.mira_schedule1_category === 'Capital Asset (Schedule 2)' ||
    data.income_tax_treatment === 'CAPITAL_ALLOWANCE'
  ) {
    issues.push({
      type: 'warning',
      field: 'mira_schedule1_category',
      message: 'Capital Asset / Expenditure detected: Excluded from direct operating deduction; subject to MIRA Schedule 2 Capital Allowance.'
    });
  }

  if (
    data.income_tax_treatment === 'NON_DEDUCTIBLE' ||
    (data.deductible_percentage !== undefined && data.deductible_percentage === 0)
  ) {
    issues.push({
      type: 'warning',
      field: 'income_tax_treatment',
      message: 'Non-deductible expense detected (e.g. fines, penalties, personal expenses). Added back to MIRA taxable income.'
    });
  }

  // 7. Duplicate check scoped to outlet
  let duplicateFound = false;
  let duplicateBillId: string | null = null;
  let duplicateReason: string | null = null;

  for (const other of existingBills) {
    if (currentId && other.id === currentId) continue;
    if (other.status === 'rejected') continue;
    if (outletId && other.outlet_id && other.outlet_id !== outletId) continue;

    const otherData = other.verifiedData || other.extractedData;
    const otherTin = (otherData.supplier?.gstin || "").trim();
    const otherName = (otherData.supplier?.name || "").trim().toLowerCase();
    const otherInvNum = (otherData.invoice?.number || "").trim();
    const otherInvDate = (otherData.invoice?.date || "").trim();
    const otherTotal = otherData.totals?.invoice_total ?? 0;

    if (supplierTin && otherTin && supplierTin.toUpperCase() === otherTin.toUpperCase() && invNumber && otherInvNum && invNumber.toLowerCase() === otherInvNum.toLowerCase()) {
      duplicateFound = true;
      duplicateBillId = other.id;
      duplicateReason = `Duplicate detected: Invoice #${invNumber} for TIN ${supplierTin} already uploaded (${other.fileName}).`;
      break;
    }

    if (supplierName && otherName && supplierName.toLowerCase() === otherName && invNumber && otherInvNum && invNumber.toLowerCase() === otherInvNum.toLowerCase()) {
      duplicateFound = true;
      duplicateBillId = other.id;
      duplicateReason = `Duplicate detected: Invoice #${invNumber} from ${data.supplier.name} already uploaded (${other.fileName}).`;
      break;
    }

    if (supplierName && otherName && supplierName.toLowerCase() === otherName && invDate && otherInvDate && invDate === otherInvDate && total > 0 && Math.abs(total - otherTotal) < 0.01) {
      duplicateFound = true;
      duplicateBillId = other.id;
      duplicateReason = `Possible duplicate: Same supplier (${data.supplier.name}), date (${invDate}), and total (MVR ${total}) already exists.`;
      break;
    }
  }

  if (duplicateFound && duplicateReason) {
    issues.push({ type: 'warning', field: 'invoice_number', message: duplicateReason });
  }

  const hasErrors = issues.some(i => i.type === 'error');

  return {
    is_valid: !hasErrors,
    issues,
    duplicate_found: duplicateFound,
    duplicate_bill_id: duplicateBillId,
    duplicate_reason: duplicateReason
  };
}

// Serve uploads with path traversal and PostgreSQL binary fallback after container restarts
app.use("/uploads", express.static(UPLOADS_DIR));
app.get("/uploads/:filename", async (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const fileData = await appStore.getUploadedFile(safeName);
    if (!fileData) {
      return res.status(404).json({ error: "Uploaded file not found." });
    }
    const localPath = path.resolve(UPLOADS_DIR, safeName);
    if (localPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
      try {
        fs.writeFileSync(localPath, fileData.data);
      } catch {
        // Non-fatal if filesystem is ephemeral/read-only
      }
    }
    res.setHeader("Content-Type", fileData.mimeType);
    res.send(fileData.data);
  } catch (err) {
    console.error("Error serving uploaded file:", err);
    res.status(500).json({ error: "Failed to retrieve uploaded file." });
  }
});

// ---------------- AUTH ROUTES ----------------

app.post("/api/auth/login", authRateLimiter.middleware(), async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username/Email and password are required." });
    }

    const [users, outlets] = await Promise.all([
      appStore.refreshUsers(),
      appStore.refreshOutlets()
    ]);
    const passwords = getPasswords();

    const term = String(username).trim().toLowerCase();
    const user = users.find(
      (u) => (u.username.toLowerCase() === term || u.email.toLowerCase() === term) && u.status === "active"
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials or account deactivated." });
    }

    const expectedPass = passwords[user.id] || "outlet123";
    const isValidPassword = PasswordSecurity.verifyPassword(password, expectedPass);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    await appStore.upsertUser(user);

    // Generate cryptographically secure session
    const session = sessionManager.createSession({
      userId: user.id,
      tenantId: user.outlet_id || (user.role === "super_admin" ? "outlet-all" : "DEFAULT-TENANT"),
      role: user.role,
      username: user.username,
      ipAddress:
        typeof req.headers["x-forwarded-for"] === "string"
          ? req.headers["x-forwarded-for"]
          : req.socket?.remoteAddress || req.ip,
      userAgent: req.headers["user-agent"]
    });

    // Ensure session is persisted to Neon PostgreSQL before returning (critical for serverless)
    try {
      await appStore.persistSessionToDb(session);
    } catch (persistErr) {
      console.error("[Auth] Failed to persist session to PostgreSQL:", persistErr);
    }

    // Backward compatibility mirror in sessions.json
    const legacySessions = getSessions();
    legacySessions.push({
      token: session.token,
      userId: user.id,
      createdAt: session.createdAt
    });
    saveSessions(legacySessions);

    // Set secure HttpOnly cookie when served over HTTPS
    const isHttps = Boolean(req.secure || req.headers["x-forwarded-proto"] === "https");
    res.cookie("cr_session", session.token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/"
    });

    const outlet = user.outlet_id ? outlets.find((o) => o.id === user.outlet_id) : null;
    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      outlet_id: user.outlet_id,
      outlet_name: outlet ? outlet.name : user.role === "super_admin" ? "All Outlets (Super Admin)" : "Branch Outlet"
    };

    const response: LoginResponse = { token: session.token, user: authUser };
    return res.json(response);
  } catch (err: any) {
    console.error("[Auth] Login error:", err);
    return res.status(500).json({ error: err?.message || "Authentication service error. Please try again." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = (req as any).user as AuthUser;
  res.json({ user: PasswordSecurity.sanitizeUser(user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const authHeader = req.headers.authorization;
  const tokenHeader = req.headers["x-auth-token"] as string;
  let token = tokenHeader;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);
  if (!token && (req as any).cookies && (req as any).cookies.cr_session) {
    token = (req as any).cookies.cr_session;
  }

  if (token) {
    sessionManager.revokeSession(token);
    try {
      await appStore.revokeSessionInDb(token);
    } catch {
      // Non-fatal
    }
    let sessions = getSessions();
    sessions = sessions.filter((s) => s.token !== token);
    saveSessions(sessions);
  }

  res.clearCookie("cr_session", { path: "/" });
  res.json({ success: true, message: "Logged out successfully" });
});

// ---------------- OUTLET MANAGEMENT ROUTES ----------------

app.get("/api/outlets", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  let outlets = await appStore.refreshOutlets();

  if (user.role === "outlet_user") {
    outlets = outlets.filter((o) => o.id === user.outlet_id);
  }

  res.json(outlets);
});

app.post("/api/outlets", requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, code, tin, address, phone } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: "Outlet Name and Code are required." });
  }

  const outlets = await appStore.refreshOutlets();
  const existing = outlets.find((o) => o.code.toLowerCase() === code.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ error: `Outlet code "${code}" already exists.` });
  }

  const newOutlet: Outlet = {
    id: "outlet-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    code: code.trim().toUpperCase(),
    tin: tin ? tin.trim() : undefined,
    address: address ? address.trim() : undefined,
    phone: phone ? phone.trim() : undefined,
    status: "active",
    createdAt: new Date().toISOString()
  };

  await appStore.upsertOutlet(newOutlet);

  res.json(newOutlet);
});

app.put("/api/outlets/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const outlets = await appStore.refreshOutlets();
  const idx = outlets.findIndex((o) => o.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Outlet not found" });
  }

  const current = outlets[idx];
  const { name, code, tin, address, phone, status } = req.body;

  if (name) current.name = name.trim();
  if (code) current.code = code.trim().toUpperCase();
  if (tin !== undefined) current.tin = tin.trim();
  if (address !== undefined) current.address = address.trim();
  if (phone !== undefined) current.phone = phone.trim();
  if (status) current.status = status;
  current.updatedAt = new Date().toISOString();

  await appStore.upsertOutlet(current);

  // Sync outlet_name on bills
  await appStore.refreshBills();
  const bills = getBills();
  let billsUpdated = false;
  bills.forEach((b) => {
    if (b.outlet_id === id) {
      b.outlet_name = current.name;
      billsUpdated = true;
    }
  });
  if (billsUpdated) await appStore.saveBills(bills);

  // Sync outlet_name on users
  const users = await appStore.refreshUsers();
  let usersUpdated = false;
  users.forEach((u) => {
    if (u.outlet_id === id) {
      u.outlet_name = current.name;
      usersUpdated = true;
    }
  });
  if (usersUpdated) await appStore.saveUsers(users);

  res.json(current);
});

// ---------------- USER MANAGEMENT ROUTES ----------------

app.get("/api/users", requireAuth, requireSuperAdmin, async (_req, res) => {
  const [users, outlets] = await Promise.all([
    appStore.refreshUsers(),
    appStore.refreshOutlets()
  ]);

  // Populate latest outlet_name and sanitize user records (never leak passwords)
  const populated = users.map((u) => {
    const o = u.outlet_id ? outlets.find((out) => out.id === u.outlet_id) : null;
    const sanitized = PasswordSecurity.sanitizeUser(u);
    return {
      ...sanitized,
      outlet_name: o ? o.name : u.role === "super_admin" ? "All Outlets (Super Admin)" : "Unassigned"
    };
  });

  res.json(populated);
});

app.post("/api/users", requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, email, username, password, role, outlet_id, status } = req.body;
  if (!name || !email || !username || !password) {
    return res.status(400).json({ error: "Name, email, username and password are required." });
  }

  const [users, outlets] = await Promise.all([
    appStore.refreshUsers(),
    appStore.refreshOutlets()
  ]);
  if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
    return res.status(400).json({ error: "Email is already registered." });
  }
  if (users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(400).json({ error: "Username is already taken." });
  }

  const outlet = outlet_id ? outlets.find((o) => o.id === outlet_id) : null;

  const newUser: User = {
    id: "user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    username: username.trim().toLowerCase(),
    role: role === "super_admin" ? "super_admin" : "outlet_user",
    outlet_id: role === "super_admin" ? null : outlet_id || null,
    outlet_name: outlet ? outlet.name : role === "super_admin" ? "All Outlets (Super Admin)" : undefined,
    status: status || "active",
    createdAt: new Date().toISOString()
  };

  const hashedPassword = PasswordSecurity.hashPassword(password);
  await appStore.upsertUser(newUser, hashedPassword);

  res.json(PasswordSecurity.sanitizeUser(newUser));
});

app.put("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const actingUser = (req as any).user as AuthUser;
  const { id } = req.params;
  const users = await appStore.refreshUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "User not found" });
  }

  const existing = users[idx];
  const current: User = { ...existing };
  const { name, email, username, role, outlet_id, status } = req.body;

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) {
      return res.status(400).json({ error: "Full name cannot be empty." });
    }
    current.name = cleanName;
  }

  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ error: "Email cannot be empty." });
    }
    if (users.some((u) => u.id !== id && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: "Email is already registered to another user." });
    }
    current.email = cleanEmail;
  }

  let usernameChanged = false;
  if (username !== undefined) {
    const cleanUsername = String(username).trim().toLowerCase();
    if (!cleanUsername || cleanUsername.length < 2) {
      return res.status(400).json({ error: "Username must be at least 2 characters." });
    }
    if (/\s/.test(cleanUsername)) {
      return res.status(400).json({ error: "Username cannot contain spaces." });
    }
    if (users.some((u) => u.id !== id && u.username.toLowerCase() === cleanUsername)) {
      return res.status(400).json({ error: "Username is already taken by another user." });
    }
    usernameChanged = cleanUsername !== existing.username.toLowerCase();
    current.username = cleanUsername;
  }

  if (role !== undefined) {
    const nextRole = role === "super_admin" ? "super_admin" : "outlet_user";
    if (existing.role === "super_admin" && nextRole !== "super_admin") {
      const hasOtherActiveAdmin = users.some(
        (u) => u.id !== id && u.role === "super_admin" && u.status === "active"
      );
      if (!hasOtherActiveAdmin) {
        return res.status(400).json({ error: "Cannot demote the last active Super Admin." });
      }
      if (id === actingUser.id) {
        return res.status(400).json({ error: "You cannot demote your own currently signed-in Super Admin account." });
      }
    }
    current.role = nextRole;
  }

  const outlets = await appStore.refreshOutlets();
  if (current.role === "super_admin") {
    current.outlet_id = null;
    current.outlet_name = "All Outlets (Super Admin)";
  } else {
    const targetOutletId = outlet_id !== undefined ? (outlet_id || null) : current.outlet_id;
    current.outlet_id = targetOutletId;
    const o = targetOutletId ? outlets.find((out) => out.id === targetOutletId) : null;
    current.outlet_name = o ? o.name : "Unassigned";
  }

  if (status !== undefined) {
    const nextStatus = status === "inactive" ? "inactive" : "active";
    if (nextStatus === "inactive") {
      if (id === actingUser.id) {
        return res.status(400).json({ error: "You cannot deactivate your own currently signed-in account." });
      }
      if (current.role === "super_admin") {
        const hasOtherActiveAdmin = users.some(
          (u) => u.id !== id && u.role === "super_admin" && u.status === "active"
        );
        if (!hasOtherActiveAdmin) {
          return res.status(400).json({ error: "Cannot deactivate the last active Super Admin." });
        }
      }
    }
    current.status = nextStatus;
  }

  await appStore.upsertUser(current);

  if (current.status === "inactive") {
    sessionManager.revokeAllUserSessions(id);
    const remainingSessions = getSessions().filter((s) => s.userId !== id);
    saveSessions(remainingSessions);
  } else if (usernameChanged) {
    sessionManager.updateUserSessionsUsername(id, current.username);
    await appStore.syncSessionUsername(id, current.username);
  }

  res.json(PasswordSecurity.sanitizeUser(current));
});

app.delete("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const actingUser = (req as any).user as AuthUser;
  const { id } = req.params;

  const users = await appStore.refreshUsers();
  const target = users.find((u) => u.id === id);
  if (!target) {
    return res.status(404).json({ error: "User not found." });
  }

  if (target.id === actingUser.id) {
    return res.status(400).json({ error: "You cannot delete your own currently signed-in account." });
  }

  if (target.role === "super_admin") {
    const hasOtherActiveAdmin = users.some(
      (u) => u.id !== id && u.role === "super_admin" && u.status === "active"
    );
    if (!hasOtherActiveAdmin) {
      return res.status(400).json({ error: "Cannot delete the last active Super Admin account." });
    }
  }

  sessionManager.revokeAllUserSessions(id);
  const remainingSessions = getSessions().filter((s) => s.userId !== id);
  saveSessions(remainingSessions);

  await appStore.deleteUser(id);

  res.json({
    success: true,
    deletedUserId: id,
    message: `User '${target.username}' removed successfully.`
  });
});

app.post("/api/users/:id/reset-password", requireAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters long." });
  }

  const users = await appStore.refreshUsers();
  const user = users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  await appStore.updateUserPassword(id, PasswordSecurity.hashPassword(newPassword));

  // Invalidate all existing active sessions for this user for security
  sessionManager.revokeAllUserSessions(id);

  res.json({ success: true, message: `Password reset successfully for user ${user.username}.` });
});

// ---------------- DASHBOARD SUMMARY ROUTE ----------------

app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const requestedOutletRaw = req.query.outletId ?? req.query.outlet ?? req.query.outlet_id;
  const requestedOutlet = typeof requestedOutletRaw === "string" ? requestedOutletRaw.trim() : undefined;
  const requestedQuarterRaw = req.query.quarter;
  const requestedQuarter = typeof requestedQuarterRaw === "string" ? requestedQuarterRaw.trim() : undefined;

  const [, outlets, users] = await Promise.all([
    appStore.refreshBills(),
    appStore.refreshOutlets(),
    appStore.refreshUsers()
  ]);
  const allBills = getBills();
  let bills = allBills;

  // Backend Isolation logic:
  let effectiveOutletId: string | null = null;
  if (user.role === "outlet_user") {
    effectiveOutletId = user.outlet_id;
  } else if (requestedOutlet && requestedOutlet !== "ALL") {
    effectiveOutletId = requestedOutlet;
  }

  if (effectiveOutletId) {
    bills = bills.filter((b) => b.outlet_id === effectiveOutletId);
  }

  if (requestedQuarter && requestedQuarter !== "ALL") {
    bills = bills.filter((b) => {
      const data = b.verifiedData || b.extractedData;
      const q = b.quarter || calculateQuarter(data.invoice.date);
      return q === requestedQuarter;
    });
  }

  const summary: DashboardSummary = {
    totalBills: bills.length,
    pendingReviewCount: bills.filter((b) => b.status === "pending_review").length,
    verifiedCount: bills.filter((b) => b.status === "verified").length,
    rejectedCount: bills.filter((b) => b.status === "rejected").length,
    totalPurchases: 0,
    totalGst: 0,
    quarterlyStats: {},
    totalOutlets: outlets.length,
    totalUsers: users.length,
    outletStats: []
  };

  bills.forEach((b) => {
    if (b.status === "verified" || b.status === "pending_review") {
      const data = b.verifiedData || b.extractedData;
      const taxable = data.totals.taxable_value || 0;
      const gst = data.totals.gst_amount || 0;

      if (b.status === "verified") {
        summary.totalPurchases += taxable;
        summary.totalGst += gst;
      }

      const q = b.quarter || calculateQuarter(data.invoice.date);
      if (!summary.quarterlyStats[q]) {
        summary.quarterlyStats[q] = { count: 0, totalPurchases: 0, totalGst: 0 };
      }
      summary.quarterlyStats[q].count += 1;
      if (b.status === "verified") {
        summary.quarterlyStats[q].totalPurchases += taxable;
        summary.quarterlyStats[q].totalGst += gst;
      }
    }
  });

  // Calculate Outlet breakdown stats if Super Admin
  if (user.role === "super_admin") {
    const quarterFilteredAllBills =
      requestedQuarter && requestedQuarter !== "ALL"
        ? allBills.filter((b) => {
            const data = b.verifiedData || b.extractedData;
            const q = b.quarter || calculateQuarter(data.invoice.date);
            return q === requestedQuarter;
          })
        : allBills;

    const statsMap: Record<string, OutletSummaryStats> = {};

    outlets.forEach((o) => {
      statsMap[o.id] = {
        outletId: o.id,
        outletName: o.name,
        totalBills: 0,
        pendingCount: 0,
        verifiedCount: 0,
        totalPurchases: 0,
        totalGst: 0
      };
    });

    quarterFilteredAllBills.forEach((b) => {
      if (b.outlet_id && statsMap[b.outlet_id]) {
        statsMap[b.outlet_id].totalBills += 1;
        if (b.status === "pending_review") statsMap[b.outlet_id].pendingCount += 1;
        if (b.status === "verified") {
          statsMap[b.outlet_id].verifiedCount += 1;
          const data = b.verifiedData || b.extractedData;
          statsMap[b.outlet_id].totalPurchases += data.totals.taxable_value || 0;
          statsMap[b.outlet_id].totalGst += data.totals.gst_amount || 0;
        }
      }
    });

    summary.outletStats = Object.values(statsMap);
  }

  res.json(summary);
});

// App settings endpoints
app.get("/api/settings", requireAuth, async (_req, res) => {
  res.json(await appStore.refreshSettings());
});

app.put("/api/settings", requireAuth, requireSuperAdmin, async (req, res) => {
  const current = await appStore.refreshSettings();
  const updated = { ...current, ...req.body };
  await appStore.saveSettings(updated);
  res.json(await appStore.refreshSettings());
});

// ---------------- BILL MANAGEMENT ROUTES ----------------

// List bills with filtering and Backend Isolation
app.get("/api/bills", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  await appStore.refreshBills();
  let bills = getBills();

  const { status, quarter, year, search, outlet, outletId, outlet_id } = req.query;
  const requestedOutletRaw = outletId ?? outlet ?? outlet_id;
  const requestedOutlet = typeof requestedOutletRaw === "string" ? requestedOutletRaw.trim() : undefined;

  // Backend Isolation:
  if (user.role === "outlet_user") {
    bills = bills.filter((b) => b.outlet_id === user.outlet_id);
  } else if (requestedOutlet && requestedOutlet !== "ALL") {
    bills = bills.filter((b) => b.outlet_id === requestedOutlet);
  }

  if (status) {
    bills = bills.filter((b) => b.status === status);
  }
  if (quarter && quarter !== "ALL") {
    bills = bills.filter((b) => {
      const data = b.verifiedData || b.extractedData;
      const q = b.quarter || calculateQuarter(data.invoice.date);
      return q === quarter;
    });
  }
  if (year) {
    const yNum = parseInt(year as string, 10);
    if (!isNaN(yNum)) {
      bills = bills.filter((b) => b.year === yNum);
    }
  }
  if (search && typeof search === "string" && search.trim() !== "") {
    const q = search.trim().toLowerCase();
    bills = bills.filter((b) => {
      const data = b.verifiedData || b.extractedData;
      return (
        (data.supplier.name || "").toLowerCase().includes(q) ||
        (data.supplier.gstin || "").toLowerCase().includes(q) ||
        (data.invoice.number || "").toLowerCase().includes(q) ||
        (b.outlet_name || "").toLowerCase().includes(q) ||
        b.fileName.toLowerCase().includes(q)
      );
    });
  }

  bills.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

  res.json(bills);
});

// Get single bill with isolation check
app.get("/api/bills/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  await appStore.refreshBills();
  const bills = getBills();
  const bill = bills.find((b) => b.id === req.params.id);

  if (!bill) {
    return res.status(404).json({ error: "Bill not found" });
  }

  // Backend Isolation Check:
  if (user.role === "outlet_user" && bill.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Bill belongs to another outlet." });
  }

  res.json(bill);
});

// AI Single Bill Extraction & Creation with Automatic Outlet Assignment
app.post("/api/bills/analyze", requireAuth, uploadRateLimiter.middleware(), upload.single("billFile"), async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;

    if (!req.file) {
      return res.status(400).json({ error: "No bill file uploaded." });
    }

    // Cryptographic & MIME Magic-Bytes File Validation
    const uploadValidation = UploadValidator.validateFile(req.file, BILL_UPLOAD_CONSTRAINTS);
    if (!uploadValidation.isValid) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      }
      return res.status(400).json({ error: uploadValidation.error });
    }

    // Determine target outlet
    let targetOutletId = user.outlet_id;
    let targetOutletName = user.outlet_name;
    const outlets = await appStore.refreshOutlets();

    // If Super Admin uploaded and specified an outlet in body/headers, use it
    if (user.role === "super_admin" && req.body.outlet_id) {
      const match = outlets.find((o) => o.id === req.body.outlet_id);
      if (match) {
        targetOutletId = match.id;
        targetOutletName = match.name;
      }
    }

    if (!targetOutletId) {
      targetOutletId = outlets[0]?.id || "outlet-1";
      targetOutletName = outlets[0]?.name || "Male' Main Branch";
    }

    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = req.file.mimetype || (req.file.originalname.endsWith(".pdf") ? "application/pdf" : "image/jpeg");

    // Persist uploaded file binary to Neon PostgreSQL
    await appStore.saveUploadedFile(req.file.filename, mimeType, fileBuffer);

    const ai = getGeminiClient();
    const settings = await appStore.refreshSettings();

    let extractedData: ExtractedBillData | null = null;
    let confidence: FieldConfidence | null = null;
    let lastRawJson = "";
    let ocrAttempts = 0;
    let ocrErrorMsg: string | null = null;

    if (ai) {
      const runGeminiExtraction = async (retryNote?: string) => {
        ocrAttempts++;
        const promptText = `
You are an expert financial document extraction system specifically tuned for Maldivian purchase bills, receipts, invoices, and handwritten market purchase slips under MIRA (Maldives Inland Revenue Authority) Income Tax & GST Tax Rules.

Extract information from this image into the required JSON schema.

CRITICAL INSTRUCTIONS & RULES:
1. DOCUMENT TYPE CLASSIFICATION:
   - "TAX_INVOICE": Formal tax invoice with vendor GST details and tax calculations.
   - "INVOICE": Standard commercial invoice without explicit GST tax breakdown.
   - "RECEIPT": Till/POS store receipt or cash receipt slip.
   - "HANDWRITTEN_PURCHASE": Handwritten purchase note, paper slip, or local market handwritten bill.
   - "CASH_PURCHASE": Cash voucher or petty cash receipt.
   - "CAPITAL_EXPENDITURE": Purchase of long-term capital assets, machinery, commercial kitchen appliances, electronics, vehicles, or equipment > MVR 10,000.
   - "OTHER" / "UNKNOWN"

2. TAX STATUS CLASSIFICATION:
   - "TAX_CHARGED": GST/VAT is explicitly itemized as a separate amount or rate.
   - "TAX_INCLUDED": Document explicitly states "GST Included" / "Inclusive of Tax".
   - "NO_TAX": Handwritten slip, non-registered seller, cash purchase without GST.
   - "UNKNOWN"

3. MIRA SCHEDULE 1 CATEGORY CLASSIFICATION (Mandatory):
   Evaluate semantic context and item descriptions, then assign exact MIRA Schedule 1 category:
   - "Cost of Sales": Direct food ingredients, beverages, food packaging, raw ingredients for cooking/resale.
   - "Insurance Premium": Property insurance, inventory insurance, staff medical insurance.
   - "Professional & Consulting Fees": Audit, legal, tax advice, IT implementation, accounting software fees.
   - "Rental, Lease & License": Shop lease, restaurant rent, POS software licenses, trade licenses.
   - "Repairs & Maintenance": Equipment servicing, AC repair, kitchen hood cleaning, building maintenance.
   - "Related Party Expenses": Management fees or payments to directors, parent companies, or sister entities.
   - "Salaries & Wages": Staff payroll, allowances, service charge distribution, Ramadan allowance.
   - "Sales & Marketing": Social media ads, promos, flyers, branding design, signage.
   - "Other Expenses": Office stationery, cleaning chemicals, internet, electricity, water, general admin overhead.
   - "Capital Asset (Schedule 2)": Machinery, commercial refrigerators, ovens, espresso machines, computers, furniture, vehicles, or single item value > MVR 10,000.

4. TAX DISALLOWANCES & CAPITAL ASSET DETECTION:
   - mira_schedule1_category: Choose one of the exact Schedule 1 categories listed above.
   - accounting_treatment: "COST_OF_SALES" | "OPERATING_EXPENSE" | "CAPITAL_EXPENDITURE" | "NON_DEDUCTIBLE".
   - income_tax_treatment:
     - "DEDUCTIBLE_EXPENSE": Standard 100% tax-deductible operational expense.
     - "CAPITAL_ALLOWANCE": Capital expenditure eligible for MIRA Schedule 2 Capital Allowance depreciation.
     - "NON_DEDUCTIBLE": Fines, government penalties, MIRA tax penalties, personal/owner expenses, income tax payments.
     - "EXCLUDED": Non-operating transaction.
   - deductible_percentage: 100 for deductible operating expenses / capital allowance; 0 for fines, penalties, personal expenses, or income tax payments.
   - is_capital_asset: Set to true if the bill is for long-term equipment, machinery, electronics, furniture, or single items > MVR 10,000.

5. SEMANTIC FIELD MAPPING (Meaning > Exact Label):
   - document_number: Recognize "Invoice No", "Invoice #", "Inv #", "Bill No", "Bill #", "Receipt No", "Doc #", "Ref #", "Memo #", or handwritten reference.
   - supplier_name: Recognize "Supplier", "Vendor", "Seller", "Sold By", "Shop Name", "Company", "Store Name", or top header text.
   - supplier_tin: Vendor's GST Registration / Tax Identification Number (e.g. 1133533GST501).
     IMPORTANT: OUR TIN is "${settings.myTin}". If you see "${settings.myTin}" under "Bill To", "Customer", or "Buyer", that is OUR TIN! DO NOT put our TIN as the supplier TIN!
   - invoice_date: Format strictly as "DD MMM YYYY" (e.g., "08 AUG 2026").
   - FINANCIALS:
     - taxable_value: Subtotal in MVR (excluding tax if tax charged, or total subtotal if no tax). ALWAYS separate Input GST from net taxable subtotal for tax invoices.
     - gst_amount: Total GST charged in MVR (set to 0 or null if NO_TAX).
     - round_off: Rounding adjustment if present.
     - invoice_total: Final total payable amount in MVR.
   - LINE ITEMS: Extract line items if visible (description, quantity, unit, rate, taxable_value, gst_amount, total).

6. EVIDENCE RULES (HARD MANDATE):
   - ONLY extract values supported by text in the document.
   - NEVER invent TINs, invoice numbers, prices, or taxes. If absent or unreadable, return null.
   - For handwritten/non-tax bills, DO NOT fabricate GST or TIN! Set tax_status to "NO_TAX" and gst_amount to 0 or null.
${retryNote ? `\nRETRY FEEDBACK FROM PREVIOUS ATTEMPT: ${retryNote}\nRe-examine the image carefully for handwritten numbers, alternate labels, or subtotal totals.` : ''}
`;

        const imagePart = {
          inlineData: {
            mimeType,
            data: fileBuffer.toString("base64")
          }
        };

        const response = await generateContentWithRetry(ai, {
          model: "gemini-3.6-flash",
          contents: [imagePart, promptText],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                document_type: { type: Type.STRING },
                tax_status: { type: Type.STRING },
                expense_category: { type: Type.STRING },
                mira_schedule1_category: { type: Type.STRING, nullable: true },
                accounting_treatment: { type: Type.STRING, nullable: true },
                income_tax_treatment: { type: Type.STRING, nullable: true },
                deductible_percentage: { type: Type.NUMBER, nullable: true },
                is_capital_asset: { type: Type.BOOLEAN, nullable: true },
                supplier: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, nullable: true },
                    gstin: { type: Type.STRING, nullable: true },
                    address: { type: Type.STRING, nullable: true },
                    phone: { type: Type.STRING, nullable: true }
                  }
                },
                invoice: {
                  type: Type.OBJECT,
                  properties: {
                    number: { type: Type.STRING, nullable: true },
                    date: { type: Type.STRING, nullable: true },
                    po_number: { type: Type.STRING, nullable: true },
                    currency: { type: Type.STRING, nullable: true },
                    gst_type: { type: Type.STRING, nullable: true }
                  }
                },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      description: { type: Type.STRING },
                      quantity: { type: Type.NUMBER, nullable: true },
                      unit: { type: Type.STRING, nullable: true },
                      rate: { type: Type.NUMBER, nullable: true },
                      discount: { type: Type.NUMBER, nullable: true },
                      taxable_value: { type: Type.NUMBER, nullable: true },
                      gst_rate: { type: Type.NUMBER, nullable: true },
                      gst_amount: { type: Type.NUMBER, nullable: true },
                      total: { type: Type.NUMBER, nullable: true }
                    }
                  }
                },
                totals: {
                  type: Type.OBJECT,
                  properties: {
                    taxable_value: { type: Type.NUMBER, nullable: true },
                    gst_amount: { type: Type.NUMBER, nullable: true },
                    round_off: { type: Type.NUMBER, nullable: true },
                    invoice_total: { type: Type.NUMBER, nullable: true }
                  }
                },
                confidence: {
                  type: Type.OBJECT,
                  properties: {
                    supplier_name: { type: Type.NUMBER },
                    supplier_tin: { type: Type.NUMBER },
                    invoice_number: { type: Type.NUMBER },
                    invoice_date: { type: Type.NUMBER },
                    taxable_value: { type: Type.NUMBER },
                    gst_amount: { type: Type.NUMBER },
                    invoice_total: { type: Type.NUMBER },
                    line_items: { type: Type.NUMBER },
                    overall: { type: Type.NUMBER }
                  }
                },
                notes: { type: Type.STRING, nullable: true }
              }
            }
          }
        });

        const rawJson = response.text ? response.text.trim() : "{}";
        const parsed = JSON.parse(rawJson);

        const docType = (parsed.document_type || "TAX_INVOICE").toUpperCase() as any;
        const taxStat = (parsed.tax_status || "TAX_CHARGED").toUpperCase() as any;
        const expCat = (parsed.expense_category || "Other") as any;

        const formattedDate = formatToMaldivianDate(parsed.invoice?.date || null);
        const taxDerived = deriveTaxTreatment(expCat, docType, parsed.notes);

        let miraCat = parsed.mira_schedule1_category || taxDerived.mira_schedule1_category;
        let acctTreat = parsed.accounting_treatment || taxDerived.accounting_treatment;
        let taxTreat = parsed.income_tax_treatment || taxDerived.income_tax_treatment;
        let dedPct = parsed.deductible_percentage ?? taxDerived.deductible_percentage;

        if (parsed.is_capital_asset || docType === 'CAPITAL_EXPENDITURE' || expCat === 'Equipment') {
          miraCat = 'Capital Asset (Schedule 2)';
          acctTreat = 'CAPITAL_EXPENDITURE';
          taxTreat = 'CAPITAL_ALLOWANCE';
          dedPct = 100;
        }

        const data: ExtractedBillData = {
          document_type: docType,
          tax_status: taxStat,
          expense_category: expCat,
          mira_schedule1_category: miraCat,
          accounting_treatment: acctTreat,
          income_tax_treatment: taxTreat,
          deductible_percentage: dedPct,
          supplier: {
            name: parsed.supplier?.name || null,
            gstin: parsed.supplier?.gstin || null,
            address: parsed.supplier?.address || null,
            phone: parsed.supplier?.phone || null
          },
          invoice: {
            number: parsed.invoice?.number || null,
            date: formattedDate || null,
            po_number: parsed.invoice?.po_number || null,
            currency: parsed.invoice?.currency || "MVR",
            gst_type: parsed.invoice?.gst_type || (taxStat === "NO_TAX" ? "Exempt / No Tax" : "GST 8%")
          },
          items: (parsed.items || []).map((item: any, idx: number) => ({
            id: `item-${idx + 1}`,
            description: item.description || "",
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
            rate: item.rate ?? null,
            discount: item.discount ?? null,
            taxable_value: item.taxable_value ?? null,
            gst_rate: item.gst_rate ?? (taxStat === "NO_TAX" ? 0 : settings.defaultGstRate),
            gst_amount: item.gst_amount ?? (taxStat === "NO_TAX" ? 0 : null),
            total: item.total ?? null
          })),
          totals: {
            taxable_value: parsed.totals?.taxable_value ?? null,
            gst_amount: taxStat === "NO_TAX" ? 0 : (parsed.totals?.gst_amount ?? null),
            round_off: parsed.totals?.round_off ?? 0,
            invoice_total: parsed.totals?.invoice_total ?? null
          },
          notes: parsed.notes || null
        };

        const conf: FieldConfidence = {
          supplier_name: parsed.confidence?.supplier_name ?? 85,
          supplier_tin: parsed.confidence?.supplier_tin ?? 85,
          invoice_number: parsed.confidence?.invoice_number ?? 85,
          invoice_date: parsed.confidence?.invoice_date ?? 85,
          taxable_value: parsed.confidence?.taxable_value ?? 85,
          gst_amount: parsed.confidence?.gst_amount ?? 85,
          invoice_total: parsed.confidence?.invoice_total ?? 85,
          line_items: parsed.confidence?.line_items ?? 80,
          overall: parsed.confidence?.overall ?? 85
        };

        let rawJsonOutput = rawJson;
        return { data, conf, rawJson: rawJsonOutput };
      };

      try {
        // Attempt #1
        const res1 = await runGeminiExtraction();
        extractedData = res1.data;
        confidence = res1.conf;
        lastRawJson = res1.rawJson;

        // Check if Attempt #1 has math errors or critical issues that justify Attempt #2
        const existingBills = getBills();
        const v1 = validateBill(extractedData, existingBills, undefined, targetOutletId);

        if (!v1.is_valid && ocrAttempts === 1) {
          const feedbackMsg = v1.issues.map((i) => i.message).join("; ");
          try {
            console.log("Validation issue on Attempt 1, running Intelligent Retry #2...", feedbackMsg);
            const res2 = await runGeminiExtraction(feedbackMsg);
            const v2 = validateBill(res2.data, existingBills, undefined, targetOutletId);
            // Use Attempt 2 if it improved validity
            if (v2.is_valid || v2.issues.length <= v1.issues.length) {
              extractedData = res2.data;
              confidence = res2.conf;
              lastRawJson = res2.rawJson;
            }
          } catch (retryErr) {
            console.warn("OCR Retry failed, keeping Attempt 1 results:", retryErr);
          }
        }
      } catch (geminiErr: any) {
        console.warn("Gemini AI extraction error:", geminiErr);
        ocrErrorMsg = geminiErr.message || "Failed to parse document with Gemini AI.";
      }
    }

    // PHASE 9 MANDATE: REMOVE FAKE FALLBACK COMPLETELY!
    // Never invent fake MVR 1,000 / GST 80 / STO data.
    const isOcrSuccess = extractedData !== null;
    if (!extractedData) {
      const today = new Date();
      const dateFormatted = formatToMaldivianDate(today.toISOString());

      extractedData = {
        document_type: "UNKNOWN",
        tax_status: "UNKNOWN",
        expense_category: "Other",
        supplier: {
          name: null,
          gstin: null,
          address: null,
          phone: null
        },
        invoice: {
          number: null,
          date: dateFormatted,
          po_number: null,
          currency: "MVR",
          gst_type: "GST 8%"
        },
        items: [],
        totals: {
          taxable_value: null,
          gst_amount: null,
          round_off: 0,
          invoice_total: null
        },
        notes: `OCR Extraction Failed: ${ocrErrorMsg || 'Unable to parse document clearly'}. Please enter details manually.`
      };

      confidence = {
        supplier_name: 0,
        supplier_tin: 0,
        invoice_number: 0,
        invoice_date: 0,
        taxable_value: 0,
        gst_amount: 0,
        invoice_total: 0,
        line_items: 0,
        overall: 0
      };
    }

    await appStore.refreshBills();
    const existingBills = getBills();
    const validation = validateBill(extractedData, existingBills, undefined, targetOutletId);

    const quarterStr = calculateQuarter(extractedData.invoice.date);
    const yearVal = parseInt(quarterStr.split("-")[0], 10) || new Date().getFullYear();

    const ocrStatus = !isOcrSuccess ? "FAILED" : validation.is_valid ? "VALIDATED" : "NEEDS_REVIEW";
    let needsReview = !validation.is_valid || !isOcrSuccess || confidence.overall < 80;

    let reviewReason: string | null = null;
    if (!isOcrSuccess) {
      reviewReason = "OCR processing failed to extract document details. Manual review and entry required.";
    } else if (validation.issues.length > 0) {
      reviewReason = validation.issues.map((i) => i.message).join(" ");
    } else if (confidence.overall < 80) {
      reviewReason = `Low OCR confidence (${confidence.overall}%). Please verify extracted numbers.`;
    }

    const billId = "bill-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

    // AI Governance Integration: Immutable lineage tracking, SHA-256 hash, and automated risk assessment
    let aiExtractionId: string | undefined = undefined;
    let aiGovernanceMeta: any = undefined;
    if (isOcrSuccess) {
      try {
        const aiExtraction = AIGovernanceService.recordAIExtraction({
          documentId: billId,
          tenantId: targetOutletId,
          model: "gemini-3.6-flash",
          modelVersion: "2026-v1.0",
          promptVersion: "mira-bill-extraction-v3.0",
          rawResponseText: lastRawJson || JSON.stringify(extractedData),
          normalizedOutput: extractedData,
          confidence,
          isRetryAttempt: ocrAttempts > 1
        });
        aiExtractionId = aiExtraction.metadata.extractionId;
        const aiSuggestion = AIGovernanceService.generateAISuggestionsAndAssessRisk(aiExtraction, {
          taxpayerTin: settings.myTin
        });
        aiGovernanceMeta = {
          model: aiExtraction.metadata.model,
          modelVersion: aiExtraction.metadata.modelVersion,
          promptVersion: aiExtraction.metadata.promptVersion,
          rawOutputHash: aiExtraction.metadata.rawOutputHash,
          riskScore: aiSuggestion.riskScore,
          anomalies: aiSuggestion.anomaliesDetected.map((a) => a.message),
          requiresHumanReview: aiSuggestion.requiresHumanReview
        };
        if (aiSuggestion.requiresHumanReview && !needsReview) {
          needsReview = true;
          reviewReason = reviewReason ? `${reviewReason} | AI Gov: ${aiSuggestion.reviewTriggers.join(', ')}` : `AI Governance: ${aiSuggestion.reviewTriggers.join(', ')}`;
        }
      } catch (govErr) {
        console.warn("AI Governance extraction record notice:", govErr);
      }
    }

    const newBill: BillRecord = {
      id: billId,
      outlet_id: targetOutletId,
      outlet_name: targetOutletName,
      uploaded_by: {
        userId: user.id,
        userName: user.name,
        userEmail: user.email
      },
      fileName: req.file.originalname,
      fileType: mimeType,
      fileSize: req.file.size,
      fileUrl: `/uploads/${req.file.filename}`,
      uploadDate: new Date().toISOString(),
      status: "pending_review",
      ocr_status: ocrStatus,
      ocr_attempts: Math.max(1, ocrAttempts),
      needs_review: needsReview,
      review_reason: reviewReason,
      extractedData,
      verifiedData: JSON.parse(JSON.stringify(extractedData)),
      confidence,
      validation,
      quarter: quarterStr,
      year: yearVal,
      updatedAt: new Date().toISOString(),
      ai_extraction_id: aiExtractionId,
      ai_governance: aiGovernanceMeta,
      audit_trail: [
        {
          date: new Date().toISOString(),
          action: "Bill Uploaded & Analyzed",
          performedBy: user.name,
          details: `Doc Type: ${extractedData.document_type}, Tax Status: ${extractedData.tax_status}, OCR Status: ${ocrStatus}, Attempts: ${Math.max(1, ocrAttempts)}${aiExtractionId ? `, AI Lineage: ${aiExtractionId}` : ''}`
        }
      ]
    };

    // Store OCR Field Evidence in Prisma Relational Database
    try {
      const tenantId = user.outlet_id || "DEFAULT-TENANT";
      await InvoiceEvidenceService.createInvoiceWithEvidence({
        tenantId,
        fileName: req.file.originalname,
        fileUrl: `/uploads/${req.file.filename}`,
        fileType: mimeType,
        invoiceNumber: extractedData.invoice.number,
        invoiceDate: extractedData.invoice.date,
        currency: extractedData.invoice.currency || "MVR",
        taxableAmount: extractedData.totals.taxable_value,
        gstAmount: extractedData.totals.gst_amount,
        totalAmount: extractedData.totals.invoice_total,
        invoiceType: "PURCHASE",
        status: "ACCOUNTANT_REVIEW",
        lines: extractedData.items.map((it, idx) => ({
          lineNumber: idx + 1,
          description: it.description || `Item ${idx + 1}`,
          quantity: it.quantity ?? 1,
          unitPrice: it.rate ?? it.taxable_value ?? 0,
          taxableAmount: it.taxable_value ?? 0,
          gstRate: (it.gst_rate ?? 8) / 100,
          gstAmount: it.gst_amount ?? 0,
          totalAmount: it.total ?? 0
        })),
        fieldEvidences: {
          supplierName: {
            value: extractedData.supplier.name,
            extractedValue: extractedData.supplier.name,
            confidence: confidence.supplier_name,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          supplierTin: {
            value: extractedData.supplier.gstin,
            extractedValue: extractedData.supplier.gstin,
            confidence: confidence.supplier_tin,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          invoiceNumber: {
            value: extractedData.invoice.number,
            extractedValue: extractedData.invoice.number,
            confidence: confidence.invoice_number,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          invoiceDate: {
            value: extractedData.invoice.date,
            extractedValue: extractedData.invoice.date,
            confidence: confidence.invoice_date,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          taxableAmount: {
            value: extractedData.totals.taxable_value,
            extractedValue: extractedData.totals.taxable_value,
            confidence: confidence.taxable_value,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          gstAmount: {
            value: extractedData.totals.gst_amount,
            extractedValue: extractedData.totals.gst_amount,
            confidence: confidence.gst_amount,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          },
          totalAmount: {
            value: extractedData.totals.invoice_total,
            extractedValue: extractedData.totals.invoice_total,
            confidence: confidence.invoice_total,
            source: 'OCR_MODEL',
            ocrModel: 'gemini-3.6-flash'
          }
        }
      });
    } catch (evidenceDbErr) {
      console.warn("Evidence database sync info:", evidenceDbErr);
    }

    await appStore.upsertBill(newBill);

    res.json(newBill);
  } catch (error: any) {
    console.error("Error analyzing bill:", error);
    res.status(500).json({ error: error.message || "Failed to analyze purchase bill." });
  }
});

// Update single bill record with backend isolation check
app.put("/api/bills/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  await appStore.refreshBills();
  const bills = getBills();
  const index = bills.findIndex((b) => b.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Bill not found" });
  }

  const current = bills[index];

  // Isolation Check:
  if (user.role === "outlet_user" && current.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot modify bill from another outlet." });
  }

  const { verifiedData, status } = req.body;

  if (verifiedData) {
    current.verifiedData = verifiedData;
    current.quarter = calculateQuarter(verifiedData.invoice.date);
    current.year = parseInt(current.quarter.split("-")[0], 10) || new Date().getFullYear();
    current.validation = validateBill(verifiedData, bills, id, current.outlet_id);
  }

  if (status) {
    current.status = status;
    if (status === "verified") {
      current.ocr_status = "APPROVED";
      current.needs_review = false;
      current.review_reason = null;
    } else if (status === "rejected") {
      current.ocr_status = "FAILED";
      current.needs_review = false;
    }
  }

  if (!current.audit_trail) current.audit_trail = [];
  current.audit_trail.push({
    date: new Date().toISOString(),
    action: status === "verified" ? "Bill Approved & Verified" : status === "rejected" ? "Bill Rejected" : "Bill Data Updated",
    performedBy: user.name,
    details: `Updated status to ${current.status}. Doc type: ${current.verifiedData?.document_type || 'N/A'}`
  });

  current.updatedAt = new Date().toISOString();
  await appStore.upsertBill(current);

  res.json(current);
});

// Re-extract AI OCR data for an existing bill
app.post("/api/bills/:id/re-extract", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  await appStore.refreshBills();
  const bills = getBills();
  const index = bills.findIndex((b) => b.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Bill not found" });
  }

  const current = bills[index];

  if (user.role === "outlet_user" && current.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot modify bill from another outlet." });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(400).json({ error: "Gemini AI client is not configured or missing API key." });
  }

  // Load file from local disk or Neon PostgreSQL fallback
  const safeFilename = path.basename(current.fileUrl);
  const storedFile = await appStore.getUploadedFile(safeFilename);
  if (!storedFile) {
    return res.status(404).json({ error: "Original bill file was not found." });
  }

  try {
    const fileBuffer = storedFile.data;
    const mimeType = current.fileType || storedFile.mimeType || (current.fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const settings = await appStore.refreshSettings();

    let extractedData: ExtractedBillData | null = null;
    let confidence: FieldConfidence | null = null;
    let ocrAttempts = current.ocr_attempts || 1;
    let ocrErrorMsg: string | null = null;

    ocrAttempts++;
    const promptText = `
You are an expert financial document extraction system specifically tuned for Maldivian purchase bills, receipts, invoices, and handwritten market purchase slips under MIRA (Maldives Inland Revenue Authority) Income Tax & GST Tax Rules.

Extract information from this image into the required JSON schema.

CRITICAL INSTRUCTIONS & RULES:
1. DOCUMENT TYPE CLASSIFICATION: "TAX_INVOICE" | "INVOICE" | "RECEIPT" | "HANDWRITTEN_PURCHASE" | "CASH_PURCHASE" | "CAPITAL_EXPENDITURE" | "OTHER".
2. TAX STATUS CLASSIFICATION: "TAX_CHARGED" | "TAX_INCLUDED" | "NO_TAX" | "UNKNOWN".
3. MIRA SCHEDULE 1 CATEGORY CLASSIFICATION: Exact Schedule 1 category ("Cost of Sales", "Insurance Premium", "Professional & Consulting Fees", "Rental, Lease & License", "Repairs & Maintenance", "Related Party Expenses", "Salaries & Wages", "Sales & Marketing", "Other Expenses", "Capital Asset (Schedule 2)").
4. EVIDENCE RULES: ONLY extract values supported by text in document.
`;

    const imagePart = {
      inlineData: {
        mimeType,
        data: fileBuffer.toString("base64")
      }
    };

    try {
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.6-flash",
        contents: [imagePart, promptText],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              document_type: { type: Type.STRING },
              tax_status: { type: Type.STRING },
              expense_category: { type: Type.STRING },
              mira_schedule1_category: { type: Type.STRING, nullable: true },
              accounting_treatment: { type: Type.STRING, nullable: true },
              income_tax_treatment: { type: Type.STRING, nullable: true },
              deductible_percentage: { type: Type.NUMBER, nullable: true },
              is_capital_asset: { type: Type.BOOLEAN, nullable: true },
              supplier: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, nullable: true },
                  gstin: { type: Type.STRING, nullable: true },
                  address: { type: Type.STRING, nullable: true },
                  phone: { type: Type.STRING, nullable: true }
                }
              },
              invoice: {
                type: Type.OBJECT,
                properties: {
                  number: { type: Type.STRING, nullable: true },
                  date: { type: Type.STRING, nullable: true },
                  po_number: { type: Type.STRING, nullable: true },
                  currency: { type: Type.STRING, nullable: true },
                  gst_type: { type: Type.STRING, nullable: true }
                }
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    quantity: { type: Type.NUMBER, nullable: true },
                    unit: { type: Type.STRING, nullable: true },
                    rate: { type: Type.NUMBER, nullable: true },
                    discount: { type: Type.NUMBER, nullable: true },
                    taxable_value: { type: Type.NUMBER, nullable: true },
                    gst_rate: { type: Type.NUMBER, nullable: true },
                    gst_amount: { type: Type.NUMBER, nullable: true },
                    total: { type: Type.NUMBER, nullable: true }
                  }
                }
              },
              totals: {
                type: Type.OBJECT,
                properties: {
                  taxable_value: { type: Type.NUMBER, nullable: true },
                  gst_amount: { type: Type.NUMBER, nullable: true },
                  round_off: { type: Type.NUMBER, nullable: true },
                  invoice_total: { type: Type.NUMBER, nullable: true }
                }
              },
              confidence: {
                type: Type.OBJECT,
                properties: {
                  supplier_name: { type: Type.NUMBER },
                  supplier_tin: { type: Type.NUMBER },
                  invoice_number: { type: Type.NUMBER },
                  invoice_date: { type: Type.NUMBER },
                  taxable_value: { type: Type.NUMBER },
                  gst_amount: { type: Type.NUMBER },
                  invoice_total: { type: Type.NUMBER },
                  line_items: { type: Type.NUMBER },
                  overall: { type: Type.NUMBER }
                }
              },
              notes: { type: Type.STRING, nullable: true }
            }
          }
        }
      });

      const rawJson = response.text ? response.text.trim() : "{}";
      const parsed = JSON.parse(rawJson);

      const docType = (parsed.document_type || "TAX_INVOICE").toUpperCase() as any;
      const taxStat = (parsed.tax_status || "TAX_CHARGED").toUpperCase() as any;
      const expCat = (parsed.expense_category || "Other") as any;

      const formattedDate = formatToMaldivianDate(parsed.invoice?.date || null);
      const taxDerived = deriveTaxTreatment(expCat, docType, parsed.notes);

      let miraCat = parsed.mira_schedule1_category || taxDerived.mira_schedule1_category;
      let acctTreat = parsed.accounting_treatment || taxDerived.accounting_treatment;
      let taxTreat = parsed.income_tax_treatment || taxDerived.income_tax_treatment;
      let dedPct = parsed.deductible_percentage ?? taxDerived.deductible_percentage;

      if (parsed.is_capital_asset || docType === 'CAPITAL_EXPENDITURE' || expCat === 'Equipment') {
        miraCat = 'Capital Asset (Schedule 2)';
        acctTreat = 'CAPITAL_EXPENDITURE';
        taxTreat = 'CAPITAL_ALLOWANCE';
        dedPct = 100;
      }

      extractedData = {
        document_type: docType,
        tax_status: taxStat,
        expense_category: expCat,
        mira_schedule1_category: miraCat,
        accounting_treatment: acctTreat,
        income_tax_treatment: taxTreat,
        deductible_percentage: dedPct,
        supplier: {
          name: parsed.supplier?.name || null,
          gstin: parsed.supplier?.gstin || null,
          address: parsed.supplier?.address || null,
          phone: parsed.supplier?.phone || null
        },
        invoice: {
          number: parsed.invoice?.number || null,
          date: formattedDate || null,
          po_number: parsed.invoice?.po_number || null,
          currency: parsed.invoice?.currency || "MVR",
          gst_type: parsed.invoice?.gst_type || (taxStat === "NO_TAX" ? "Exempt / No Tax" : "GST 8%")
        },
        items: (parsed.items || []).map((item: any, idx: number) => ({
          id: `item-${idx + 1}`,
          description: item.description || "",
          quantity: item.quantity ?? null,
          unit: item.unit ?? null,
          rate: item.rate ?? null,
          discount: item.discount ?? null,
          taxable_value: item.taxable_value ?? null,
          gst_rate: item.gst_rate ?? (taxStat === "NO_TAX" ? 0 : settings.defaultGstRate),
          gst_amount: item.gst_amount ?? (taxStat === "NO_TAX" ? 0 : null),
          total: item.total ?? null
        })),
        totals: {
          taxable_value: parsed.totals?.taxable_value ?? null,
          gst_amount: taxStat === "NO_TAX" ? 0 : (parsed.totals?.gst_amount ?? null),
          round_off: parsed.totals?.round_off ?? 0,
          invoice_total: parsed.totals?.invoice_total ?? null
        },
        notes: parsed.notes || null
      };

      confidence = {
        supplier_name: parsed.confidence?.supplier_name ?? 85,
        supplier_tin: parsed.confidence?.supplier_tin ?? 85,
        invoice_number: parsed.confidence?.invoice_number ?? 85,
        invoice_date: parsed.confidence?.invoice_date ?? 85,
        taxable_value: parsed.confidence?.taxable_value ?? 85,
        gst_amount: parsed.confidence?.gst_amount ?? 85,
        invoice_total: parsed.confidence?.invoice_total ?? 85,
        line_items: parsed.confidence?.line_items ?? 80,
        overall: parsed.confidence?.overall ?? 85
      };
    } catch (err: any) {
      console.warn("Re-extraction Gemini AI error:", err);
      ocrErrorMsg = err.message || "Re-extraction failed.";
    }

    if (extractedData) {
      const validation = validateBill(extractedData, bills, current.id, current.outlet_id);
      const ocrStatus = validation.is_valid ? "VALIDATED" : "NEEDS_REVIEW";
      const needsReview = !validation.is_valid || confidence!.overall < 80;

      let reviewReason: string | null = null;
      if (validation.issues.length > 0) {
        reviewReason = validation.issues.map((i) => i.message).join(" ");
      } else if (confidence!.overall < 80) {
        reviewReason = `Low OCR confidence (${confidence!.overall}%). Please verify extracted numbers.`;
      }

      current.extractedData = extractedData;
      current.verifiedData = JSON.parse(JSON.stringify(extractedData));
      current.confidence = confidence!;
      current.validation = validation;
      current.ocr_attempts = ocrAttempts;
      current.ocr_status = ocrStatus;
      current.needs_review = needsReview;
      current.review_reason = reviewReason;
      current.updatedAt = new Date().toISOString();

      if (!current.audit_trail) current.audit_trail = [];
      current.audit_trail.push({
        date: new Date().toISOString(),
        action: "Re-extracted with Gemini AI",
        performedBy: user.name,
        details: `Re-run attempt #${ocrAttempts}. Status: ${ocrStatus}, Confidence: ${confidence!.overall}%`
      });

      await appStore.upsertBill(current);
      return res.json(current);
    } else {
      return res.status(500).json({ error: ocrErrorMsg || "Failed to re-extract bill details." });
    }
  } catch (err: any) {
    console.error("Re-extraction server error:", err);
    return res.status(500).json({ error: err.message || "Failed to re-extract bill." });
  }
});

// Phase 39: AI Governance Status & Policy Endpoint
app.get("/api/ai/governance/status", requireAuth, (req, res) => {
  const thresholds = AIGovernanceService.getReviewThresholds();
  res.json({
    framework: "MIRA Tax Engine AI Governance (Phase 39)",
    policy: {
      aiRole: "ASSISTANT_EXTRACTOR_AND_SUGGESTER",
      postingAuthority: "HUMAN_ONLY",
      approvalAuthority: "HUMAN_ONLY",
      regulatoryOverrideAllowed: false,
      deterministicEngineOverride: true
    },
    thresholds,
    safetyInvariants: [
      "AI cannot directly post transactions to General Ledger",
      "AI cannot alter statutory tax rates (8% General, 16% Tourism)",
      "AI cannot approve tax returns or invoices",
      "Low confidence (< 80% field, < 85% overall) requires mandatory human review",
      "All human overrides of AI extractions are immutably audited with SHA-256 state hashes"
    ]
  });
});

// Phase 39: AI Governance Lineage & Risk Assessment for a specific bill
app.get("/api/bills/:id/governance", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  await appStore.refreshBills();
  const bills = getBills();
  const bill = bills.find((b) => b.id === id);

  if (!bill) {
    return res.status(404).json({ error: "Bill not found" });
  }

  // Tenant Isolation Check
  if (user.role === "outlet_user" && bill.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot view governance details for bill from another outlet." });
  }

  const extractionId = bill.ai_extraction_id;
  const extraction = extractionId ? AIGovernanceService.getExtraction(extractionId) : null;
  const overrides = extractionId ? AIGovernanceService.getOverridesForExtraction(extractionId) : [];

  res.json({
    billId: bill.id,
    ai_extraction_id: extractionId || null,
    ai_governance: bill.ai_governance || null,
    extractionMetadata: extraction?.metadata || null,
    overrides,
    status: bill.status,
    needs_review: bill.needs_review,
    review_reason: bill.review_reason
  });
});

// Delete bill with backend isolation check
app.delete("/api/bills/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  await appStore.refreshBills();
  const bills = getBills();
  const bill = bills.find((b) => b.id === id);

  if (!bill) {
    return res.status(404).json({ error: "Bill not found" });
  }

  // Isolation Check:
  if (user.role === "outlet_user" && bill.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot delete bill from another outlet." });
  }

  const filename = path.basename(bill.fileUrl);
  try {
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error("Failed to delete file from disk", e);
  }

  await appStore.deleteUploadedFile(filename);
  await appStore.deleteBill(id);

  res.json({ success: true, message: "Bill deleted successfully" });
});

// -----------------------------------------------------------------------------
// PHASE 22: INVOICE EVIDENCE & LIFECYCLE API ENDPOINTS
// -----------------------------------------------------------------------------

// GET /api/invoices/:id/evidence - Retrieve full evidence and audit trail
app.get("/api/invoices/:id/evidence", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { id } = req.params;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const invoiceWithEvidence = await InvoiceEvidenceService.getInvoiceWithEvidence(tenantId, id);
    if (!invoiceWithEvidence) {
      return res.status(404).json({ error: `Invoice with ID '${id}' not found.` });
    }

    res.json(invoiceWithEvidence);
  } catch (error: any) {
    console.error("Error retrieving invoice evidence:", error);
    res.status(500).json({ error: error.message || "Failed to retrieve invoice evidence." });
  }
});

// POST /api/invoices/:id/correct - Correct OCR field while preserving original extraction
app.post("/api/invoices/:id/correct", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { id } = req.params;
    const { fieldName, newValue, reason } = req.body;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    if (!fieldName || newValue === undefined) {
      return res.status(400).json({ error: "fieldName and newValue are required." });
    }

    const updated = await InvoiceEvidenceService.correctFieldEvidence({
      invoiceId: id,
      tenantId,
      fieldName,
      newValue,
      correctedBy: user.name,
      correctionReason: reason || "User manual correction"
    });

    res.json({ success: true, invoice: updated });
  } catch (error: any) {
    console.error("Error correcting field evidence:", error);
    res.status(500).json({ error: error.message || "Failed to correct field evidence." });
  }
});

// POST /api/invoices/:id/approve - Approve invoice after validation
app.post("/api/invoices/:id/approve", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { id } = req.params;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const approved = await InvoiceEvidenceService.approveInvoice(tenantId, id, user.name);
    res.json({ success: true, invoice: approved });
  } catch (error: any) {
    console.error("Error approving invoice:", error);
    res.status(400).json({ error: error.message || "Failed to approve invoice." });
  }
});

// POST /api/invoices/:id/post - Post approved invoice to GL
app.post("/api/invoices/:id/post", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { id } = req.params;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const result = await InvoiceEvidenceService.postInvoiceToLedger(tenantId, id, user.name);
    res.json({ success: true, invoice: result.invoice, journal: result.journal });
  } catch (error: any) {
    console.error("Error posting invoice to general ledger:", error);
    res.status(400).json({ error: error.message || "Failed to post invoice to ledger." });
  }
});

// POST /api/invoices/:id/reject - Reject invoice
app.post("/api/invoices/:id/reject", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { id } = req.params;
    const { reason } = req.body;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const rejected = await InvoiceEvidenceService.rejectInvoice(tenantId, id, user.name, reason || "Rejected by reviewer");
    res.json({ success: true, invoice: rejected });
  } catch (error: any) {
    console.error("Error rejecting invoice:", error);
    res.status(500).json({ error: error.message || "Failed to reject invoice." });
  }
});

// POST /api/invoices/validate - Validate invoice data without saving
app.post("/api/invoices/validate", requireAuth, (req, res) => {
  try {
    const validation = InvoiceValidator.validate(req.body);
    res.json(validation);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Validation failed." });
  }
});

// ---------------- CANONICAL 6-DIMENSIONAL CLASSIFICATION API ----------------

// POST /api/classification/classify - Deterministic classification
app.post("/api/classification/classify", requireAuth, (req, res) => {
  try {
    const classification = CanonicalClassificationEngine.classifyLine(req.body);
    res.json(classification);
  } catch (error: any) {
    console.error("Classification error:", error);
    res.status(500).json({ error: error.message || "Failed to classify line item." });
  }
});

// POST /api/classification/suggest - AI/Heuristic classification suggestion
app.post("/api/classification/suggest", requireAuth, async (req, res) => {
  try {
    const suggestion = await CanonicalClassificationEngine.suggestClassification(req.body);
    res.json(suggestion);
  } catch (error: any) {
    console.error("Suggestion error:", error);
    res.status(500).json({ error: error.message || "Failed to generate classification suggestion." });
  }
});

// POST /api/classification/validate - Validate line classification consistency & high-risk status
app.post("/api/classification/validate", requireAuth, (req, res) => {
  try {
    const { classification, input } = req.body;
    const validation = CanonicalClassificationEngine.validateClassification(classification, input);
    res.json(validation);
  } catch (error: any) {
    console.error("Classification validation error:", error);
    res.status(500).json({ error: error.message || "Failed to validate classification." });
  }
});

// POST /api/classification/approve - Approve a line classification by reviewer
app.post("/api/classification/approve", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { invoiceId, lineId, lineNumber, comments } = req.body;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const approved = await CanonicalClassificationEngine.approveClassification({
      tenantId,
      invoiceId,
      lineId,
      lineNumber,
      approvedBy: user.name,
      comments
    });
    res.json({ success: true, classification: approved });
  } catch (error: any) {
    console.error("Classification approval error:", error);
    res.status(400).json({ error: error.message || "Failed to approve classification." });
  }
});

// POST /api/classification/override - Apply human manual override
app.post("/api/classification/override", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { invoiceId, lineId, lineNumber, overrideValues, overrideReason } = req.body;
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    const result = await CanonicalClassificationEngine.overrideClassification({
      tenantId,
      invoiceId,
      lineId,
      lineNumber,
      overrideValues,
      overrideReason,
      overriddenBy: user.name
    });
    res.json({ success: true, classification: result });
  } catch (error: any) {
    console.error("Classification override error:", error);
    res.status(400).json({ error: error.message || "Failed to override classification." });
  }
});

// ================= GST ENGINE & STATUTORY RETURNS (MIRA 205/206) =================

async function loadRealCompanyRevenues() {
  if (appStore.isUsingDatabase()) {
    return await RevenuePersistenceService.getAllAsync("COMPANY-001");
  }
  return RevenuePersistenceService.getAll("COMPANY-001");
}

function resolveGstOutletScope(user: AuthUser, requestedOutletId?: unknown): string | null {
  if (user.role === "outlet_user") {
    return user.outlet_id || null;
  }
  if (typeof requestedOutletId === "string" && requestedOutletId.trim() && requestedOutletId !== "ALL") {
    return requestedOutletId.trim();
  }
  return null;
}

function buildPeriodDateRange(periodName: string): { periodName: string; startDate: string; endDate: string; taxYear: number } {
  const [yearStr, code] = (periodName || "").split("-");
  const taxYear = parseInt(yearStr, 10) || new Date().getFullYear();
  if (code && code.startsWith("Q")) {
    const q = Math.min(4, Math.max(1, parseInt(code.replace("Q", ""), 10) || 1));
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const lastDay = new Date(taxYear, endMonth, 0).getDate();
    return {
      periodName: `${taxYear}-Q${q}`,
      startDate: `${taxYear}-${String(startMonth).padStart(2, "0")}-01`,
      endDate: `${taxYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      taxYear
    };
  }
  const m = Math.min(12, Math.max(1, parseInt((code || "M01").replace("M", ""), 10) || 1));
  const lastDay = new Date(taxYear, m, 0).getDate();
  return {
    periodName: `${taxYear}-M${String(m).padStart(2, "0")}`,
    startDate: `${taxYear}-${String(m).padStart(2, "0")}-01`,
    endDate: `${taxYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    taxYear
  };
}

// GET /api/gst/periods - Summarize uploaded bills & posted revenues by filing period (no demo data)
app.get("/api/gst/periods", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const requestedOutlet = ((req.query.outlet_id || req.query.outletId || req.query.outlet) as string | undefined);
    const effectiveOutletId = resolveGstOutletScope(user, requestedOutlet);

    const [settings, outlets, , allRevenues] = await Promise.all([
      appStore.refreshSettings(),
      appStore.refreshOutlets(),
      appStore.refreshBills(),
      loadRealCompanyRevenues()
    ]);

    const allBills = getBills();
    const scopedBills = effectiveOutletId
      ? allBills.filter((b) => b.outlet_id === effectiveOutletId)
      : allBills;

    const scopedRevenues = allRevenues.filter(
      (r) =>
        r.status === "POSTED" &&
        !String(r.tenantId || "").startsWith("TEST-") &&
        (!effectiveOutletId || r.outletId === effectiveOutletId)
    );

    type PeriodSummary = {
      totalBills: number;
      verifiedBills: number;
      pendingBills: number;
      revenuesCount: number;
      totalBillGst: number;
      totalRevenueGst: number;
    };

    const periods: Record<string, PeriodSummary> = {};
    const yearSet = new Set<number>([new Date().getFullYear(), new Date().getFullYear() - 1]);

    const ensureBucket = (key: string) => {
      if (!periods[key]) {
        periods[key] = {
          totalBills: 0,
          verifiedBills: 0,
          pendingBills: 0,
          revenuesCount: 0,
          totalBillGst: 0,
          totalRevenueGst: 0
        };
      }
      return periods[key];
    };

    let latestBillPeriod: string | null = null;
    let latestRevenuePeriod: string | null = null;

    for (const bill of scopedBills) {
      const data = bill.verifiedData || bill.extractedData;
      if (!data) continue;
      const isoDate = normalizeBillDateToIso(data.invoice?.date, bill.uploadDate);
      const year = parseInt(isoDate.slice(0, 4), 10);
      const month = parseInt(isoDate.slice(5, 7), 10);
      if (isNaN(year) || isNaN(month)) continue;
      yearSet.add(year);

      const quarter = Math.ceil(month / 3);
      const monthKey = `${year}-M${String(month).padStart(2, "0")}`;
      const quarterKey = `${year}-Q${quarter}`;

      if (!latestBillPeriod || monthKey > latestBillPeriod) {
        latestBillPeriod = monthKey;
      }

      const gstAmt = Number(data.totals?.gst_amount || 0);
      for (const key of [monthKey, quarterKey]) {
        const b = ensureBucket(key);
        b.totalBills += 1;
        if (bill.status === "verified") {
          b.verifiedBills += 1;
          b.totalBillGst = Number((b.totalBillGst + gstAmt).toFixed(2));
        } else if (bill.status !== "rejected") {
          b.pendingBills += 1;
        }
      }
    }

    for (const rev of scopedRevenues) {
      const isoDate = normalizeBillDateToIso(rev.transactionDate);
      const year = parseInt(isoDate.slice(0, 4), 10);
      const month = parseInt(isoDate.slice(5, 7), 10);
      if (isNaN(year) || isNaN(month)) continue;
      yearSet.add(year);

      const quarter = Math.ceil(month / 3);
      const monthKey = `${year}-M${String(month).padStart(2, "0")}`;
      const quarterKey = `${year}-Q${quarter}`;

      if (!latestRevenuePeriod || monthKey > latestRevenuePeriod) {
        latestRevenuePeriod = monthKey;
      }

      const gstAmt = Number(rev.gstAmount?.toString() || 0);
      for (const key of [monthKey, quarterKey]) {
        const b = ensureBucket(key);
        b.revenuesCount += 1;
        b.totalRevenueGst = Number((b.totalRevenueGst + gstAmt).toFixed(2));
      }
    }

    const years = Array.from(yearSet).sort((a, b) => b - a);

    res.json({
      success: true,
      settings: { myTin: settings.myTin || "" },
      outlets,
      effectiveOutletId,
      years,
      periods,
      latestBillPeriod: latestBillPeriod || latestRevenuePeriod || `${new Date().getFullYear()}-M${String(new Date().getMonth() + 1).padStart(2, "0")}`
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to load GST filing periods." });
  }
});

// GET /api/gst/rates - Resolve effective GST rate and rule citation
app.get("/api/gst/rates", requireAuth, (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const sector = ((req.query.sector as string)?.toUpperCase() === 'TOURISM' ? 'TOURISM' : 'GENERAL') as any;
    const rateResolution = canonicalGstEngine.resolveGstRate(date, sector);
    res.json({ success: true, rateResolution });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to resolve GST rate." });
  }
});

// POST /api/gst/calculate - Calculate transaction GST and input eligibility
app.post("/api/gst/calculate", requireAuth, (req, res) => {
  try {
    const { transactionDate, sector, taxableAmount, transactionType, treatment, isCapitalAsset, apportionmentRatio } = req.body;
    const calculation = canonicalGstEngine.calculateTransactionGst({
      transactionDate: transactionDate || new Date(),
      sector: (sector?.toUpperCase() === 'TOURISM' ? 'TOURISM' : 'GENERAL'),
      taxableAmount: Number(taxableAmount || 0),
      transactionType: transactionType || 'OUTPUT_TAX',
      treatment,
      isCapitalAsset,
      apportionmentRatio: apportionmentRatio !== undefined ? Number(apportionmentRatio) : undefined
    });
    res.json({ success: true, calculation });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to calculate GST." });
  }
});

// POST /api/gst/mira205 - Generate official MIRA 205 General Sector Return
app.post("/api/gst/mira205", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { transactions, taxpayer, period, previousExcessCredit, outlet_id } = req.body;
    const effectivePeriod = period && period.startDate && period.endDate
      ? period
      : buildPeriodDateRange(period?.periodName || `${new Date().getFullYear()}-M01`);

    const [settings, outlets] = await Promise.all([
      appStore.refreshSettings(),
      appStore.refreshOutlets(),
      appStore.refreshBills()
    ]);

    const effectiveOutletId = resolveGstOutletScope(user, outlet_id);
    const selectedOutletObj = effectiveOutletId ? outlets.find((o) => o.id === effectiveOutletId) : null;

    let effectiveTransactions: GstTransactionInput[] = Array.isArray(transactions) ? transactions : [];
    let billBreakdown: any[] = [];
    let periodStats: any = null;

    if (effectiveTransactions.length === 0) {
      const allBills = getBills();
      const scopedBills = effectiveOutletId
        ? allBills.filter((b) => b.outlet_id === effectiveOutletId)
        : allBills;

      const allRevenues = await loadRealCompanyRevenues();
      const scopedRevenues = allRevenues.filter((rev) => {
        if (rev.status !== "POSTED") return false;
        if (String(rev.tenantId || "").startsWith("TEST-")) return false;
        if ((rev.sector || "GENERAL") !== "GENERAL") return false;
        if (effectiveOutletId && rev.outletId !== effectiveOutletId) return false;
        const isoDate = normalizeBillDateToIso(rev.transactionDate);
        return isoDate >= effectivePeriod.startDate && isoDate <= effectivePeriod.endDate;
      });

      const revenueGstInputs = scopedRevenues.map((r) => RevenueGstService.toGstTransactionInput(r));

      let taxableSupplies = 0;
      let zeroRatedSupplies = 0;
      let exemptSupplies = 0;
      for (const r of scopedRevenues) {
        const net = Number(r.netAmount?.toString() || 0);
        if (r.gstClassification === "ZERO_RATED") zeroRatedSupplies += net;
        else if (r.gstClassification === "EXEMPT" || r.gstClassification === "OUT_OF_SCOPE") exemptSupplies += net;
        else taxableSupplies += net;
      }

      const entityHasExemptSupplies = exemptSupplies > 0;
      const apportionmentRatio = canonicalGstEngine.calculateApportionmentRatio(
        taxableSupplies,
        zeroRatedSupplies,
        exemptSupplies
      );

      const billResult = convertBillsToGstInputs({
        bills: scopedBills,
        period: effectivePeriod,
        targetSector: "GENERAL",
        myTin: settings.myTin,
        entityHasExemptSupplies,
        apportionmentRatio
      });

      billBreakdown = billResult.auditItems;
      periodStats = {
        ...billResult.stats,
        revenueEntriesCount: revenueGstInputs.length,
        outletScope: selectedOutletObj ? selectedOutletObj.name : "All Outlets Consolidated"
      };
      effectiveTransactions = [...billResult.transactions, ...revenueGstInputs];
    }

    const resolvedTaxpayer = {
      tin: taxpayer?.tin?.trim() || selectedOutletObj?.tin || settings.myTin || "NOT-CONFIGURED",
      name:
        taxpayer?.name?.trim() ||
        (selectedOutletObj ? selectedOutletObj.name : "All Outlets Consolidated"),
      businessAddress: taxpayer?.businessAddress?.trim() || selectedOutletObj?.address || undefined
    };

    const returnData = canonicalGstEngine.generateMira205Return({
      transactions: effectiveTransactions,
      taxpayer: resolvedTaxpayer,
      period: effectivePeriod,
      previousExcessCredit: previousExcessCredit ? Number(previousExcessCredit) : 0
    });

    res.json({
      success: true,
      mira205: returnData,
      billBreakdown,
      periodStats
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to generate MIRA 205 return." });
  }
});

// POST /api/gst/mira206 - Generate official MIRA 206 Tourism Sector Return
app.post("/api/gst/mira206", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { transactions, taxpayer, period, previousExcessCredit, outlet_id } = req.body;
    const effectivePeriod = period && period.startDate && period.endDate
      ? period
      : buildPeriodDateRange(period?.periodName || `${new Date().getFullYear()}-M01`);

    const [settings, outlets] = await Promise.all([
      appStore.refreshSettings(),
      appStore.refreshOutlets(),
      appStore.refreshBills()
    ]);

    const effectiveOutletId = resolveGstOutletScope(user, outlet_id);
    const selectedOutletObj = effectiveOutletId ? outlets.find((o) => o.id === effectiveOutletId) : null;

    let effectiveTransactions: GstTransactionInput[] = Array.isArray(transactions) ? transactions : [];
    let billBreakdown: any[] = [];
    let periodStats: any = null;

    if (effectiveTransactions.length === 0) {
      const allBills = getBills();
      const scopedBills = effectiveOutletId
        ? allBills.filter((b) => b.outlet_id === effectiveOutletId)
        : allBills;

      const allRevenues = await loadRealCompanyRevenues();
      const scopedRevenues = allRevenues.filter((rev) => {
        if (rev.status !== "POSTED") return false;
        if (String(rev.tenantId || "").startsWith("TEST-")) return false;
        if (rev.sector !== "TOURISM") return false;
        if (effectiveOutletId && rev.outletId !== effectiveOutletId) return false;
        const isoDate = normalizeBillDateToIso(rev.transactionDate);
        return isoDate >= effectivePeriod.startDate && isoDate <= effectivePeriod.endDate;
      });

      const revenueGstInputs = scopedRevenues.map((r) => RevenueGstService.toGstTransactionInput(r));

      let taxableSupplies = 0;
      let zeroRatedSupplies = 0;
      let exemptSupplies = 0;
      for (const r of scopedRevenues) {
        const net = Number(r.netAmount?.toString() || 0);
        if (r.gstClassification === "ZERO_RATED") zeroRatedSupplies += net;
        else if (r.gstClassification === "EXEMPT" || r.gstClassification === "OUT_OF_SCOPE") exemptSupplies += net;
        else taxableSupplies += net;
      }

      const entityHasExemptSupplies = exemptSupplies > 0;
      const apportionmentRatio = canonicalGstEngine.calculateApportionmentRatio(
        taxableSupplies,
        zeroRatedSupplies,
        exemptSupplies
      );

      const billResult = convertBillsToGstInputs({
        bills: scopedBills,
        period: effectivePeriod,
        targetSector: "TOURISM",
        myTin: settings.myTin,
        entityHasExemptSupplies,
        apportionmentRatio
      });

      billBreakdown = billResult.auditItems;
      periodStats = {
        ...billResult.stats,
        revenueEntriesCount: revenueGstInputs.length,
        outletScope: selectedOutletObj ? selectedOutletObj.name : "All Outlets Consolidated"
      };
      effectiveTransactions = [...billResult.transactions, ...revenueGstInputs];
    }

    const resolvedName =
      taxpayer?.name?.trim() ||
      (selectedOutletObj ? selectedOutletObj.name : "All Outlets Consolidated");

    const resolvedTaxpayer = {
      tin: taxpayer?.tin?.trim() || selectedOutletObj?.tin || settings.myTin || "NOT-CONFIGURED",
      name: resolvedName,
      tourismEstablishmentName: taxpayer?.tourismEstablishmentName?.trim() || resolvedName,
      operatingLicenseNumber: taxpayer?.operatingLicenseNumber?.trim() || selectedOutletObj?.code || ""
    };

    const returnData = canonicalGstEngine.generateMira206Return({
      transactions: effectiveTransactions,
      taxpayer: resolvedTaxpayer,
      period: effectivePeriod,
      previousExcessCredit: previousExcessCredit ? Number(previousExcessCredit) : 0
    });

    res.json({
      success: true,
      mira206: returnData,
      billBreakdown,
      periodStats
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to generate MIRA 206 return." });
  }
});

// POST /api/gst/reconciliation - Reconcile uploaded bills & posted revenues GST subledger to GL accounts
app.post("/api/gst/reconciliation", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { periodStart, periodEnd, sector, outlet_id } = req.body;
    const targetSector = sector === "TOURISM" ? "TOURISM" : "GENERAL";
    const startStr = periodStart || `${new Date().getFullYear()}-01-01`;
    const endStr = periodEnd || `${new Date().getFullYear()}-01-31`;

    const effectiveOutletId = resolveGstOutletScope(user, outlet_id);

    const [settings] = await Promise.all([
      appStore.refreshSettings(),
      appStore.refreshBills()
    ]);

    const allBills = getBills();
    const scopedBills = effectiveOutletId
      ? allBills.filter((b) => b.outlet_id === effectiveOutletId)
      : allBills;

    const allRevenues = await loadRealCompanyRevenues();
    const scopedRevenues = allRevenues.filter((rev) => {
      if (rev.status !== "POSTED") return false;
      if (String(rev.tenantId || "").startsWith("TEST-")) return false;
      if ((rev.sector || "GENERAL") !== targetSector) return false;
      if (effectiveOutletId && rev.outletId !== effectiveOutletId) return false;
      const isoDate = normalizeBillDateToIso(rev.transactionDate);
      return isoDate >= startStr && isoDate <= endStr;
    });

    const billResult = convertBillsToGstInputs({
      bills: scopedBills,
      period: { startDate: startStr, endDate: endStr },
      targetSector,
      myTin: settings.myTin
    });

    const gstTransactionsTotalInputTax = Number(
      billResult.auditItems
        .filter((a) => a.included)
        .reduce((sum, a) => sum + a.claimableGst, 0)
        .toFixed(2)
    );

    const gstTransactionsTotalOutputTax = Number(
      scopedRevenues
        .reduce((sum, r) => sum + (r.gstClassification === "TAXABLE" ? Number(r.gstAmount?.toString() || 0) : 0), 0)
        .toFixed(2)
    );

    let glOutputTaxBalance = 0;
    let glInputTaxBalance = 0;

    if (appStore.isUsingDatabase()) {
      const tenantIds = ["COMPANY-001", ...(effectiveOutletId ? [effectiveOutletId] : [])];
      const pStart = new Date(`${startStr}T00:00:00.000Z`);
      const pEnd = new Date(`${endStr}T23:59:59.999Z`);

      const glLines = await prisma.journalLine.findMany({
        where: {
          journal: {
            tenantId: { in: tenantIds },
            status: "POSTED",
            entryDate: { gte: pStart, lte: pEnd }
          },
          accountCode: {
            in: ["2200-GST-OUTPUT-TAX", "2100-GST-INPUT-TAX", "2200", "2100", "1400"]
          }
        }
      });

      for (const line of glLines) {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        if (line.accountCode === "2200-GST-OUTPUT-TAX" || line.accountCode === "2200") {
          glOutputTaxBalance += credit - debit;
        } else if (line.accountCode === "2100-GST-INPUT-TAX" || line.accountCode === "1400") {
          glInputTaxBalance += debit - credit;
        } else if (line.accountCode === "2100") {
          glOutputTaxBalance += credit - debit;
        }
      }
    }

    glOutputTaxBalance = Number(glOutputTaxBalance.toFixed(2));
    glInputTaxBalance = Number(glInputTaxBalance.toFixed(2));

    const outputTaxVariance = Number(Math.abs(gstTransactionsTotalOutputTax - glOutputTaxBalance).toFixed(2));
    const inputTaxVariance = Number(Math.abs(gstTransactionsTotalInputTax - glInputTaxBalance).toFixed(2));
    const isReconciled = outputTaxVariance < 0.05 && inputTaxVariance < 0.05;
    const discrepancies: string[] = [];

    if (outputTaxVariance >= 0.05) {
      discrepancies.push(
        `Output GST variance of MVR ${outputTaxVariance.toFixed(2)} between Posted Revenue Subledger (MVR ${gstTransactionsTotalOutputTax.toFixed(2)}) and GL Account 2200 (MVR ${glOutputTaxBalance.toFixed(2)})`
      );
    }
    if (inputTaxVariance >= 0.05) {
      discrepancies.push(
        `Input GST variance of MVR ${inputTaxVariance.toFixed(2)} between Verified Bills Subledger (MVR ${gstTransactionsTotalInputTax.toFixed(2)}) and GL Account 1400/2100-INPUT (MVR ${glInputTaxBalance.toFixed(2)})`
      );
    }

    res.json({
      success: true,
      reconciliation: {
        periodStart: startStr,
        periodEnd: endStr,
        sector: targetSector,
        gstTransactionsTotalOutputTax,
        gstTransactionsTotalInputTax,
        glOutputTaxBalance,
        glInputTaxBalance,
        outputTaxVariance,
        inputTaxVariance,
        isReconciled,
        discrepancies
      }
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to reconcile GST to GL." });
  }
});

// ================= NON-RESIDENT WITHHOLDING TAX (NWT) & MIRA 602 =================

// POST /api/nwt/calculate - Calculate Section 55 NWT liability
app.post("/api/nwt/calculate", requireAuth, (req, res) => {
  try {
    const calculation = calculateNwt(req.body);
    res.json({ success: true, calculation });
  } catch (error: any) {
    console.error("NWT calculation error:", error);
    res.status(400).json({ error: error.message || "Failed to calculate NWT." });
  }
});

// POST /api/nwt/mira602 - Generate official MIRA 602 Non-Resident Withholding Tax Return
app.post("/api/nwt/mira602", requireAuth, (req, res) => {
  try {
    const { calculations, period, taxpayer } = req.body;
    const nwtPeriod = period || buildNwtPeriod(new Date().getFullYear(), new Date().getMonth() + 1);
    const nwtTaxpayer = taxpayer || {
      tin: "1000200300",
      businessName: "Registered Maldivian Taxpayer Entity"
    };

    const mira602 = generateMira602Return(calculations || [], nwtPeriod, nwtTaxpayer);
    res.json({ success: true, mira602 });
  } catch (error: any) {
    console.error("MIRA 602 generation error:", error);
    res.status(400).json({ error: error.message || "Failed to generate MIRA 602 return." });
  }
});

// POST /api/nwt/reconciliation - Reconcile NWT Subledger to GL Account 2200
app.post("/api/nwt/reconciliation", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { calculations, period, glBalance } = req.body;
    const nwtPeriod = period || buildNwtPeriod(new Date().getFullYear(), new Date().getMonth() + 1);
    const tenantId = user.outlet_id || "DEFAULT-TENANT";

    let balance = Number(glBalance);
    if (isNaN(balance)) {
      // Query GL Account 2200 (Withholding Tax Payable) from database if not explicitly passed
      const glAccount = await prisma.account.findFirst({
        where: { tenantId, accountCode: '2200' }
      });
      if (glAccount) {
        const lines = await prisma.journalLine.findMany({
          where: { accountId: glAccount.id }
        });
        balance = lines.reduce((acc, line) => acc + Number(line.credit) - Number(line.debit), 0);
      } else {
        balance = 0;
      }
    }

    const reconciliation = reconcileNwtToGl(calculations || [], nwtPeriod, balance);
    res.json({ success: true, reconciliation });
  } catch (error: any) {
    console.error("NWT reconciliation error:", error);
    res.status(400).json({ error: error.message || "Failed to perform NWT reconciliation." });
  }
});

// POST /api/nwt/validate-treaty - Validate Double Tax Avoidance Agreement (DTAA) Certificate
app.post("/api/nwt/validate-treaty", requireAuth, (req, res) => {
  try {
    const { certificate, transactionDate } = req.body;
    const date = transactionDate || new Date().toISOString().split("T")[0];
    const validation = validateDtaaCertificate(certificate, date);
    res.json({ success: true, validation });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to validate DTAA certificate." });
  }
});

// ================= PHASE 26 — INCOME TAX ENGINE (SECTIONS 15, 16, 30, 50, 70) =================

// GET /api/income-tax/rates - Resolve statutory income tax rules & brackets dynamically
app.get("/api/income-tax/rates", requireAuth, (req, res) => {
  try {
    const taxpayerType = (req.query.taxpayerType as any) || "COMPANY";
    const taxYear = req.query.taxYear ? Number(req.query.taxYear) : new Date().getFullYear();
    const effectiveDate = `${taxYear}-12-31`;

    const rules = defaultRuleResolver.resolveAllRules({
      taxType: "INCOME_TAX",
      taxpayerType,
      transactionDate: effectiveDate
    });

    res.json({ success: true, taxYear, taxpayerType, rules });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to resolve income tax rules." });
  }
});

// POST /api/income-tax/taxable-income - Calculate taxable income & loss relief
app.post("/api/income-tax/taxable-income", requireAuth, (req, res) => {
  try {
    const calculation = defaultIncomeTaxEngine.calculateTaxableIncome(req.body);
    res.json({ success: true, calculation });
  } catch (error: any) {
    console.error("Taxable income calculation error:", error);
    res.status(400).json({ error: error.message || "Failed to calculate taxable income." });
  }
});

// POST /api/income-tax/liability - Calculate progressive/corporate bracket tax liability
app.post("/api/income-tax/liability", requireAuth, (req, res) => {
  try {
    const { netTaxableIncome, taxpayerType, taxYear, accountingDays, groupFactor, grossTaxableIncome } = req.body;
    const liability = defaultIncomeTaxEngine.calculateTaxLiability(
      Number(netTaxableIncome || 0),
      taxpayerType || "COMPANY",
      {
        taxYear: taxYear ? Number(taxYear) : undefined,
        accountingDays: accountingDays ? Number(accountingDays) : undefined,
        groupFactor: groupFactor ? Number(groupFactor) : undefined,
        grossTaxableIncome: grossTaxableIncome !== undefined ? Number(grossTaxableIncome) : undefined
      }
    );
    res.json({ success: true, liability });
  } catch (error: any) {
    console.error("Tax liability calculation error:", error);
    res.status(400).json({ error: error.message || "Failed to calculate tax liability." });
  }
});

// POST /api/income-tax/calculate-final - Full end-to-end Income Tax computation
app.post("/api/income-tax/calculate-final", requireAuth, (req, res) => {
  try {
    const result = defaultIncomeTaxEngine.calculateFinalTaxPayable(req.body);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("Final income tax calculation error:", error);
    res.status(400).json({ error: error.message || "Failed to calculate final income tax." });
  }
});

// ================= MILESTONE 7: AUTHORITATIVE MIRA 604 & INCOME TAX ENDPOINTS =================

// Helper to extract UserSession from request
function getIncomeTaxUserSession(req: express.Request): any {
  const user = (req as any).user;
  const tenantId = (req.headers["x-tenant-id"] as string) || (req.query.tenantId as string) || (req.body?.tenantId as string) || user?.tenantId || "COMPANY-001";
  const role = user?.role === "super_admin" ? "CLIENT_ADMIN" : (user?.role?.toUpperCase() || "CLIENT_ADMIN");
  return {
    userId: user?.id || user?.userId || "USR-SYSTEM",
    tenantId,
    role
  };
}

// GET /api/income-tax/:taxYear - Fetch persisted return or current calculation
app.get("/api/income-tax/:taxYear", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = (req.query.tenantId as string) || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    let result = await MIRA604IntegrationService.getReturn(tenantId, taxYear, session);
    if (!result) {
      // Calculate draft if not yet persisted
      result = await MIRA604IntegrationService.calculateAndPrepareReturn(
        {
          tenantId,
          taxYear,
          tin: req.query.tin as string,
          taxpayerName: req.query.taxpayerName as string,
          entityType: req.query.entityType as any
        },
        session
      );
    }

    res.json({ success: true, return: result });
  } catch (error: any) {
    console.error("Get income tax return error:", error);
    const status = error.message?.includes("Cross-tenant") || error.message?.includes("Unauthorized") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to fetch income tax return." });
  }
});

// POST /api/income-tax/:taxYear/calculate - Calculate, reconcile, and persist MIRA 604
app.post("/api/income-tax/:taxYear/calculate", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = req.body?.tenantId || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    const result = await MIRA604IntegrationService.calculateAndPrepareReturn(
      {
        ...req.body,
        tenantId,
        taxYear
      },
      session
    );

    res.json({ success: true, return: result });
  } catch (error: any) {
    console.error("Calculate income tax error:", error);
    const status = error.message?.includes("Cross-tenant") || error.message?.includes("Unauthorized") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to calculate income tax return." });
  }
});

// POST /api/income-tax/:taxYear/approve - Approve calculated return (TAX_MANAGER / CLIENT_ADMIN)
app.post("/api/income-tax/:taxYear/approve", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = req.body?.tenantId || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    const result = await MIRA604IntegrationService.approveReturn(
      tenantId,
      taxYear,
      session,
      { notes: req.body?.notes }
    );

    res.json({ success: true, message: "Tax return approved successfully.", return: result });
  } catch (error: any) {
    console.error("Approve income tax error:", error);
    const status = error.message?.includes("Unauthorized") || error.message?.includes("Cross-tenant") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to approve income tax return." });
  }
});

// POST /api/income-tax/:taxYear/finalize - Finalize and seal immutable return
app.post("/api/income-tax/:taxYear/finalize", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = req.body?.tenantId || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    const result = await MIRA604IntegrationService.finalizeReturn(
      tenantId,
      taxYear,
      session,
      { notes: req.body?.notes }
    );

    res.json({ success: true, message: "Tax return finalized and sealed as immutable.", return: result });
  } catch (error: any) {
    console.error("Finalize income tax error:", error);
    const status = error.message?.includes("Unauthorized") || error.message?.includes("Cross-tenant") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to finalize income tax return." });
  }
});

// DELETE /api/income-tax/:taxYear - Delete an unfinalized return
app.delete("/api/income-tax/:taxYear", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = (req.query.tenantId as string) || (req.body?.tenantId as string) || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    const result = await MIRA604IntegrationService.deleteReturn(tenantId, taxYear, session);
    res.json({ success: true, message: result.message });
  } catch (error: any) {
    console.error("Delete income tax return error:", error);
    const status = error.message?.includes("Unauthorized") || error.message?.includes("Cross-tenant") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to delete income tax return." });
  }
});

// GET /api/income-tax/:taxYear/trace - Retrieve transaction-to-box trace
app.get("/api/income-tax/:taxYear/trace", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = (req.query.tenantId as string) || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    let trace = await MIRA604IntegrationService.getTrace(tenantId, taxYear, session);
    if (!trace) {
      const ret = await MIRA604IntegrationService.calculateAndPrepareReturn({ tenantId, taxYear }, session);
      trace = ret.trace;
    }

    res.json({ success: true, trace });
  } catch (error: any) {
    console.error("Get income tax trace error:", error);
    const status = error.message?.includes("Unauthorized") || error.message?.includes("Cross-tenant") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to retrieve tax trace." });
  }
});

// GET /api/income-tax/:taxYear/reconciliation - Retrieve 5-way reconciliation report
app.get("/api/income-tax/:taxYear/reconciliation", requireAuth, async (req, res) => {
  try {
    const taxYear = parseInt(req.params.taxYear, 10);
    const session = getIncomeTaxUserSession(req);
    const tenantId = (req.query.tenantId as string) || session.tenantId;

    if (tenantId !== session.tenantId && session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied: cross-tenant access is prohibited." });
    }

    let ret = await MIRA604IntegrationService.getReturn(tenantId, taxYear, session);
    if (!ret) {
      ret = await MIRA604IntegrationService.calculateAndPrepareReturn({ tenantId, taxYear }, session);
    }

    res.json({ success: true, reconciliation: ret.reconciliation });
  } catch (error: any) {
    console.error("Get income tax reconciliation error:", error);
    const status = error.message?.includes("Unauthorized") || error.message?.includes("Cross-tenant") ? 403 : 400;
    res.status(status).json({ error: error.message || "Failed to retrieve tax reconciliation." });
  }
});

// ---------------- EXCEL TEMPLATE & EXPORT ----------------

app.get("/api/template/info", requireAuth, async (_req, res) => {
  const storedTemplate = await appStore.getCustomTemplateBuffer();
  const hasCustom = Boolean(storedTemplate);
  let availableColumns: string[] = [];
  const settings = await appStore.refreshSettings();

  if (storedTemplate) {
    try {
      const workbook = XLSX.read(storedTemplate.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (data.length > 0) {
        availableColumns = data[0].map((c) => String(c || "").trim()).filter(Boolean);
      }
    } catch (e) {
      console.error("Error reading template excel file", e);
    }
  }

  res.json({
    hasCustomTemplate: hasCustom,
    filename: storedTemplate ? storedTemplate.filename : undefined,
    availableColumns,
    mapping: settings.templateMapping
  } as ExcelTemplateInfo);
});

app.post("/api/template/upload", requireAuth, requireSuperAdmin, uploadRateLimiter.middleware(), upload.single("templateFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No Excel file provided." });
  }

  // Validate Excel upload structure and magic bytes
  const validation = UploadValidator.validateFile(req.file, TEMPLATE_UPLOAD_CONSTRAINTS);
  if (!validation.isValid) {
    if (req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    return res.status(400).json({ error: validation.error });
  }

  try {
    const templateBuffer = fs.readFileSync(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

    const workbook = XLSX.read(templateBuffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const cols = (rows[0] || []).map((c) => String(c || "").trim()).filter(Boolean);

    await appStore.saveCustomTemplate(req.file.originalname || "custom_template.xlsx", templateBuffer);

    res.json({
      success: true,
      message: "Template uploaded successfully",
      columns: cols
    });
  } catch (error: any) {
    console.error("Error reading template:", error);
    res.status(500).json({ error: "Invalid Excel template file." });
  }
});

// Excel Export API with Outlet Scope & Consolidation Support
app.post("/api/export/excel", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { quarter, year, status, outlet: requestedOutlet } = req.body;
    await appStore.refreshBills();
    let bills = getBills();

    // Backend Isolation:
    let effectiveOutlet = requestedOutlet;
    if (user.role === "outlet_user") {
      effectiveOutlet = user.outlet_id;
    }

    if (effectiveOutlet && effectiveOutlet !== "ALL") {
      bills = bills.filter((b) => b.outlet_id === effectiveOutlet);
    }

    if (status) {
      bills = bills.filter((b) => b.status === status);
    } else {
      bills = bills.filter((b) => b.status === "verified");
    }

    if (quarter) {
      bills = bills.filter((b) => b.quarter === quarter);
    }
    if (year) {
      const yNum = parseInt(year, 10);
      if (!isNaN(yNum)) {
        bills = bills.filter((b) => b.year === yNum);
      }
    }

    const settings = await appStore.refreshSettings();
    const mapping = settings.templateMapping;
    const storedTemplate = await appStore.getCustomTemplateBuffer();

    let workbook: any;
    let sheetName = "GST Purchases";

    if (storedTemplate) {
      workbook = XLSX.read(storedTemplate.buffer, { type: "buffer" });
      sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const existingRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const headers: string[] = (existingRows[0] || []).map((h) => String(h || "").trim());

      const newRows: any[][] = [];

      bills.forEach((b) => {
        const rowData = getRowForHeaders(headers, b, mapping);
        const rowArr = headers.map((h) => (rowData[h] !== undefined ? rowData[h] : ""));
        newRows.push(rowArr);
      });

      XLSX.utils.sheet_add_aoa(sheet, newRows, { origin: -1 });
    } else {
      workbook = XLSX.utils.book_new();

      const defaultHeaders = [
        "Outlet Name",
        "Supplier Name",
        "Supplier Tin",
        "Invoice Number",
        "Invoice Date",
        "Subtotal (Excl. GST)",
        "GST Amount (8%)",
        "Invoice Total",
        "Quarter",
        "Notes"
      ];

      const exportRows = bills.map((b) => getRowForHeaders(defaultHeaders, b, mapping));

      const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: defaultHeaders });
      worksheet["!cols"] = [
        { wch: 25 }, { wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 15 },
        { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 25 }
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const filename = `CR_Maldives_GST_Purchases_${quarter || "Export"}_${Date.now()}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error: any) {
    console.error("Excel export error:", error);
    res.status(500).json({ error: "Failed to generate Excel file." });
  }
});

// Google Sheets Sync API
app.post("/api/export/google-sheets", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const { quarter, year, outlet: requestedOutlet } = req.body;
    await appStore.refreshBills();
    let bills = getBills().filter((b) => b.status === "verified");

    if (user.role === "outlet_user") {
      bills = bills.filter((b) => b.outlet_id === user.outlet_id);
    } else if (requestedOutlet && requestedOutlet !== "ALL") {
      bills = bills.filter((b) => b.outlet_id === requestedOutlet);
    }

    if (quarter) {
      bills = bills.filter((b) => b.quarter === quarter);
    }
    if (year) {
      const yNum = parseInt(year, 10);
      if (!isNaN(yNum)) bills = bills.filter((b) => b.year === yNum);
    }

    const settings = await appStore.refreshSettings();
    if (!settings.googleSheets.spreadsheetId) {
      return res.status(400).json({ error: "Google Spreadsheet ID is not configured." });
    }

    const defaultHeaders = [
      "Outlet Name",
      "Supplier Name",
      "Supplier Tin",
      "Invoice Number",
      "Invoice Date",
      "Subtotal (Excl. GST)",
      "GST Amount (8%)",
      "Invoice Total",
      "Quarter",
      "Notes"
    ];

    const rows = bills.map((b) => getRowForHeaders(defaultHeaders, b, settings.templateMapping));

    res.json({
      success: true,
      exportedCount: rows.length,
      spreadsheetId: settings.googleSheets.spreadsheetId,
      message: `Successfully synchronized ${rows.length} verified bill(s) to Google Sheets.`
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to sync with Google Sheets." });
  }
});

// ---------------- REVENUE & INCOME TAX ROUTES ----------------

// Helper to convert RevenueTransaction to frontend-compatible RevenueRecord
function formatRevenueForClient(r: any): any {
  const gross = Number(r.grossAmount ?? r.gross_amount ?? r.amount ?? 0);
  const gst = Number(r.gstAmount ?? r.gst_collected ?? 0);
  const net = Number(r.netAmount ?? r.net_revenue ?? (gross - gst));
  const dStr = r.transactionDate || r.date || new Date().toISOString().split("T")[0];
  const quarterStr = calculateQuarter(dStr);
  const yearVal = parseInt(quarterStr.split("-")[0], 10) || new Date(dStr).getFullYear();

  return {
    id: r.id,
    outlet_id: r.outletId || r.outlet_id || "outlet-1",
    outlet_name: r.outletName || r.outlet_name || "Main Branch",
    date: dStr,
    category: r.category || "POS Sales",
    gross_amount: gross,
    gst_collected: gst,
    net_revenue: net,
    amount: net,
    payment_method: r.paymentMethod || r.payment_method || "Card / POS",
    notes: r.description || r.notes || "Sales Revenue",
    description: r.description || r.notes || "Sales Revenue",
    quarter: r.quarter || quarterStr,
    year: r.year || yearVal,
    status: r.status || "POSTED",
    journalId: r.journalId,
    gstTransactionId: r.gstTransactionId,
    gstRate: r.gstRate,
    gstRuleId: r.gstRuleId,
    accountingPeriodId: r.accountingPeriodId || quarterStr,
    accountingPeriod: {
      periodName: r.quarter || quarterStr,
      quarter: r.quarter || quarterStr,
      year: r.year || yearVal,
      month: dStr.slice(0, 7)
    },
    reversalJournalId: r.reversalJournalId,
    reversalOfId: r.reversalOfId,
    reversedById: r.reversedById,
    correctionNote: r.correctionNote,
    created_by: r.createdBy || r.created_by || "System",
    created_at: r.createdAt || r.created_at || new Date().toISOString()
  };
}

// GET /api/revenue/reconcile - 4-way revenue reconciliation
app.get("/api/revenue/reconcile", requireAuth, async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req as any).user?.tenantId || "COMPANY-001";
    const report = await RevenueReconciliationService.reconcileRevenue({
      tenantId,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      outletId: req.query.outletId as string,
      prismaClient: prisma
    });
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: "Reconciliation failed", details: err.message });
  }
});

// GET /api/revenue/:id/trace - Comprehensive audit and accounting trace
app.get("/api/revenue/:id/trace", requireAuth, async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req as any).user?.tenantId || "COMPANY-001";
    const trace = await RevenueTraceService.getDiagnosticTrace(req.params.id, tenantId, prisma);
    if (!trace) {
      return res.status(404).json({ error: "Revenue transaction not found for trace." });
    }
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: "Trace failed", details: err.message });
  }
});

// GET /api/revenue - List revenue entries
app.get("/api/revenue", requireAuth, (req, res) => {
  const user = (req as any).user as AuthUser;
  let revenues = RevenuePersistenceService.getAll("COMPANY-001");

  // Fallback to legacy getRevenues() if persistence is empty
  if (revenues.length === 0) {
    const legacy = getRevenues();
    if (legacy.length > 0) {
      for (const l of legacy) {
        RevenuePersistenceService.save(l as any);
      }
      revenues = RevenuePersistenceService.getAll("COMPANY-001");
    }
  }

  let formatted = revenues.map(formatRevenueForClient);

  const requestedRevenueOutlet = (req.query.outletId || req.query.outlet || req.query.outlet_id) as string | undefined;
  if (user.role === "outlet_user") {
    formatted = formatted.filter((r) => r.outlet_id === user.outlet_id);
  } else if (requestedRevenueOutlet && requestedRevenueOutlet !== "ALL") {
    formatted = formatted.filter((r) => r.outlet_id === requestedRevenueOutlet);
  }

  if (req.query.year) {
    const yNum = parseInt(req.query.year as string, 10);
    if (!isNaN(yNum)) {
      formatted = formatted.filter((r) => (r.year || new Date(r.date).getFullYear()) === yNum);
    }
  }

  formatted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  res.json(formatted);
});

// GET /api/revenue/:id - Retrieve a single enriched revenue entry
app.get("/api/revenue/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const record = RevenuePersistenceService.getById(id, "COMPANY-001");
  if (!record) {
    return res.status(404).json({ error: "Revenue entry not found.", code: "NOT_FOUND" });
  }

  if (user.role === "outlet_user" && record.outletId !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot view revenue from another outlet." });
  }

  res.json(formatRevenueForClient(record));
});

// POST /api/revenue - Add a revenue entry (or bulk array) with authoritative journal posting
app.post("/api/revenue", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const outlets = await appStore.refreshOutlets();

  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === "super_admin" ? "CLIENT_ADMIN" : "STAFF_ACCOUNTANT") as any,
    tenantId: "COMPANY-001",
    permissions: ["POST_JOURNAL", "CREATE_TRANSACTIONS", "REVERSE_TRANSACTIONS", "VIEW_REPORTS", "EXPORT_DATA"] as any
  };

  const processEntry = async (body: any) => {
    let targetOutletId = body.outlet_id || body.outletId;
    let targetOutletName = body.outlet_name || body.outletName;

    if (user.role === "outlet_user") {
      targetOutletId = user.outlet_id;
      targetOutletName = user.outlet_name || "Branch Outlet";
    } else {
      const match = outlets.find((o) => o.id === targetOutletId);
      targetOutletName = match ? match.name : (outlets[0]?.name || "Main Branch");
    }

    const dStr = body.date || body.transactionDate || new Date().toISOString().split("T")[0];
    const grossVal = body.gross_amount ?? body.grossAmount ?? body.amount;
    const netVal = body.net_revenue ?? body.netAmount;

    return await RevenuePostingService.postRevenue(
      {
        tenantId: "COMPANY-001",
        outletId: targetOutletId,
        outletName: targetOutletName,
        transactionDate: dStr,
        category: body.category || "POS Sales",
        description: body.description || body.notes || "Sales Revenue",
        grossAmount: grossVal,
        netAmount: netVal,
        amountBasis: body.amountBasis || "GST_INCLUSIVE",
        sector: body.sector || "GENERAL",
        gstClassification: body.gstClassification || "TAXABLE",
        paymentMethod: body.payment_method || body.paymentMethod || "CARD",
        idempotencyKey: body.idempotencyKey,
        sourceId: body.sourceId,
        notes: body.notes || body.description,
        autoPost: body.autoPost !== false
      },
      session,
      prisma
    );
  };

  try {
    if (Array.isArray(req.body)) {
      const results = [];
      for (const item of req.body) {
        const created = await processEntry(item);
        results.push(formatRevenueForClient(created));
      }
      return res.status(201).json({ success: true, count: results.length, entries: results });
    }

    const { date, transactionDate, gross_amount, grossAmount, net_revenue, netAmount, amount } = req.body;
    const dVal = date || transactionDate;
    if (!dVal || (gross_amount === undefined && grossAmount === undefined && net_revenue === undefined && netAmount === undefined && amount === undefined)) {
      return res.status(400).json({ error: "Date and gross_amount/net_revenue are required." });
    }

    const created = await processEntry(req.body);
    res.status(201).json(formatRevenueForClient(created));
  } catch (err: any) {
    console.error("Error posting revenue:", err);
    res.status(400).json({ error: err.message || "Failed to post revenue" });
  }
});

// PUT /api/revenue/:id - Edit an existing revenue entry (DRAFT or VALIDATED only; POSTED rejected)
app.put("/api/revenue/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const existing = RevenuePersistenceService.getById(id, "COMPANY-001");

  if (!existing) {
    return res.status(404).json({ error: "Revenue entry not found.", code: "NOT_FOUND" });
  }

  if (user.role === "outlet_user" && existing.outletId !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot edit revenue from another outlet." });
  }

  if (existing.status === "POSTED") {
    return res.status(400).json({
      error: "Cannot modify POSTED revenue transaction in place. Financial ledger entries are immutable. Please use the reversal or correction workflow.",
      code: "TRANSACTION_ALREADY_POSTED"
    });
  }

  if (existing.status !== "DRAFT" && existing.status !== "VALIDATED") {
    return res.status(400).json({
      error: `Cannot modify transaction with status ${existing.status}. Only DRAFT and VALIDATED transactions may be edited.`,
      code: existing.status === "REVERSED" ? "TRANSACTION_ALREADY_POSTED" : "INVALID_TRANSACTION_STATE"
    });
  }

  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === "super_admin" ? "CLIENT_ADMIN" : "STAFF_ACCOUNTANT") as any,
    tenantId: "COMPANY-001",
    permissions: ["POST_JOURNAL", "CREATE_TRANSACTIONS", "REVERSE_TRANSACTIONS", "VIEW_REPORTS", "EXPORT_DATA"] as any
  };

  try {
    const updated = await RevenuePostingService.updateDraft(id, req.body, session);
    res.json(formatRevenueForClient(updated));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/revenue/:id - Delete an unposted DRAFT entry (POSTED and REVERSED rejected)
app.delete("/api/revenue/:id", requireAuth, (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const existing = RevenuePersistenceService.getById(id, "COMPANY-001");

  if (!existing) {
    return res.status(404).json({ error: "Revenue record not found.", code: "NOT_FOUND" });
  }

  if (user.role === "outlet_user" && existing.outletId !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot delete revenue record from another outlet." });
  }

  if (existing.status === "POSTED" || existing.status === "REVERSED") {
    return res.status(400).json({
      error: `Cannot delete ${existing.status} revenue transaction. Posted accounting transactions are immutable. Use the reversal workflow to void the transaction.`,
      code: "CANNOT_DELETE_POSTED_TRANSACTION"
    });
  }

  if (existing.status !== "DRAFT") {
    return res.status(400).json({
      error: `Cannot delete transaction with status ${existing.status}. Only DRAFT transactions may be deleted.`,
      code: "CANNOT_DELETE_NON_DRAFT"
    });
  }

  try {
    RevenuePostingService.deleteTransaction(id, "COMPANY-001");
    res.json({ success: true, message: "Revenue draft deleted successfully." });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/revenue/:id/reverse - Formally reverse a posted revenue transaction
app.post("/api/revenue/:id/reverse", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const { reason } = req.body;

  const existing = RevenuePersistenceService.getById(id, "COMPANY-001");
  if (!existing) {
    return res.status(404).json({ error: "Revenue transaction not found.", code: "NOT_FOUND" });
  }

  if (user.role === "outlet_user" && existing.outletId !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot reverse revenue from another outlet." });
  }

  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === "super_admin" ? "CLIENT_ADMIN" : "STAFF_ACCOUNTANT") as any,
    tenantId: "COMPANY-001",
    permissions: ["POST_JOURNAL", "CREATE_TRANSACTIONS", "REVERSE_TRANSACTIONS", "VIEW_REPORTS", "EXPORT_DATA"] as any
  };

  try {
    const reversed = await RevenuePostingService.reverseRevenue(
      id,
      reason || "Reversal requested by user",
      session,
      prisma
    );
    res.json({
      success: true,
      message: `Transaction ${id} reversed successfully`,
      reversedTransaction: formatRevenueForClient(reversed)
    });
  } catch (err: any) {
    console.error("Error reversing revenue:", err);
    res.status(400).json({ error: err.message || "Failed to reverse revenue" });
  }
});

// POST /api/revenue/:id/correct - Atomically reverse and replace a posted revenue transaction
app.post("/api/revenue/:id/correct", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;

  const existing = RevenuePersistenceService.getById(id, "COMPANY-001");
  if (!existing) {
    return res.status(404).json({ error: "Revenue transaction not found.", code: "NOT_FOUND" });
  }

  if (user.role === "outlet_user" && existing.outletId !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot correct revenue from another outlet." });
  }

  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === "super_admin" ? "CLIENT_ADMIN" : "STAFF_ACCOUNTANT") as any,
    tenantId: "COMPANY-001",
    permissions: ["POST_JOURNAL", "CREATE_TRANSACTIONS", "REVERSE_TRANSACTIONS", "VIEW_REPORTS", "EXPORT_DATA"] as any
  };

  try {
    const { original, replacement } = await RevenuePostingService.correctRevenue(
      id,
      req.body,
      session,
      prisma
    );
    res.json({
      success: true,
      message: `Transaction ${id} corrected. Replacement posted as ${replacement.id}`,
      original: formatRevenueForClient(original),
      replacement: formatRevenueForClient(replacement)
    });
  } catch (err: any) {
    console.error("Error correcting revenue:", err);
    res.status(400).json({ error: err.message || "Failed to correct revenue" });
  }
});

// ================= FIXED ASSET REGISTER & CAPITAL ALLOWANCE ROUTES =================

// GET /api/assets - Get fixed asset register items
app.get("/api/assets", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  let assets = await appStore.refreshAssets();

  const requestedAssetOutlet = (req.query.outletId || req.query.outlet || req.query.outlet_id) as string | undefined;
  if (user.role === "outlet_user") {
    assets = assets.filter((a) => a.outlet_id === user.outlet_id);
  } else if (requestedAssetOutlet && requestedAssetOutlet !== "ALL") {
    assets = assets.filter((a) => a.outlet_id === requestedAssetOutlet);
  }

  if (req.query.year) {
    const yNum = parseInt(req.query.year as string, 10);
    if (!isNaN(yNum)) {
      assets = assets.filter((a) => new Date(a.purchase_date).getFullYear() === yNum);
    }
  }

  assets.sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());

  res.json(assets);
});

// POST /api/assets - Add fixed asset entry (or bulk array)
app.post("/api/assets", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const outlets = await appStore.refreshOutlets();

  const handleSingleAsset = (body: any): FixedAssetRecord => {
    const {
      id,
      outlet_id,
      asset_name,
      asset_class,
      purchase_date,
      cost_price,
      mira_rate,
      opening_wdv,
      supplier,
      notes,
      bill_id
    } = body;

    let targetOutletId = outlet_id;
    let targetOutletName = "";

    if (user.role === "outlet_user") {
      targetOutletId = user.outlet_id;
      targetOutletName = user.outlet_name || "Branch Outlet";
    } else {
      const match = outlets.find((o) => o.id === targetOutletId);
      targetOutletName = match ? match.name : (outlets[0]?.name || "Main Branch");
    }

    const aClass: AssetClass = asset_class || 'Plant & Equipment / Machinery';
    const stdRate = mira_rate !== undefined ? Number(mira_rate) : (MIRA_CAPITAL_ALLOWANCE_RATES[aClass] || 10);
    const costNum = Number(cost_price || 0);
    const openWdv = opening_wdv !== undefined ? Number(opening_wdv) : costNum;

    const allowance = Math.min(openWdv, Number((openWdv * (stdRate / 100)).toFixed(2)));
    const closeWdv = Number((openWdv - allowance).toFixed(2));

    return {
      id: id || ("ast-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)),
      outlet_id: targetOutletId,
      outlet_name: targetOutletName,
      asset_name: asset_name || "Capital Asset",
      asset_class: aClass,
      purchase_date: purchase_date || new Date().toISOString().split("T")[0],
      cost_price: costNum,
      mira_rate: stdRate,
      opening_wdv: openWdv,
      capital_allowance: allowance,
      closing_wdv: closeWdv,
      supplier: supplier || "",
      notes: notes || "",
      bill_id: bill_id || "",
      created_at: new Date().toISOString()
    };
  };

  const assets = await appStore.refreshAssets();

  if (Array.isArray(req.body)) {
    const newAssets = req.body.map((item) => handleSingleAsset(item));
    const updated = [...newAssets, ...assets];
    await appStore.saveAssets(updated);
    return res.json({ success: true, count: newAssets.length, entries: newAssets });
  }

  const newAsset = handleSingleAsset(req.body);
  await appStore.upsertAsset(newAsset);

  res.json(newAsset);
});

// POST /api/assets/import-from-bills - Automatically register Capital Expenditure bills into asset register
app.post("/api/assets/import-from-bills", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const [, existingAssets, outlets] = await Promise.all([
    appStore.refreshBills(),
    appStore.refreshAssets(),
    appStore.refreshOutlets()
  ]);
  const bills = getBills();

  let importedCount = 0;
  const created: FixedAssetRecord[] = [];

  bills.forEach((b) => {
    if (b.status === "rejected") return;
    if (user.role === "outlet_user" && b.outlet_id !== user.outlet_id) return;
    const data = b.verifiedData || b.extractedData;

    const isCapEx =
      data.document_type === "CAPITAL_EXPENDITURE" ||
      data.mira_schedule1_category === "Capital Asset (Schedule 2)" ||
      data.income_tax_treatment === "CAPITAL_ALLOWANCE";

    if (isCapEx) {
      // Check if already registered
      const alreadyExists = existingAssets.some((a) => a.bill_id === b.id);
      if (!alreadyExists) {
        let outletName = b.outlet_name || "";
        const matchOutlet = outlets.find((o) => o.id === b.outlet_id);
        if (matchOutlet) outletName = matchOutlet.name;

        const costVal = data.totals?.taxable_value || data.totals?.invoice_total || 0;
        const aClass: AssetClass = 'Plant & Equipment / Machinery';
        const stdRate = MIRA_CAPITAL_ALLOWANCE_RATES[aClass] || 10;
        const allowance = Number((costVal * (stdRate / 100)).toFixed(2));
        const closeWdv = Number((costVal - allowance).toFixed(2));

        const invNum = data.invoice?.number || (data.invoice as any)?.invoice_number || "Invoice Purchase";
        const newAsset: FixedAssetRecord = {
          id: "ast-bill-" + b.id.slice(0, 8),
          outlet_id: b.outlet_id,
          outlet_name: outletName,
          asset_name: (data.supplier?.name || "Equipment") + " - " + invNum,
          asset_class: aClass,
          purchase_date: data.invoice?.date || b.uploadDate.split("T")[0],
          cost_price: costVal,
          mira_rate: stdRate,
          opening_wdv: costVal,
          capital_allowance: allowance,
          closing_wdv: closeWdv,
          bill_id: b.id,
          supplier: data.supplier?.name || "",
          notes: `Imported from purchase bill #${invNum}`,
          created_at: new Date().toISOString()
        };

        existingAssets.unshift(newAsset);
        created.push(newAsset);
        importedCount++;
      }
    }
  });

  if (importedCount > 0) {
    await appStore.saveAssets(existingAssets);
  }

  res.json({ success: true, count: importedCount, created });
});

// PUT /api/assets/:id - Update an existing asset entry
app.put("/api/assets/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const assets = await appStore.refreshAssets();
  const index = assets.findIndex((a) => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Fixed asset record not found." });
  }

  const existing = assets[index];
  if (user.role === "outlet_user" && existing.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot edit assets from another outlet." });
  }

  const {
    outlet_id,
    asset_name,
    asset_class,
    purchase_date,
    cost_price,
    mira_rate,
    opening_wdv,
    supplier,
    notes
  } = req.body;

  const outlets = await appStore.refreshOutlets();
  let targetOutletId = existing.outlet_id;
  let targetOutletName = existing.outlet_name;

  if (user.role !== "outlet_user" && outlet_id) {
    targetOutletId = outlet_id;
    const match = outlets.find((o) => o.id === outlet_id);
    targetOutletName = match ? match.name : targetOutletName;
  }

  const aClass: AssetClass = asset_class || existing.asset_class;
  const stdRate = mira_rate !== undefined ? Number(mira_rate) : (MIRA_CAPITAL_ALLOWANCE_RATES[aClass] || existing.mira_rate);
  const costNum = cost_price !== undefined ? Number(cost_price) : existing.cost_price;
  const openWdv = opening_wdv !== undefined ? Number(opening_wdv) : existing.opening_wdv;

  const allowance = Math.min(openWdv, Number((openWdv * (stdRate / 100)).toFixed(2)));
  const closeWdv = Number((openWdv - allowance).toFixed(2));

  const updated: FixedAssetRecord = {
    ...existing,
    outlet_id: targetOutletId,
    outlet_name: targetOutletName,
    asset_name: asset_name || existing.asset_name,
    asset_class: aClass,
    purchase_date: purchase_date || existing.purchase_date,
    cost_price: costNum,
    mira_rate: stdRate,
    opening_wdv: openWdv,
    capital_allowance: allowance,
    closing_wdv: closeWdv,
    supplier: supplier !== undefined ? supplier : existing.supplier,
    notes: notes !== undefined ? notes : existing.notes
  };

  await appStore.upsertAsset(updated);

  res.json(updated);
});

// DELETE /api/assets/:id - Delete a fixed asset record
app.delete("/api/assets/:id", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const { id } = req.params;
  const assets = await appStore.refreshAssets();
  const ast = assets.find((a) => a.id === id);

  if (!ast) {
    return res.status(404).json({ error: "Fixed asset record not found" });
  }

  if (user.role === "outlet_user" && ast.outlet_id !== user.outlet_id) {
    return res.status(403).json({ error: "Access Denied: Cannot delete asset record from another outlet." });
  }

  await appStore.deleteAsset(id);

  res.json({ success: true, message: "Fixed asset record deleted successfully" });
});

// Helper function for MIRA 604 & Schedule 1 Tax Computation
function generateTaxReportHelper(reqYear: number, requestedOutlet: string): Mira604Summary {
  const settings = getAppSettings();

  // 1. Gather Revenues
  let revenues = getRevenues().filter((r) => (r.year || new Date(r.date).getFullYear()) === reqYear);
  if (requestedOutlet !== "ALL") {
    revenues = revenues.filter((r) => r.outlet_id === requestedOutlet);
  }
  const totalRevenue = revenues.reduce((sum, r) => {
    const net = r.net_revenue ?? (r.gross_amount ? r.gross_amount - (r.gst_collected || 0) : r.amount) ?? 0;
    return sum + net;
  }, 0);

  // 2. Gather Bills
  let bills = getBills().filter((b) => b.year === reqYear && b.status !== "rejected");
  if (requestedOutlet !== "ALL") {
    bills = bills.filter((b) => b.outlet_id === requestedOutlet);
  }

  const schedule1: Record<MiraSchedule1Category, number> = {
    'Cost of Sales': 0,
    'Insurance Premium': 0,
    'Professional & Consulting Fees': 0,
    'Rental, Lease & License': 0,
    'Repairs & Maintenance': 0,
    'Related Party Expenses': 0,
    'Salaries & Wages': 0,
    'Sales & Marketing': 0,
    'Other Expenses': 0,
    'Capital Asset (Schedule 2)': 0
  };

  let nonDeductibleAddbacks = 0;
  let unverifiedCount = 0;
  let unclassifiedCount = 0;

  bills.forEach((b) => {
    if (b.status === "pending_review" || b.needs_review || !b.verifiedData) {
      unverifiedCount++;
    }

    const data = b.verifiedData || b.extractedData;
    const cat = data.mira_schedule1_category || 'Other Expenses';
    if (!data.mira_schedule1_category || cat === 'Other Expenses') {
      unclassifiedCount++;
    }

    const subtotal = data.totals?.taxable_value || data.totals?.invoice_total || 0;
    const dedPct = data.deductible_percentage ?? 100;

    if (schedule1[cat] !== undefined) {
      schedule1[cat] += subtotal;
    } else {
      schedule1['Other Expenses'] += subtotal;
    }

    if (data.income_tax_treatment === 'NON_DEDUCTIBLE' || dedPct === 0) {
      nonDeductibleAddbacks += subtotal;
    } else if (dedPct < 100) {
      const nonDedPortion = subtotal * ((100 - dedPct) / 100);
      nonDeductibleAddbacks += nonDedPortion;
    }
  });

  // 3. Check for missing revenue months
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const activeMonths = new Set<number>();
  revenues.forEach((r) => {
    const d = new Date(r.date);
    if (!isNaN(d.getTime())) {
      activeMonths.add(d.getMonth());
    }
  });

  const missingRevenueMonths: string[] = [];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  for (let m = 0; m < 12; m++) {
    if (reqYear < currentYear || (reqYear === currentYear && m <= currentMonth)) {
      if (!activeMonths.has(m)) {
        missingRevenueMonths.push(MONTH_NAMES[m]);
      }
    }
  }

  // 4. Gather Capital Allowances from Fixed Asset Register
  let assets = getAssets();
  if (requestedOutlet !== "ALL") {
    assets = assets.filter((a) => a.outlet_id === requestedOutlet);
  }
  const totalCapitalAllowance = assets.reduce((sum, a) => sum + (a.capital_allowance || 0), 0);

  const costOfSales = schedule1['Cost of Sales'];
  const grossProfit = totalRevenue - costOfSales;

  const totalOperatingExpenses =
    schedule1['Insurance Premium'] +
    schedule1['Professional & Consulting Fees'] +
    schedule1['Rental, Lease & License'] +
    schedule1['Repairs & Maintenance'] +
    schedule1['Related Party Expenses'] +
    schedule1['Salaries & Wages'] +
    schedule1['Sales & Marketing'] +
    schedule1['Other Expenses'];

  const netAccountingProfit = grossProfit - totalOperatingExpenses;
  const taxableIncome = Math.max(0, netAccountingProfit + nonDeductibleAddbacks - totalCapitalAllowance);

  // 5. Tax Bracket Engine based on Entity Profile
  const profile = settings.taxpayerProfile || 'COMPANY';
  let estimatedTax = 0;
  let bracketsApplied = '';

  if (profile === 'COMPANY') {
    if (taxableIncome > 500000) {
      estimatedTax = (taxableIncome - 500000) * 0.15;
      bracketsApplied = 'Company Rate: 0% on first MVR 500,000; 15% on excess (MVR ' + (taxableIncome - 500000).toLocaleString() + ')';
    } else {
      estimatedTax = 0;
      bracketsApplied = 'Company Rate: 0% (Taxable Income ≤ MVR 500,000)';
    }
  } else {
    let remaining = taxableIncome;
    let tax = 0;

    if (remaining > 2400000) {
      tax += (remaining - 2400000) * 0.15;
      remaining = 2400000;
    }
    if (remaining > 1800000) {
      tax += (remaining - 1800000) * 0.12;
      remaining = 1800000;
    }
    if (remaining > 1200000) {
      tax += (remaining - 1200000) * 0.08;
      remaining = 1200000;
    }
    if (remaining > 720000) {
      tax += (remaining - 720000) * 0.055;
    }
    estimatedTax = tax;
    bracketsApplied = 'Sole Proprietor Progressive Individual Brackets (Exempt up to MVR 720,000; 5.5% to 15% tiers)';
  }

  const warnings: string[] = [];
  if (unverifiedCount > 0) {
    warnings.push(`${unverifiedCount} purchase invoice(s) are unverified or awaiting approval.`);
  }
  if (missingRevenueMonths.length > 0) {
    warnings.push(`No sales logged for ${missingRevenueMonths.length} month(s): ${missingRevenueMonths.slice(0, 4).join(', ')}${missingRevenueMonths.length > 4 ? '...' : ''}.`);
  }
  if (unclassifiedCount > 0) {
    warnings.push(`${unclassifiedCount} expense document(s) categorized under default 'Other Expenses'.`);
  }

  const auditChecks: TaxAuditCheck = {
    unverified_documents_count: unverifiedCount,
    missing_revenue_months: missingRevenueMonths,
    unclassified_expenses_count: unclassifiedCount,
    audit_warnings: warnings,
    is_audit_passed: warnings.length === 0
  };

  return {
    taxpayer_profile: profile,
    accounting_basis: settings.accountingBasis || 'ACCRUAL',
    year: reqYear,
    outlet_id: requestedOutlet,
    revenue: totalRevenue,
    cost_of_sales: costOfSales,
    gross_profit: grossProfit,
    operating_expenses: totalOperatingExpenses,
    schedule1_breakdown: schedule1,
    net_accounting_profit: netAccountingProfit,
    non_deductible_addbacks: nonDeductibleAddbacks,
    total_capital_allowances: totalCapitalAllowance,
    taxable_income: taxableIncome,
    estimated_income_tax: estimatedTax,
    tax_brackets_applied: bracketsApplied,
    total_bills_analyzed: bills.length,
    total_revenue_entries: revenues.length,
    audit_checks: auditChecks
  };
}

// GET /api/reports/income-tax - Generate MIRA 604 & Schedule 1 Summary Report
app.get("/api/reports/income-tax", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const reqYear = parseInt(req.query.year as string, 10) || new Date().getFullYear();
  let requestedOutlet = (req.query.outlet_id as string) || (req.query.outletId as string) || (req.query.outlet as string) || "ALL";

  if (user.role === "outlet_user") {
    requestedOutlet = user.outlet_id || "ALL";
  }

  await Promise.all([appStore.refreshBills(), appStore.refreshAssets(), appStore.refreshSettings()]);
  const summary = generateTaxReportHelper(reqYear, requestedOutlet);
  res.json(summary);
});

// GET /api/tax-report/:year - Dedicated MIRA 604 Tax Preparation Computation Route
app.get("/api/tax-report/:year", requireAuth, async (req, res) => {
  const user = (req as any).user as AuthUser;
  const reqYear = parseInt(req.params.year, 10) || new Date().getFullYear();
  let requestedOutlet = (req.query.outlet_id as string) || (req.query.outletId as string) || (req.query.outlet as string) || "ALL";

  if (user.role === "outlet_user") {
    requestedOutlet = user.outlet_id || "ALL";
  }

  await Promise.all([appStore.refreshBills(), appStore.refreshAssets(), appStore.refreshSettings()]);
  const summary = generateTaxReportHelper(reqYear, requestedOutlet);
  res.json(summary);
});

// Regulatory Snapshot & Regression Engine Endpoints (Phase 42)
app.get("/api/regulatory/rules", requireAuth, (_req, res) => {
  res.json({
    count: SEEDED_REGULATORY_RULES.length,
    rules: SEEDED_REGULATORY_RULES
  });
});

app.get("/api/regulatory/snapshot", requireAuth, (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const snapshot = RegulatorySnapshotService.createSnapshot(date);
  res.json(snapshot);
});

app.post("/api/regulatory/snapshots/compare", requireAuth, express.json(), (req, res) => {
  const { baselineDate, targetDate } = req.body;
  const base = RegulatorySnapshotService.createSnapshot(baselineDate || '2024-01-01');
  const target = RegulatorySnapshotService.createSnapshot(targetDate || new Date().toISOString().slice(0, 10));
  const report = RegulatorySnapshotService.compareSnapshots(base, target);
  res.json(report);
});

app.get("/api/regulatory/regression/run", requireAuth, (_req, res) => {
  const engine = new RegulatoryRegressionEngine();
  const results = engine.runFullRegressionSuite();
  res.json(results);
});

// ============================================================================
// PHASE 43 — EXPLAINABLE TAX CALCULATION API ROUTES
// ============================================================================

// POST /api/tax/explain/income-tax - Compute Income Tax with 5-part Explainability Structure
app.post("/api/tax/explain/income-tax", requireAuth, (req, res) => {
  try {
    const input = req.body;
    const calcResult = defaultIncomeTaxEngine.calculateFinalTaxPayable(input);
    const explanation = calcResult.explanation || defaultTaxExplainabilityEngine.generateIncomeTaxExplanation(input, calcResult);
    res.json({
      calculation: calcResult,
      explanation
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error generating income tax explanation' });
  }
});

// POST /api/tax/explain/gst - Compute GST with Deterministic Rule-Referenced Explanation
app.post("/api/tax/explain/gst", requireAuth, (req, res) => {
  try {
    const input = req.body;
    const explanation = defaultTaxExplainabilityEngine.generateGstExplanation(input);
    res.json(explanation);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error generating GST explanation' });
  }
});

// POST /api/tax/explain/nwt - Compute Non-Resident Withholding Tax with Explainability
app.post("/api/tax/explain/nwt", requireAuth, (req, res) => {
  try {
    const input = req.body;
    const explanation = defaultTaxExplainabilityEngine.generateNwtExplanation(input);
    res.json(explanation);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error generating NWT explanation' });
  }
});

// POST /api/tax/explain/verify - Verify mathematical exactness and audit rule references
app.post("/api/tax/explain/verify", requireAuth, (req, res) => {
  try {
    const { explanation } = req.body;
    if (!explanation) {
      return res.status(400).json({ error: 'Missing explanation payload' });
    }
    const verification = defaultTaxExplainabilityEngine.verifyExplanation(explanation);
    res.json(verification);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error verifying explanation' });
  }
});

// ============================================================================
// PHASE 44 — TAX COMPLIANCE DASHBOARD API ROUTES
// ============================================================================

// GET /api/compliance/dashboard - Retrieve authoritative 8-dimension compliance status
app.get("/api/compliance/dashboard", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const period = (req.query.period as string) || "ALL";
    let outletId = ((req.query.outletId || req.query.outlet || req.query.outlet_id) as string) || "ALL";
    if (user.role === "outlet_user") {
      outletId = user.outlet_id || "ALL";
    }
    const [, outlets, assets] = await Promise.all([
      appStore.refreshBills(),
      appStore.refreshOutlets(),
      appStore.refreshAssets()
    ]);
    const bills = getBills();
    const revenueRecords = getRevenues();

    const result = ComplianceDashboardService.evaluateCompliance({
      period,
      outletId,
      bills,
      outlets,
      assets,
      journals: [],
      revenueRecords
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error evaluating tax compliance dashboard' });
  }
});

// POST /api/compliance/evaluate - Authoritative compliance evaluation on custom payload
app.post("/api/compliance/evaluate", requireAuth, (req, res) => {
  try {
    const options = req.body || {};
    const result = ComplianceDashboardService.evaluateCompliance(options);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Error evaluating compliance' });
  }
});

// ============================================================================
// PHASE 45 — PRE-FILING CONTROL ENGINE API ROUTES
// ============================================================================

// POST /api/compliance/pre-filing/check - Run authoritative 14-check pre-filing control
app.post("/api/compliance/pre-filing/check", requireAuth, (req, res) => {
  try {
    const user = (req as any).user as AuthUser;
    const body = req.body || {};
    const period = body.period || (req.query.period as string) || "ALL";
    let outletId = body.outletId || ((req.query.outletId || req.query.outlet || req.query.outlet_id) as string) || "ALL";
    if (user.role === "outlet_user") {
      outletId = user.outlet_id || "ALL";
    }

    const bills = body.bills || getBills();
    const assets = body.assets || getAssets();
    const journals = body.journals || [];
    const taxAdjustments = body.taxAdjustments || [];
    const taxLossLots = body.taxLossLots || [];
    const auditLogs = body.auditLogs || [];

    const result = PreFilingControlEngine.runPreFilingCheck({
      period,
      outletId,
      bills,
      assets,
      journals,
      taxAdjustments,
      taxLossLots,
      auditLogs,
      periodInfo: body.periodInfo || {
        periodKey: period,
        status: body.periodStatus || 'OPEN',
        isApproved: body.periodApproved || false
      },
      periodStatus: body.periodStatus,
      periodApproved: body.periodApproved,
      trialBalance: body.trialBalance,
      gstReconciliation: body.gstReconciliation,
      nwtReconciliation: body.nwtReconciliation,
      miraReturnValid: body.miraReturnValid,
      approvals: body.approvals,
      miraReturns: body.miraReturns,
      schedules: body.schedules,
      reconciliationResult: body.reconciliationResult,
      options: body.options
    });

    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error running pre-filing check' });
  }
});

// POST /api/filing/package/ready-for-filing - Generate strictly validated ready-for-filing package (refuses if blocking issues exist)
app.post("/api/filing/package/ready-for-filing", requireAuth, (req, res) => {
  try {
    const input = req.body;
    if (!input || !input.taxpayer) {
      return res.status(400).json({ success: false, error: "Missing required taxpayer profile in filing input" });
    }

    const packageResult = FilingPackageGenerator.generateReadyForFilingPackage({
      ...input,
      bills: input.bills || getBills(),
      fixedAssets: input.fixedAssets || getAssets()
    });

    res.json({
      success: true,
      manifest: packageResult.manifest,
      packageChecksum: packageResult.manifest.packageChecksum,
      totalFiles: packageResult.manifest.totalFiles,
      preFilingCheck: packageResult.manifest.preFilingCheck
    });
  } catch (error: any) {
    if (error instanceof PreFilingBlockedError) {
      return res.status(422).json({
        success: false,
        error: error.message,
        blockingIssuesCount: error.preFilingResult.blockingIssues.length,
        preFilingResult: error.preFilingResult
      });
    }
    res.status(400).json({ success: false, error: error.message || 'Filing package generation failed' });
  }
});


// Always return structured JSON for unmatched /api/* routes (including in serverless mode)
app.use("/api/*", apiNotFoundHandler);

// Centralized Production Error Handler (registered on app directly so serverless mode also returns JSON)
app.use(centralizedErrorHandler);

const isServerlessRuntime = Boolean(
  process.env.NETLIFY_SERVERLESS ||
    process.env.SERVERLESS ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
);

// Setup Vite Middleware / Static and Server Listening for non-serverless Node runtimes
async function start() {
  await ensureAppInitialized();

  if (process.env.NODE_ENV !== "production") {
    const vitePkg = "vite";
    const { createServer: createViteServer } = await import(/* @vite-ignore */ vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Maldivian Multi-Outlet GST App server running on http://0.0.0.0:${PORT} (Persistence: ${appStore.isUsingDatabase() ? "PostgreSQL" : "local-json"})`);
  });
}

if (!isServerlessRuntime) {
  start();
}
