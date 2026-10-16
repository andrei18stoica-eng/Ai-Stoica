// The product's public name and domain, in one place (Serasmart AI, 0.7.19). The interface reads the same file
// (renderer/src/brand.js). Change the name or the domain here; apps/server/brand.cjs keeps the same defaults
// (test-0719-brand.cjs checks them). Technical names stay as they were (AI_STOICA_* variables, data files,
// the Windows installer's productName), so existing data and settings keep working.
const brand = require("./brand.json");

const BRAND_NAME = String(process.env.AI_STOICA_BRAND_NAME || brand.name).trim() || brand.name;
const BRAND_SHORT = String(process.env.AI_STOICA_BRAND_SHORT || brand.short).trim() || brand.short;
const BRAND_DOMAIN = String(process.env.AI_STOICA_PUBLIC_DOMAIN || brand.domain).trim() || brand.domain;

module.exports = { BRAND_NAME, BRAND_SHORT, BRAND_DOMAIN, brand };
