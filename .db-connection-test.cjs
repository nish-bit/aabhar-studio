const postgres = require("postgres");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is missing");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : "require"
});

(async () => {
  try {
    await sql`select 1 as ok`;
    console.log("Database connection: OK");
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
