import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from './client.js';
import {
  AppSettings,
  BillRecord,
  FixedAssetRecord,
  Outlet,
  TemplateColumnMapping,
  User
} from '../types.js';
import { PasswordSecurity } from '../services/security/passwordSecurity.js';
import { sessionManager } from '../services/security/sessionManager.js';
import { SecureSession } from '../services/security/types.js';

function resolveAppDataDir(): string {
  const localDir = path.join(process.cwd(), 'data');
  const tmpDir = path.join(os.tmpdir(), 'cr-maldives-data');
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY_SERVERLESS) {
    return tmpDir;
  }
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    fs.accessSync(localDir, fs.constants.W_OK);
    return localDir;
  } catch {
    return tmpDir;
  }
}

const DATA_DIR = resolveAppDataDir();
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BILLS_FILE = path.join(DATA_DIR, 'bills.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TEMPLATE_EXCEL_FILE = path.join(DATA_DIR, 'custom_template.xlsx');
const OUTLETS_FILE = path.join(DATA_DIR, 'outlets.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PASSWORDS_FILE = path.join(DATA_DIR, 'passwords.json');
const ASSETS_FILE = path.join(DATA_DIR, 'assets.json');

const DEFAULT_MAPPING: TemplateColumnMapping = {
  supplier_name: 'Supplier Name',
  supplier_tin: 'Supplier Tin',
  invoice_number: 'Invoice Number',
  invoice_date: 'Invoice Date',
  taxable_value: 'Subtotal (Excl. GST)',
  gst_amount: 'GST Amount (8%)',
  invoice_total: 'Invoice Total',
  quarter: 'Quarter',
  notes: 'Notes',
  outlet_name: 'Outlet Name'
};

function getDefaultSettings(): AppSettings {
  return {
    myTin: '1133533GST501',
    defaultGstRate: 8,
    autoApproveHighConfidence: false,
    templateMapping: { ...DEFAULT_MAPPING },
    googleSheets: {
      spreadsheetId: '',
      sheetName: 'GST Purchases',
      connected: false,
      mapping: { ...DEFAULT_MAPPING }
    }
  };
}

function getSeedOutlets(): Outlet[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'outlet-1',
      name: "Male' Main Branch",
      code: 'MLE-01',
      tin: '1000001GST501',
      address: "Boduthakurufaanu Magu, Male', Maldives",
      phone: '+960 334 4300',
      status: 'active',
      createdAt: now
    },
    {
      id: 'outlet-2',
      name: "Hulhumale' Outlet",
      code: 'HLM-02',
      tin: '1000002GST502',
      address: "Nirolhu Magu, Hulhumale', Maldives",
      phone: '+960 335 1122',
      status: 'active',
      createdAt: now
    },
    {
      id: 'outlet-3',
      name: 'Maafushi Resort Shop',
      code: 'MFS-03',
      tin: '1000003GST503',
      address: 'Kani Magu, Maafushi, Maldives',
      phone: '+960 778 9988',
      status: 'active',
      createdAt: now
    }
  ];
}

function getSeedUsers(): User[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'user-ibreez',
      name: 'Ibreez Super Admin',
      email: 'ibreez@crmaldives.com',
      username: 'ibreez',
      role: 'super_admin',
      outlet_id: null,
      outlet_name: 'All Outlets (System Admin)',
      status: 'active',
      createdAt: now
    },
    {
      id: 'user-admin',
      name: 'Super Admin',
      email: 'admin@crmaldives.com',
      username: 'admin',
      role: 'super_admin',
      outlet_id: null,
      outlet_name: 'All Outlets (System Admin)',
      status: 'active',
      createdAt: now
    },
    {
      id: 'user-male',
      name: "Male' Manager",
      email: 'male@crmaldives.com',
      username: 'male_user',
      role: 'outlet_user',
      outlet_id: 'outlet-1',
      outlet_name: "Male' Main Branch",
      status: 'active',
      createdAt: now
    },
    {
      id: 'user-hulhumale',
      name: "Hulhumale' Manager",
      email: 'hulhumale@crmaldives.com',
      username: 'hulhumale_user',
      role: 'outlet_user',
      outlet_id: 'outlet-2',
      outlet_name: "Hulhumale' Outlet",
      status: 'active',
      createdAt: now
    },
    {
      id: 'user-maafushi',
      name: 'Maafushi Manager',
      email: 'maafushi@crmaldives.com',
      username: 'maafushi_user',
      role: 'outlet_user',
      outlet_id: 'outlet-3',
      outlet_name: 'Maafushi Resort Shop',
      status: 'active',
      createdAt: now
    }
  ];
}

function getSeedPasswords(): Record<string, string> {
  return {
    'user-ibreez': 'admin',
    'user-admin': 'admin123',
    'user-male': 'outlet123',
    'user-hulhumale': 'outlet123',
    'user-maafushi': 'outlet123'
  };
}

