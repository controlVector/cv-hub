// @ts-check
/** @type {import('drizzle-kit').Config} */
module.exports = {
  schema: './dist/db/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
};
