import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { isProduction } from "../env.js";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export const COOKIE_NAME = "player_token";

export function setPlayerCookie(c: Context, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });
}

export async function getPlayerFromCookie(c: Context) {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  const player = await db.query.players.findFirst({
    where: eq(schema.players.sessionToken, token),
  });
  return player ?? null;
}

export async function requirePlayer(c: Context) {
  const player = await getPlayerFromCookie(c);
  if (!player) {
    return null;
  }
  return player;
}

export async function requirePlayerInRoom(c: Context, pin: string) {
  const player = await getPlayerFromCookie(c);
  if (!player) return null;

  const room = await db.query.gameRooms.findFirst({
    where: eq(schema.gameRooms.pin, pin),
  });
  if (!room) return null;
  if (player.roomId !== room.id) return null;

  return { player, room };
}
