# ระบบเก็บราคารายวัน (Price Collector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ดาวน์โหลดฟีดสินค้า Shopee Affiliate ทุกวัน เก็บราคาระดับ variant ของสินค้าที่มีแบรนด์ลง Postgres เป็นประวัติที่ห้ามขาดช่วง และแจ้งเตือนแม่หมอทันทีเมื่อเก็บไม่สำเร็จ ให้ใช้งานจริงได้ก่อน 11 พ.ย. 2026

**Architecture:** โปรแกรม Node.js/TypeScript ตัวเดียว (`npm run collect`) อ่านไฟล์ CSV จาก HTTP แบบสตรีมทีละแถว แปลงแถวเป็นข้อมูลสินค้า กรองเฉพาะสินค้ามีแบรนด์ แล้วใส่ตาราง staging เป็นชุด เมื่ออ่านครบทุกไฟล์จึงนำ staging ไปอัปเดตตารางหลักในทรานแซกชันเดียว (สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย) systemd timer บนเครื่อง Oracle Cloud Always Free สั่งรันวันละหลายรอบ รอบที่พบว่าวันนี้สำเร็จแล้วจะข้ามไป

**Tech Stack:** Node.js 22 LTS, TypeScript (strict), `csv-parse`, `pg`, Vitest, `@electric-sql/pglite` (Postgres ในหน่วยความจำ สำหรับเทสต์โดยไม่ต้องใช้ Docker), PostgreSQL 16, systemd, Ubuntu 24.04 ARM

**Spec:** `docs/superpowers/specs/2026-10-26-rakakoom-design.md` (ข้อ 4, 6.1, 8, 9)

## Global Constraints

- ห้ามดึงข้อมูลจากหน้าเว็บ Shopee (scraping) ใช้เฉพาะไฟล์ฟีดจากแดชบอร์ดแอฟฟิลิเอต
- ความลับทั้งหมด (ลิงก์ฟีด, LINE token, URL สำรองข้อมูล) อยู่ใน environment variables เท่านั้น **ห้าม commit** มีไฟล์ `.env.example` ที่มีแต่ชื่อตัวแปร
- เก็บเฉพาะสินค้าที่ `global_brand` ไม่ว่างและไม่ใช่ "NoBrand" (เทียบแบบไม่สนตัวพิมพ์และช่องว่าง เช่น "No Brand", "nobrand")
- ราคาเก็บเป็นจำนวนเต็มหน่วยสตางค์ (`360.0` → `36000`) ห้ามใช้ float ในฐานข้อมูล
- `feed_date` คือวันที่ตามเวลาไทย (`Asia/Bangkok`) รูปแบบ `YYYY-MM-DD`
- ห้ามลบประวัติราคา (`price_changes`) ไม่ว่ากรณีใด
- บันทึกราคาใหม่เฉพาะเมื่อราคาต่างจากราคาล่าสุดก่อนหน้า และบันทึก "วันนี้เก็บสำเร็จ" แยกใน `feed_runs` (เพื่อแยก "ราคาไม่เปลี่ยน" ออกจาก "วันนั้นไม่ได้เก็บ")
- ข้อความแจ้งเตือนเป็นภาษาไทย ขึ้นต้นด้วย `RakaKoom:`
- โฮสต์ต้องฟรี (Oracle Cloud Always Free: 2 OCPU / 12 GB RAM / ดิสก์รวม 200 GB)

## Review Focus

1. **แถวที่มีคำอธิบายหลายบรรทัด เครื่องหมายคำพูด ลูกน้ำ หรืออีโมจิ** ต้องอ่านได้ถูกคอลัมน์ ไม่เลื่อนไปปนคอลัมน์อื่น → Task 4 `openFeed parses quoted multiline fields`
2. **variant เดียวกันโผล่สองครั้งในรอบเดียว** (อยู่ทั้งสองไฟล์) ต้องไม่ทำให้รอบนั้นพัง และบันทึกราคาแค่แถวเดียว → Task 3 `applyRun dedupes repeated model_id`
3. **รันซ้ำในวันเดียวกันหลังรอบก่อนล้มกลางทาง** ต้องไม่มีข้อมูลซ้ำหรือค้างจาก staging เก่า → Task 5 `rerun after failure leaves no leftovers`
4. **ฟีดว่างหรือเล็กลงผิดปกติ** (Shopee มีปัญหา หรือไฟล์โหลดมาไม่ครบ) ต้องไม่ถูกนับว่าสำเร็จเงียบ ๆ → Task 5 `zero kept rows is failure` และ `drop below half of last success is suspect`
5. **เครื่องดับหรือ timer ไม่ทำงานเลย** โปรแกรมจะแจ้งเตือนเองไม่ได้ ต้องมีบริการภายนอกเฝ้า (heartbeat) → Task 6 `ping reports success and fail` + Task 7 ตั้ง healthchecks.io

