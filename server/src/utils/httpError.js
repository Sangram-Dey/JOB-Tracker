// Throw this from a route to send a specific status code; the error handler in app.js reads err.status.
export const httpError = (status, message) => Object.assign(new Error(message), { status });
