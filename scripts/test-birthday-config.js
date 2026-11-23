/** Test local — pas d'HTTP. node scripts/test-birthday-config.js */
const {
  parseBirthdayDate,
  formatBirthdayDate,
  localParts,
  parseBirthdayConfig,
} = require("../lib/birthdayConfig");

if (!parseBirthdayDate("23/11")) throw new Error("parse");
if (parseBirthdayDate("32/11")) throw new Error("invalid day");
if (formatBirthdayDate({ day: 3, month: 1 }) !== "03/01") throw new Error("format");
const cfg = parseBirthdayConfig({ enabled: true, hour: 30, timezone_offset_minutes: 60 });
if (cfg.hour !== 23) throw new Error("hour clamp");
const parts = localParts(Date.UTC(2026, 10, 23, 8, 0, 0), 60);
if (parts.hour !== 9) throw new Error("offset hour");
console.log("ok", formatBirthdayDate(parseBirthdayDate("23/11/2001")));
