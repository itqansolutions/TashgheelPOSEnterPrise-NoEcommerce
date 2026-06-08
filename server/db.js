/**
 * server/db.js — PostgreSQL Mongoose-Compatible Adapter
 *
 * Provides a drop-in replacement for `mongoose` across the entire codebase.
 * Documents are stored as JSONB in Postgres tables:
 *   CREATE TABLE <collection> (_id VARCHAR(100) PRIMARY KEY, data JSONB, created_at TIMESTAMPTZ)
 *
 * Supported Mongoose API:
 *   Model.find(query).sort().limit().select().populate()
 *   Model.findOne(query)
 *   Model.findById(id)
 *   Model.deleteOne(query)
 *   Model.deleteMany(query)
 *   Model.updateOne(filter, update)
 *   Model.updateMany(filter, update)
 *   Model.countDocuments(query)
 *   Model.create(data)
 *   Model.insertMany(docs)
 *   Model.findOneAndUpdate(filter, update, options)
 *   new Model(data) → doc.save(), doc.markModified()
 *
 * Query operators: $gte, $lte, $gt, $lt, $ne, $in, $nin, $exists, $regex
 * Chaining: .sort(), .limit(), .skip(), .select(), .populate() (no-op, data is flat)
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('crypto').webcrypto ? require('crypto') : { v4: () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36) };

// Polyfill uuid v4 without external dependency
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

let pool = null;

// ─────────────────────────────────────────────
// CONNECTION
// ─────────────────────────────────────────────

async function connect() {
    const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connStr) {
        throw new Error('PostgreSQL connection string not found. Set DATABASE_URL environment variable.');
    }

    pool = new Pool({
        connectionString: connStr,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await pool.connect();
    client.release();
    console.log('PostgreSQL Connected ✓');

    // Auto-create all tables
    await initSchema();
    console.log('PostgreSQL Schema Synchronized ✓');
}

// ─────────────────────────────────────────────
// SCHEMA INIT
// ─────────────────────────────────────────────

const COLLECTIONS = [
    'tenants', 'users', 'products', 'sales', 'salesmen', 'expenses',
    'categories', 'stockadjustments', 'shifts', 'auditlogs', 'suppliers',
    'purchases', 'ledgertransactions', 'stores', 'customers',
    'ecommerceconfigs', 'onlineorders'
];

async function initSchema() {
    const client = await pool.connect();
    try {
        for (const table of COLLECTIONS) {
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${table} (
                    _id VARCHAR(100) PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            // Index on tenantId for fast multi-tenant queries
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_${table}_tenant
                ON ${table} ((data->>'tenantId'))
            `);
        }
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────
// QUERY HELPERS
// ─────────────────────────────────────────────

/**
 * Convert MongoDB-style query object to PostgreSQL JSONB WHERE clause.
 * Returns { sql: string, params: array }
 * idxRef is a mutable { val: number } shared across nested calls.
 */
