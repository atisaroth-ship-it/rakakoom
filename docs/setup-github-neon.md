# ตั้งค่าระบบเก็บราคาบน GitHub Actions + Neon (ฟรี ไม่ต้องผูกบัตร)

ต้องเตรียมก่อน: LINE channel access token, LINE user ID ของแม่หมอ, ลิงก์ฟีดทั้ง 2 ไฟล์ (ดูแผนข้อ P2–P4)

## 1. Neon (ฐานข้อมูล)
1. สมัครที่ neon.com (ใช้บัญชี Google หรือ GitHub ได้ ไม่ต้องใช้บัตร)
2. Create project: ชื่อ `rakakoom`, **Postgres 17**, ภูมิภาค **AWS US East (Ohio หรือ N. Virginia)** — ใกล้เครื่องของ GitHub ที่สุด
3. หน้า Dashboard → Connect → เลือก **ปิด Connection pooling** (ใช้ direct connection) → คัดลอก connection string
   - ควรหน้าตาแบบ `postgresql://<user>:<password>@<host>/<db>?sslmode=require`
   - ถ้ามี `&channel_binding=require` ต่อท้าย **ให้ลบส่วนนั้นออก**
   - นี่คือรหัสผ่านฐานข้อมูล ห้ามส่งในแชทหรือใส่ในไฟล์ใด ๆ

## 2. healthchecks.io (เตือนเมื่อระบบไม่ได้รันเลย)
สร้าง 2 check และตั้งให้ส่งการแจ้งเตือนหาแม่หมอ (อีเมลหรือ LINE):
- `rakakoom-collect`: Period 1 day, Grace 8 hours
- `rakakoom-backup`: Period 7 days, Grace 1 day

## 3. GitHub
1. สมัคร github.com (ไม่ต้องใช้บัตร)
2. New repository: ชื่อ `rakakoom`, **Public**, ไม่ต้องติ๊กสร้าง README
3. ส่งโค้ดขึ้น repo (Claude ช่วยทำให้ได้ถ้าแม่หมอล็อกอิน GitHub บนเครื่องนี้แล้ว) — ใช้ branch `feat/price-collector` เป็น main หรือ merge ก่อน
4. Settings → Secrets and variables → Actions → **New repository secret** ใส่ทีละตัว:

| ชื่อ | ค่า |
|---|---|
| `DATABASE_URL` | connection string จาก Neon (ข้อ 1.3) |
| `FEED_URLS` | ลิงก์ฟีดไฟล์ 1 และ 2 คั่นด้วยจุลภาค |
| `LINE_CHANNEL_ACCESS_TOKEN` | token ของ LINE OA |
| `ADMIN_LINE_USER_ID` | user ID ของแม่หมอ (ขึ้นต้นด้วย `U`) |
| `HEALTHCHECK_URL` | URL ping ของ check `rakakoom-collect` |
| `BACKUP_HEALTHCHECK_URL` | URL ping ของ check `rakakoom-backup` |

5. (ไม่บังคับ) แท็บ Variables: `DB_SIZE_LIMIT_MB` = `1024` (ค่าเริ่มต้นอยู่แล้ว)
6. แท็บ Actions → ถ้าขึ้นให้เปิดใช้ workflows ให้กดเปิด

**ข้อควรระวัง:** log ของการรันใน repo สาธารณะใครก็เปิดดูได้ ค่าใน Secrets จะถูกซ่อนเป็น `***` อัตโนมัติ ห้ามแก้ workflow ให้พิมพ์ค่าความลับออกมา

## 4. ทดสอบ (ทำตามลำดับ)
1. **การแจ้งเตือนเมื่อล้ม:** แก้ secret `FEED_URLS` ชั่วคราวเป็น `https://example.invalid/x` → Actions → collect prices → **Run workflow** (ต้องเป็นหลัง 10:00 เวลาไทย) → แม่หมอต้องได้ LINE "ล้มเหลว" **ข้อความเดียว** และ healthchecks ขึ้น fail → แก้ secret กลับเป็นค่าจริง
2. **เก็บราคาจริง:** Run workflow อีกครั้ง → รอจนจบ (อาจหลายสิบนาที) → เปิด log ขั้น "Collect today's prices" บรรทัดสุดท้ายต้องมี `"status":"success"` และ `"rowsRead"` ประมาณ 2,000,000
3. **ฟีดส่ง Last-Modified ไหม:** Neon → SQL Editor → `select feed_date, status, rows_read, rows_kept, last_modified, finished_at - started_at as took from feed_runs order by id desc limit 3;` ถ้า `last_modified` เป็น `[null, null]` ระบบจะพึ่งได้แค่การไม่รันก่อน 10:00 — จดไว้ในข้อ 5
4. **สำรองข้อมูล:** Actions → backup database → Run workflow → หน้าผลการรันต้องมี artifact `rakakoom-<วันที่>` และ healthchecks `rakakoom-backup` ขึ้น up
5. **ลองกู้ข้อมูล:** ดาวน์โหลด artifact → Neon สร้าง branch ใหม่ชื่อ `restore-check` → `pg_restore --no-owner -d "<connection string ของ branch นั้น>" rakakoom-<วันที่>.dump` → นับ `select count(*) from price_changes` ให้เท่าของจริง → ลบ branch
6. **ตารางเวลา:** วันถัดไป แท็บ Actions ต้องเห็น collect prices รันเองช่วง 10:30 เวลาไทย (GitHub อาจช้าไปบ้าง)

## 5. ผลจากรอบจริงครั้งแรก (กรอกหลังทดสอบ)
- เวลาที่ใช้ต่อรอบ: _
- ฟีดส่ง Last-Modified หรือไม่: _
- จำนวนสินค้า/variant ที่เก็บ (`rows_kept`, `select count(*) from variants`): _
- ขนาดฐานข้อมูล (`select pg_size_pretty(pg_database_size(current_database()))`): _
- ขนาดไฟล์สำรอง: _ → ส่งข้อมูลออกต่อเดือน ≈ ขนาด × 4 ต้องไม่เกิน 5 GB
