-- CreateTable
CREATE TABLE `AppLockAccountLock` (
    `accountId` VARCHAR(191) NOT NULL,
    `kdf` VARCHAR(191) NOT NULL,
    `passwordWrappedKey` VARCHAR(191) NOT NULL,
    `deviceWrappedKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`accountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AppLockAccountLock` ADD CONSTRAINT `AppLockAccountLock_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