---

## สิ่งที่ต้องทำก่อนเริ่ม (ไม่ใช่งานเขียนโค้ด)

- [ ] **P1 (แม่หมอ):** สมัคร Oracle Cloud ด้วยตัวเอง (ใช้บัตรยืนยันตัวตน) เลือก home region สิงคโปร์ (`ap-singapore-1`) — จำเป็นก่อน Task 7
- [ ] **P2 (ตรวจลิงก์ฟีด):** วันที่ 27 ต.ค. เปิดแดชบอร์ด → รายการ feed สินค้า → "Product Feed All Global Category" → ดูลิงก์ แล้วเทียบกับลิงก์ของวันที่ 26 ต.ค. ถ้า**เหมือนเดิม** ใส่ลิงก์ทั้งหมดใน `FEED_URLS` ได้ครั้งเดียว ถ้า**เปลี่ยนทุกวัน** ให้หยุดและถามแม่หมอ ห้ามทำระบบล็อกอินแดชบอร์ดอัตโนมัติ (spec ข้อ 9)
- [ ] **P3 (แม่หมอ):** หา LINE channel access token (LINE Developers → channel ของ OA → Messaging API) และ user ID ของแม่หมอ (หน้า Basic settings → "Your user ID") สำหรับแจ้งเตือน
- [ ] **P4 (แม่หมอ):** สมัคร healthchecks.io แบบฟรี สร้าง check รอบ 1 วัน ระยะผ่อนผัน 8 ชั่วโมง ตั้งให้ส่งอีเมลหรือ LINE ไปที่แม่หมอ

---

