-- Preserve existing wrapped keys while allowing the 200-character envelopes produced by clients.
ALTER TABLE `AppLockAccountLock`
    MODIFY `passwordWrappedKey` LONGTEXT NOT NULL,
    MODIFY `deviceWrappedKey` LONGTEXT NOT NULL;
