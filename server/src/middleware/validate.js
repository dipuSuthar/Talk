import { badRequest } from "../lib/errors.js";

/** validate({ body, query, params }) -> parsed values land on req.valid.* (Express 5 makes req.query read-only). */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ["params", "query", "body"]) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
      throw badRequest(details[0]?.message ? `${details[0].field ? details[0].field + ": " : ""}${details[0].message}` : "Invalid request", details);
    }
    req.valid[part] = result.data;
  }
  next();
};
