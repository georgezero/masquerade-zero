import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const sexEnum = pgEnum('sex', ['male', 'female', 'other', 'prefer_not_to_say']);

export const exerciseTypeEnum = pgEnum('exercise_type', [
  'Strength',
  'Cardio',
  'Mobility',
  'Recovery',
  'Other',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: text('user_id').primaryKey(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    sex: sexEnum('sex'),
    tennisNickname: text('tennis_nickname'),
    birthYear: integer('birth_year'),
    avatarUrl: text('avatar_url'),
    timezone: text('timezone'),
    profileCompletedAt: timestamp('profile_completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_profiles_email_unique').on(table.email),
    uniqueIndex('user_profiles_tennis_nickname_unique').on(table.tennisNickname),
  ],
);

export const playerProfiles = pgTable(
  'player_profiles',
  {
    userId: text('user_id').primaryKey(),
    utrSingles: text('utr_singles'),
    utrDoubles: text('utr_doubles'),
    ustaNtrpSingles: text('usta_ntrp_singles'),
    ustaNtrpDoubles: text('usta_ntrp_doubles'),
    dominantHand: text('dominant_hand'),
    backhandStyle: text('backhand_style'),
    level: text('level'),
    yearsPlaying: integer('years_playing'),
    singlesDoublesPreference: text('singles_doubles_preference'),
    primaryGoals: text('primary_goals'),
    trainingDays: text('training_days'),
    coachName: text('coach_name'),
    homeClub: text('home_club'),
    preferredSessionMinutes: integer('preferred_session_minutes'),
    injuryNotes: text('injury_notes'),
    favoriteDrills: text('favorite_drills'),
    playStyle: text('play_style'),
    preferredSurfaces: text('preferred_surfaces'),
    ratingsUpdatedAt: timestamp('ratings_updated_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('player_profiles_user_id_idx').on(table.userId)],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    weekStart: text('week_start').notNull(),
    planText: text('plan_text').notNull(),
    ...timestamps,
  },
  (table) => [index('goals_user_id_idx').on(table.userId)],
);

export const practices = pgTable(
  'practices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    withCoach: boolean('with_coach').default(false).notNull(),
    coachName: text('coach_name'),
    workedOn: text('worked_on').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('practices_user_id_idx').on(table.userId)],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    opponent: text('opponent').notNull(),
    score: text('score').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('matches_user_id_idx').on(table.userId)],
);

export const diets = pgTable(
  'diets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('diets_user_id_idx').on(table.userId)],
);

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    exerciseType: exerciseTypeEnum('exercise_type').notNull(),
    durationMin: integer('duration_min').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('exercises_user_id_idx').on(table.userId)],
);