### Task 1: โครงโปรเจกต์ การอ่านค่าตั้งต้น และตัวช่วยเทสต์ฐานข้อมูล

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/config.ts`, `src/db/db.ts`, `src/db/pg.ts`, `src/time.ts`
- Test: `tests/config.test.ts`, `tests/time.test.ts`, `tests/helpers/testDb.ts`

**Interfaces:**
- Produces:
  - `interface Config { databaseUrl: string; feedUrls: string[]; lineChannelAccessToken: string | null; adminLineUserId: string | null; healthcheckUrl: string | null }`
  - `loadConfig(env: Record<string, string | undefined>): Config` — ต้องมี `DATABASE_URL`, `FEED_URLS` (คั่นด้วยจุลภาค ตัดช่องว่าง ตัดค่าว่าง) ถ้าขาด ให้ throw `Error` ที่บอกชื่อตัวแปรที่ขาดทั้งหมด ตัวอื่นไม่มีได้ (เป็น `null`)
  - `interface Db { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>; close(): Promise<void> }`
  - `createPgDb(databaseUrl: string): Db` ใน `src/db/pg.ts` (ใช้ `pg.Pool` ตั้ง type parser ของ int8 (OID 20) ให้คืนเป็น `number`)
  - `createTestDb(): Promise<Db>` ใน `tests/helpers/testDb.ts` (PGlite ในหน่วยความจำ — Task 3 จะเพิ่มการรัน migration; ใน Task 1 ยังไม่ต้องมี)
  - `bangkokDate(now: Date): string` ใน `src/time.ts` → `YYYY-MM-DD` ตามเวลาไทย

- [ ] **Step 1:** `git init` สร้าง `.gitignore` (`node_modules/`, `dist/`, `.env`, `*.dump`) และ `.env.example` ที่มีบรรทัด `DATABASE_URL=`, `FEED_URLS=`, `LINE_CHANNEL_ACCESS_TOKEN=`, `ADMIN_LINE_USER_ID=`, `HEALTHCHECK_URL=`, `BACKUP_PAR_URL=`
- [ ] **Step 2:** `npm init -y` แล้วติดตั้ง `csv-parse pg` และ dev deps `typescript tsx vitest @electric-sql/pglite @types/node @types/pg csv-stringify` ตั้ง scripts: `"test": "vitest run"`, `"collect": "tsx src/collect/cli.ts"`, `"migrate": "tsx src/db/migrateCli.ts"`, `"typecheck": "tsc --noEmit"` และ `"engines": { "node": ">=22" }`
- [ ] **Step 3: เขียนเทสต์ที่ต้องล้ม**

```ts
// tests/config.test.ts
test('loadConfig splits FEED_URLS and nulls optional vars', () => {
  const c = loadConfig({ DATABASE_URL: 'postgres://x', FEED_URLS: ' https://a/1 , https://a/2 ,' });
  expect(c.feedUrls).toEqual(['https://a/1', 'https://a/2']);
  expect(c.lineChannelAccessToken).toBeNull();
});
test('loadConfig names every missing var', () => {
  expect(() => loadConfig({})).toThrow(/DATABASE_URL.*FEED_URLS/);
});
// tests/time.test.ts
test('bangkokDate rolls over at 17:00 UTC', () => {
  expect(bangkokDate(new Date('2026-10-26T16:59:00Z'))).toBe('2026-10-26');
  expect(bangkokDate(new Date('2026-10-26T17:00:00Z'))).toBe('2026-10-27');
});
```

- [ ] **Step 4:** รัน `npm test` → คาดว่า FAIL (ยังไม่มีฟังก์ชัน)
- [ ] **Step 5:** เขียน `loadConfig`, `bangkokDate` (ใช้ `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`), `Db`, `createPgDb`, `createTestDb`
- [ ] **Step 6:** รัน `npm test && npm run typecheck` → คาดว่า PASS
- [ ] **Step 7:** Commit `chore: scaffold collector project`

---

### Task 2: แปลงแถวฟีดเป็นข้อมูลสินค้า

**Files:**
- Create: `src/feed/columns.ts`, `src/feed/parseRow.ts`
- Test: `tests/feed/parseRow.test.ts`, `tests/helpers/feedRecord.ts`

**Interfaces:**
- Produces:
  - `FEED_COLUMNS: readonly string[]` — 47 ชื่อคอลัมน์**ตามลำดับนี้ทุกตัวอักษร** (ตรวจจากไฟล์จริง 26 ต.ค.):
    `image_link_4, cb_option, global_category1, stock, item_sold, is_preferred_shop, title, shopid, model_prices, global_category2, sale_price, like, shopee_verified_flag, global_catid2, is_item_welcome_package, is_official_shop, global_catid3, description, seller_penalty_score, global_catid1, image_link_3, additional_image_link, image_link_9, image_link_7, global_category3, global_item_attributes, condition, discount_percentage, model_names, image_link_6, holiday_mode_on, itemid, model_ids, has_lowest_price_guarantee, shop_sku_count, image_link_10, shop_rating, item_rating, seller_name, price, image_link_8, image_link, shop_name, global_brand, image_link_5, product_link, product_short link`
    (ชื่อสุดท้ายมีช่องว่างจริง: `product_short link`)
  - `type FeedRecord = Record<string, string>`
  - `interface ParsedShop { shopId: number; shopName: string; sellerName: string; shopRating: number | null; penaltyScore: number | null; isOfficial: boolean; isPreferred: boolean; holidayMode: boolean }`
  - `interface ParsedVariant { modelId: number; name: string; priceSatang: number }`
  - `interface ParsedItem { itemId: number; shopId: number; title: string; brand: string; categories: [string, string, string]; categoryIds: [number | null, number | null, number | null]; attributes: unknown; productLink: string; affiliateLink: string; imageLink: string; itemRating: number | null; itemSold: number; stock: number; crossBorder: boolean; condition: string; priceSatang: number; salePriceSatang: number; discountPercentage: number; variants: ParsedVariant[]; shop: ParsedShop }`
  - `type SkipReason = 'no_brand' | 'bad_ids' | 'variant_mismatch' | 'bad_price'`
  - `parseFeedRow(r: FeedRecord): { ok: true; item: ParsedItem } | { ok: false; reason: SkipReason }`
  - `toSatang(s: string): number | null` — `"360.0"`→`36000`, `"15"`→`1500`, `"19.99"`→`1999`, ว่างหรือไม่ใช่ตัวเลข → `null` (แปลงจากข้อความ ไม่คูณ float)
  - `makeFeedRecord(overrides?: Partial<FeedRecord>): FeedRecord` ใน `tests/helpers/feedRecord.ts` — ค่าเริ่มต้นเป็นสินค้า INGCO 1 variant (`itemid` `53001999315`, `shopid` `101487342`, `model_ids` `445195501093`, `model_prices` `360.0`, `global_brand` `Ingco(อิงโก้)`, `is_official_shop` `Non-Official shop`, `is_preferred_shop` `Preferred shop`, `holiday_mode_on` `Off`, `cb_option` `Non-Cross border`, `shop_rating` `4.93`, `seller_penalty_score` `0`) คอลัมน์อื่นเป็นค่าว่าง

ค่าข้อความที่แปลงเป็น boolean (ตรงตัว): `is_official_shop === 'Official shop'`, `is_preferred_shop === 'Preferred shop'`, `holiday_mode_on === 'On'`, `cb_option === 'Cross border'`
variant: แยก `model_ids` / `model_names` / `model_prices` ด้วย `|` ตัดช่องว่าง ทิ้งช่องว่างท้ายสุด ถ้าจำนวนไม่เท่ากัน → `variant_mismatch`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

```ts
test('parses single-variant branded item', () => {
  const r = parseFeedRow(makeFeedRecord());
  expect(r.ok && r.item.variants).toEqual([{ modelId: 445195501093, name: expect.any(String), priceSatang: 36000 }]);
  expect(r.ok && r.item.shop).toMatchObject({ isOfficial: false, isPreferred: true, holidayMode: false, penaltyScore: 0, shopRating: 4.93 });
});
test.each(['NoBrand', 'No Brand', ' nobrand ', ''])('skips brand %j', b => {
  expect(parseFeedRow(makeFeedRecord({ global_brand: b }))).toEqual({ ok: false, reason: 'no_brand' });
});
test('splits variants and ignores trailing pipe', () => {
  const r = parseFeedRow(makeFeedRecord({ model_ids: '1|2|', model_names: '3W,แสงขาว|5W,แสงส้ม|', model_prices: '15.0|17.0|' }));
  expect(r.ok && r.item.variants.map(v => [v.modelId, v.name, v.priceSatang])).toEqual([[1, '3W,แสงขาว', 1500], [2, '5W,แสงส้ม', 1700]]);
});
test('variant count mismatch is skipped', () => {
  expect(parseFeedRow(makeFeedRecord({ model_ids: '1|2', model_names: 'a|b', model_prices: '15.0' }))).toEqual({ ok: false, reason: 'variant_mismatch' });
});
test('non-numeric itemid is bad_ids', () => {
  expect(parseFeedRow(makeFeedRecord({ itemid: '' }))).toEqual({ ok: false, reason: 'bad_ids' });
});
test('toSatang avoids float error', () => { expect(toSatang('19.99')).toBe(1999); expect(toSatang('abc')).toBeNull(); });
```

- [ ] **Step 2:** รัน `npx vitest run tests/feed/parseRow.test.ts` → FAIL
- [ ] **Step 3:** เขียน `FEED_COLUMNS`, `toSatang`, `parseFeedRow`, `makeFeedRecord` (`global_item_attributes` ใช้ `JSON.parse` ถ้าพังให้เป็น `null` ไม่ใช่เหตุให้ข้ามสินค้า; ราคา variant ที่แปลงไม่ได้ → `bad_price`)
- [ ] **Step 4:** รันเทสต์ → PASS
- [ ] **Step 5:** Commit `feat: parse shopee feed rows`

---

### Task 3: โครงสร้างฐานข้อมูลและการนำข้อมูลรอบนั้นเข้าตารางหลัก

**Files:**
- Create: `migrations/001_collector.sql`, `src/db/migrate.ts`, `src/db/migrateCli.ts`, `src/db/store.ts`
- Modify: `tests/helpers/testDb.ts` (เรียก `migrate`)
- Test: `tests/db/store.test.ts`

**Interfaces:**
- Consumes: `Db`, `ParsedItem` (Task 1–2)
- Produces:
  - `migrate(db: Db): Promise<void>` — รันไฟล์ใน `migrations/` ตามลำดับชื่อ จดไว้ในตาราง `schema_migrations(name text primary key)` รันซ้ำได้
  - `stageItems(db: Db, runId: number, items: ParsedItem[]): Promise<void>`
  - `applyRun(db: Db, runId: number, feedDate: string): Promise<ApplyStats>` — ต้องถูกเรียกภายใน `db.transaction` โดยผู้เรียก
  - `clearStaging(db: Db, runId: number): Promise<void>`
  - `interface ApplyStats { items: number; variants: number; priceChanges: number }`

ตาราง (ชื่อและคอลัมน์หลักที่ส่วนบอทในอนาคตจะใช้ — ชนิดเพิ่มเติมและ index ให้คนสร้างเลือก):
- `feed_runs(id serial pk, feed_date date, status text check in ('running','success','suspect','failed'), started_at timestamptz, finished_at timestamptz, rows_read bigint, rows_kept bigint, skipped jsonb, error text)` — unique index บางส่วน: `(feed_date) where status in ('success','suspect')`
- `shops(shop_id bigint pk, shop_name, seller_name, shop_rating numeric(3,2), penalty_score int, is_official bool, is_preferred bool, holiday_mode bool, updated_on date)`
- `items(item_id bigint pk, shop_id bigint, title, brand, category1..3, category_id1..3, attributes jsonb, product_link, affiliate_link, image_link, item_rating numeric(3,2), item_sold int, stock int, cross_border bool, condition text, price_satang bigint, sale_price_satang bigint, discount_percentage int, first_seen date, last_seen date)`
- `variants(model_id bigint pk, item_id bigint, name text, price_satang bigint, first_seen date, last_seen date)`
- `price_changes(model_id bigint, effective_date date, price_satang bigint, primary key (model_id, effective_date))`
- `staging_items`, `staging_variants` (unlogged, มีคอลัมน์ `run_id`) — รูปแบบภายในให้คนสร้างเลือก (เช่น เก็บ item เป็น `jsonb`)

ตรรกะ `applyRun` (ทำเป็น SQL ทีละชุดใหญ่ ไม่วนทีละแถวใน Node): ตัดแถวซ้ำใน staging (model_id/item_id/shop_id เดียวกัน ใช้แถวสุดท้าย) → upsert `shops`, `items`, `variants` (`last_seen = feedDate`, `first_seen` ไม่ทับค่าเดิม) → ลงตาราง `price_changes` เฉพาะ variant ที่ไม่มีประวัติ หรือราคาล่าสุด*ก่อน* `feedDate` ต่างจากราคาวันนี้ ถ้ามีแถวของ `feedDate` อยู่แล้ว (รันซ้ำวันเดียวกัน) ให้แทนค่า → `clearStaging`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม** (ใช้ `createTestDb()` และ `parseFeedRow(makeFeedRecord(...))` สร้าง item)

```ts
test('first sighting writes one price_changes row', async () => { /* stage+apply วันที่ 2026-10-27 → price_changes = [{model_id:445195501093, effective_date:'2026-10-27', price_satang:36000}] */ });
test('unchanged price next day writes nothing new but bumps last_seen', async () => { /* 27 แล้ว 28 ราคาเดิม → price_changes 1 แถว, variants.last_seen = '2026-10-28' */ });
test('changed price writes a new row', async () => { /* 27=360.0, 28=329.0 → 2 แถว */ });
test('same-day rerun replaces that day instead of duplicating', async () => { /* 27=360.0 แล้วรัน 27 อีกรอบ=350.0 → แถววันที่ 27 เดียว ราคา 35000 */ });
test('applyRun dedupes repeated model_id', async () => { /* stage item เดียวกันสองครั้งใน run เดียว → ไม่ error, price_changes 1 แถว */ });
test('applyRun clears staging for the run', async () => { /* หลัง apply → staging ของ runId ว่าง */ });
test('migrate is idempotent', async () => { /* migrate สองครั้งไม่ error */ });
```
(แต่ละเทสต์ต้อง assert ค่าจากตารางจริงตามที่เขียนในคอมเมนต์)

- [ ] **Step 2:** รัน `npx vitest run tests/db/store.test.ts` → FAIL
- [ ] **Step 3:** เขียน migration, `migrate`, `stageItems` (insert หลายแถวต่อคำสั่ง แบ่งชุดไม่ให้พารามิเตอร์เกิน 60,000 ตัว), `applyRun`, `clearStaging`
- [ ] **Step 4:** รันเทสต์ → PASS
- [ ] **Step 5:** Commit `feat: collector schema and run apply`

---

### Task 4: อ่านไฟล์ฟีดจาก HTTP แบบสตรีม

**Files:**
- Create: `src/feed/openFeed.ts`
- Test: `tests/feed/openFeed.test.ts`

**Interfaces:**
- Consumes: `FeedRecord`, `FEED_COLUMNS` (Task 2)
- Produces: `openFeed(url: string, fetchFn?: typeof fetch): AsyncIterable<FeedRecord>` — ตาม redirect, ถ้า HTTP ไม่ใช่ 2xx ให้ throw `Error` ที่มีเลขสถานะ (ห้ามใส่ URL ลงข้อความ error เพราะเป็นความลับ), ใช้ `csv-parse` ตัวเลือก `{ columns: true, bom: true, relax_quotes: true, relax_column_count: true }`, ถ้าหัวคอลัมน์ไม่มี `itemid`/`model_ids`/`model_prices`/`global_brand` ให้ throw `Error('feed header changed: missing <ชื่อ>')`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม** — เปิด `http.createServer` บนพอร์ตสุ่มในเทสต์ เสิร์ฟ CSV ที่สร้างด้วย `csv-stringify` จาก `FEED_COLUMNS` + `makeFeedRecord` ขึ้นต้นด้วย BOM และมี route `/redirect` ที่ตอบ 302 ไปยังไฟล์จริง

```ts
test('openFeed parses quoted multiline fields', async () => {
  // description = 'บรรทัด 1\nบรรทัด "2", มีลูกน้ำ 💡'
  // ต้องได้ 2 records, records[0].description ตรงตามนั้น, records[0].itemid === '53001999315'
});
test('openFeed strips BOM so first column name is exact', async () => { /* Object.keys(rec)[0] === 'image_link_4' */ });
test('openFeed follows redirect', async () => { /* /redirect → ได้ records */ });
test('openFeed throws on 404 without leaking url', async () => { /* error.message มี '404' และไม่มี '/feed' */ });
test('openFeed throws when header changed', async () => { /* CSV ที่ไม่มีคอลัมน์ model_prices → /feed header changed: missing model_prices/ */ });
```

- [ ] **Step 2:** รัน `npx vitest run tests/feed/openFeed.test.ts` → FAIL
- [ ] **Step 3:** เขียน `openFeed` (ส่ง `Readable.fromWeb(res.body)` เข้า parser แบบ pipe ไม่อ่านทั้งไฟล์เข้าหน่วยความจำ)
- [ ] **Step 4:** รันเทสต์ → PASS
- [ ] **Step 5:** Commit `feat: stream feed csv over http`

---

### Task 5: ตัวคุมรอบการเก็บรายวัน

**Files:**
- Create: `src/collect/runDaily.ts`, `src/collect/cli.ts`
- Test: `tests/collect/runDaily.test.ts`

**Interfaces:**
- Consumes: `Db`, `migrate`, `stageItems`, `applyRun`, `clearStaging`, `parseFeedRow`, `openFeed`, `bangkokDate`, `loadConfig`
- Produces:
  - `interface RunDeps { db: Db; feedUrls: string[]; openFeed: (url: string) => AsyncIterable<FeedRecord>; alert: (msg: string) => Promise<void>; ping: (status: 'success' | 'fail') => Promise<void>; now: () => Date; batchSize?: number /* ค่าเริ่ม 1000 */ }`
  - `interface RunResult { status: 'success' | 'suspect' | 'failed' | 'skipped'; feedDate: string; rowsRead: number; rowsKept: number; skipped: Partial<Record<SkipReason, number>>; error?: string }`
  - `runDaily(deps: RunDeps): Promise<RunResult>`

พฤติกรรม:
1. `feedDate = bangkokDate(now())` ถ้ามีรอบ `success`/`suspect` ของวันนี้แล้ว → คืน `skipped` (ไม่ ping ไม่ alert)
2. สร้างแถว `feed_runs` สถานะ `running` → อ่านทุก URL ตามลำดับ → `parseFeedRow` → สะสมทีละ `batchSize` แล้ว `stageItems` → นับ `rowsRead`, `rowsKept`, `skipped` ตามเหตุผล
3. อ่านครบทุกไฟล์แล้วจึง `db.transaction(tx => applyRun(tx, runId, feedDate))`
4. `rowsKept === 0` → ถือว่า**ล้มเหลว** (ห้าม apply)
5. ถ้า `rowsKept < 0.5 × rows_kept ของรอบสำเร็จล่าสุด` → สถานะ `suspect` (apply แล้ว) + alert: `RakaKoom: เก็บราคาวันที่ {feedDate} ได้ข้อมูลน้อยผิดปกติ ({rowsKept} รายการ เทียบกับ {prevKept} เมื่อ {prevDate})`
6. สำเร็จ/suspect → อัปเดต `feed_runs` + `ping('success')`
7. error ใด ๆ → `clearStaging`, `feed_runs.status='failed'`, `error` = ข้อความ error, `alert('RakaKoom: เก็บราคาวันที่ {feedDate} ล้มเหลว — {ข้อความ error}')`, `ping('fail')`, คืน `failed` (ไม่ throw)
8. `cli.ts`: `loadConfig(process.env)` → `createPgDb` → `migrate` → `runDaily` → พิมพ์ผลเป็น JSON บรรทัดเดียว → `process.exit(status === 'failed' ? 1 : 0)`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม** (ใช้ `createTestDb`, `openFeed` ปลอมที่คืน records จาก `makeFeedRecord`, `alert`/`ping` เป็น `vi.fn()`, `now` คงที่ `2026-10-27T03:30:00Z`)

```ts
test('success run records feed_runs and pings success', async () => { /* status 'success', feed_runs มี 1 แถว success, ping called with 'success', alert not called */ });
test('second run same day is skipped', async () => { /* status 'skipped', openFeed ไม่ถูกเรียก */ });
test('counts skip reasons', async () => { /* 1 NoBrand + 1 ปกติ → rowsRead 2, rowsKept 1, skipped {no_brand:1} */ });
test('zero kept rows is failure', async () => { /* records ทั้งหมด NoBrand → 'failed', alert มี 'ล้มเหลว', ไม่มี price_changes */ });
test('drop below half of last success is suspect', async () => { /* วันที่ 26 สำเร็จ 4 รายการ, วันที่ 27 ได้ 1 → 'suspect', alert มี 'น้อยผิดปกติ' */ });
test('stream error mid-file fails without partial apply', async () => { /* openFeed ของไฟล์ที่ 2 throw หลังส่ง 1 แถว → 'failed', items ว่าง, staging ว่าง */ });
test('rerun after failure leaves no leftovers', async () => { /* รอบแรกล้ม รอบสองสำเร็จ → price_changes ไม่ซ้ำ, staging ว่าง, feed_runs = [failed, success] */ });
```

- [ ] **Step 2:** รัน `npx vitest run tests/collect/runDaily.test.ts` → FAIL
- [ ] **Step 3:** เขียน `runDaily` และ `cli.ts`
- [ ] **Step 4:** รัน `npm test && npm run typecheck` → PASS ทั้งหมด
- [ ] **Step 5:** Commit `feat: daily collector run with failure handling`

---

### Task 6: แจ้งเตือน LINE และ heartbeat

**Files:**
- Create: `src/notify/line.ts`, `src/notify/ping.ts`
- Modify: `src/collect/cli.ts` (ใช้ของจริงแทนตัวว่าง)
- Test: `tests/notify/notify.test.ts`

**Interfaces:**
- Produces:
  - `createLineAlert(token: string | null, userId: string | null, fetchFn?: typeof fetch): (msg: string) => Promise<void>` — POST `https://api.line.me/v2/bot/message/push` header `Authorization: Bearer {token}` body `{ to: userId, messages: [{ type: 'text', text: msg }] }` ตัดข้อความไม่เกิน 4,900 ตัวอักษร ถ้า token หรือ userId เป็น null → `console.warn` แล้วจบ ส่งไม่สำเร็จ → `console.error` **ไม่ throw** (การแจ้งเตือนพังต้องไม่ทำให้สถานะรอบเปลี่ยน)
  - `createPing(url: string | null, fetchFn?: typeof fetch): (status: 'success' | 'fail') => Promise<void>` — success: GET `{url}`, fail: GET `{url}/fail` (รูปแบบ healthchecks.io) null → ไม่ทำอะไร error → `console.error` ไม่ throw

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