function buildWhere(query = {}, idxRef) {
    if (!idxRef) idxRef = { val: 1 };
    const conditions = [];
    const params = [];

    function processField(field, value) {
        if (value === null || value === undefined) {
            conditions.push(`(data->>'${field}') IS NULL`);
            return;
        }
        if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            for (const [op, opVal] of Object.entries(value)) {
                const pgVal = serializeValue(opVal);
                switch (op) {
                    case '$gte':
                        if (opVal instanceof Date || (typeof opVal === 'string' && opVal.match(/^\d{4}-\d{2}-\d{2}/))) {
                            conditions.push(`(data->>'${field}')::timestamptz >= $${idxRef.val++}::timestamptz`);
                            params.push(new Date(opVal).toISOString());
                        } else {
                            conditions.push(`(data->>'${field}')::numeric >= $${idxRef.val++}`);
                            params.push(pgVal);
                        }
                        break;
                    case '$lte':
                        if (opVal instanceof Date || (typeof opVal === 'string' && opVal.match(/^\d{4}-\d{2}-\d{2}/))) {
                            conditions.push(`(data->>'${field}')::timestamptz <= $${idxRef.val++}::timestamptz`);
                            params.push(new Date(opVal).toISOString());
                        } else {
                            conditions.push(`(data->>'${field}')::numeric <= $${idxRef.val++}`);
                            params.push(pgVal);
                        }
                        break;
                    case '$gt':
                        conditions.push(`(data->>'${field}')::numeric > $${idxRef.val++}`);
                        params.push(pgVal);
                        break;
                    case '$lt':
                        conditions.push(`(data->>'${field}')::numeric < $${idxRef.val++}`);
                        params.push(pgVal);
                        break;
                    case '$ne':
                        conditions.push(`(data->>'${field}') != $${idxRef.val++}`);
                        params.push(String(pgVal));
                        break;
                    case '$in':
                        if (Array.isArray(opVal) && opVal.length > 0) {
                            const placeholders = opVal.map(() => `$${idxRef.val++}`).join(', ');
                            conditions.push(`(data->>'${field}') IN (${placeholders})`);
                            opVal.forEach(v => params.push(String(v)));
                        } else {
                            conditions.push('1=0');
                        }
                        break;
                    case '$nin':
                        if (Array.isArray(opVal) && opVal.length > 0) {
                            const placeholders = opVal.map(() => `$${idxRef.val++}`).join(', ');
                            conditions.push(`(data->>'${field}') NOT IN (${placeholders})`);
                            opVal.forEach(v => params.push(String(v)));
                        }
                        break;
                    case '$exists':
                        conditions.push(opVal ? `data ? '${field}'` : `NOT (data ? '${field}')`);
                        break;
                    case '$regex': {
                        const flags = value.$options || '';
                        const pgOp = flags.includes('i') ? '~*' : '~';
                        conditions.push(`(data->>'${field}') ${pgOp} $${idxRef.val++}`);
                        params.push(opVal instanceof RegExp ? opVal.source : String(opVal));
                        break;
                    }
                    default:
                        break;
                }
            }
        } else {
            const pgVal = serializeValue(value);
            if (pgVal === null) {
                conditions.push(`(data->>'${field}') IS NULL`);
            } else {
                conditions.push(`data->>'${field}' = $${idxRef.val++}`);
                params.push(String(pgVal));
            }
        }
    }

    for (const [key, value] of Object.entries(query)) {
        if (key === '_id') {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                if (value.$in) {
                    const placeholders = value.$in.map(() => `$${idxRef.val++}`).join(', ');
                    conditions.push(`_id IN (${placeholders})`);
                    value.$in.forEach(v => params.push(String(v)));
                }
            } else {
                conditions.push(`_id = $${idxRef.val++}`);
                params.push(String(value));
            }
        } else if (key === '$or') {
            const orClauses = value.map(subQuery => {
                const sub = buildWhere(subQuery, idxRef);
                params.push(...sub.params);
                return `(${sub.sql || '1=1'})`;
            });
            if (orClauses.length) conditions.push(`(${orClauses.join(' OR ')})`);
        } else if (key === '$and') {
            value.forEach(subQuery => {
                const sub = buildWhere(subQuery, idxRef);
                params.push(...sub.params);
                if (sub.sql) conditions.push(sub.sql);
            });
        } else {
            processField(key, value);
        }
    }

    return {
        sql: conditions.length ? conditions.join(' AND ') : null,
        params
    };
}


function serializeValue(val) {
    if (val instanceof Date) return val.toISOString();
    if (val && typeof val === 'object' && val.toString && !Array.isArray(val)) {
        // ObjectId-like
        return val.toString();
    }
    return val;
}

/**
 * Deserialize a JSONB row from PostgreSQL back to a Mongoose-like document object.
 */
