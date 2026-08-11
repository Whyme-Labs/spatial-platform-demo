PRAGMA foreign_keys = ON;

-- Capture origin records where observations came from. Asset producer records
-- which supported pipeline produced the files presented to this project. The
-- legacy adapter remains during the expand phase for rollback compatibility.
ALTER TABLE projects ADD COLUMN capture_origin TEXT
  CHECK (capture_origin IS NULL OR capture_origin IN (
    'xgrids', 'fjd', 'phone', 'drone', 'third-party'
  ));

ALTER TABLE projects ADD COLUMN asset_producer TEXT
  CHECK (asset_producer IS NULL OR asset_producer IN (
    'xgrids-lcc', 'fjd-trion', 'open-import'
  ));

UPDATE projects
SET capture_origin = CASE COALESCE(capture_adapter_v2, capture_adapter)
  WHEN 'xgrids-lcc' THEN 'xgrids'
  WHEN 'fjd-trion' THEN 'fjd'
  WHEN 'phone-video' THEN 'phone'
  WHEN 'drone-imagery' THEN 'drone'
  ELSE 'third-party'
END,
asset_producer = CASE COALESCE(capture_adapter_v2, capture_adapter)
  WHEN 'xgrids-lcc' THEN 'xgrids-lcc'
  WHEN 'fjd-trion' THEN 'fjd-trion'
  WHEN 'open-import' THEN 'open-import'
  ELSE NULL
END;