```ts
test('line alert posts push message', async () => { /* fetch mock ได้ url push, header Bearer tok, body.to 'U1', body.messages[0].text 'RakaKoom: x' */ });
test('line alert without token does not call fetch', async () => {});
test('line alert swallows http error', async () => { /* fetch คืน 500 → resolve ไม่ throw */ });
test('ping reports success and fail', async () => { /* success → 'https://hc/abc', fail → 'https://hc/abc/fail' */ });
```

- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียนทั้งสองฟังก์ชัน แล้วต่อเข้า `cli.ts`
- [ ] **Step 4:** รัน `npm test` → PASS
- [ ] **Step 5:** Commit `feat: line alerts and heartbeat ping`

---

### Task 7: ติดตั้งบน Oracle Cloud, ตั้งเวลา และสำรองข้อมูล

**Files:**
- Create: `deploy/README.md` (ขั้นตอนทีละข้อเป็นภาษาไทย), `deploy/setup.sh`, `deploy/rakakoom-collect.service`, `deploy/rakakoom-collect.timer`, `deploy/backup.sh`, `deploy/rakakoom-backup.service`, `deploy/rakakoom-backup.timer`, `deploy/postgresql-tuning.conf`

**Interfaces:**
- Consumes: `npm run collect`, `npm run migrate`

