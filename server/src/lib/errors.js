export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}
export const badRequest = (m, d) => new AppError(400, m, d);
export const unauthorized = (m = "Not authorized") => new AppError(401, m);
export const forbidden = (m = "You don't have permission to do that") => new AppError(403, m);
export const notFound = (m = "Not found") => new AppError(404, m);
export const conflict = (m) => new AppError(409, m);
