import type { Queryable } from './database.js'
export async function migrateHousehold(db: Queryable) {
  // Keep the September schema and its data intact.
  await db.query(`CREATE TABLE IF NOT EXISTS laundry_items(id UUID PRIMARY KEY,name VARCHAR(120) NOT NULL,details VARCHAR(250) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`ALTER TABLE laundry_items ADD COLUMN IF NOT EXISTS interval_days INTEGER CHECK(interval_days BETWEEN 1 AND 3650)`)
  await db.query(`ALTER TABLE laundry_items ADD COLUMN IF NOT EXISTS photo TEXT NOT NULL DEFAULT ''`)
  await db.query(`CREATE TABLE IF NOT EXISTS laundry_washes(id UUID PRIMARY KEY,item_id UUID NOT NULL REFERENCES laundry_items(id) ON DELETE CASCADE,washed_on DATE NOT NULL,note VARCHAR(500) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`CREATE INDEX IF NOT EXISTS laundry_washes_item_date_idx ON laundry_washes(item_id,washed_on DESC)`)
  await db.query(`CREATE TABLE IF NOT EXISTS supply_items(id UUID PRIMARY KEY,name VARCHAR(100) NOT NULL,details VARCHAR(250) NOT NULL DEFAULT '',category VARCHAR(100) NOT NULL DEFAULT 'Для дома',interval_days INTEGER CHECK(interval_days BETWEEN 1 AND 3650),running_low BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`CREATE TABLE IF NOT EXISTS supply_purchases(id UUID PRIMARY KEY,item_id UUID NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,purchased_on DATE NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>0),quantity VARCHAR(120) NOT NULL DEFAULT '',note VARCHAR(500) NOT NULL DEFAULT '',operation_id UUID UNIQUE REFERENCES expenses(id) ON DELETE SET NULL,owns_operation BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`CREATE INDEX IF NOT EXISTS supply_purchases_item_date_idx ON supply_purchases(item_id,purchased_on DESC)`)
  // Keep the last known cost/date even if the expense is later removed.
  await db.query(`CREATE OR REPLACE FUNCTION trellis_sync_supply_expense() RETURNS trigger AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM supply_purchases WHERE operation_id=NEW.id) THEN
        IF NEW.type <> 'expense' THEN RAISE EXCEPTION 'Покупка запаса связана с этим расходом. Сначала удали связь в Запасах.'; END IF;
        UPDATE supply_purchases SET amount=NEW.amount,purchased_on=NEW.operation_date
          WHERE operation_id=NEW.id AND (amount<>NEW.amount OR purchased_on<>NEW.operation_date);
      END IF;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`)
  await db.query(`DROP TRIGGER IF EXISTS trellis_supply_expense ON expenses`)
  await db.query(`CREATE TRIGGER trellis_supply_expense BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION trellis_sync_supply_expense()`)

}