function rowToDoc(row, tableName, schema) {
    if (!row) return null;
    const doc = { ...row.data, _id: row._id };
    return makeDocument(doc, tableName, schema);
}

// ─────────────────────────────────────────────
// DOCUMENT INSTANCE
// ─────────────────────────────────────────────

/**
 * Creates a document instance that mirrors a Mongoose document.
 * Supports .save(), .toObject(), .toJSON(), ._id access.
 */
function makeDocument(data, tableName, schema) {
    const doc = { ...data };

    if (!doc._id) {
        doc._id = generateId();
    }

    // Set schema defaults for missing fields
    if (schema && schema.paths) {
        for (const [path, def] of Object.entries(schema.paths)) {
            if (doc[path] === undefined && def.default !== undefined) {
                doc[path] = typeof def.default === 'function' ? def.default() : def.default;
            }
        }
    }

    // toString support for _id (ObjectId compatibility)
    const docProxy = new Proxy(doc, {
        get(target, prop) {
            if (prop === '_id') return { toString: () => String(target._id), valueOf: () => String(target._id), toHexString: () => String(target._id) };
            if (prop === 'toObject') return () => ({ ...target });
            if (prop === 'toJSON') return () => ({ ...target });
            if (prop === 'markModified') return () => {}; // no-op
            if (prop === 'save') return async () => {
                const id = String(target._id);
                const toStore = { ...target };
                delete toStore._id;

                // Ensure dates are serialized
                for (const [k, v] of Object.entries(toStore)) {
                    if (v instanceof Date) toStore[k] = v.toISOString();
                }

                await pool.query(
                    `INSERT INTO ${tableName} (_id, data, created_at) VALUES ($1, $2::jsonb, NOW())
                     ON CONFLICT (_id) DO UPDATE SET data = $2::jsonb`,
                    [id, JSON.stringify(toStore)]
                );
                return docProxy;
            };
            if (prop === 'isNew') return !data._id;
            return target[prop];
        },
        set(target, prop, value) {
            if (prop === '_id') {
                target._id = String(value);
            } else {
                target[prop] = value;
            }
            return true;
        }
    });

    return docProxy;
}

// ─────────────────────────────────────────────
// QUERY CHAIN BUILDER
// ─────────────────────────────────────────────

class QueryChain {
    constructor(tableName, schema, query = {}) {
        this.tableName = tableName;
        this.schema = schema;
        this.query = query;
        this._sort = null;
        this._limit = null;
        this._skip = null;
        this._selectFields = null;
        this._populateFields = [];
        this._resolvedPromise = null;
    }

    sort(sortObj) {
        this._sort = sortObj;
        return this;
    }

    limit(n) {
        this._limit = parseInt(n) || null;
        return this;
    }

    skip(n) {
        this._skip = parseInt(n) || null;
        return this;
    }

    select(fields) {
        if (typeof fields === 'string') {
            this._selectFields = fields.split(' ').filter(f => f && !f.startsWith('-'));
            this._excludeFields = fields.split(' ').filter(f => f.startsWith('-')).map(f => f.slice(1));
        }
        return this;
    }

    populate(field) {
        // populate is a no-op in JSONB mode since data is already embedded / referenced by ID
        // For .populate('supplierId', 'name phone') — we skip this since IDs are strings
        this._populateFields.push(field);
        return this;
    }