ค่าที่กำหนด:
- เครื่อง: `VM.Standard.A1.Flex` 2 OCPU / 12 GB, Ubuntu 24.04 ARM, boot volume 150 GB (เหลือโควตาไว้ 50 GB)
- Postgres 16, `shared_buffers = 3GB`, `effective_cache_size = 6GB`, `work_mem = 64MB`, `maintenance_work_mem = 512MB` — ทำให้ใช้หน่วยความจำเกิน 20% ตลอด ไม่เข้าเกณฑ์ "เครื่องว่าง" ของ Oracle (spec ข้อ 8)
- environment อยู่ที่ `/etc/rakakoom.env` สิทธิ์ `600` เจ้าของ `rakakoom`
- เวลาเก็บ: `OnCalendar=*-*-* 03:30,05:30,07:30,09:30 UTC` (= 10:30, 12:30, 14:30, 16:30 เวลาไทย หลังฟีดอัปเดตราว 09:20) `Persistent=true` รอบที่สำเร็จแล้วจะข้าม (Task 5)
- สำรองข้อมูล: `OnCalendar=*-*-* 12:00 UTC`, `pg_dump -Fc` แล้ว `curl -T` ขึ้น OCI Object Storage ผ่าน pre-authenticated request (`BACKUP_PAR_URL`) ชื่อไฟล์ `rakakoom-YYYY-MM-DD.dump` ตั้ง lifecycle rule ใน bucket ให้ลบไฟล์อายุเกิน 14 วัน — **ก่อนตั้งค่า ให้ตรวจในหน้า Always Free ว่า Object Storage ยังฟรีและได้กี่ GB** ถ้าไม่ฟรี ให้หยุดและถามแม่หมอ
- `backup.sh` ล้มเหลว → ส่ง LINE แจ้งเตือนด้วย `curl` ไปยัง push API (ใช้ token/userId จาก env เดียวกัน) ข้อความ `RakaKoom: สำรองฐานข้อมูลวันที่ {date} ล้มเหลว`

