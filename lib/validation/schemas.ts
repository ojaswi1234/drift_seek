import { z } from "zod";

/**
 * Schema for creating a new web server monitor.
 * Matches: POST /api/database
 */
export const createMonitorSchema = z.object({
  name: z.string({
    message: "Name is required and must be a string",
  })
  .trim()
  .min(1, "Name cannot be empty")
  .max(100, "Name must be at most 100 characters"),
  url: z.string({
    message: "URL is required and must be a string",
  })
  .trim()
  .transform((val) => {
    if (!val.startsWith("http://") && !val.startsWith("https://")) {
      return `https://${val}`;
    }
    return val;
  })
  .pipe(z.string().url("Invalid URL format")),
});

/**
 * Schema for deleting a web server monitor via query parameters.
 * Matches: DELETE /api/database?id=<id>
 */
export const deleteMonitorSchema = z.object({
  id: z.string({
    message: "ID is required",
  })
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format (must be a 24-character hexadecimal string)"),
});

/**
 * Schema for triggering an A/B test run.
 * Matches: POST /api/abtest/trigger
 */
export const triggerABTestSchema = z.object({
  githubUrl: z.string({
    message: "GitHub URL is required",
  })
  .trim()
  .url("Invalid GitHub URL format")
  .refine(
    (url) => url.startsWith("https://github.com/"),
    "GitHub URL must start with 'https://github.com/'"
  ),
  branches: z.array(
    z.string({
      message: "Branch name must be a string",
    })
    .trim()
    .min(1, "Branch name cannot be empty"),
    {
      message: "Branches are required",
    }
  )
  .length(2, "Exactly 2 branches must be specified for A/B testing"),
  buildCommand: z.string().trim().optional(),
  startCommand: z.string().trim().optional(),
});

/**
 * Schema for triggering a monitor ping check.
 * Matches: POST /api/monitor/ping
 */
export const pingMonitorSchema = z.object({
  id: z.string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format")
    .optional(),
  url: z.string()
    .trim()
    .optional()
    .refine((val) => {
      if (!val) return true;
      let clean = val;
      if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
        clean = `https://${clean}`;
      }
      try {
        new URL(clean);
        return true;
      } catch {
        return false;
      }
    }, "Invalid URL format")
    .transform((val) => {
      if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
        return `https://${val}`;
      }
      return val;
    }),
})
.refine((data) => data.id || data.url, {
  message: "Must provide either id or url",
});