    async _execute() {
        const { sql, params } = buildWhere(this.query);
        let q = `SELECT _id, data FROM ${this.tableName}`;
        if (sql) q += ` WHERE ${sql}`;

        // Sorting
        if (this._sort) {
            const parts = [];
            for (const [field, dir] of Object.entries(this._sort)) {
                if (field === '_id') {
                    parts.push(`_id ${dir === -1 || dir === '-1' ? 'DESC' : 'ASC'}`);
                } else {
                    parts.push(`data->>'${field}' ${dir === -1 || dir === '-1' ? 'DESC' : 'ASC'}`);
                }
            }
            if (parts.length) q += ` ORDER BY ${parts.join(', ')}`;
        } else {
            // Default sort by created_at DESC for consistency
            q += ` ORDER BY created_at DESC`;
        }

        if (this._limit) q += ` LIMIT ${this._limit}`;
        if (this._skip) q += ` OFFSET ${this._skip}`;

        const result = await pool.query(q, params);
        let docs = result.rows.map(row => rowToDoc(row, this.tableName, this.schema));

        // Apply select exclusions
        if (this._excludeFields && this._excludeFields.length) {
            docs = docs.map(doc => {
                const obj = doc.toObject ? doc.toObject() : { ...doc };
                this._excludeFields.forEach(f => delete obj[f]);
                return makeDocument(obj, this.tableName, this.schema);
            });
        }

        return docs;
    }

    then(resolve, reject) {
        return this._execute().then(resolve, reject);
    }

    catch(reject) {
        return this._execute().catch(reject);
    }
}

// ─────────────────────────────────────────────
// MODEL FACTORY
// ─────────────────────────────────────────────

function createModel(modelName, schema) {
    const tableName = modelName.toLowerCase() + 's';
    // Handle irregular plurals
    const tableMap = {
        'tenants': 'tenants',
        'users': 'users',
        'products': 'products',
        'sales': 'sales',
        'salesmen': 'salesmen',
        'expenses': 'expenses',
        'categorys': 'categories',
        'stockadjustments': 'stockadjustments',
        'shifts': 'shifts',
        'auditlogs': 'auditlogs',
        'suppliers': 'suppliers',
        'purchases': 'purchases',
        'ledgertransactions': 'ledgertransactions',
        'stores': 'stores',
        'customers': 'customers',
        'ecommerceconfigs': 'ecommerceconfigs',
        'onlineorders': 'onlineorders',
    };

    const table = tableMap[tableName] || tableName;

    const Model = {
        modelName,
        schema,

        // ---- Static methods ----

        find(query = {}) {
            return new QueryChain(table, schema, query);
        },

        async findOne(query = {}) {
            const chain = new QueryChain(table, schema, query);
            chain._limit = 1;
            const results = await chain._execute();
            return results[0] || null;
        },

        async findById(id) {
            if (!id) return null;
            return Model.findOne({ _id: String(id) });
        },

        async findByIdAndDelete(id) {
            if (!id) return null;
            const doc = await Model.findById(id);
            if (doc) await Model.deleteOne({ _id: String(id) });
            return doc;
        },

        async deleteOne(query = {}) {
            const { sql, params } = buildWhere(query);
            let q = `DELETE FROM ${table}`;
            if (sql) q += ` WHERE ${sql}`;
            await pool.query(q, params);
            return { deletedCount: 1 };
        },

        async deleteMany(query = {}) {
            const { sql, params } = buildWhere(query);
            let q = `DELETE FROM ${table}`;
            if (sql) q += ` WHERE ${sql}`;
            const result = await pool.query(q, params);
            return { deletedCount: result.rowCount };
        },

        async updateOne(filter = {}, update = {}) {
            const doc = await Model.findOne(filter);
            if (!doc) return { modifiedCount: 0 };

            const obj = doc.toObject ? doc.toObject() : { ...doc };
            const id = String(doc._id);

            if (update.$set) Object.assign(obj, update.$set);
            if (update.$inc) {
                for (const [k, v] of Object.entries(update.$inc)) {
                    obj[k] = (obj[k] || 0) + v;
                }
            }
            if (update.$push) {
                for (const [k, v] of Object.entries(update.$push)) {
                    if (!Array.isArray(obj[k])) obj[k] = [];
                    obj[k].push(v);
                }
            }
            // Plain update (no operators)
            if (!update.$set && !update.$inc && !update.$push) {
                Object.assign(obj, update);
            }

            delete obj._id;
            await pool.query(
                `UPDATE ${table} SET data = $1::jsonb WHERE _id = $2`,
                [JSON.stringify(obj), id]
            );
            return { modifiedCount: 1 };
        },

        async updateMany(filter = {}, update = {}) {
            const docs = await Model.find(filter);
            let count = 0;
            for (const doc of docs) {
                await Model.updateOne({ _id: String(doc._id) }, update);
                count++;
            }
            return { modifiedCount: count };
        },

        async countDocuments(query = {}) {
            const { sql, params } = buildWhere(query);
            let q = `SELECT COUNT(*) FROM ${table}`;
            if (sql) q += ` WHERE ${sql}`;
            const result = await pool.query(q, params);
            return parseInt(result.rows[0].count) || 0;
        },

        async create(data) {
            const id = generateId();
            const toStore = { ...data };
            delete toStore._id;
            for (const [k, v] of Object.entries(toStore)) {
                if (v instanceof Date) toStore[k] = v.toISOString();
            }
            await pool.query(
                `INSERT INTO ${table} (_id, data, created_at) VALUES ($1, $2::jsonb, NOW())`,
                [id, JSON.stringify(toStore)]
            );
            return makeDocument({ _id: id, ...data }, table, schema);
        },

        async insertMany(docs = []) {
            const results = [];
            for (const doc of docs) {
                const created = await Model.create(doc);
                results.push(created);
            }
            return results;
        },

        async findOneAndUpdate(filter = {}, update = {}, options = {}) {
            let doc = await Model.findOne(filter);
            if (!doc && options.upsert) {
                // Create new
                const newData = { ...filter };
                if (update.$set) Object.assign(newData, update.$set);
                if (update.$setOnInsert) Object.assign(newData, update.$setOnInsert);
                doc = await Model.create(newData);
            } else if (doc) {
                await Model.updateOne({ _id: String(doc._id) }, update);
                if (options.new) {
                    doc = await Model.findById(String(doc._id));
                }
            }
            return doc;
        },
    };

    // Constructor function (for `new Model(data)` usage)
    function ModelConstructor(data = {}) {
        return makeDocument({ ...data }, table, schema);
    }

    // Copy all static methods to the constructor
    Object.assign(ModelConstructor, Model);
    ModelConstructor.prototype = Model;

    return ModelConstructor;
}

