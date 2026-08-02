PRAGMA foreign_keys = ON;

ALTER TABLE floorplan_revisions
  ADD COLUMN navigation_receipt_version TEXT CHECK (
    navigation_receipt_version IS NULL OR
    navigation_receipt_version = 'floorplan-navigation-receipt-v1'
  );