function getSeedAssets(): FixedAssetRecord[] {
  return [
    {
      id: 'ast-001',
      outlet_id: 'outlet-1',
      outlet_name: "Male' Main Branch",
      asset_name: 'POS Hardware & Server System',
      asset_class: 'Computer Software & Hardware',
      purchase_date: '2025-01-15',
      cost_price: 45000,
      mira_rate: 33.33,
      opening_wdv: 45000,
      capital_allowance: 14998.5,
      closing_wdv: 30001.5,
      supplier: 'Alpha Technology Pvt Ltd',
      notes: 'Main POS terminals and kitchen display system'
    },
    {
      id: 'ast-002',
      outlet_id: 'outlet-1',
      outlet_name: "Male' Main Branch",
      asset_name: 'Commercial Espresso Machine & Coffee Grinder',
      asset_class: 'Plant & Equipment / Machinery',
      purchase_date: '2025-03-10',
      cost_price: 85000,
      mira_rate: 10,
      opening_wdv: 85000,
      capital_allowance: 8500,
      closing_wdv: 76500,
      supplier: 'Maldives Kitchen Equipment Pvt Ltd',
      notes: '3-Group La Marzocco espresso machine'
    },
    {
      id: 'ast-003',
      outlet_id: 'outlet-2',
      outlet_name: "Hulhumale' Outlet",
      asset_name: 'Delivery Scooter (Honda Click 125)',
      asset_class: 'Vehicles & Transport',
      purchase_date: '2025-06-20',
      cost_price: 38000,
      mira_rate: 20,
      opening_wdv: 38000,
      capital_allowance: 7600,
      closing_wdv: 30400,
      supplier: 'Sheesha Motors Maldives',
      notes: 'Food delivery vehicle'
    }
  ];
}

function normalizeSettings(parsed: any): AppSettings {
  const defaults = getDefaultSettings();
  const merged: AppSettings = {
    ...defaults,
    ...(parsed || {}),
    templateMapping: {
      ...DEFAULT_MAPPING,
      ...(parsed?.templateMapping || {})
    },
    googleSheets: {
      ...defaults.googleSheets,
      ...(parsed?.googleSheets || {}),
      mapping: {
        ...DEFAULT_MAPPING,
        ...(parsed?.googleSheets?.mapping || {})
      }
    }
  };

  if (
    !merged.templateMapping.supplier_tin ||
    merged.templateMapping.supplier_tin === 'TIN on Invoice'
  ) {
    merged.templateMapping.supplier_tin = 'Supplier Tin';
  }
  if (
    !merged.templateMapping.taxable_value ||
    merged.templateMapping.taxable_value === 'Taxable Value (MVR)'
  ) {
    merged.templateMapping.taxable_value = 'Subtotal (Excl. GST)';
  }
  if (!merged.templateMapping.outlet_name) {
    merged.templateMapping.outlet_name = 'Outlet Name';
  }
  return merged;
}

const OPERATIONAL_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "AppOutlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tin" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppOutlet_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppOutlet_code_key" ON "AppOutlet"("code")`,
  `CREATE INDEX IF NOT EXISTS "AppOutlet_status_idx" ON "AppOutlet"("status")`,
  `CREATE TABLE IF NOT EXISTS "AppUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'outlet_user',
    "outletId" TEXT,
    "outletName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_email_key" ON "AppUser"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_username_key" ON "AppUser"("username")`,
  `CREATE INDEX IF NOT EXISTS "AppUser_outletId_idx" ON "AppUser"("outletId")`,
  `CREATE INDEX IF NOT EXISTS "AppUser_role_idx" ON "AppUser"("role")`,
  `CREATE INDEX IF NOT EXISTS "AppUser_status_idx" ON "AppUser"("status")`,
  `CREATE TABLE IF NOT EXISTS "AppSession" (
    "token" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("token")
  )`,
  `CREATE INDEX IF NOT EXISTS "AppSession_userId_idx" ON "AppSession"("userId")`,
  `CREATE INDEX IF NOT EXISTS "AppSession_expiresAt_idx" ON "AppSession"("expiresAt")`,
  `CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL,
    "valueJson" TEXT,
    "binaryData" BYTEA,
    "filename" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
  )`,
  `CREATE TABLE IF NOT EXISTS "AppBill" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "outletName" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "ocrStatus" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppBill_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "AppBill_outletId_idx" ON "AppBill"("outletId")`,
  `CREATE INDEX IF NOT EXISTS "AppBill_status_idx" ON "AppBill"("status")`,
  `CREATE INDEX IF NOT EXISTS "AppBill_quarter_idx" ON "AppBill"("quarter")`,
  `CREATE INDEX IF NOT EXISTS "AppBill_year_idx" ON "AppBill"("year")`,
  `CREATE INDEX IF NOT EXISTS "AppBill_uploadDate_idx" ON "AppBill"("uploadDate")`,
  `CREATE TABLE IF NOT EXISTS "AppUploadedFile" (
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppUploadedFile_pkey" PRIMARY KEY ("filename")
  )`,
  `CREATE TABLE IF NOT EXISTS "AppFixedAsset" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "outletName" TEXT,
    "assetName" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "purchaseDate" TEXT NOT NULL,
    "costPrice" DECIMAL(18,4) NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppFixedAsset_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "AppFixedAsset_outletId_idx" ON "AppFixedAsset"("outletId")`,
  `CREATE INDEX IF NOT EXISTS "AppFixedAsset_purchaseDate_idx" ON "AppFixedAsset"("purchaseDate")`
];

class AppStore {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private dbEnabled = false;

  private outletsCache: Outlet[] | null = null;
  private usersCache: User[] | null = null;
  private passwordsCache: Record<string, string> | null = null;
  private settingsCache: AppSettings | null = null;
  private billsCache: BillRecord[] | null = null;
  private assetsCache: FixedAssetRecord[] | null = null;
  private customTemplateCache: { filename: string; buffer: Buffer } | null = null;

