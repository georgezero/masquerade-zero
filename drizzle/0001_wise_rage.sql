CREATE UNIQUE INDEX `word_packs_name_unique` ON `word_packs` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `word_pairs_pack_civilian_unique` ON `word_pairs` (`pack_id`,`civilian_word`);