-- Automated privacy detection is removed. It ran a vision model over poster
-- images only, which samples a 2D render rather than the scene, and privacy
-- review is handled outside the platform. The Worker no longer reads or writes
-- any of these tables, the AI binding and the scan queue are gone, and the
-- operator's confirmation on the QA form is the record of review.
--
-- Review comments of kind 'redaction' are untouched: they are a reviewer's own
-- feedback and stay with the rest of it in review_comments.
DROP TABLE IF EXISTS privacy_candidates;
DROP TABLE IF EXISTS privacy_scan_inputs;
DROP TABLE IF EXISTS privacy_scans;
DROP TABLE IF EXISTS privacy_regions;
