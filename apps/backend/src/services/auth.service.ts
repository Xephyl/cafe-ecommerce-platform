import { AppError } from "../utils/AppError"
import { User } from "../models/user.model"
import {
  generateTokens,
  hashToken,
  verifyRefreshToken,
  accessTokenRemainingSeconds,
} from "../utils/token"
import { redisGet, redisSet, redisDel } from "../config/redis"
import { jwtConfig } from "../config/jwt"
import { mergeCarts } from "./cart.service"
import type { RegisterInput, LoginInput } from "@cafe/shared"
import type { SafeUserObject } from "../models/user.model"
import type { AccessTokenPayload } from "../utils/token"

export interface AuthResult {
  user:         SafeUserObject
  accessToken:  string
  refreshToken: string
}

export interface RefreshResult {
  accessToken:  string
  refreshToken: string
}

// Registers a new CUSTOMER account.
// If a sessionId is provided (guest had items in cart), merges guest cart
// into the newly created user cart.
export async function register(
  input:     RegisterInput,
  sessionId?: string
): Promise<AuthResult> {
  const existing = await User.findOne({ email: input.email.toLowerCase().trim() })
  if (existing) {
    throw new AppError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists")
  }

  const user = await User.create({
    email:     input.email,
    password:  input.password,
    firstName: input.firstName,
    lastName:  input.lastName,
  })

  const userId = user._id.toHexString()
  const tokens = generateTokens(userId, user.email, user.role)
  await storeRefreshToken(userId, tokens.refreshToken)

  if (sessionId) {
    await mergeCarts(sessionId, userId)
  }

  return {
    user:         user.toSafeObject(),
    accessToken:  tokens.accessToken,
    refreshToken: tokens.refreshToken,
  }
}

// Authenticates an existing user.
// If a sessionId is provided (guest had items in cart), merges guest cart
// into the user's existing cart.
export async function login(
  input:      LoginInput,
  sessionId?: string
): Promise<AuthResult> {
  const user = await User.findByEmail(input.email)
  if (!user) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password")
  }

  const passwordMatch = await user.comparePassword(input.password)
  if (!passwordMatch) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password")
  }

  if (!user.isActive) {
    throw new AppError(403, "ACCOUNT_DISABLED", "This account has been disabled")
  }

  const userId = user._id.toHexString()
  const tokens = generateTokens(userId, user.email, user.role)
  await storeRefreshToken(userId, tokens.refreshToken)

  if (sessionId) {
    await mergeCarts(sessionId, userId)
  }

  return {
    user:         user.toSafeObject(),
    accessToken:  tokens.accessToken,
    refreshToken: tokens.refreshToken,
  }
}

// Rotates a refresh token pair with reuse detection.
export async function refreshTokens(incomingRefreshToken: string): Promise<RefreshResult> {
  let payload: ReturnType<typeof verifyRefreshToken>
  try {
    payload = verifyRefreshToken(incomingRefreshToken)
  } catch {
    throw new AppError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid or expired")
  }

  const userId = payload.sub
  const storedHash = await redisGet(`auth:refresh:${userId}`)
  if (!storedHash) {
    throw new AppError(401, "REFRESH_TOKEN_REVOKED", "Refresh token has been revoked")
  }

  if (storedHash !== hashToken(incomingRefreshToken)) {
    await redisDel(`auth:refresh:${userId}`)
    throw new AppError(401, "REFRESH_TOKEN_REVOKED", "Refresh token has been revoked")
  }

  const user = await User.findById(userId).lean()
  if (!user) {
    await redisDel(`auth:refresh:${userId}`)
    throw new AppError(401, "REFRESH_TOKEN_REVOKED", "User no longer exists")
  }

  await redisDel(`auth:refresh:${userId}`)
  const userObjectId = user._id.toHexString()
  const tokens = generateTokens(userObjectId, user.email, user.role)
  await storeRefreshToken(userId, tokens.refreshToken)

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
}

// Blacklists the access token jti and deletes the refresh token.
export async function logout(
  userId:        string,
  accessPayload: Pick<AccessTokenPayload, "jti" | "exp">
): Promise<void> {
  const remainingTTL = accessTokenRemainingSeconds(accessPayload as AccessTokenPayload)
  if (remainingTTL > 0) {
    await redisSet(`auth:blacklist:${accessPayload.jti}`, "1", remainingTTL)
  }
  await redisDel(`auth:refresh:${userId}`)
}

async function storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
  await redisSet(
    `auth:refresh:${userId}`,
    hashToken(refreshToken),
    jwtConfig.refreshTTLSeconds
  )
}