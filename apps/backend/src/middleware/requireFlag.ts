import type { Request, Response, NextFunction } from "express"
import { getFlag, FlagName } from "../config/featureFlags"
import { apiResponse } from "../utils/apiResponse"

/**
 * Middleware to check if a feature flag is enabled
 * @param flag - The feature flag to check
 * @returns Express middleware function
 */
export function requireFlag(flag: FlagName) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!getFlag(flag)) {
      res.status(503).json(
        apiResponse.error(
          "FEATURE_DISABLED",
          `The ${flag} feature is currently disabled`
        )
      )
      return
    }
    next()
  }
}
