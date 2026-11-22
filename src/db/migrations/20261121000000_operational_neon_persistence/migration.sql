-- Operational Neon PostgreSQL Persistence Tables
-- Ensures Outlets, Users, Sessions, Settings, Bills, Uploaded Files, and Fixed Assets persist across restarts.

CREATE TABLE IF NOT EXISTS "AppOutlet" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppOutlet_code_key" ON "AppOutlet"("code");
CREATE INDEX IF NOT EXISTS "AppOutlet_status_idx" ON "AppOutlet"("status");

CREATE TABLE IF NOT EXISTS "AppUser" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_email_key" ON "AppUser"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_username_key" ON "AppUser"("username");
CREATE INDEX IF NOT EXISTS "AppUser_outletId_idx" ON "AppUser"("outletId");
CREATE INDEX IF NOT EXISTS "AppUser_role_idx" ON "AppUser"("role");
CREATE INDEX IF NOT EXISTS "AppUser_status_idx" ON "AppUser"("status");

CREATE TABLE IF NOT EXISTS "AppSession" (
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
);

CREATE INDEX IF NOT EXISTS "AppSession_userId_idx" ON "AppSession"("userId");
CREATE INDEX IF NOT EXISTS "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");

CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL,
    "valueJson" TEXT,
    "binaryData" BYTEA,
    "filename" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "AppBill" (
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
);

CREATE INDEX IF NOT EXISTS "AppBill_outletId_idx" ON "AppBill"("outletId");
CREATE INDEX IF NOT EXISTS "AppBill_status_idx" ON "AppBill"("status");
CREATE INDEX IF NOT EXISTS "AppBill_quarter_idx" ON "AppBill"("quarter");
CREATE INDEX IF NOT EXISTS "AppBill_year_idx" ON "AppBill"("year");
CREATE INDEX IF NOT EXISTS "AppBill_uploadDate_idx" ON "AppBill"("uploadDate");

CREATE TABLE IF NOT EXISTS "AppUploadedFile" (
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUploadedFile_pkey" PRIMARY KEY ("filename")
);

CREATE TABLE IF NOT EXISTS "AppFixedAsset" (
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
);

CREATE INDEX IF NOT EXISTS "AppFixedAsset_outletId_idx" ON "AppFixedAsset"("outletId");
CREATE INDEX IF NOT EXISTS "AppFixedAsset_purchaseDate_idx" ON "AppFixedAsset"("purchaseDate");
