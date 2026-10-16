CREATE TABLE `campaign_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`order_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_fills_unique` ON `campaign_fills` (`campaign_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_org_id` text NOT NULL,
	`title` text NOT NULL,
	`criteria` text NOT NULL,
	`license` text NOT NULL,
	`max_price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`budget_cents` integer NOT NULL,
	`spent_cents` integer DEFAULT 0 NOT NULL,
	`filled` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`collection_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`buyer_org_id`) REFERENCES `buyer_orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campaigns_status_idx` ON `campaigns` (`status`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);