// ─────────────────────────────────────────────
// MONGOOSE API SHIM
// ─────────────────────────────────────────────

/**
 * Schema class — lightweight shim for `new mongoose.Schema({...})`
 * We don't actually enforce schema types, just store the definition
 * and extract index hints.
 */
class Schema {
    constructor(definition = {}, options = {}) {
        this.definition = definition;
        this.options = options;
        this.paths = {};
        this._indexes = [];

        // Parse definition for defaults
        this._parseDefinition(definition, '');
    }

    _parseDefinition(def, prefix) {
        for (const [key, val] of Object.entries(def)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                if (val.default !== undefined || val.type !== undefined || val.enum !== undefined) {
                    this.paths[fullKey] = val;
                } else if (typeof val !== 'function') {
                    // Nested object, recurse
                    this._parseDefinition(val, fullKey);
                }
            } else if (Array.isArray(val)) {
                // Array type — skip for now
            }
        }
    }

    index(fields, options) {
        this._indexes.push({ fields, options });
        return this;
    }

    // Schema.Types shim
    static get Types() {
        return {
            ObjectId: 'ObjectId',
            Mixed: 'Mixed',
            String: String,
            Number: Number,
            Boolean: Boolean,
            Date: Date,
        };
    }
}

// Expose mongoose-compatible module
const db = {
    connect,
    Schema,
    model: createModel,

    // Types.ObjectId shim for isinstance checks  
    Types: {
        ObjectId: {
            isValid: (id) => typeof id === 'string' && id.length > 0,
        }
    },

    // Schema.Types alias
    SchemaTypes: Schema.Types,
};

module.exports = db;
