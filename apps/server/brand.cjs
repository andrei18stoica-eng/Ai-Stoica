// The product's public name and domain for Serasmart Cloud (emails, notifications). Same defaults as
// apps/desktop/lib/brand.json (test-0719-brand.cjs checks them); BRAND_NAME / PUBLIC_DOMAIN override them.
const BRAND_NAME = String(process.env.BRAND_NAME || "Serasmart AI").trim() || "Serasmart AI";
const BRAND_SHORT = String(process.env.BRAND_SHORT || "Serasmart").trim() || "Serasmart";
const BRAND_DOMAIN = String(process.env.PUBLIC_DOMAIN || "aistoica.ro").trim() || "aistoica.ro";

module.exports = { BRAND_NAME, BRAND_SHORT, BRAND_DOMAIN };
