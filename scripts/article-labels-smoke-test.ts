import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { tenantScope, type TenantScope } from "../lib/tenant/scope.ts";
import { numeric } from "../lib/numeric.ts";
import { allocateStockArticles, listArticleLabels } from "../lib/inventory/article-labels.ts";
import { applyStockDelta, recordStockIn } from "../lib/inventory/stock-queries.ts";
import { catalogCodeConflict } from "../lib/inventory/catalog-codes.ts";
import { listProducts } from "../lib/inventory/product-queries.ts";
import { ARTICLE_NUMBER_START } from "../lib/inventory/article-numbers.ts";

interface Fixture { tenantId: string; userId: string; productId: string; variantIds: string[] }
const fixtures: Fixture[] = [];
const page = { page: 1, pageSize: 1000 };
const article = (ordinal: number) => ARTICLE_NUMBER_START + ordinal - 1;
function run<T>(fixture: Fixture, fn: (scope: TenantScope) => Promise<T>) {
  return withTenantRls(fixture.tenantId, () => fn(tenantScope(fixture.tenantId)));
}
async function receive(scope: TenantScope, fixture: Fixture, variantId: string, quantity: number) {
  assert.notEqual(await applyStockDelta(scope, { productId: fixture.productId, variantId }, quantity), null);
  return recordStockIn(scope, fixture.userId, { productId: fixture.productId, variantId, quantity, unitCost: "10", supplierId: null, receivedAt: null, note: "Article number integration fixture" });
}
try {
  const created = await withRlsBypass(async (tx) => {
    const shops: Fixture[] = [];
    for (const name of ["A", "B"]) {
      const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Article test ${name}`, email: `${randomUUID()}@example.com`, vatPercentage: numeric("0"), lowStockThreshold: 5 });
      const user = await tx.orm.public.User.select("id").create({ tenantId: tenant.id, name: "Article test owner", email: `${randomUUID()}@example.com`, passwordHash: "test-fixture-no-login", role: "shop_owner" });
      const product = await tx.orm.public.Product.select("id").create({ tenantId: tenant.id, name: "Kid's", sku: "SHOES", costPrice: numeric("10"), sellPrice: numeric("20"), stockQty: numeric("0") });
      const variantIds: string[] = [];
      for (const size of ["M", "L"]) {
        const variant = await tx.orm.public.ProductVariant.select("id").create({ tenantId: tenant.id, productId: product.id, sku: `SHOES-${size}`, label: `${size} / Red / 100g`, costPrice: numeric("10"), sellPrice: numeric("20"), stockQty: numeric("0") });
        variantIds.push(variant.id);
      }
      // A name containing "1" must not leak into an exact article search.
      await tx.orm.public.Product.create({ tenantId: tenant.id, name: `Decoy ${ARTICLE_NUMBER_START}`, sku: "DECOY", costPrice: numeric("1"), sellPrice: numeric("2"), stockQty: numeric("0") });
      shops.push({ tenantId: tenant.id, userId: user.id, productId: product.id, variantIds });
    }
    return shops;
  });
  fixtures.push(...created);
  const [a, b] = fixtures;
  assert.equal((await run(a, (scope) => listArticleLabels(scope, a.productId, page))).total, 0, "zero stock has no physical unit numbers");
  const firstReceipt = await run(a, (scope) => receive(scope, a, a.variantIds[0], 5));
  const first = await run(a, (scope) => listArticleLabels(scope, a.productId, page));
  assert.deepEqual(first.labels.map((label) => label.articleNumber), [1, 2, 3, 4, 5].map(article), "five numbers already exist when opening stock is saved");
  assert.ok(first.labels.every((label) => label.variantId === a.variantIds[0]), "every number resolves to the same M/Red/100g variant");
  assert.deepEqual(await run(a, (scope) => listArticleLabels(scope, a.productId, page)), first, "printing/reopening cannot create more numbers");
  await run(a, (scope) => allocateStockArticles(scope, a.variantIds[0], 5, firstReceipt.id));
  assert.equal((await run(a, (scope) => listArticleLabels(scope, a.productId, page))).total, 5, "a receipt allocation retry never duplicates numbers");
  await assert.rejects(run(a, (scope) => allocateStockArticles(scope, a.variantIds[1], 5, firstReceipt.id)), /different stock receipt/);
  await run(a, (scope) => receive(scope, a, a.variantIds[1], 3));
  await run(a, (scope) => receive(scope, a, a.variantIds[0], 2));
  const second = await run(a, (scope) => listArticleLabels(scope, a.productId, page));
  assert.deepEqual(second.labels.map((label) => label.articleNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(article));
  assert.deepEqual(second.labels.slice(0, 5), first.labels, "restocking preserves every existing number");
  await Promise.all(Array.from({ length: 2 }, () => run(a, (scope) => receive(scope, a, a.variantIds[0], 2))));
  assert.deepEqual((await run(a, (scope) => listArticleLabels(scope, a.productId, page))).labels.map((label) => label.articleNumber), Array.from({ length: 14 }, (_, i) => article(i + 1)), "concurrent receipts remain consecutive and unique");
  await assert.rejects(run(a, async (scope) => { await receive(scope, a, a.variantIds[0], 2); throw new Error("rollback fixture"); }), /rollback fixture/);
  assert.equal((await run(a, (scope) => listArticleLabels(scope, a.productId, page))).total, 14, "failed stock saves roll back article numbers too");
  await run(a, async (scope) => {
    await applyStockDelta(scope, { productId: a.productId, variantId: a.variantIds[0] }, -2);
    assert.equal((await listArticleLabels(scope, a.productId, { ...page, stockOnly: true })).total, 12, "default label quantities follow stock instead of including historical numbers");
    assert.equal((await listArticleLabels(scope, a.productId, page)).total, 14, "older numbers remain available for reprints");
    await applyStockDelta(scope, { productId: a.productId, variantId: a.variantIds[0] }, 2);
  });
  await run(b, (scope) => receive(scope, b, b.variantIds[0], 1));
  assert.equal((await run(b, (scope) => listArticleLabels(scope, b.productId, page))).labels[0].articleNumber, ARTICLE_NUMBER_START, "every shop starts at 2000");
  await assert.rejects(run(b, (scope) => listArticleLabels(scope, a.productId, page)), /Product not found/);
  await assert.rejects(run(a, (scope) => allocateStockArticles(scope, b.variantIds[0], 1, randomUUID())), /variant not found/);
  await run(a, async (scope) => {
    assert.match((await catalogCodeConflict(scope, a.productId, String(ARTICLE_NUMBER_START), []))!, /printed article/);
    const found = await listProducts(scope, { search: String(ARTICLE_NUMBER_START), categoryId: null, status: "active" }, { offset: 0, pageSize: 20 });
    assert.equal(found.total, 1, "exact article search yields one product, ignoring partial name matches");
    assert.equal(found.products[0]?.id, a.productId);
    const exact = await listArticleLabels(scope, a.productId, { ...page, articleNumber: article(6) });
    assert.equal(exact.labels[0].variantId, a.variantIds[1], "the scanned number selects the L variant");
    assert.equal((await listArticleLabels(scope, a.productId, { ...page, variantId: a.variantIds[1] })).total, 3);
    assert.equal(Number((await scope.ProductVariant.select("stockQty").where({ id: a.variantIds[0] }).first())?.stockQty), 11, "reading labels preserves stock");
  });
  // A stock receipt is independent of the 1,000-label print limit.
  await run(a, (scope) => receive(scope, a, a.variantIds[0], 1001));
  const large = await run(a, (scope) => listArticleLabels(scope, a.productId, page));
  assert.equal(large.total, 1015);
  assert.equal(large.labels.length, 1000);
  const tail = await run(a, (scope) => listArticleLabels(scope, a.productId, { ...page, page: 2 }));
  assert.equal(tail.labels.length, 15);
  assert.equal(tail.labels[0].articleNumber, article(1001));
  await run(a, async (scope) => {
    const unit = await scope.VariantUnit.select("id").create(scope.own({ name: "kg", measured: true }));
    await scope.Product.where({ id: a.productId }).update({ unitId: unit.id });
    const variant = await scope.ProductVariant.select("id").create(scope.own({ productId: a.productId, sku: "MEASURED", label: "Measured", costPrice: numeric("1"), sellPrice: numeric("2"), stockQty: numeric("0") }));
    await receive(scope, a, variant.id, 2.5);
    await receive(scope, a, variant.id, 1.25);
    assert.equal((await listArticleLabels(scope, a.productId, { ...page, variantId: variant.id })).total, 1, "measurement quantities are not mistaken for piece counts");
  });
  await run(a, async (scope) => {
    const other = await scope.Product.select("id").create(scope.own({ name: "Other shoes", sku: "OTHER", costPrice: numeric("1"), sellPrice: numeric("2"), stockQty: numeric("2") }));
    const variant = await scope.ProductVariant.select("id").create(scope.own({ productId: other.id, sku: "OTHER-M", label: "M", costPrice: numeric("1"), sellPrice: numeric("2"), stockQty: numeric("2") }));
    await allocateStockArticles(scope, variant.id, 2, randomUUID());
    const own = await listArticleLabels(scope, a.productId, page);
    const otherLabels = await listArticleLabels(scope, other.id, page);
    assert.equal(own.productId, a.productId);
    assert.equal(own.total, 1016, "another product's numbers cannot increase this product's label count");
    assert.ok(own.labels.every((label) => label.variantId !== variant.id));
    assert.equal(otherLabels.productId, other.id);
    assert.equal(otherLabels.total, 2);
    assert.ok(otherLabels.labels.every((label) => label.variantId === variant.id));
    assert.equal((await listArticleLabels(scope, a.productId, { ...page, variantId: variant.id })).total, 0, "a foreign product variant cannot be injected into the label filter");
    assert.equal((await listArticleLabels(scope, a.productId, { ...page, articleNumber: otherLabels.labels[0].articleNumber })).total, 0);
  });
  console.log("Article integration passed: stock-time allocation, per-unit variants, read-only reprints, concurrency, rollback, tenant isolation, exact search, large receipts and measured units.");
} finally {
  try {
    for (const fixture of fixtures) await withRlsBypass(async (tx) => {
      for (const statement of [
        rawSql`DELETE FROM public.article_labels WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.stock_movements WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.product_variants WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.products WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.variant_units WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.users WHERE tenant_id = ${fixture.tenantId}::uuid`,
        rawSql`DELETE FROM public.tenants WHERE id = ${fixture.tenantId}::uuid`,
      ]) await tx.execute(statement.affectedCount().build());
    });
  } finally { await db.close(); }
}