  private ensureDirs(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    } catch {
      // Ignore read-only dir errors in restricted runtimes
    }
  }

  private readJsonFile<T>(filePath: string): T | null {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
      }
    } catch (e) {
      console.error(`[AppStore] Failed to read ${filePath}:`, e);
    }
    return null;
  }

  private writeJsonFile(filePath: string, data: unknown): void {
    try {
      this.ensureDirs();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-fatal if container filesystem is constrained
    }
  }

  public isUsingDatabase(): boolean {
    return this.dbEnabled;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.performInitialize();
    try {
      await this.initPromise;
    } finally {
      if (!this.initialized) {
        this.initPromise = null;
      }
    }
  }

  private async performInitialize(): Promise<void> {
    if (this.initialized) return;
    this.ensureDirs();

    if (!process.env.DATABASE_URL && process.env.database_url) {
      process.env.DATABASE_URL = process.env.database_url;
    }
    if (!process.env.SESSION_SECRET && (process.env.Session_Secret || process.env.session_secret)) {
      process.env.SESSION_SECRET = process.env.Session_Secret || process.env.session_secret;
    }

    const hasDbUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
    if (!hasDbUrl) {
      console.warn('[AppStore] DATABASE_URL is not configured. Using local JSON files in ./data.');
      this.loadLocalCaches();
      this.initialized = true;
      return;
    }

    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      for (const ddl of OPERATIONAL_DDL_STATEMENTS) {
        await prisma.$executeRawUnsafe(ddl);
      }
      this.dbEnabled = true;
      console.log('[AppStore] Connected to PostgreSQL (Neon). Operational persistence enabled.');

      await this.bootstrapAndLoadFromDb();
      this.registerSessionHooks();
      this.initialized = true;
    } catch (err: any) {
      console.error('[AppStore] PostgreSQL initialization failed, falling back to local JSON:', err?.message || err);
      this.dbEnabled = false;
      this.loadLocalCaches();
      this.initialized = true;
    }
  }

  private loadLocalCaches(): void {
    const localOutlets = this.readJsonFile<Outlet[]>(OUTLETS_FILE);
    this.outletsCache = localOutlets && localOutlets.length > 0 ? localOutlets : getSeedOutlets();
    if (!localOutlets || localOutlets.length === 0) {
      this.writeJsonFile(OUTLETS_FILE, this.outletsCache);
    }

    const localUsers = this.readJsonFile<User[]>(USERS_FILE);
    this.usersCache = localUsers && localUsers.length > 0 ? localUsers : getSeedUsers();
    if (!localUsers || localUsers.length === 0) {
      this.writeJsonFile(USERS_FILE, this.usersCache);
    }

    const localPasswords = this.readJsonFile<Record<string, string>>(PASSWORDS_FILE);
    this.passwordsCache =
      localPasswords && Object.keys(localPasswords).length > 0 ? localPasswords : getSeedPasswords();
    if (!localPasswords || Object.keys(localPasswords).length === 0) {
      this.writeJsonFile(PASSWORDS_FILE, this.passwordsCache);
    }

    const localSettings = this.readJsonFile<any>(SETTINGS_FILE);
    this.settingsCache = normalizeSettings(localSettings);
    if (!localSettings) {
      this.writeJsonFile(SETTINGS_FILE, this.settingsCache);
    }

    const localBills = this.readJsonFile<BillRecord[]>(BILLS_FILE);
    this.billsCache = Array.isArray(localBills) ? localBills : [];

    const localAssets = this.readJsonFile<FixedAssetRecord[]>(ASSETS_FILE);
    this.assetsCache = localAssets && localAssets.length > 0 ? localAssets : getSeedAssets();
    if (!localAssets || localAssets.length === 0) {
      this.writeJsonFile(ASSETS_FILE, this.assetsCache);
    }
  }

  private async bootstrapAndLoadFromDb(): Promise<void> {
    // 1. Outlets
    const dbOutlets = await prisma.appOutlet.findMany({ orderBy: { createdAt: 'asc' } });
    if (dbOutlets.length === 0) {
      const localOutlets = this.readJsonFile<Outlet[]>(OUTLETS_FILE);
      const seed = localOutlets && localOutlets.length > 0 ? localOutlets : getSeedOutlets();
      for (const o of seed) {
        await this.persistOutletToDb(o);
      }
      this.outletsCache = seed;
    } else {
      this.outletsCache = dbOutlets.map((o) => ({
        id: o.id,
        name: o.name,
        code: o.code,
        tin: o.tin ?? undefined,
        address: o.address ?? undefined,
        phone: o.phone ?? undefined,
        status: (o.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString()
      }));
    }
    this.writeJsonFile(OUTLETS_FILE, this.outletsCache);

    // 2. Users & Passwords
    const dbUsers = await prisma.appUser.findMany({ orderBy: { createdAt: 'asc' } });
    if (dbUsers.length === 0) {
      const localUsers = this.readJsonFile<User[]>(USERS_FILE);
      const localPasswords = this.readJsonFile<Record<string, string>>(PASSWORDS_FILE) || {};
      const defaultPasswords = getSeedPasswords();
      const seedUsers = localUsers && localUsers.length > 0 ? localUsers : getSeedUsers();

      this.usersCache = [];
      this.passwordsCache = {};

      for (const u of seedUsers) {
        const rawPass = localPasswords[u.id] || defaultPasswords[u.id] || 'outlet123';
        const hashed = rawPass.startsWith('pbkdf2:') ? rawPass : PasswordSecurity.hashPassword(rawPass);
        await this.persistUserToDb(u, hashed);
        this.usersCache.push(u);
        this.passwordsCache[u.id] = hashed;
      }
    } else {
      this.usersCache = dbUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role === 'super_admin' ? 'super_admin' : 'outlet_user',
        outlet_id: u.outletId ?? null,
        outlet_name: u.outletName ?? undefined,
        status: (u.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
        createdAt: u.createdAt.toISOString(),
        lastLogin: u.lastLogin ? u.lastLogin.toISOString() : undefined
      }));
      const pwdMap: Record<string, string> = {};
      for (const u of dbUsers) {
        pwdMap[u.id] = u.passwordHash;
      }
      this.passwordsCache = pwdMap;
    }
    this.writeJsonFile(USERS_FILE, this.usersCache);
    this.writeJsonFile(PASSWORDS_FILE, this.passwordsCache);

    // 3. Settings & Custom Excel Template
    const dbSettings = await prisma.appSetting.findUnique({ where: { key: 'app_settings' } });
    if (!dbSettings || !dbSettings.valueJson) {
      const localSettings = this.readJsonFile<any>(SETTINGS_FILE);
      this.settingsCache = normalizeSettings(localSettings);
      await prisma.appSetting.upsert({
        where: { key: 'app_settings' },
        create: { key: 'app_settings', valueJson: JSON.stringify(this.settingsCache) },
        update: { valueJson: JSON.stringify(this.settingsCache) }
      });
    } else {
      try {
        this.settingsCache = normalizeSettings(JSON.parse(dbSettings.valueJson));
      } catch {
        this.settingsCache = getDefaultSettings();
      }
    }
    this.writeJsonFile(SETTINGS_FILE, this.settingsCache);

    const dbTemplate = await prisma.appSetting.findUnique({ where: { key: 'custom_template' } });
    if (dbTemplate?.binaryData) {
      const buf = Buffer.from(dbTemplate.binaryData);
      this.customTemplateCache = {
        filename: dbTemplate.filename || 'custom_template.xlsx',
        buffer: buf
      };
      try {
        this.ensureDirs();
        fs.writeFileSync(TEMPLATE_EXCEL_FILE, buf);
      } catch {
        // Ignore
      }
    } else if (fs.existsSync(TEMPLATE_EXCEL_FILE)) {
      try {
        const buf = fs.readFileSync(TEMPLATE_EXCEL_FILE);
        await this.saveCustomTemplate('custom_template.xlsx', buf);
      } catch {
        // Ignore
      }
    }

    // 4. Bills
    const dbBills = await prisma.appBill.findMany({ orderBy: { uploadDate: 'desc' } });
    if (dbBills.length === 0) {
      const localBills = this.readJsonFile<BillRecord[]>(BILLS_FILE) || [];
      for (const b of localBills) {
        await this.persistBillToDb(b);
      }
      this.billsCache = localBills;
    } else {
      const loadedBills: BillRecord[] = [];
      for (const row of dbBills) {
        try {
          loadedBills.push(JSON.parse(row.payloadJson) as BillRecord);
        } catch {
          // Skip malformed record
        }
      }
      this.billsCache = loadedBills;
    }
    this.writeJsonFile(BILLS_FILE, this.billsCache);

    // 5. Fixed Assets
    const dbAssets = await prisma.appFixedAsset.findMany({ orderBy: { createdAt: 'desc' } });
    if (dbAssets.length === 0) {
      const localAssets = this.readJsonFile<FixedAssetRecord[]>(ASSETS_FILE);
      const seedAssets = localAssets && localAssets.length > 0 ? localAssets : getSeedAssets();
      for (const a of seedAssets) {
        await this.persistAssetToDb(a);
      }
      this.assetsCache = seedAssets;
    } else {
      const loadedAssets: FixedAssetRecord[] = [];
      for (const row of dbAssets) {
        try {
          loadedAssets.push(JSON.parse(row.payloadJson) as FixedAssetRecord);
        } catch {
          // Skip
        }
      }
      this.assetsCache = loadedAssets;
    }
    this.writeJsonFile(ASSETS_FILE, this.assetsCache);

    // 6. Sessions: Clean expired & hydrate active sessions from Neon
    try {
      await prisma.appSession.deleteMany({
        where: { expiresAt: { lte: new Date() } }
      });
      const activeRows = await prisma.appSession.findMany();
      const hydrated: SecureSession[] = activeRows.map((r) => ({
        token: r.token,
        tokenHash: r.tokenHash,
        userId: r.userId,
        tenantId: r.tenantId,
        role: r.role,
        username: r.username,
        ipAddress: r.ipAddress ?? undefined,
        userAgent: r.userAgent ?? undefined,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        lastActiveAt: r.lastActiveAt.toISOString()
      }));
      sessionManager.hydrateSessions(hydrated);
    } catch (e) {
      console.warn('[AppStore] Failed to hydrate sessions from DB:', e);
    }
  }

  private registerSessionHooks(): void {
    sessionManager.setPersistenceHooks({
      onCreate: (session) => {
        if (!this.dbEnabled) return;
        void prisma.appSession
          .upsert({
            where: { token: session.token },
            create: {
              token: session.token,
              tokenHash: session.tokenHash,
              userId: session.userId,
              tenantId: session.tenantId,
              role: String(session.role),
              username: session.username,
              ipAddress: session.ipAddress || null,
              userAgent: session.userAgent || null,
              createdAt: new Date(session.createdAt),
              expiresAt: new Date(session.expiresAt),
              lastActiveAt: new Date(session.lastActiveAt)
            },
            update: {
              lastActiveAt: new Date(session.lastActiveAt),
              expiresAt: new Date(session.expiresAt)
            }
          })
          .catch((e) => console.error('[AppStore] Failed to persist session:', e));
      },
      onRevoke: (token) => {
        if (!this.dbEnabled) return;
        void prisma.appSession
          .deleteMany({ where: { token } })
          .catch((e) => console.error('[AppStore] Failed to revoke session in DB:', e));
      },
      onRevokeUser: (userId) => {
        if (!this.dbEnabled) return;
        void prisma.appSession
          .deleteMany({ where: { userId } })
          .catch((e) => console.error('[AppStore] Failed to revoke user sessions in DB:', e));
      },
      onClear: () => {
        if (!this.dbEnabled) return;
        void prisma.appSession
          .deleteMany({})
          .catch((e) => console.error('[AppStore] Failed to clear sessions in DB:', e));
      }
    });
  }

  public async persistSessionToDb(session: SecureSession): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appSession.upsert({
      where: { token: session.token },
      create: {
        token: session.token,
        tokenHash: session.tokenHash,
        userId: session.userId,
        tenantId: session.tenantId,
        role: String(session.role),
        username: session.username,
        ipAddress: session.ipAddress || null,
        userAgent: session.userAgent || null,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
        lastActiveAt: new Date(session.lastActiveAt)
      },
      update: {
        lastActiveAt: new Date(session.lastActiveAt),
        expiresAt: new Date(session.expiresAt)
      }
    });
  }

  public async revokeSessionInDb(token: string): Promise<void> {
    if (!this.dbEnabled || !token) return;
    await prisma.appSession.deleteMany({ where: { token } });
  }

  public async getSessionFromDb(token: string): Promise<SecureSession | null> {
    if (!this.dbEnabled || !token) return null;
    try {
      const r = await prisma.appSession.findUnique({ where: { token } });
      if (!r) return null;
      const session: SecureSession = {
        token: r.token,
        tokenHash: r.tokenHash,
        userId: r.userId,
        tenantId: r.tenantId,
        role: r.role,
        username: r.username,
        ipAddress: r.ipAddress ?? undefined,
        userAgent: r.userAgent ?? undefined,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        lastActiveAt: r.lastActiveAt.toISOString()
      };
      if (sessionManager.isSessionExpired(session)) {
        await prisma.appSession.deleteMany({ where: { token } });
        return null;
      }
      sessionManager.hydrateSessions([session]);
      return session;
    } catch {
      return null;
    }
  }

  // ---------------- OUTLETS ----------------

  public getOutlets(): Outlet[] {
    if (!this.outletsCache) {
      this.loadLocalCaches();
    }
    return [...(this.outletsCache || [])];
  }

  public async refreshOutlets(): Promise<Outlet[]> {
    if (!this.dbEnabled) return this.getOutlets();
    const dbOutlets = await prisma.appOutlet.findMany({ orderBy: { createdAt: 'asc' } });
    this.outletsCache = dbOutlets.map((o) => ({
      id: o.id,
      name: o.name,
      code: o.code,
      tin: o.tin ?? undefined,
      address: o.address ?? undefined,
      phone: o.phone ?? undefined,
      status: (o.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString()
    }));
    this.writeJsonFile(OUTLETS_FILE, this.outletsCache);
    return [...this.outletsCache];
  }

  private async persistOutletToDb(o: Outlet): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appOutlet.upsert({
      where: { id: o.id },
      create: {
        id: o.id,
        name: o.name,
        code: o.code,
        tin: o.tin ?? null,
        address: o.address ?? null,
        phone: o.phone ?? null,
        status: o.status || 'active',
        createdAt: o.createdAt ? new Date(o.createdAt) : new Date(),
        updatedAt: o.updatedAt ? new Date(o.updatedAt) : new Date()
      },
      update: {
        name: o.name,
        code: o.code,
        tin: o.tin ?? null,
        address: o.address ?? null,
        phone: o.phone ?? null,
        status: o.status || 'active',
        updatedAt: o.updatedAt ? new Date(o.updatedAt) : new Date()
      }
    });
  }

  public async upsertOutlet(outlet: Outlet): Promise<void> {
    const list = this.getOutlets();
    const idx = list.findIndex((o) => o.id === outlet.id);
    if (idx >= 0) {
      list[idx] = outlet;
    } else {
      list.push(outlet);
    }
    this.outletsCache = list;
    this.writeJsonFile(OUTLETS_FILE, list);
    await this.persistOutletToDb(outlet);
  }

  public async saveOutlets(outlets: Outlet[]): Promise<void> {
    this.outletsCache = [...outlets];
    this.writeJsonFile(OUTLETS_FILE, this.outletsCache);
    if (!this.dbEnabled) return;

    const ids = outlets.map((o) => o.id);
    for (const o of outlets) {
      await this.persistOutletToDb(o);
    }
    await prisma.appOutlet.deleteMany({
      where: { id: { notIn: ids } }
    });
  }

  // ---------------- USERS & PASSWORDS ----------------

  public getUsers(): User[] {
    if (!this.usersCache) {
      this.loadLocalCaches();
    }
    return [...(this.usersCache || [])];
  }

  public async refreshUsers(): Promise<User[]> {
    if (!this.dbEnabled) return this.getUsers();
    const dbUsers = await prisma.appUser.findMany({ orderBy: { createdAt: 'asc' } });
    this.usersCache = dbUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username,
      role: u.role === 'super_admin' ? 'super_admin' : 'outlet_user',
      outlet_id: u.outletId ?? null,
      outlet_name: u.outletName ?? undefined,
      status: (u.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
      createdAt: u.createdAt.toISOString(),
      lastLogin: u.lastLogin ? u.lastLogin.toISOString() : undefined
    }));
    const pwdMap: Record<string, string> = {};
    for (const u of dbUsers) {
      pwdMap[u.id] = u.passwordHash;
    }
    this.passwordsCache = pwdMap;
    this.writeJsonFile(USERS_FILE, this.usersCache);
    this.writeJsonFile(PASSWORDS_FILE, this.passwordsCache);
    return [...this.usersCache];
  }

  public getPasswords(): Record<string, string> {
    if (!this.passwordsCache) {
      this.loadLocalCaches();
    }
    return { ...(this.passwordsCache || {}) };
  }

  private async persistUserToDb(u: User, passwordHash: string): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appUser.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        passwordHash,
        role: u.role,
        outletId: u.outlet_id ?? null,
        outletName: u.outlet_name ?? null,
        status: u.status || 'active',
        lastLogin: u.lastLogin ? new Date(u.lastLogin) : null,
        createdAt: u.createdAt ? new Date(u.createdAt) : new Date()
      },
      update: {
        name: u.name,
        email: u.email,
        username: u.username,
        passwordHash,
        role: u.role,
        outletId: u.outlet_id ?? null,
        outletName: u.outlet_name ?? null,
        status: u.status || 'active',
        lastLogin: u.lastLogin ? new Date(u.lastLogin) : null
      }
    });
  }

  public async upsertUser(user: User, passwordHash?: string): Promise<void> {
    const users = this.getUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      users[idx] = user;
    } else {
      users.push(user);
    }
    this.usersCache = users;
    this.writeJsonFile(USERS_FILE, users);

    const passwords = this.getPasswords();
    if (passwordHash) {
      passwords[user.id] = passwordHash;
      this.passwordsCache = passwords;
      this.writeJsonFile(PASSWORDS_FILE, passwords);
    }

    const effectiveHash = passwordHash || passwords[user.id] || PasswordSecurity.hashPassword('outlet123');
    await this.persistUserToDb(user, effectiveHash);
  }

  public async saveUsers(users: User[]): Promise<void> {
    this.usersCache = [...users];
    this.writeJsonFile(USERS_FILE, this.usersCache);
    if (!this.dbEnabled) return;

    const passwords = this.getPasswords();
    for (const u of users) {
      const hash = passwords[u.id] || PasswordSecurity.hashPassword('outlet123');
      await this.persistUserToDb(u, hash);
    }
  }

  public async syncSessionUsername(userId: string, username: string): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appSession.updateMany({
      where: { userId },
      data: { username }
    });
  }

  public async deleteUser(userId: string): Promise<void> {
    const users = this.getUsers().filter((u) => u.id !== userId);
    this.usersCache = users;
    this.writeJsonFile(USERS_FILE, users);

    const passwords = this.getPasswords();
    if (userId in passwords) {
      delete passwords[userId];
      this.passwordsCache = passwords;
      this.writeJsonFile(PASSWORDS_FILE, passwords);
    }

    if (!this.dbEnabled) return;
    await prisma.appSession.deleteMany({ where: { userId } });
    await prisma.appUser.deleteMany({ where: { id: userId } });
  }

  public async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const passwords = this.getPasswords();
    passwords[userId] = passwordHash;
    this.passwordsCache = passwords;
    this.writeJsonFile(PASSWORDS_FILE, passwords);
    if (!this.dbEnabled) return;

    await prisma.appUser.updateMany({
      where: { id: userId },
      data: { passwordHash }
    });
  }

  public async savePasswords(passwords: Record<string, string>): Promise<void> {
    this.passwordsCache = { ...passwords };
    this.writeJsonFile(PASSWORDS_FILE, this.passwordsCache);
    if (!this.dbEnabled) return;

    for (const [userId, passwordHash] of Object.entries(passwords)) {
      await prisma.appUser.updateMany({
        where: { id: userId },
        data: { passwordHash }
      });
    }
  }

  // ---------------- SETTINGS & CUSTOM TEMPLATE ----------------

  public getSettings(): AppSettings {
    if (!this.settingsCache) {
      this.loadLocalCaches();
    }
    return JSON.parse(JSON.stringify(this.settingsCache || getDefaultSettings()));
  }

  public async refreshSettings(): Promise<AppSettings> {
    if (!this.dbEnabled) return this.getSettings();
    const row = await prisma.appSetting.findUnique({ where: { key: 'app_settings' } });
    if (row?.valueJson) {
      try {
        this.settingsCache = normalizeSettings(JSON.parse(row.valueJson));
        this.writeJsonFile(SETTINGS_FILE, this.settingsCache);
      } catch {
        // Ignore parse failure
      }
    }
    return this.getSettings();
  }

  public async saveSettings(settings: AppSettings): Promise<void> {
    const normalized = normalizeSettings(settings);
    this.settingsCache = normalized;
    this.writeJsonFile(SETTINGS_FILE, normalized);
    if (!this.dbEnabled) return;

    await prisma.appSetting.upsert({
      where: { key: 'app_settings' },
      create: { key: 'app_settings', valueJson: JSON.stringify(normalized) },
      update: { valueJson: JSON.stringify(normalized) }
    });
  }

  public async saveCustomTemplate(filename: string, buffer: Buffer): Promise<void> {
    this.customTemplateCache = { filename, buffer };
    try {
      this.ensureDirs();
      fs.writeFileSync(TEMPLATE_EXCEL_FILE, buffer);
    } catch {
      // Ignore
    }
    if (!this.dbEnabled) return;

    await prisma.appSetting.upsert({
      where: { key: 'custom_template' },
      create: {
        key: 'custom_template',
        filename,
        binaryData: buffer
      },
      update: {
        filename,
        binaryData: buffer
      }
    });
  }

  public async getCustomTemplateBuffer(): Promise<{ filename: string; buffer: Buffer } | null> {
    if (fs.existsSync(TEMPLATE_EXCEL_FILE)) {
      try {
        return {
          filename: this.customTemplateCache?.filename || 'custom_template.xlsx',
          buffer: fs.readFileSync(TEMPLATE_EXCEL_FILE)
        };
      } catch {
        // Fall through to DB
      }
    }
    if (this.customTemplateCache) {
      return this.customTemplateCache;
    }
    if (!this.dbEnabled) return null;

    const row = await prisma.appSetting.findUnique({ where: { key: 'custom_template' } });
    if (row?.binaryData) {
      const buf = Buffer.from(row.binaryData);
      this.customTemplateCache = {
        filename: row.filename || 'custom_template.xlsx',
        buffer: buf
      };
      return this.customTemplateCache;
    }
    return null;
  }

  public async deleteCustomTemplate(): Promise<void> {
    this.customTemplateCache = null;
    try {
      if (fs.existsSync(TEMPLATE_EXCEL_FILE)) fs.unlinkSync(TEMPLATE_EXCEL_FILE);
    } catch {
      // Ignore
    }
    if (!this.dbEnabled) return;
    await prisma.appSetting.deleteMany({ where: { key: 'custom_template' } });
  }

  // ---------------- BILLS & UPLOADED FILES ----------------

  public getBills(): BillRecord[] {
    if (!this.billsCache) {
      this.loadLocalCaches();
    }
    return [...(this.billsCache || [])];
  }

  public async refreshBills(): Promise<BillRecord[]> {
    if (!this.dbEnabled) return this.getBills();
    const rows = await prisma.appBill.findMany({ orderBy: { uploadDate: 'desc' } });
    const parsed: BillRecord[] = [];
    for (const r of rows) {
      try {
        parsed.push(JSON.parse(r.payloadJson) as BillRecord);
      } catch {
        // Skip invalid JSON
      }
    }
    this.billsCache = parsed;
    this.writeJsonFile(BILLS_FILE, parsed);
    return [...parsed];
  }

  private async persistBillToDb(b: BillRecord): Promise<void> {
    if (!this.dbEnabled) return;
    const uploadDate = b.uploadDate ? new Date(b.uploadDate) : new Date();
    const safeUploadDate = isNaN(uploadDate.getTime()) ? new Date() : uploadDate;
    await prisma.appBill.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        outletId: b.outlet_id || 'outlet-1',
        outletName: b.outlet_name ?? null,
        fileName: b.fileName,
        fileType: b.fileType || 'image/jpeg',
        fileSize: Number(b.fileSize || 0),
        fileUrl: b.fileUrl,
        uploadDate: safeUploadDate,
        status: b.status || 'pending_review',
        ocrStatus: b.ocr_status || 'NEEDS_REVIEW',
        quarter: b.quarter || '2026-Q1',
        year: Number(b.year || new Date().getFullYear()),
        payloadJson: JSON.stringify(b)
      },
      update: {
        outletId: b.outlet_id || 'outlet-1',
        outletName: b.outlet_name ?? null,
        fileName: b.fileName,
        fileType: b.fileType || 'image/jpeg',
        fileSize: Number(b.fileSize || 0),
        fileUrl: b.fileUrl,
        uploadDate: safeUploadDate,
        status: b.status || 'pending_review',
        ocrStatus: b.ocr_status || 'NEEDS_REVIEW',
        quarter: b.quarter || '2026-Q1',
        year: Number(b.year || new Date().getFullYear()),
        payloadJson: JSON.stringify(b)
      }
    });
  }

  public async upsertBill(bill: BillRecord): Promise<void> {
    const list = this.getBills();
    const idx = list.findIndex((b) => b.id === bill.id);
    if (idx >= 0) {
      list[idx] = bill;
    } else {
      list.push(bill);
    }
    this.billsCache = list;
    this.writeJsonFile(BILLS_FILE, list);
    await this.persistBillToDb(bill);
  }

  public async deleteBill(id: string): Promise<void> {
    const list = this.getBills().filter((b) => b.id !== id);
    this.billsCache = list;
    this.writeJsonFile(BILLS_FILE, list);
    if (!this.dbEnabled) return;
    await prisma.appBill.deleteMany({ where: { id } });
  }

  public async saveBills(bills: BillRecord[]): Promise<void> {
    this.billsCache = [...bills];
    this.writeJsonFile(BILLS_FILE, this.billsCache);
    if (!this.dbEnabled) return;

    const ids = bills.map((b) => b.id);
    for (const b of bills) {
      await this.persistBillToDb(b);
    }
    if (ids.length > 0) {
      await prisma.appBill.deleteMany({ where: { id: { notIn: ids } } });
    } else {
      await prisma.appBill.deleteMany({});
    }
  }

  public async saveUploadedFile(filename: string, mimeType: string, data: Buffer): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appUploadedFile.upsert({
      where: { filename },
      create: {
        filename,
        mimeType: mimeType || 'application/octet-stream',
        size: data.length,
        data
      },
      update: {
        mimeType: mimeType || 'application/octet-stream',
        size: data.length,
        data
      }
    });
  }

  public async getUploadedFile(filename: string): Promise<{ mimeType: string; data: Buffer } | null> {
    const safeName = path.basename(filename);
    const localPath = path.resolve(UPLOADS_DIR, safeName);
    if (localPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) && fs.existsSync(localPath)) {
      try {
        const ext = path.extname(safeName).toLowerCase();
        const mime =
          ext === '.pdf'
            ? 'application/pdf'
            : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
        return { mimeType: mime, data: fs.readFileSync(localPath) };
      } catch {
        // Fall through to DB
      }
    }
    if (!this.dbEnabled) return null;

    const row = await prisma.appUploadedFile.findUnique({ where: { filename: safeName } });
    if (!row) return null;
    return { mimeType: row.mimeType, data: Buffer.from(row.data) };
  }

  public async deleteUploadedFile(filename: string): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appUploadedFile.deleteMany({ where: { filename: path.basename(filename) } });
  }

  // ---------------- FIXED ASSETS ----------------

  public getAssets(): FixedAssetRecord[] {
    if (!this.assetsCache) {
      this.loadLocalCaches();
    }
    return [...(this.assetsCache || [])];
  }

  public async refreshAssets(): Promise<FixedAssetRecord[]> {
    if (!this.dbEnabled) return this.getAssets();
    const rows = await prisma.appFixedAsset.findMany({ orderBy: { createdAt: 'desc' } });
    const parsed: FixedAssetRecord[] = [];
    for (const r of rows) {
      try {
        parsed.push(JSON.parse(r.payloadJson) as FixedAssetRecord);
      } catch {
        // Skip
      }
    }
    this.assetsCache = parsed;
    this.writeJsonFile(ASSETS_FILE, parsed);
    return [...parsed];
  }

  private async persistAssetToDb(a: FixedAssetRecord): Promise<void> {
    if (!this.dbEnabled) return;
    await prisma.appFixedAsset.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        outletId: a.outlet_id || 'outlet-1',
        outletName: a.outlet_name ?? null,
        assetName: a.asset_name || 'Capital Asset',
        assetClass: a.asset_class || 'Plant & Equipment / Machinery',
        purchaseDate: a.purchase_date || new Date().toISOString().split('T')[0],
        costPrice: Number(a.cost_price || 0),
        payloadJson: JSON.stringify(a)
      },
      update: {
        outletId: a.outlet_id || 'outlet-1',
        outletName: a.outlet_name ?? null,
        assetName: a.asset_name || 'Capital Asset',
        assetClass: a.asset_class || 'Plant & Equipment / Machinery',
        purchaseDate: a.purchase_date || new Date().toISOString().split('T')[0],
        costPrice: Number(a.cost_price || 0),
        payloadJson: JSON.stringify(a)
      }
    });
  }

  public async upsertAsset(asset: FixedAssetRecord): Promise<void> {
    const list = this.getAssets();
    const idx = list.findIndex((a) => a.id === asset.id);
    if (idx >= 0) {
      list[idx] = asset;
    } else {
      list.unshift(asset);
    }
    this.assetsCache = list;
    this.writeJsonFile(ASSETS_FILE, list);
    await this.persistAssetToDb(asset);
  }

  public async deleteAsset(id: string): Promise<void> {
    const list = this.getAssets().filter((a) => a.id !== id);
    this.assetsCache = list;
    this.writeJsonFile(ASSETS_FILE, list);
    if (!this.dbEnabled) return;
    await prisma.appFixedAsset.deleteMany({ where: { id } });
  }

  public async saveAssets(assets: FixedAssetRecord[]): Promise<void> {
    this.assetsCache = [...assets];
    this.writeJsonFile(ASSETS_FILE, this.assetsCache);
    if (!this.dbEnabled) return;

    const ids = assets.map((a) => a.id);
    for (const a of assets) {
      await this.persistAssetToDb(a);
    }
    if (ids.length > 0) {
      await prisma.appFixedAsset.deleteMany({ where: { id: { notIn: ids } } });
    } else {
      await prisma.appFixedAsset.deleteMany({});
    }
  }
}

export const appStore = new AppStore();
