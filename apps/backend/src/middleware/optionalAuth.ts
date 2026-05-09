import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { jwtConfig } from "../config/jwt"
import { redisExists } from "../config/redis"
import { AppError } from "../utils/AppError"
import type { AccessTokenPayload } from "../utils/token"

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith("Bearer ")) {
      return next()
    }

    const token = authHeader.slice(7).trim()
    if (!token) return next()

    let payload: AccessTokenPayload
    try {
      payload = jwt.verify(token, jwtConfig.accessSecret) as AccessTokenPayload
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(401, "TOKEN_EXPIRED", "Access token has expired")
      }
      throw new AppError(401, "TOKEN_INVALID", "Access token is invalid")
    }

    const isBlacklisted = await redisExists(`auth:blacklist:${payload.jti}`)
    if (isBlacklisted) {
      throw new AppError(401, "TOKEN_REVOKED", "Access token has been revoked")
    }

    req.user = {
      id:    payload.sub,
      email: payload.email,
      role:  payload.role,
      jti:   payload.jti,
      exp:   payload.exp,
    }
    next()
  } catch (err) {
    next(err)
  }
}