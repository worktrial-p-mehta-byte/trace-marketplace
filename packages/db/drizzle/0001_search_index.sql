-- Full-text search over listings (SQLite FTS5). Rebuildable from the
-- database and blobs at any time (rebuildSearchIndex), so it can be swapped
-- for OpenSearch later without a data migration.
CREATE VIRTUAL TABLE `listing_search` USING fts5(
  `listing_id` UNINDEXED,
  `title`,
  `body`,
  tokenize = 'porter unicode61'
);
