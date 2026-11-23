-- CreateTable
CREATE TABLE "AppLockAccountLock" (
    "accountId" TEXT NOT NULL,
    "kdf" TEXT NOT NULL,
    "passwordWrappedKey" TEXT NOT NULL,
    "deviceWrappedKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppLockAccountLock_pkey" PRIMARY KEY ("accountId")
);

-- AddForeignKey
ALTER TABLE "AppLockAccountLock" ADD CONSTRAINT "AppLockAccountLock_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

