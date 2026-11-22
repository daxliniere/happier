-- CreateTable
CREATE TABLE "AppLockAccountLock" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "kdf" TEXT NOT NULL,
    "passwordWrappedKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppLockAccountLock_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

