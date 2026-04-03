CREATE TABLE `clues` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`clue_text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clues_round_player_unique` ON `clues` (`round_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `clues_round_idx` ON `clues` (`round_id`);--> statement-breakpoint
CREATE TABLE `game_room_used_pairs` (
	`room_id` text NOT NULL,
	`pair_id` text NOT NULL,
	PRIMARY KEY(`room_id`, `pair_id`),
	FOREIGN KEY (`room_id`) REFERENCES `game_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `word_pairs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`pin` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`mode` text DEFAULT 'online' NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`round_number` integer DEFAULT 0 NOT NULL,
	`max_rounds` integer DEFAULT 3 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_rooms_pin_unique` ON `game_rooms` (`pin`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`nickname` text NOT NULL,
	`role` text,
	`word` text,
	`session_token` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`word_revealed` integer DEFAULT false NOT NULL,
	`joined_at` text DEFAULT (datetime('now')) NOT NULL,
	`eliminated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `game_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_session_token_unique` ON `players` (`session_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_nickname_unique` ON `players` (`room_id`,`nickname`);--> statement-breakpoint
CREATE INDEX `players_room_id_idx` ON `players` (`room_id`);--> statement-breakpoint
CREATE INDEX `players_session_idx` ON `players` (`session_token`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`pair_id` text,
	`round_number` integer NOT NULL,
	`speaking_order_json` text DEFAULT '[]' NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`imposter_caught` integer,
	`winner` text,
	FOREIGN KEY (`room_id`) REFERENCES `game_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `word_pairs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_room_round_unique` ON `rounds` (`room_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_round_voter_unique` ON `votes` (`round_id`,`voter_id`);--> statement-breakpoint
CREATE INDEX `votes_round_idx` ON `votes` (`round_id`);--> statement-breakpoint
CREATE TABLE `word_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`civilian_word` text NOT NULL,
	`imposter_word` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `word_packs`(`id`) ON UPDATE no action ON DELETE cascade
);
