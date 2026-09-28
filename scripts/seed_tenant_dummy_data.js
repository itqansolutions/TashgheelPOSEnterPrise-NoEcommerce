/**
 * scripts/seed_tenant_dummy_data.js
 * 
 * Usage:
 *   node scripts/seed_tenant_dummy_data.js <TENANT_ID> [DATABASE_URL]
 */

require('dotenv').config();

const args = process.argv.slice(2);
const tenantId = args[0] || '6f9b7e0e-06f7-4a61-85f2-8db52cfac585';
const dbUrl = args[1] || process.env.DATABASE_URL;

if (dbUrl) {
    process.env.DATABASE_URL = dbUrl;
}

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    console.error('Usage: node scripts/seed_tenant_dummy_data.js ' + tenantId + '  postgresql://...');
    process.exit(1);
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('====================================================');
    console.log('   TASHGHEEL POS - DUMMY DATA SEEDER');
    console.log('   Target Tenant ID: ' + tenantId);
    console.log('====================================================\n');

    // 1. Verify Tenant
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
    });

    if (!tenant) {
        console.error('Tenant with ID  + tenantId +  was not found in the database.');
        process.exit(1);
    }

    console.log('Found Tenant: ' + (tenant.businessName || tenant.shopName || tenant.email));

    // 2. Resolve or Create Stores
    let stores = await prisma.store.findMany({
        where: { tenantId }
    });

    if (stores.length === 0) {
        console.log('Creating default store for tenant...');
        const mainStore = await prisma.store.create({
            data: {
                tenantId,
                name: 'الفرع الرئيسي (Main Store)',
                location: 'القاهرة - مصر',
                phone: '01000000001'
            }
        });
        stores = [mainStore];
    }

    const primaryStore = stores[0];
    console.log('Target Store: ' + primaryStore.name + ' (' + primaryStore.id + ')');

    // Clean up previous dummy data to ensure idempotency
    console.log('\nCleaning up previous dummy test data for tenant...');
    try {
        await prisma.inventoryMovement.deleteMany({ where: { tenantId, referenceType: 'SEED' } });
        await prisma.variantStock.deleteMany({ where: { tenantId } });
        await prisma.sale.deleteMany({ where: { tenantId, receiptId: { in: ['INV-1001', 'INV-1002', 'INV-1003', 'INV-1004', 'INV-1005'] } } });
        await prisma.purchase.deleteMany({ where: { tenantId, receiptId: { in: ['PO-2026-001', 'PO-2026-002'] } } });
        await prisma.product.deleteMany({ where: { tenantId, category: { in: ['ملابس وأزياء', 'إلكترونيات وإكسسوارات'] } } });
        await prisma.category.deleteMany({ where: { tenantId, name: { in: ['ملابس وأزياء', 'إلكترونيات وإكسسوارات'] } } });
        await prisma.supplier.deleteMany({ where: { tenantId, name: { in: ['شركة المتحدة للمنسوجات والملابس الجاهزة', 'مؤسسة تيك زون لاستيراد الإلكترونيات'] } } });
        await prisma.customer.deleteMany({ where: { tenantId, name: { in: ['عميل عام (نقدي)', 'محمد السيد (عميل VIP)', 'شركة حلول التقنية المستقبلية'] } } });
        console.log('✔ Cleanup complete.');
    } catch (e) {
        console.warn('Cleanup warning:', e.message);
    }

    // 3. Create Categories
    console.log('\n[1/6] Seeding Categories...');
    const catClothing = await prisma.category.create({
        data: {
            tenantId,
            name: 'ملابس وأزياء',
            nameEn: 'Clothing & Apparel'
        }
    });

    const catElectronics = await prisma.category.create({
        data: {
            tenantId,
            name: 'إلكترونيات وإكسسوارات',
            nameEn: 'Electronics & Accessories'
        }
    });
    console.log('✔ Created Categories: "' + catClothing.name + '", "' + catElectronics.name + '"');

    // 4. Create Suppliers
    console.log('\n[2/6] Seeding Suppliers...');
    const supTextile = await prisma.supplier.create({
        data: {
            tenantId,
            name: 'شركة المتحدة للمنسوجات والملابس الجاهزة',
            phone: '01011223344',
            address: 'المحلة الكبرى - المنطقة الصناعية',
            balance: 0
        }
    });

    const supTech = await prisma.supplier.create({
        data: {
            tenantId,
            name: 'مؤسسة تيك زون لاستيراد الإلكترونيات',
            phone: '01122334455',
            address: 'مول البستان للكمبيوتر - التحرير - القاهرة',
            balance: 0
        }
    });
    console.log('Created Suppliers:  + supTextile.name + ,  + supTech.name + ');

    // 5. Create Customers
    console.log('\n[3/6] Seeding Customers...');
    const custWalkin = await prisma.customer.create({
        data: {
            tenantId,
            name: 'عميل عام (نقدي)',
            phone: '01000000000',
            address: 'نقطة البيع المباشرة',
            loyaltyPoints: 0
        }
    });

    const custVip = await prisma.customer.create({
        data: {
            tenantId,
            name: 'محمد السيد (عميل VIP)',
            phone: '01234567890',
            email: 'mohamed.sayed@example.com',
            address: 'مدينة نصر - القاهرة',
            loyaltyPoints: 240
        }
    });

    const custCorp = await prisma.customer.create({
        data: {
            tenantId,
            name: 'شركة حلول التقنية المستقبلية',
            phone: '01099887766',
            email: 'purchasing@futuretech.com',
            address: 'القرية الذكية - 6 أكتوبر',
            loyaltyPoints: 500,
            balance: 1500.00
        }
    });
    console.log('Created Customers: Walk-in, VIP, Corporate');

    // 6. Create Salesman
    let salesmen = await prisma.salesman.findMany({ where: { tenantId } });
    let defaultSalesman = salesmen[0];
    if (!defaultSalesman) {
        defaultSalesman = await prisma.salesman.create({
            data: {
                tenantId,
                name: 'أحمد علي - كاشير ومسؤول مبيعات',
                jobTitle: 'Senior Cashier',
                phone: '01211122233'
            }
        });
    }

    // 7. Products & Variants Catalog
    console.log('\n[4/6] Seeding Products & Variants Catalog...');
    const productsData = [
        // ── Clothing & Apparel ──
        {
            name: 'قميص بولو قطني كلاسيك',
            nameEn: 'Classic Cotton Polo Shirt',
            category: 'ملابس وأزياء',
            categoryEn: 'Clothing & Apparel',
            supplier: supTextile.name,
            imageUrl: 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&auto=format&fit=crop&q=80',
            price: 350.00,
            cost: 180.00,
            hasVariants: true,
            variants: [
                { id: 'polo-blk-m', sku: 'POLO-BLK-M', barcode: '622100101', price: 350.00, cost: 180.00, stock: 25, attributes: { Color: 'Black (أسود)', Size: 'M' } },
                { id: 'polo-blk-l', sku: 'POLO-BLK-L', barcode: '622100102', price: 350.00, cost: 180.00, stock: 30, attributes: { Color: 'Black (أسود)', Size: 'L' } },
                { id: 'polo-blk-xl', sku: 'POLO-BLK-XL', barcode: '622100103', price: 370.00, cost: 190.00, stock: 15, attributes: { Color: 'Black (أسود)', Size: 'XL' } },
                { id: 'polo-wht-m', sku: 'POLO-WHT-M', barcode: '622100104', price: 350.00, cost: 180.00, stock: 20, attributes: { Color: 'White (أبيض)', Size: 'M' } },
                { id: 'polo-wht-l', sku: 'POLO-WHT-L', barcode: '622100105', price: 350.00, cost: 180.00, stock: 25, attributes: { Color: 'White (أبيض)', Size: 'L' } },
                { id: 'polo-nvy-l', sku: 'POLO-NVY-L', barcode: '622100106', price: 350.00, cost: 180.00, stock: 18, attributes: { Color: 'Navy (كحلي)', Size: 'L' } }
            ]
        },
        {
            name: 'بنطلون جينز سليم فيت أزرق',
            nameEn: 'Slim Fit Blue Denim Jeans',
            category: 'ملابس وأزياء',
            categoryEn: 'Clothing & Apparel',
            supplier: supTextile.name,
            imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&auto=format&fit=crop&q=80',
            price: 480.00,
            cost: 260.00,
            hasVariants: true,
            variants: [
                { id: 'jean-blu-32', sku: 'JEAN-BLU-32', barcode: '622100201', price: 480.00, cost: 260.00, stock: 20, attributes: { Size: '32' } },
                { id: 'jean-blu-34', sku: 'JEAN-BLU-34', barcode: '622100202', price: 480.00, cost: 260.00, stock: 25, attributes: { Size: '34' } },
                { id: 'jean-blu-36', sku: 'JEAN-BLU-36', barcode: '622100203', price: 480.00, cost: 260.00, stock: 15, attributes: { Size: '36' } }
            ]
        },
        {
            name: 'حذاء سنيكرز كاجوال جلد طبيعي',
            nameEn: 'Genuine Leather Casual Sneakers',
            category: 'ملابس وأزياء',
            categoryEn: 'Clothing & Apparel',
            supplier: supTextile.name,
            imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&auto=format&fit=crop&q=80',
            price: 750.00,
            cost: 420.00,
            hasVariants: true,
            variants: [
                { id: 'snk-wht-42', sku: 'SNK-WHT-42', barcode: '622100301', price: 750.00, cost: 420.00, stock: 10, attributes: { Color: 'White', Size: '42' } },
                { id: 'snk-wht-43', sku: 'SNK-WHT-43', barcode: '622100302', price: 750.00, cost: 420.00, stock: 12, attributes: { Color: 'White', Size: '43' } },
                { id: 'snk-blk-42', sku: 'SNK-BLK-42', barcode: '622100303', price: 750.00, cost: 420.00, stock: 8, attributes: { Color: 'Black', Size: '42' } },
                { id: 'snk-blk-43', sku: 'SNK-BLK-43', barcode: '622100304', price: 750.00, cost: 420.00, stock: 14, attributes: { Color: 'Black', Size: '43' } }
            ]
        },
        {
            name: 'تيشيرت بيزيك قطن 100%',
            nameEn: 'Basic Cotton Crewneck T-Shirt',
            category: 'ملابس وأزياء',
            categoryEn: 'Clothing & Apparel',
            supplier: supTextile.name,
            imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80',
            barcode: '622100401',
            price: 180.00,
            cost: 95.00,
            stock: 60,
            hasVariants: false
        },
        {
            name: 'بليزر كحلي كلاسيك فاخر',
            nameEn: 'Premium Classic Navy Blazer',
            category: 'ملابس وأزياء',
            categoryEn: 'Clothing & Apparel',
            supplier: supTextile.name,
            imageUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=600&auto=format&fit=crop&q=80',
            barcode: '622100501',
            price: 1250.00,
            cost: 700.00,
            stock: 10,
            hasVariants: false
        },

        // ── Electronics & Accessories ──
        {
            name: 'سماعات بلوتوث عازلة للضوضاء ANC',
            nameEn: 'Wireless Noise Cancelling Earbuds',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
            price: 650.00,
            cost: 380.00,
            hasVariants: true,
            variants: [
                { id: 'ear-blk', sku: 'EAR-BLK', barcode: '622200101', price: 650.00, cost: 380.00, stock: 20, attributes: { Color: 'Matte Black' } },
                { id: 'ear-wht', sku: 'EAR-WHT', barcode: '622200102', price: 650.00, cost: 380.00, stock: 25, attributes: { Color: 'Glossy White' } }
            ]
        },
        {
            name: 'شاحن جداري سريع 65W GaN',
            nameEn: 'Fast GaN Wall Charger 65W',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&auto=format&fit=crop&q=80',
            barcode: '622200201',
            price: 320.00,
            cost: 160.00,
            stock: 45,
            hasVariants: false
        },
        {
            name: 'كابل شحن سريع قماش USB-C إلى Type-C',
            nameEn: 'Braided Fast Charging Cable USB-C to USB-C',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1605464315542-bda3e2f4e605?w=600&auto=format&fit=crop&q=80',
            price: 95.00,
            cost: 40.00,
            hasVariants: true,
            variants: [
                { id: 'cbl-gry-1m', sku: 'CBL-GRY-1M', barcode: '622200301', price: 75.00, cost: 32.00, stock: 40, attributes: { Length: '1 Meter', Color: 'Gray' } },
                { id: 'cbl-gry-2m', sku: 'CBL-GRY-2M', barcode: '622200302', price: 95.00, cost: 40.00, stock: 50, attributes: { Length: '2 Meters', Color: 'Gray' } },
                { id: 'cbl-blk-2m', sku: 'CBL-BLK-2M', barcode: '622200303', price: 95.00, cost: 40.00, stock: 45, attributes: { Length: '2 Meters', Color: 'Black' } }
            ]
        },
        {
            name: 'باور بانك فائق السعة 20000mAh شحن سريع',
            nameEn: 'Ultra Slim Power Bank 20000mAh PD 22.5W',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1609592807664-885741e17f05?w=600&auto=format&fit=crop&q=80',
            barcode: '622200401',
            price: 580.00,
            cost: 320.00,
            stock: 22,
            hasVariants: false
        },
        {
            name: 'حامل سيارة شاحن لاسلكي مغناطيسي MagSafe',
            nameEn: 'Magnetic Car Mount Fast Wireless Charger',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=600&auto=format&fit=crop&q=80',
            barcode: '622200501',
            price: 290.00,
            cost: 145.00,
            stock: 26,
            hasVariants: false
        },
        {
            name: 'ساعة ذكية رياضية مقاومة للماء AMOLED',
            nameEn: 'Smart Fitness Sports Watch AMOLED',
            category: 'إلكترونيات وإكسسوارات',
            categoryEn: 'Electronics & Accessories',
            supplier: supTech.name,
            imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
            price: 890.00,
            cost: 510.00,
            hasVariants: true,
            variants: [
                { id: 'watch-blk', sku: 'WATCH-BLK', barcode: '622200601', price: 890.00, cost: 510.00, stock: 15, attributes: { Color: 'Midnight Black' } },
                { id: 'watch-slv', sku: 'WATCH-SLV', barcode: '622200602', price: 890.00, cost: 510.00, stock: 12, attributes: { Color: 'Silver Metallic' } }
            ]
        }
    ];

    for (const p of productsData) {
        let totalStock = p.stock || 0;
        if (p.hasVariants && Array.isArray(p.variants)) {
            totalStock = p.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
        }

        const storesArray = [{ storeId: primaryStore.id, stock: totalStock }];

        const productRecord = await prisma.product.create({
            data: {
                tenantId,
                name: p.name,
                nameEn: p.nameEn,
                barcode: p.barcode || (p.variants && p.variants[0] ? p.variants[0].barcode : null),
                category: p.category,
                categoryEn: p.categoryEn,
                supplier: p.supplier,
                imageUrl: p.imageUrl,
                price: p.price,
                cost: p.cost,
                stock: totalStock,
                minStock: 5,
                trackStock: true,
                active: true,
                hasVariants: p.hasVariants,
                variants: p.variants || [],
                stores: storesArray
            }
        });

        // Seed VariantStock and Initial Inventory Movements
        if (p.hasVariants && Array.isArray(p.variants)) {
            for (const v of p.variants) {
                await prisma.variantStock.create({
                    data: {
                        tenantId,
                        storeId: primaryStore.id,
                        productId: productRecord.id,
                        variantId: v.id,
                        quantity: v.stock || 0,
                        minStock: 3
                    }
                });

                await prisma.inventoryMovement.create({
                    data: {
                        tenantId,
                        storeId: primaryStore.id,
                        productId: productRecord.id,
                        variantId: v.id,
                        type: 'OPENING',
                        quantityDelta: v.stock || 0,
                        quantityBefore: 0,
                        quantityAfter: v.stock || 0,
                        referenceType: 'SEED',
                        referenceId: 'INITIAL_SEED',
                        notes: 'Initial Stock Balance - ' + v.sku
                    }
                });
            }
        } else {
            await prisma.variantStock.create({
                data: {
                    tenantId,
                    storeId: primaryStore.id,
                    productId: productRecord.id,
                    variantId: null,
                    quantity: totalStock,
                    minStock: 5
                }
            });

            await prisma.inventoryMovement.create({
                data: {
                    tenantId,
                    storeId: primaryStore.id,
                    productId: productRecord.id,
                    variantId: null,
                    type: 'OPENING',
                    quantityDelta: totalStock,
                    quantityBefore: 0,
                    quantityAfter: totalStock,
                    referenceType: 'SEED',
                    referenceId: 'INITIAL_SEED',
                    notes: 'Initial Stock Balance'
                }
            });
        }

        console.log('  ✔ Created: ' + productRecord.name + ' (Stock: ' + totalStock + ')');
    }

    // 8. Purchases
    console.log('\n[5/6] Seeding Purchase Invoices...');
    await prisma.purchase.create({
        data: {
            tenantId,
            storeId: primaryStore.id,
            supplierId: supTextile.id,
            receiptId: 'PO-2026-001',
            date: new Date(Date.now() - 5 * 24 * 3600 * 1000),
            total: 12500.00,
            cashPaid: 12500.00,
            cashier: 'admin',
            items: [
                { name: 'قميص بولو قطني كلاسيك', qty: 50, cost: 180.00, code: '622100101' },
                { name: 'بنطلون جينز سليم فيت أزرق', qty: 25, cost: 260.00, code: '622100201' }
            ]
        }
    });

    await prisma.purchase.create({
        data: {
            tenantId,
            storeId: primaryStore.id,
            supplierId: supTech.id,
            receiptId: 'PO-2026-002',
            date: new Date(Date.now() - 3 * 24 * 3600 * 1000),
            total: 18400.00,
            cashPaid: 15000.00,
            cashier: 'admin',
            items: [
                { name: 'سماعات بلوتوث عازلة للضوضاء ANC', qty: 25, cost: 380.00, code: '622200101' },
                { name: 'شاحن جداري سريع 65W GaN', qty: 30, cost: 160.00, code: '622200201' }
            ]
        }
    });
    console.log('Created Purchases: PO-2026-001 (12,500 EGP), PO-2026-002 (18,400 EGP)');

    // 9. Shifts & Sales
    console.log('\n[6/6] Seeding Shifts & POS Sales Invoices...');
    const shift = await prisma.shift.create({
        data: {
            tenantId,
            storeId: primaryStore.id,
            cashier: 'admin',
            startCash: 1000.00,
            startTime: new Date(Date.now() - 8 * 3600 * 1000),
            status: 'open',
            totalSales: 3840.00,
            cashSales: 1650.00,
            cardSales: 1300.00,
            mobileSales: 890.00
        }
    });

    const salesToCreate = [
        {
            receiptId: 'INV-1001',
            customerId: custWalkin.id,
            method: 'cash',
            total: 530.00,
            items: [
                { name: 'قميص بولو قطني كلاسيك (Black - L)', qty: 1, price: 350.00, cost: 180.00, code: '622100102' },
                { name: 'تيشيرت بيزيك قطن 100%', qty: 1, price: 180.00, cost: 95.00, code: '622100401' }
            ]
        },
        {
            receiptId: 'INV-1002',
            customerId: custVip.id,
            method: 'card',
            total: 1300.00,
            items: [
                { name: 'سماعات بلوتوث عازلة للضوضاء ANC', qty: 2, price: 650.00, cost: 380.00, code: '622200101' }
            ]
        },
        {
            receiptId: 'INV-1003',
            customerId: custWalkin.id,
            method: 'cash',
            total: 480.00,
            items: [
                { name: 'بنطلون جينز سليم فيت أزرق (Size 34)', qty: 1, price: 480.00, cost: 260.00, code: '622100202' }
            ]
        },
        {
            receiptId: 'INV-1004',
            customerId: custVip.id,
            method: 'mobile',
            total: 890.00,
            items: [
                { name: 'ساعة ذكية رياضية مقاومة للماء AMOLED', qty: 1, price: 890.00, cost: 510.00, code: '622200601' }
            ]
        },
        {
            receiptId: 'INV-1005',
            customerId: custCorp.id,
            method: 'split',
            total: 640.00,
            splitPayments: [
                { method: 'cash', amount: 300.00 },
                { method: 'card', amount: 340.00 }
            ],
            items: [
                { name: 'شاحن جداري سريع 65W GaN', qty: 2, price: 320.00, cost: 160.00, code: '622200201' }
            ]
        }
    ];

    for (const s of salesToCreate) {
        await prisma.sale.create({
            data: {
                tenantId,
                storeId: primaryStore.id,
                shiftId: shift.id,
                receiptId: s.receiptId,
                customerId: s.customerId,
                method: s.method,
                splitPayments: s.splitPayments || [],
                total: s.total,
                taxAmount: 0,
                cashier: 'admin',
                salesman: defaultSalesman.name,
                status: 'finished',
                items: s.items,
                date: new Date(Date.now() - Math.floor(Math.random() * 6 * 3600 * 1000))
            }
        });
        console.log('  Created Sale: ' + s.receiptId + ' (' + s.total + ' EGP, ' + s.method + ')');
    }

    console.log('\n====================================================');
    console.log('   DUMMY DATA SEED COMPLETED SUCCESSFULLY!');
    console.log('====================================================');
}

main()
    .catch((err) => {
        console.error('Seeder Error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