- [ ] **Step 1:** เขียนไฟล์ใน `deploy/` และ `deploy/README.md` (สร้างเครื่อง, เปิดเฉพาะพอร์ต SSH, ติดตั้ง Node 22 + Postgres 16, สร้างผู้ใช้/ฐานข้อมูล, clone, `npm ci`, ใส่ env, `npm run migrate`, เปิด timer, ตั้ง bucket + lifecycle, ใส่ URL healthchecks)
- [ ] **Step 2:** รัน `bash -n deploy/*.sh` และ `systemd-analyze verify deploy/*.service deploy/*.timer` (บนเครื่องเซิร์ฟเวอร์) → ไม่มี error
- [ ] **Step 3: ทดสอบจริงบนเซิร์ฟเวอร์** (หลัง P1–P4 เสร็จ): `sudo systemctl start rakakoom-collect.service` แล้วรอจนจบ → `journalctl -u rakakoom-collect` แสดง JSON ที่ `"status":"success"`; `psql -c "select feed_date,status,rows_read,rows_kept from feed_runs"` มี 1 แถว success; `rows_read` ประมาณ 2,000,000
- [ ] **Step 4: ทดสอบว่าการแจ้งเตือนทำงาน:** ตั้ง `FEED_URLS` ชั่วคราวเป็น URL ที่ไม่มีอยู่ → รัน service → แม่หมอได้ข้อความ LINE "ล้มเหลว" และ healthchecks แสดงสถานะ fail → คืนค่า env เดิม
- [ ] **Step 5:** รัน `sudo systemctl start rakakoom-backup.service` → มีไฟล์ dump ใน bucket; ลองกู้คืนลงฐานข้อมูลชั่วคราวด้วย `pg_restore` แล้วนับแถว `price_changes` ให้ตรงกับต้นฉบับ
- [ ] **Step 6:** วัดเวลาที่ใช้และขนาดฐานข้อมูลหลังรอบแรก (`select pg_size_pretty(pg_database_size('rakakoom'))`) แล้วจดลง `deploy/README.md` เพื่อคาดว่าดิสก์ 150 GB พอกี่วัน
- [ ] **Step 7:** Commit `chore: oracle cloud deployment and backups`

---

## ทำทีหลัง (แผนแยก — ไม่อยู่ในแผนนี้)
- แผน 2: บอท LINE (รับลิงก์, จับคู่รุ่น, ราคา 3 แบบ, คำแนะนำ, ป้ายร้าน, การ์ด Flex)
- แผน 3: หน้าชาร์ต LIFF
- แผน 4: หน้าแอดมินปฏิทินโค้ด/ปฏิทินโปร
