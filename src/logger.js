function log(level, message, error) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] [${level}] [SymphonyMelody] ${message}`);
  if (error) console.error(error);
}
module.exports = { info: (m) => log("INFO", m), warn: (m) => log("WARN", m), error: (m, e) => log("ERROR", m, e) };
