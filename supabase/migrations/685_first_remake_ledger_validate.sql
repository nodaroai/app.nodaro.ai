-- 685: validate the ledger's source CHECK that 684 re-added NOT VALID.
--
-- 684 adds `credit_transactions_source_check` (365's list plus
-- 'first_remake_cover') as NOT VALID, so its own transaction takes the table's
-- lock only for the catalog change. VALIDATE scans the existing rows under a
-- weaker lock (SHARE UPDATE EXCLUSIVE: reads and writes continue), here, in a
-- transaction of its own. Every existing row already satisfies it (the list is
-- a superset of 365's). Re-running this file is a no-op.
ALTER TABLE credit_transactions VALIDATE CONSTRAINT credit_transactions_source_check;
