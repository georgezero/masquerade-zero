import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  diets,
  exercises,
  goals,
  matches,
  playerProfiles,
  practices,
  userProfiles,
} from "../db/schema.js";
import type { AuthUser } from "./auth.js";

type UserProfileRow = typeof userProfiles.$inferSelect;
type PlayerProfileRow = typeof playerProfiles.$inferSelect;

export type AppProfile = {
  avatarUrl: string | null;
  backhandStyle: string | null;
  birthYear: number | null;
  coachName: string | null;
  createdAt: string | null;
  favoriteDrills: string | null;
  firstName: string | null;
  handedness: string | null;
  homeClub: string | null;
  injuryNotes: string | null;
  lastName: string | null;
  level: string | null;
  preferredSessionMinutes: number | null;
  primaryGoals: string | null;
  profileCompletedAt: string | null;
  sex: UserProfileRow["sex"] | null;
  singlesDoublesPreference: string | null;
  tennisNickname: string | null;
  trainingDays: string | null;
  yearsPlaying: number | null;
};

export type Viewer = {
  authUser: AuthUser | null;
  profile: AppProfile | null;
  role: "guest" | "authenticated";
  profileRequired: boolean;
};

export type HistoryItem = {
  id: string;
  kind: string;
  date: string;
  sortAt: string;
  summary?: string;
  [key: string]: unknown;
};

export function toViewer(authUser: AuthUser | null, profile: AppProfile | null): Viewer {
  const role = authUser && profile ? "authenticated" : "guest";
  const profileRequired = Boolean(
    authUser && profile && !profileIsComplete(profile),
  );
  return { authUser, profile, role, profileRequired };
}

export function profileIsComplete(profile: AppProfile | null): boolean {
  return Boolean(profile?.firstName && profile?.lastName && profile?.sex);
}

function mergeProfile(profile: UserProfileRow, playerProfile: PlayerProfileRow | null): AppProfile {
  return {
    avatarUrl: profile.avatarUrl,
    backhandStyle: playerProfile?.backhandStyle ?? null,
    birthYear: profile.birthYear,
    coachName: playerProfile?.coachName ?? null,
    createdAt: profile.createdAt?.toISOString() ?? null,
    favoriteDrills: playerProfile?.favoriteDrills ?? null,
    firstName: profile.firstName,
    handedness: playerProfile?.dominantHand ?? null,
    homeClub: playerProfile?.homeClub ?? null,
    injuryNotes: playerProfile?.injuryNotes ?? null,
    lastName: profile.lastName,
    level: playerProfile?.level ?? null,
    preferredSessionMinutes: playerProfile?.preferredSessionMinutes ?? null,
    primaryGoals: playerProfile?.primaryGoals ?? null,
    profileCompletedAt: profile.profileCompletedAt?.toISOString() ?? null,
    sex: profile.sex ?? null,
    singlesDoublesPreference: playerProfile?.singlesDoublesPreference ?? null,
    tennisNickname: profile.tennisNickname,
    trainingDays: playerProfile?.trainingDays ?? null,
    yearsPlaying: playerProfile?.yearsPlaying ?? null,
  };
}

