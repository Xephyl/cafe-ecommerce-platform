import type { Request, Response } from "express"
import { asyncHandler } from "../utils/asyncHandler"
import { apiResponse } from "../utils/apiResponse"
import * as authService from "../services/auth.service"
import { AppError } from "../utils/AppError"
import { jwtConfig } from "../config/jwt"
import { config } from "../config/index"

// Refresh token cookie options
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   config.isProd,
  sameSite: "strict" as const,
  maxAge:   jwtConfig.refreshTTLSeconds * 1000,
  path:     "/api/auth",
}

// Clear cookie options
const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   config.isProd,
  sameSite: "strict" as const,
  path:     "/api/auth",
}

// POST /api/auth/register
export const register = asyncHandler(async (req: Request, res: Response) => {
  const sessionId = req.signedCookies.sessionId as string | undefined
  const result    = await authService.register(req.body, sessionId)

  res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS)
  if (sessionId) res.clearCookie("sessionId", { path: "/" })

  res.status(201).json(
    apiResponse.success({ user: result.user, accessToken: result.accessToken })
  )
})

// POST /api/auth/login
export const login = asyncHandler(async (req: Request, res: Response) => {
  const sessionId = req.signedCookies.sessionId as string | undefined
  const result    = await authService.login(req.body, sessionId)

  res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS)
  if (sessionId) res.clearCookie("sessionId", { path: "/" })

  res.status(200).json(
    apiResponse.success({ user: result.user, accessToken: result.accessToken })
  )
})

// POST /api/auth/refresh
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const incomingToken = req.cookies.refreshToken as string | undefined
  if (!incomingToken) {
    throw new AppError(401, "REFRESH_TOKEN_MISSING", "Refresh token cookie is missing")
  }
  const result = await authService.refreshTokens(incomingToken)
  res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS)
  res.status(200).json(apiResponse.success({ accessToken: result.accessToken }))
})

// POST /api/auth/logout
export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "TOKEN_MISSING", "Authentication required")
  }
  await authService.logout(req.user.id, { jti: req.user.jti, exp: req.user.exp })
  res.clearCookie("refreshToken", CLEAR_COOKIE_OPTIONS)
  res.status(200).json(apiResponse.success({ message: "Logged out successfully" }))
})

// GET /api/auth/me
export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "TOKEN_MISSING", "Authentication required")
  }
  res.status(200).json(
    apiResponse.success({ id: req.user.id, email: req.user.email, role: req.user.role })
  )
})