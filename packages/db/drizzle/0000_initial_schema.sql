CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`kind` text NOT NULL,
	`blob_key` text,
	`data` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_trace_idx` ON `assets` (`trace_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bounties` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_org_id` text NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`per_trace_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bounty_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`bounty_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`bounty_id`) REFERENCES `bounties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `buyer_orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`collection_id`, `listing_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`version` integer NOT NULL,
	`listing_ids` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_org_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`query` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`tier` integer NOT NULL,
	`scope` text NOT NULL,
	`scope_ref` text,
	`terms_version` text NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `consents_trace_idx` ON `consents` (`trace_id`);--> statement-breakpoint
CREATE TABLE `demand_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`buyer_org_id` text,
	`criteria` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demand_signals_created_idx` ON `demand_signals` (`created_at`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_org_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`license_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entitlements_buyer_idx` ON `entitlements` (`buyer_org_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `event_cursors` (
	`consumer` text PRIMARY KEY NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`evidence` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `labels_trace_idx` ON `labels` (`trace_id`);--> statement-breakpoint
CREATE INDEX `labels_code_idx` ON `labels` (`code`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`account` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_account_idx` ON `ledger_entries` (`account`);--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`order_line_id` text NOT NULL,
	`scope` text NOT NULL,
	`exclusive` integer DEFAULT false NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`tier` integer NOT NULL,
	`status` text NOT NULL,
	`price_policy` text DEFAULT 'trait-v1' NOT NULL,
	`allowed_licenses` text NOT NULL,
	`current_price_cents` integer,
	`price_updated_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`);--> statement-breakpoint
CREATE INDEX `listings_trace_idx` ON `listings` (`trace_id`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`seller_share_rate` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`buyer_org_id` text NOT NULL,
	`status` text NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`factors` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_snapshots_listing_idx` ON `price_snapshots` (`listing_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_org_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`license` text NOT NULL,
	`total_cents` integer NOT NULL,
	`breakdown` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `collection_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trace_traits` (
	`trace_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`combo_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `traces` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text NOT NULL,
	`title` text,
	`harness` text NOT NULL,
	`model` text NOT NULL,
	`language` text,
	`framework` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`turn_count` integer NOT NULL,
	`tool_call_count` integer NOT NULL,
	`content_hash` text NOT NULL,
	`blob_key` text NOT NULL,
	`redaction_count` integer DEFAULT 0 NOT NULL,
	`redaction_density` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `traces_seller_idx` ON `traces` (`seller_id`);--> statement-breakpoint
CREATE INDEX `traces_hash_idx` ON `traces` (`content_hash`);--> statement-breakpoint
CREATE INDEX `traces_facets_idx` ON `traces` (`language`,`framework`,`model`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`buyer_org_id` text,
	`terms_accepted_version` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);