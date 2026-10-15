-- Split listing content into its own column so searches can leave it out.
-- Anonymous visitors may not read trace content (canViewContent), so their
-- searches match only title and metadata; signed-in searches also match
-- content. The index is rebuilt from the database and blobs on first use
-- (ensureSearchIndex), so dropping it here loses nothing.
DROP TABLE IF EXISTS `listing_search`;--> statement-breakpoint
CREATE VIRTUAL TABLE `listing_search` USING fts5(
  `listing_id` UNINDEXED,
  `title`,
  `meta`,
  `content`,
  tokenize = 'porter unicode61'
);
