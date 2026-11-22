-- CreateTable
CREATE TABLE "AppLockAccountLock" (
    "accountId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "kdf" TEXT NOT NULL,
    "passwordWrappedKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppLockAccountLock_pkey" PRIMARY KEY ("accountId")
);

-- AddForeignKey
ALTER TABLE "AppLockAccountLock" ADD CONSTRAINT "AppLockAccountLock_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