export async function ensureUserProfile(user: AuthUser): Promise<AppProfile | null> {
  if (!db || !user.email) {
    return null;
  }

  await db
    .insert(userProfiles)
    .values({
      userId: user.id,
      email: user.email,
      displayName: user.name ?? null,
      firstName: null,
      lastName: null,
      sex: null,
      tennisNickname: null,
      birthYear: null,
      avatarUrl: null,
      timezone: null,
      profileCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  await db
    .insert(playerProfiles)
    .values({
      userId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return getAppProfile(user.id);
}

export async function getAppProfile(userId: string): Promise<AppProfile | null> {
  if (!db) {
    return null;
  }

  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  if (!profile) {
    return null;
  }

  const [playerProfile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  return mergeProfile(profile, playerProfile ?? null);
}

// --- Normalization helpers ---

export function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function normalizeAvatarUrl(value: unknown): { error?: string; value: string | null } {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return { value: null };
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") {
      return { error: "Avatar URL must use https.", value: null };
    }
    return { value: url.toString() };
  } catch {
    return { error: "Avatar URL must be a valid URL.", value: null };
  }
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredDate(value: unknown): string {
  return normalizeRequiredText(value, "Date");
}

function normalizeDuration(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Duration must be greater than 0.");
  }
  return Math.round(parsed);
}

function normalizeExerciseType(value: unknown): "Strength" | "Cardio" | "Mobility" | "Recovery" | "Other" {
  return ["Strength", "Cardio", "Mobility", "Recovery", "Other"].includes(String(value))
    ? (value as "Strength" | "Cardio" | "Mobility" | "Recovery" | "Other")
    : "Other";
}

// --- Profile update ---

export async function updateTennisProfile(
  userId: string,
  body: Record<string, unknown>,
): Promise<AppProfile> {
  if (!db) {
    throw new Error("Database is not configured.");
  }

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const sex = typeof body.sex === "string" ? body.sex : "";
  const tennisNickname = normalizeNullableText(body.tennisNickname);
  const birthYear = normalizeNullableInteger(body.birthYear);
  const handedness = normalizeNullableText(body.handedness);
  const level = normalizeNullableText(body.level);
  const yearsPlaying = normalizeNullableInteger(body.yearsPlaying);
  const singlesDoublesPreference = normalizeNullableText(body.singlesDoublesPreference);
  const backhandStyle = normalizeNullableText(body.backhandStyle);
  const primaryGoals = normalizeNullableText(body.primaryGoals);
  const trainingDays = normalizeNullableText(body.trainingDays);
  const coachName = normalizeNullableText(body.coachName);
  const homeClub = normalizeNullableText(body.homeClub);
  const preferredSessionMinutes = normalizeNullableInteger(body.preferredSessionMinutes);
  const injuryNotes = normalizeNullableText(body.injuryNotes);
  const favoriteDrills = normalizeNullableText(body.favoriteDrills);
  const avatarUrl = normalizeAvatarUrl(body.avatarUrl);

  if (!firstName || !lastName) {
    throw new Error("First and last name are required.");
  }

  if (!["male", "female", "other", "prefer_not_to_say"].includes(sex)) {
    throw new Error("Sex is required.");
  }

  if (avatarUrl.error) {
    throw new Error(avatarUrl.error);
  }

  const completedProfile = profileIsComplete({
    avatarUrl: avatarUrl.value,
    backhandStyle,
    birthYear,
    coachName,
    createdAt: null,
    favoriteDrills,
    firstName,
    handedness,
    homeClub,
    injuryNotes,
    lastName,
    level,
    preferredSessionMinutes,
    primaryGoals,
    profileCompletedAt: null,
    sex: sex as AppProfile["sex"],
    singlesDoublesPreference,
    tennisNickname,
    trainingDays,
    yearsPlaying,
  });

  await db
    .update(userProfiles)
    .set({
      avatarUrl: avatarUrl.value,
      birthYear,
      firstName,
      lastName,
      profileCompletedAt: completedProfile ? new Date() : null,
      sex: sex as "male" | "female" | "other" | "prefer_not_to_say",
      tennisNickname,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, userId));

  await db
    .update(playerProfiles)
    .set({
      backhandStyle,
      coachName,
      dominantHand: handedness,
      favoriteDrills,
      homeClub,
      injuryNotes,
      level,
      preferredSessionMinutes,
      primaryGoals,
      singlesDoublesPreference,
      trainingDays,
      updatedAt: new Date(),
      yearsPlaying,
    })
    .where(eq(playerProfiles.userId, userId));

  const profile = await getAppProfile(userId);
  if (!profile) {
    throw new Error("Profile not found after update.");
  }
  return profile;
}

// --- History ---

export async function listHistory(
  userId: string,
  kind: string,
  limit: number,
  offset: number,
): Promise<{ items: HistoryItem[]; total: number }> {
  if (!db) {
    return { items: [], total: 0 };
  }

  const perTableLimit = Math.max(limit + offset, 50);

  const [goalRows, practiceRows, matchRows, dietRows, exerciseRows] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.updatedAt)).limit(perTableLimit),
    db.select().from(practices).where(eq(practices.userId, userId)).orderBy(desc(practices.createdAt)).limit(perTableLimit),
    db.select().from(matches).where(eq(matches.userId, userId)).orderBy(desc(matches.createdAt)).limit(perTableLimit),
    db.select().from(diets).where(eq(diets.userId, userId)).orderBy(desc(diets.createdAt)).limit(perTableLimit),
    db.select().from(exercises).where(eq(exercises.userId, userId)).orderBy(desc(exercises.createdAt)).limit(perTableLimit),
  ]);

  const items: HistoryItem[] = [
    ...goalRows.map((item) => ({
      date: item.weekStart,
      id: item.id,
      kind: "goal" as const,
      sortAt: item.updatedAt.toISOString(),
      summary: item.planText,
      weekStart: item.weekStart,
      planText: item.planText,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    ...practiceRows.map((item) => ({
      ...item,
      date: item.date,
      id: item.id,
      kind: "practice" as const,
      sortAt: item.createdAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
    ...matchRows.map((item) => ({
      ...item,
      date: item.date,
      id: item.id,
      kind: "match" as const,
      sortAt: item.createdAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
    ...dietRows.map((item) => ({
      ...item,
      date: item.date,
      id: item.id,
      kind: "diet" as const,
      sortAt: item.createdAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
    ...exerciseRows.map((item) => ({
      ...item,
      date: item.date,
      id: item.id,
      kind: "exercise" as const,
      sortAt: item.createdAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
  ]
    .filter((item) => kind === "all" || item.kind === kind)
    .sort((left, right) => new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime());

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
  };
}

// --- CRUD for each entry type ---

export async function createGoal(userId: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const weekStart = normalizeRequiredText(body.weekStart, "Week start");
  const planText = normalizeRequiredText(body.planText, "Plan text");
  await db.insert(goals).values({ planText, userId, weekStart });
}

export async function updateGoal(userId: string, id: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const weekStart = normalizeRequiredText(body.weekStart, "Week start");
  const planText = normalizeRequiredText(body.planText, "Plan text");
  const result = await db.update(goals).set({ planText, updatedAt: new Date(), weekStart })
    .where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();
  if (!result[0]) { throw new Error("Entry not found."); }
  return result[0];
}

export async function deleteGoal(userId: string, id: string) {
  if (!db) { throw new Error("Database is not configured."); }
  const result = await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId))).returning({ id: goals.id });
  if (!result[0]) { throw new Error("Entry not found."); }
}

export async function createPractice(userId: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const workedOn = normalizeRequiredText(body.workedOn, "Worked on");
  await db.insert(practices).values({
    coachName: normalizeOptionalText(body.coachName) || null,
    createdAt: new Date(), date, notes: normalizeOptionalText(body.notes),
    userId, withCoach: Boolean(body.withCoach), workedOn,
  });
}

export async function updatePractice(userId: string, id: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const workedOn = normalizeRequiredText(body.workedOn, "Worked on");
  const result = await db.update(practices).set({
    coachName: normalizeOptionalText(body.coachName) || null,
    date, notes: normalizeOptionalText(body.notes),
    withCoach: Boolean(body.withCoach), workedOn,
  }).where(and(eq(practices.id, id), eq(practices.userId, userId))).returning();
  if (!result[0]) { throw new Error("Entry not found."); }
  return result[0];
}

export async function deletePractice(userId: string, id: string) {
  if (!db) { throw new Error("Database is not configured."); }
  const result = await db.delete(practices).where(and(eq(practices.id, id), eq(practices.userId, userId))).returning({ id: practices.id });
  if (!result[0]) { throw new Error("Entry not found."); }
}

export async function createMatch(userId: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const opponent = normalizeRequiredText(body.opponent, "Opponent");
  await db.insert(matches).values({
    createdAt: new Date(), date, notes: normalizeOptionalText(body.notes),
    opponent, score: normalizeOptionalText(body.score), userId,
  });
}

export async function updateMatch(userId: string, id: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const opponent = normalizeRequiredText(body.opponent, "Opponent");
  const result = await db.update(matches).set({
    date, notes: normalizeOptionalText(body.notes), opponent, score: normalizeOptionalText(body.score),
  }).where(and(eq(matches.id, id), eq(matches.userId, userId))).returning();
  if (!result[0]) { throw new Error("Entry not found."); }
  return result[0];
}

export async function deleteMatch(userId: string, id: string) {
  if (!db) { throw new Error("Database is not configured."); }
  const result = await db.delete(matches).where(and(eq(matches.id, id), eq(matches.userId, userId))).returning({ id: matches.id });
  if (!result[0]) { throw new Error("Entry not found."); }
}

export async function createDiet(userId: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const summary = normalizeRequiredText(body.summary, "Summary");
  await db.insert(diets).values({ createdAt: new Date(), date, summary, userId });
}

export async function updateDiet(userId: string, id: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const summary = normalizeRequiredText(body.summary, "Summary");
  const result = await db.update(diets).set({ date, summary })
    .where(and(eq(diets.id, id), eq(diets.userId, userId))).returning();
  if (!result[0]) { throw new Error("Entry not found."); }
  return result[0];
}

export async function deleteDiet(userId: string, id: string) {
  if (!db) { throw new Error("Database is not configured."); }
  const result = await db.delete(diets).where(and(eq(diets.id, id), eq(diets.userId, userId))).returning({ id: diets.id });
  if (!result[0]) { throw new Error("Entry not found."); }
}

export async function createExercise(userId: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const durationMin = normalizeDuration(body.durationMin);
  await db.insert(exercises).values({
    createdAt: new Date(), date, durationMin,
    exerciseType: normalizeExerciseType(body.exerciseType),
    notes: normalizeOptionalText(body.notes), userId,
  });
}

export async function updateExercise(userId: string, id: string, body: Record<string, unknown>) {
  if (!db) { throw new Error("Database is not configured."); }
  const date = normalizeRequiredDate(body.date);
  const durationMin = normalizeDuration(body.durationMin);
  const result = await db.update(exercises).set({
    date, durationMin, exerciseType: normalizeExerciseType(body.exerciseType),
    notes: normalizeOptionalText(body.notes),
  }).where(and(eq(exercises.id, id), eq(exercises.userId, userId))).returning();
  if (!result[0]) { throw new Error("Entry not found."); }
  return result[0];
}

export async function deleteExercise(userId: string, id: string) {
  if (!db) { throw new Error("Database is not configured."); }
  const result = await db.delete(exercises).where(and(eq(exercises.id, id), eq(exercises.userId, userId))).returning({ id: exercises.id });
  if (!result[0]) { throw new Error("Entry not found."); }
}

// --- Single entry lookup ---

export async function getEntryById(userId: string, kind: string, id: string): Promise<HistoryItem | null> {
  if (!db) { return null; }

  if (kind === "goal") {
    const [row] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId))).limit(1);
    if (!row) { return null; }
    return { id: row.id, kind: "goal", date: row.weekStart, sortAt: row.updatedAt.toISOString(), summary: row.planText, weekStart: row.weekStart, planText: row.planText, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  if (kind === "practice") {
    const [row] = await db.select().from(practices).where(and(eq(practices.id, id), eq(practices.userId, userId))).limit(1);
    if (!row) { return null; }
    return { ...row, id: row.id, kind: "practice", date: row.date, sortAt: row.createdAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }
  if (kind === "match") {
    const [row] = await db.select().from(matches).where(and(eq(matches.id, id), eq(matches.userId, userId))).limit(1);
    if (!row) { return null; }
    return { ...row, id: row.id, kind: "match", date: row.date, sortAt: row.createdAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }
  if (kind === "diet") {
    const [row] = await db.select().from(diets).where(and(eq(diets.id, id), eq(diets.userId, userId))).limit(1);
    if (!row) { return null; }
    return { ...row, id: row.id, kind: "diet", date: row.date, sortAt: row.createdAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }
  if (kind === "exercise") {
    const [row] = await db.select().from(exercises).where(and(eq(exercises.id, id), eq(exercises.userId, userId))).limit(1);
    if (!row) { return null; }
    return { ...row, id: row.id, kind: "exercise", date: row.date, sortAt: row.createdAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }

  return null;
}
