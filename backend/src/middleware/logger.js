/** Minimal structured request logger — no external dependency. */
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'ERR ' : res.statusCode >= 400 ? 'WARN' : 'OK  ';
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(
      `[${stamp}] ${level} ${req.method.padEnd(6)} ${res.statusCode} ${ms.toFixed(1)}ms  ${req.originalUrl}`
    );
  });
  next();
}
