/**
 * Authoritative Variant Resolver for Tashgheel POS
 * 
 * Strict resolution order:
 * 1. exact id
 * 2. exact _id
 * 3. exact sku
 * 4. exact barcode
 * 5. no match
 * 
 * Rejection / Ambiguity Rule:
 * If a query matches more than one variant within any tier,
 * the resolver MUST throw an AMBIGUOUS_VARIANT error and halt immediately.
 */

class AmbiguousVariantError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'AmbiguousVariantError';
        this.code = 'AMBIGUOUS_VARIANT';
        this.statusCode = 400;
        this.details = details;
    }
}

/**
 * Resolves a variant from product.variants based on strict hierarchy.
 * @param {Array} variants Array of variant objects from product.variants JSON
 * @param {string} query The variant identifier, SKU, or barcode to resolve
 * @param {object} [context] Optional context for descriptive error messages (productId, productName)
 * @returns {object|null} The uniquely matched variant object, or null if no match found.
 * @throws {AmbiguousVariantError} If more than one variant matches the query.
 */
function resolveVariant(variants, query, context = {}) {
    if (!variants || !Array.isArray(variants) || variants.length === 0 || query === undefined || query === null) {
        return null;
    }

    const q = String(query).trim();
    if (!q) {
        return null;
    }

    // Step 1: exact id
    const byId = variants.filter(v => v.id !== undefined && v.id !== null && String(v.id).trim() === q);
    if (byId.length > 1) {
        throw new AmbiguousVariantError(
            `AMBIGUOUS_VARIANT: Multiple variants (${byId.length}) matched exact id "${q}" on product "${context.productName || context.productId || 'Unknown'}".`,
            { query: q, tier: 'id', candidateCount: byId.length, context }
        );
    }
    if (byId.length === 1) {
        return byId[0];
    }

    // Step 2: exact _id
    const byUnderscoreId = variants.filter(v => v._id !== undefined && v._id !== null && String(v._id).trim() === q);
    if (byUnderscoreId.length > 1) {
        throw new AmbiguousVariantError(
            `AMBIGUOUS_VARIANT: Multiple variants (${byUnderscoreId.length}) matched exact _id "${q}" on product "${context.productName || context.productId || 'Unknown'}".`,
            { query: q, tier: '_id', candidateCount: byUnderscoreId.length, context }
        );
    }
    if (byUnderscoreId.length === 1) {
        return byUnderscoreId[0];
    }

    // Step 3: exact sku
    const bySku = variants.filter(v => v.sku !== undefined && v.sku !== null && String(v.sku).trim() === q);
    if (bySku.length > 1) {
        throw new AmbiguousVariantError(
            `AMBIGUOUS_VARIANT: Multiple variants (${bySku.length}) matched exact sku "${q}" on product "${context.productName || context.productId || 'Unknown'}".`,
            { query: q, tier: 'sku', candidateCount: bySku.length, context }
        );
    }
    if (bySku.length === 1) {
        return bySku[0];
    }

    // Step 4: exact barcode
    const byBarcode = variants.filter(v => v.barcode !== undefined && v.barcode !== null && String(v.barcode).trim() === q);
    if (byBarcode.length > 1) {
        throw new AmbiguousVariantError(
            `AMBIGUOUS_VARIANT: Multiple variants (${byBarcode.length}) matched exact barcode "${q}" on product "${context.productName || context.productId || 'Unknown'}".`,
            { query: q, tier: 'barcode', candidateCount: byBarcode.length, context }
        );
    }
    if (byBarcode.length === 1) {
        return byBarcode[0];
    }

    // Step 5: no match
    return null;
}

/**
 * Returns canonical variant ID string from a matched variant object
 */
function getCanonicalVariantId(variant) {
    if (!variant) return null;
    return String(variant.id || variant._id || variant.sku || variant.barcode || '');
}

/**
 * Returns all candidate IDs for a variant for backwards-compatible matching
 */
function getVariantCandidateIds(variant, fallbackQuery = null) {
    const list = [];
    if (variant) {
        if (variant.id) list.push(String(variant.id));
        if (variant._id) list.push(String(variant._id));
        if (variant.sku) list.push(String(variant.sku));
        if (variant.barcode) list.push(String(variant.barcode));
    }
    if (fallbackQuery) {
        list.push(String(fallbackQuery));
    }
    return Array.from(new Set(list.filter(Boolean)));
}

module.exports = {
    resolveVariant,
    AmbiguousVariantError,
    getCanonicalVariantId,
    getVariantCandidateIds
};
